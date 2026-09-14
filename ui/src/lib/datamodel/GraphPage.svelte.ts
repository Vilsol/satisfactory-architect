import { assertUnreachable, copyText, deepClone, roundToNearest } from "$lib/utilties";
import { untrack } from "svelte";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { type IdGen, type Id, IdMapper, type PasteSource } from "./IdGen.svelte";
import { clipboardDataType, dataModelVersion, NodePriorities } from "./constants";
import type { GraphPageJson } from "../../../../server/shared/types_serialization";
import { isNodeAttachable } from "./nodeTypeProperties.svelte";
import { applyJsonToMap, applyJsonToSet, StateHistory, type JsonSerializable } from "./StateHistory.svelte";
import { GraphEdge, type GraphEdgeProperties } from "./GraphEdge.svelte";
import { type LayoutOrientation, GraphNode, type GraphNodeResourceJointProperties, type NewNodeDetails, type ProductionDetails, type JointDragType } from "./GraphNode.svelte";
import { GraphView, type IVector2D } from "./GraphView.svelte";
import type { AppState } from "./AppState.svelte";
import { settings } from "$lib/settings.svelte";
import { blockStateChanges, unblockStateChanges } from "./globals.svelte";
import type { Rotation } from "./productionLayout";

export type PageContext = {
	appState: AppState,
	page: GraphPage,
};

const oppositeLayoutOrientation: Record<LayoutOrientation, LayoutOrientation> = {
	"top": "bottom",
	"bottom": "top",
	"left": "right",
	"right": "left",
};
export type NodeHighlightType = "attachable" | "hovered";
export type ToolMode = "select-nodes"|"select-edges"|"add-note"|"drag-view";
export class GraphPage implements JsonSerializable<PageContext> {
	readonly context: PageContext;
	readonly idGen: IdGen;
	readonly id: Id;
	name: string;
	icon: string;
	readonly view: GraphView;
	readonly nodes: SvelteMap<Id, GraphNode>;
	readonly edges: SvelteMap<Id, GraphEdge>;
	toolMode: ToolMode;
	readonly selectedNodes: SvelteSet<Id>;
	readonly selectedEdges: SvelteSet<Id>;
	readonly history: StateHistory<PageContext>;
	readonly highlightedNodes: Record<NodeHighlightType, SvelteSet<Id>>;
	userEventsPriorityNodeId: Id | null;
	svgElement: Element | null;
	asJson: any;

	constructor(appState: AppState, id: Id, name: string, icon: string, view: GraphView, nodes: GraphNode[], edges: GraphEdge[], toolMode: ToolMode) {
		this.context = { appState, page: this };
		this.idGen = appState.idGen;
		this.id = id;
		this.name = $state(name);
		this.icon = $state(icon);
		this.view = view;
		this.nodes = new SvelteMap(nodes.map((n) => [n.id, n]));
		this.edges = new SvelteMap(edges.map((e) => [e.id, e]));
		this.toolMode = $state(toolMode);
		this.selectedNodes = new SvelteSet();
		this.selectedEdges = new SvelteSet();
		this.history = new StateHistory(this, this.context);
		this.highlightedNodes = {
			attachable: new SvelteSet(),
			hovered: new SvelteSet(),
		};
		this.userEventsPriorityNodeId = $state(null);
		this.svgElement = null;
		this.asJson = $derived(this.toJSON());
	}

	static newDefault(appState: AppState, name: string = "New Page"): GraphPage {
		const view = GraphView.newDefault();
		return new GraphPage(appState, appState.idGen.nextId(), name, "IconDesc_FactoryStencil", view, [], [], "select-nodes");
	}

	static fromJSON(appState: AppState, json: GraphPageJson): GraphPage {
		const view = GraphView.fromJSON(json.view);
		const page = new GraphPage(appState, json.id, json.name, json.icon, view, [], [], json.toolMode as ToolMode);
		const nodes = Object.values(json.nodes).map((n) => GraphNode.fromJSON(n, page.context));
		for (const node of nodes) {
			page.nodes.set(node.id, node);
		}
		const edges = Object.values(json.edges).map((e) => GraphEdge.fromJSON(e, page.context));
		for (const edge of edges) {
			page.edges.set(edge.id, edge);
		}
		return page;
	}

	applyJson(json: any): void {
		if (json.version !== dataModelVersion) {
			throw new Error(`Unsupported data model version: ${json.version}. Expected: ${dataModelVersion}`);
		}
		this.name = json.name;
		this.icon = json.icon;
		applyJsonToMap(json.nodes as any, this.nodes, GraphNode.fromJSON as any, this.context);
		applyJsonToMap(json.edges as any, this.edges, GraphEdge.fromJSON as any, this.context);
		applyJsonToSet(json.selectedNodes, this.selectedNodes);
		applyJsonToSet(json.selectedEdges, this.selectedEdges);
	}

	applySyncJson(json: any): void {
		if (json.version !== dataModelVersion) {
			throw new Error(`Unsupported data model version: ${json.version}. Expected: ${dataModelVersion}`);
		}
		this.name = json.name;
		this.icon = json.icon;
		this.toolMode = json.toolMode;
	}

	toJSON(): GraphPageJson {
		return {
			version: dataModelVersion,
			type: "graph-page",
			id: this.id,
			name: this.name,
			icon: this.icon,
			view: untrack(() => this.view.toJSON()),
			nodes: Object.fromEntries(this.nodes.entries().map(([k, n]) => [k, n.asJson])),
			edges: Object.fromEntries(this.edges.entries().map(([k, e]) => [k, e.asJson])),
			toolMode: untrack(() => this.toolMode),
			selectedNodes: Array.from(this.selectedNodes),
			selectedEdges: Array.from(this.selectedEdges),
		};
	}

	toSyncJson(): any {
		return {
			version: dataModelVersion,
			type: "graph-page",
			id: this.id,
			name: this.name,
			icon: this.icon,
			view: untrack(() => this.view.toJSON()),
			toolMode: untrack(() => this.toolMode),
		};
	}

	afterPaste(mapper: IdMapper, pasteSource: PasteSource) {
		for (const item of [...this.nodes.values(), ...this.edges.values()]) {
			item.afterPaste(mapper, pasteSource);
		}
	}

	addNodes(...nodes: GraphNode[]): void {
		for (const node of nodes) {
			if (this.nodes.has(node.id)) {
				throw new Error(`Node with id ${node.id} already exists.`);
			}
			this.nodes.set(node.id, node);
		}
	}

	removeNode(nodeId: Id): void {
		if (!this.nodes.has(nodeId)) {
			return;
		}
		const node = this.nodes.get(nodeId)!;
		for (const childId of node.children) {
			const childNode = this.nodes.get(childId);
			if (childNode) {
				this.removeNode(childId);
			}
		}
		for (const edgeId of node.edges) {
			this.removeEdge(edgeId);
		}
		this.nodes.delete(nodeId);
		this.selectedNodes.delete(nodeId);
		if (this.selectedNodes.has(nodeId)) {
			this.selectedNodes.delete(nodeId);
		}
	}

	removeSelectedNodes(): void {
		for (const nodeId of this.selectedNodes) {
			this.removeNode(nodeId);
		}
		this.selectedNodes.clear();
	}

	removeSelectedEdges(): void {
		for (const edgeId of this.selectedEdges) {
			this.removeEdge(edgeId);
		}
		this.selectedEdges.clear();
	}

	removeSelectedNodesAndEdges(): void {
		this.removeSelectedNodes();
		this.removeSelectedEdges();
	}

	addChildrenToNode(parentNode: GraphNode, ...childNodes: GraphNode[]): void {
		if (!this.nodes.has(parentNode.id)) {
			throw new Error("Parent node must exist in the this.");
		}
		for (const childNode of childNodes) {
			if (childNode.parentNode !== null) {
				throw new Error(`Child node ${childNode.id} already has a parent.`);
			}
			parentNode.children.add(childNode.id);
			childNode.parentNode = parentNode.id;
		}
	}

	addEdge(edge: GraphEdge): void {
		if (this.edges.has(edge.id)) {
			throw new Error(`Edge with id ${edge.id} already exists.`);
		}
		this.edges.set(edge.id, edge);
	}

	addEdgeBetweenNodes(edge: GraphEdge, startNode: GraphNode, endNode: GraphNode): void {
		this.edges.set(edge.id, edge);
		edge.connectNode(startNode, "start", this);
		edge.connectNode(endNode, "end", this);
	}

	removeEdge(edgeId: Id): void {
		const edge = this.edges.get(edgeId);
		if (!edge) {
			return;
		}
		const startNode = this.nodes.get(edge.startNodeId);
		const endNode = this.nodes.get(edge.endNodeId);
		if (startNode) {
			startNode.edges.delete(edge.id);
		}
		if (endNode) {
			endNode.edges.delete(edge.id);
		}
		this.edges.delete(edgeId);
		if (this.selectedEdges.has(edgeId)) {
			this.selectedEdges.delete(edgeId);
		}
	}

	moveSelectedNodes(totalDeltaX: number, totalDeltaY: number): void {
		for (const nodeId of this.selectedNodes) {
			const node = this.nodes.get(nodeId);
			if (node) {
				this.moveNode(node, totalDeltaX, totalDeltaY);
			}
		}
	}

	startMovingSelectedNodes(): void {
		for (const nodeId of this.selectedNodes) {
			const node = this.nodes.get(nodeId);
			if (node) {
				this.startMovingNode(node);
			}
		}
	}

	startMovingNode(node: GraphNode): void {
		node.onDragStart();
	}

	clearHighlightedNodes(): void {
		for (const nodes of Object.values(this.highlightedNodes)) {
			nodes.clear();
		}
	}

	getResourceJointAttachableNodes(movingNode: GraphNode<GraphNodeResourceJointProperties>): GraphNode[] {
		const originalNodeEdges = this.nodes.get(movingNode.properties.dragStartNodeId!)?.edges ?? [];
		const ignoreNodeIds = new Set([movingNode.id]);
		const ignoreEdges = [...movingNode.edges, ...originalNodeEdges];
		if (movingNode.edges.size >= 1) {
			const edge = this.edges.get(movingNode.edges.values().next().value!);
			if (edge) {
				let otherNodeId: Id | undefined;
				if (edge.startNodeId === movingNode.id) {
					otherNodeId = edge.endNodeId;
				} else if (edge.endNodeId === movingNode.id) {
					otherNodeId = edge.startNodeId;
				}
				const otherNode = otherNodeId ? this.nodes.get(otherNodeId) : undefined;
				if (otherNode) {
					ignoreEdges.push(...otherNode.edges);
				}
			}
		}
		for (const edgeIds of ignoreEdges) {
			const edge = this.edges.get(edgeIds);
			if (!edge) {
				continue;
			}
			for (const otherNodeId of [edge.startNodeId, edge.endNodeId]) {
				ignoreNodeIds.add(otherNodeId);
			}
		}
		
		const isOutput = movingNode.properties.jointType === "output";
		const attachableNodes: GraphNode[] = [];
		for (const node of this.nodes.values()) {
			if (ignoreNodeIds.has(node.id)) {
				continue;
			}
			if (!isNodeAttachable(node)) {
				continue;
			}
			const properties = node.properties;
			if ("resourceClassName" in properties) {
				if (properties.resourceClassName !== movingNode.properties.resourceClassName) {
					continue;
				}
				if (properties.type === "resource-joint") {
					if (properties.jointType !== movingNode.properties.jointType) {
						continue;
					}
				} else if (properties.type === "splitter" || properties.type === "merger") {
					const attachedEdges = Array.from(node.edges.values()
						.map(edgeId => this.edges.get(edgeId))
						.filter(edge => edge !== undefined));
					const incomingEdges = attachedEdges.filter(edge => edge.endNodeId === node.id).length;
					const outgoingEdges = attachedEdges.filter(edge => edge.startNodeId === node.id).length;
					if (properties.type === "splitter" && incomingEdges >= 1 && !isOutput) {
						continue;
					} else if (properties.type === "merger" && outgoingEdges >= 1 && isOutput) {
						continue;
					}
				} else {
					assertUnreachable(properties.type);
				}
				attachableNodes.push(node as GraphNode);
			}
			else {
				continue;
			}
		}

		return attachableNodes;
	}

	startMovingRecipeResourceJoint(
		node: GraphNode,
		position: IVector2D,
		jointType: "input" | "output",
		jointDragType: JointDragType,
		resourceClassName: string,
		layoutOrientation?: LayoutOrientation,
		ownerUserId?: string | null,
	): GraphNode<GraphNodeResourceJointProperties> {
		const newNode = new GraphNode<GraphNodeResourceJointProperties>(
			this.idGen.nextId(),
			this.context,
			position,
			NodePriorities.TOP_LEVEL,
			[],
			null,
			[],
			{
				type: "resource-joint",
				resourceClassName: resourceClassName,
				jointType: jointType === "input" ? "output" : "input",
				layoutOrientation: oppositeLayoutOrientation[layoutOrientation!],
				locked: false,
				jointDragType: jointDragType,
				dragStartNodeId: node.id,
				dragOwnerUserId: ownerUserId,
			}
		);
		this.addNodes(newNode);
		const properties: GraphEdgeProperties = {
			displayType: settings.defaultEdgeDisplayType.value,
			isDrainLine: false,
			startOrientation: null,
			endOrientation: null,
		};
		this.addEdgeBetweenNodes(
			new GraphEdge(this.context, this.idGen.nextId(), "item-flow", "", "", properties),
			jointType === "input" ? newNode : node,
			jointType === "input" ? node : newNode
		);
		newNode.onDragStart();
		return newNode;
	}

	onResourceJointDragEnd(node: GraphNode) {
		if (node.edges.size <= 1) {
			this.removeNode(node.id);
		}
	}
	
	connectResourceJoints(movingNode: GraphNode, destNode: GraphNode) {
		const movingEdge = this.edges.get(movingNode.edges.values().next().value!);
		if (!movingEdge) {
			console.error("Moving node does not have an edge.");
			this.removeNode(movingNode.id);
			return;
		}
		let otherNode: GraphNode|undefined;
		if (movingEdge.startNodeId === movingNode.id) {
			otherNode = this.nodes.get(movingEdge.endNodeId);
			movingEdge.connectNode(destNode, "start", this);
		} else if (movingEdge.endNodeId === movingNode.id) {
			otherNode = this.nodes.get(movingEdge.startNodeId);
			movingEdge.connectNode(destNode, "end", this);
		} else {
			console.error("Moving node is not connected to the edge.");
			this.removeNode(movingNode.id);
			return;
		}
		movingNode.edges.delete(movingEdge.id);
		if (movingNode.edges.size === 0) {
			this.removeNode(movingNode.id);
		}
		destNode.edges.add(movingEdge.id);

		if (destNode.parentNode && destNode.parentNode === otherNode?.parentNode) {
			movingEdge.properties.displayType = "angled";
		}
	}

	/** Turn every building in the selection, ignoring anything that cannot be turned. */
	rotateSelectedNodes(quarters: Rotation): void {
		for (const nodeId of this.selectedNodes) {
			this.nodes.get(nodeId)?.rotateBy(quarters);
		}
	}

	/**
	 * Put a splitter or merger into the middle of a belt that already exists.
	 *
	 * The one belt becomes two with the new node between them. Returns null, leaving
	 * everything as it was, if the belt is gone or its ends do not agree on an item -
	 * there would be nothing to give the new node to carry.
	 */
	splitEdge(edge: GraphEdge, nodeType: "splitter" | "merger", position: IVector2D): GraphNode | null {
		if (!this.edges.has(edge.id)) {
			return null;
		}
		const startNode = this.nodes.get(edge.startNodeId);
		const endNode = this.nodes.get(edge.endNodeId);
		if (!startNode || !endNode) {
			return null;
		}
		const resourceClassName = resourceCarriedBy(startNode) ?? resourceCarriedBy(endNode);
		if (!resourceClassName) {
			return null;
		}

		const { displayType, isDrainLine, startOrientation, endOrientation } = edge.properties;

		// One change as far as undo and the other people in the room are concerned, not a
		// belt vanishing followed by three things appearing.
		blockStateChanges();
		try {
			const middle = this.makeNewNode({ type: nodeType, resourceClassName }, position);
			this.removeEdge(edge.id);

			// The outer ends keep the direction they were leaving their port in. The two
			// new inner ends are left on auto, and the bends of the old belt are dropped:
			// they describe a shape between two points that are no longer joined.
			this.addEdgeBetweenNodes(
				new GraphEdge(this.context, this.idGen.nextId(), edge.type, "", "", {
					displayType,
					isDrainLine,
					startOrientation,
					endOrientation: null,
				}),
				startNode,
				middle,
			);
			this.addEdgeBetweenNodes(
				new GraphEdge(this.context, this.idGen.nextId(), edge.type, "", "", {
					displayType,
					isDrainLine,
					startOrientation: null,
					endOrientation,
				}),
				middle,
				endNode,
			);
			return middle;
		} finally {
			unblockStateChanges();
			this.history.onDataChange();
		}
	}

	moveNode(node: GraphNode, totalDeltaX: number, totalDeltaY: number) {
		node.move(totalDeltaX, totalDeltaY, this.view.gridSnap);
	}

	selectNode(node: GraphNode): void {
		this.selectedNodes.clear();
		this.selectedNodes.add(node.id);
	}

	toggleNodeSelection(node: GraphNode): void {
		if (this.selectedNodes.has(node.id)) {
			this.selectedNodes.delete(node.id);
		} else {
			this.selectedNodes.add(node.id);
		}
	}

	selectEdge(edge: GraphEdge): void {
		this.selectedEdges.clear();
		this.selectedEdges.add(edge.id);
	}

	toggleEdgeSelection(edge: GraphEdge): void {
		if (this.selectedEdges.has(edge.id)) {
			this.selectedEdges.delete(edge.id);
		} else {
			this.selectedEdges.add(edge.id);
		}
	}

	clearAllSelection(): void {
		this.selectedNodes.clear();
		this.selectedEdges.clear();
	}

	/** Pan the view so a node sits in the middle of the screen. */
	centerOnNode(node: GraphNode): void {
		const rect = this.svgElement?.getBoundingClientRect();
		const width = rect?.width ?? 0;
		const height = rect?.height ?? 0;
		const position = node.getAbsolutePosition(this);
		this.view.offset.x = width / 2 - position.x * this.view.scale;
		this.view.offset.y = height / 2 - position.y * this.view.scale;
	}

	screenToPageCoords(screen: IVector2D): IVector2D {
		let offset: IVector2D;
		if (this.svgElement) {
			const rect = this.svgElement.getBoundingClientRect();
			offset = { x: rect.left, y: rect.top };
		} else {
			offset = { x: 0, y: 0 };
		}
		const graphX = (screen.x - offset.x - this.view.offset.x) / this.view.scale;
		const graphY = (screen.y - offset.y - this.view.offset.y) / this.view.scale;
		return { x: graphX, y: graphY };
	}

	makeNewNode(newNodeDetails: NewNodeDetails, position: IVector2D): GraphNode {
		if (newNodeDetails.type === "splitter" || newNodeDetails.type === "merger" || newNodeDetails.type === "text-note") {
			const node = new GraphNode(
				this.idGen.nextId(),
				this.context,
				{x: 0, y: 0},
				NodePriorities.OTHER,
				[],
				null,
				[],
				newNodeDetails,
			);
			node.onDragStart();
			this.moveNode(node, position.x, position.y);
			this.addNodes(node);
			return node;
		} else {
			const {parent, children} = GraphNode.makeProductionNode(
				this.idGen,
				this.context,
				{x: 0, y: 0},
				[],
				newNodeDetails as ProductionDetails,
			);
			parent.onDragStart();
			this.moveNode(parent, position.x, position.y);
			this.addNodes(parent);
			for (const child of children) {
				this.addNodes(child);
				this.addChildrenToNode(parent, child);
			}
			return parent;
		}
	}

	/**
	 * Who is part-way through dragging a new belt out of which node.
	 *
	 * A drag in progress is a temporary joint carrying the id of the node it started
	 * from and whose drag it is. Both are ordinary synced nodes, so everyone already
	 * has this - it just needs collecting into something a node can ask about itself
	 * without searching the whole page.
	 *
	 * Everything caught up in the drag is listed: the building the belt is being pulled
	 * out of, the joint on it, the loose end following the cursor, and the belt between
	 * them - so all of it can be shown in that person's colour.
	 */
	private readonly _dragHighlightsByUser: { nodes: Map<Id, string>; edges: Map<Id, string> } = $derived.by(() => {
		const nodes = new Map<Id, string>();
		const edges = new Map<Id, string>();
		for (const node of this.nodes.values()) {
			if (node.properties.type !== "resource-joint") {
				continue;
			}
			const { jointDragType, dragStartNodeId, dragOwnerUserId } = node.properties;
			if (!jointDragType || !dragStartNodeId || !dragOwnerUserId) {
				continue;
			}
			// The loose end being dragged around.
			nodes.set(node.id, dragOwnerUserId);
			// The joint it was pulled out of, and the building that joint belongs to.
			nodes.set(dragStartNodeId, dragOwnerUserId);
			const origin = this.nodes.get(dragStartNodeId);
			if (origin?.parentNode) {
				nodes.set(origin.parentNode, dragOwnerUserId);
			}
			// And the belt stretched between the two.
			for (const edgeId of node.edges) {
				edges.set(edgeId, dragOwnerUserId);
			}
		}
		return { nodes, edges };
	});

	/**
	 * Worked out once for the whole page rather than per node.
	 *
	 * Every node and every belt asks this about itself while the page is being drawn.
	 * As a plain getter that meant walking the whole page once per node - fine for a
	 * few, and a large part of the time to open a page with a few hundred.
	 */
	get dragHighlightsByUser(): { nodes: Map<Id, string>; edges: Map<Id, string> } {
		return this._dragHighlightsByUser;
	}

	/** The current selection in the same shape as the clipboard, or null if empty. */
	selectionAsJson(): any | null {
		const selectedNodes = Array.from(this.selectedNodes.values()
			.map((id) => this.nodes.get(id)!));
		if (selectedNodes.length === 0) {
			return null;
		}
		const selectedJointIds = new Set(selectedNodes
			.flatMap(n => Array.from(n.children.values())));
		const selectedJoints = Array.from(selectedJointIds.values()
			.map((id) => this.nodes.get(id))
			.filter(n => n !== undefined));
		const allNodes = [...selectedNodes, ...selectedJoints];
		const allNodeIds = new Set(allNodes.map(n => n.id));
		const selectedEdges = Array.from(this.edges.values()
			.filter(e => allNodeIds.has(e.startNodeId) && allNodeIds.has(e.endNodeId)));
		return {
			type: clipboardDataType,
			version: dataModelVersion,
			nodes: allNodes.map((n) => deepClone(n.asJson)),
			edges: selectedEdges.map((e) => deepClone(e.asJson)),
		};
	}

	copyOrCutSelection(mode: "copy" | "cut") {
		const json = this.selectionAsJson();
		if (!json) {
			return;
		}
		copyText(JSON.stringify(json));
		if (mode === "cut") {
			this.removeSelectedNodesAndEdges();
		}
	}

	insertJson(data: any, pasteSource: PasteSource, centerPoint?: IVector2D) {
		if (data.type !== clipboardDataType || data.version !== dataModelVersion) {
			console.log("Unsupported data format or version");
			return;
		}
		const idMapper = new IdMapper(this.idGen);
		for (const item of [...data.nodes, ...data.edges]) {
			if ("id" in item) {
				item.id = idMapper.mapId(item.id);
			}
		}
		const nodes = (data.nodes as any[]).map((n: any) => GraphNode.fromJSON(n, this.context));
		const edges = (data.edges as any[]).map((e: any) => GraphEdge.fromJSON(e, this.context));
		for (const node of nodes) {
			node.afterPaste(idMapper, pasteSource);
			this.addNodes(node);
		}
		for (const edge of edges) {
			edge.afterPaste(idMapper);
			this.addEdge(edge);
		}

		if (centerPoint) {
			const nodesCenter: IVector2D = {x: 0, y: 0};
			let count = 0;
			for (const node of nodes) {
				if (node.parentNode !== null) {
					continue;
				}
				nodesCenter.x += node.position.x;
				nodesCenter.y += node.position.y;
				count++;
			}
			nodesCenter.x /= count;
			nodesCenter.y /= count;
			if (this.view.enableGridSnap) {
				centerPoint.x = roundToNearest(centerPoint.x, this.view.gridSnap);
				centerPoint.y = roundToNearest(centerPoint.y, this.view.gridSnap);
				nodesCenter.x = roundToNearest(nodesCenter.x, this.view.gridSnap);
				nodesCenter.y = roundToNearest(nodesCenter.y, this.view.gridSnap);
			}
			const deltaX = centerPoint.x - nodesCenter.x;
			const deltaY = centerPoint.y - nodesCenter.y;
			for (const node of nodes) {
				if (node.parentNode !== null) {
					continue;
				}
				node.position.x += deltaX;
				node.position.y += deltaY;
			}
		}
	}
}

/** The item a joint, splitter or merger deals in. Nothing else carries one. */
function resourceCarriedBy(node: GraphNode): string | undefined {
	const properties = node.properties;
	return "resourceClassName" in properties ? properties.resourceClassName : undefined;
}
