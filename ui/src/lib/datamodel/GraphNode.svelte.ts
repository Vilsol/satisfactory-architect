import { satisfactoryDatabase } from "$lib/satisfactoryDatabase";
import { buildingOf, clampClockSpeed, clampSloops, sloopSlotsOf } from "./overclocking";
import type { SFRecipePart } from "$lib/satisfactoryDatabaseTypes";
import { assertUnreachable, roundToNearest } from "$lib/utilties";
import { SvelteSet } from "svelte/reactivity";
import type { GraphPage, PageContext } from "./GraphPage.svelte";
import { Vector2D, type IVector2D } from "./GraphView.svelte";
import type { Id, IdGen, IdMapper, PasteSource } from "./IdGen.svelte";
import type { GraphNodeJson } from "../../../../server/shared/types_serialization";
import { NodePriorities } from "./constants";
import { getNodeRadius } from "./nodeTypeProperties.svelte";
import { applyJsonToObject, applyJsonToSet, type JsonSerializable } from "./StateHistory.svelte";
import { settings } from "$lib/settings.svelte";
import { jointSide, jointSlots, normaliseRotation, productionNodeSize, rotateQuarters, type Rotation } from "./productionLayout";

export type GraphNodeType = "production" | "resource-joint" | "splitter" | "merger" | "factory-reference" | "text-note";
export interface ResourceJointInfo {
	id: Id;
	type: "input" | "output";
}
export interface ProductionRecipeDetails {
	type: "recipe";
	recipeClassName: string;
}
export interface ProductionExtractionDetails {
	type: "extraction";
	partClassName: string;
	buildingClassName: string;
	purityModifier: 0.5 | 1 | 2;
}
export interface PowerProductionDetails {
	type: "power-production";
	powerBuildingClassName: string;
	fuelClassName: string;
}
export interface ProductionFactoryInOutDetails {
	type: "factory-output" | "factory-input";
	partClassName: string;
}
export interface FactoryReferenceDetails {
	type: "factory-reference";
	factoryId: Id;
	jointsToExternalNodes: Record<Id, Id>;
}
export type ProductionDetails =
	ProductionRecipeDetails |
	ProductionExtractionDetails |
	ProductionFactoryInOutDetails |
	FactoryReferenceDetails |
	PowerProductionDetails;
export interface GraphNodeProductionProperties {
	type: "production";
	details: ProductionDetails;
	multiplier: number;
	autoMultiplier: boolean;
	resourceJoints: ResourceJointInfo[];
	customColor?: string;
	/**
	 * Quarter turns clockwise. Optional, so saves written before buildings could be
	 * turned load as they always did rather than needing the format version bumped.
	 */
	rotation?: Rotation;
	/**
	 * How fast the building is run, as a fraction of normal. Absent means normal speed,
	 * the same way an absent rotation means upright.
	 */
	clockSpeed?: number;
	/** Somersloops in the building. Absent means none. */
	sloops?: number;
}
export type LayoutOrientation = "top" | "bottom" | "left" | "right";
export type JointDragType = "drag-to-connect" | "click-to-connect";
export interface GraphNodeResourceJointProperties {
	type: "resource-joint";
	resourceClassName: string;
	jointType: "input" | "output";
	layoutOrientation: LayoutOrientation | undefined;
	locked: boolean;
	jointDragType?: JointDragType;
	dragStartNodeId?: Id;
	dragOwnerUserId?: string | null;
}
export interface GraphNodeSplitterMergerProperties {
	type: "splitter" | "merger";
	resourceClassName: string;
}
export interface GraphNodeTextNoteProperties {
	type: "text-note";
	content: string;
}
export type NewNodeDetails = ProductionDetails | GraphNodeSplitterMergerProperties | GraphNodeTextNoteProperties;
export type GraphNodeProperties =
	GraphNodeProductionProperties |
	GraphNodeResourceJointProperties |
	GraphNodeSplitterMergerProperties |
	GraphNodeTextNoteProperties;
export class GraphNode<T extends GraphNodeProperties = GraphNodeProperties> implements JsonSerializable<PageContext> {
	readonly id: Id;
	readonly context: PageContext;
	readonly position: Vector2D;
	private dragStartPosition: IVector2D;
	readonly priority: number;
	readonly edges: SvelteSet<Id>;
	parentNode: Id|null;
	readonly children: SvelteSet<Id>;
	readonly properties: T;
	size: IVector2D;
	/** For an output joint: made but not shipped. Zero for everything else. */
	surplus: number;
	/** For an input joint: wanted but not received. Zero for everything else. */
	shortfall: number;
	/**
	 * The rate this joint would have to be set to so it matched the other side of its
	 * belts - what upstream could supply it, or what downstream would take from it.
	 */
	balanceTarget: number;
	readonly asJson: any;

	constructor(id: Id, context: PageContext, position: IVector2D, priority: number, edges: Id[], parentNode: Id|null, children: Id[], properties: T, size?: IVector2D) {
		this.id = id;
		this.context = context;
		this.position = new Vector2D(position);
		this.dragStartPosition = { x: 0, y: 0 };
		this.priority = priority;
		this.edges = new SvelteSet(edges);
		this.parentNode = parentNode;
		this.children = new SvelteSet(children);
		this.properties = $state(properties);
		if (!size) {
			const radius = getNodeRadius(this);
			size = {
				x: radius,
				y: radius,
			};
		}
		this.size = $state(size);
		this.surplus = $state(0);
		this.shortfall = $state(0);
		this.balanceTarget = $state(0);
		this.asJson = $derived(this.toJSON());
	}

	static makeProductionNode(
		idGen: IdGen,
		context: PageContext,
		position: IVector2D,
		edges: Id[],
		details: ProductionDetails,
	): {parent: GraphNode<GraphNodeProductionProperties>, children: GraphNode<GraphNodeResourceJointProperties>[]} {
		let inputs: SFRecipePart[];
		let outputs: SFRecipePart[];
		let multiplier = 1;
		let useAutoMultiplier = false;
		const extInputNodeIds: Id[] = [];
		const extOutputNodeIds: Id[] = [];
		switch (details.type) {
			case "recipe":
				const recipe = satisfactoryDatabase.recipes[details.recipeClassName];
				if (!recipe) {
					throw new Error(`Recipe with class name ${details.recipeClassName} does not exist.`);
				}
				inputs = recipe.inputs;
				outputs = recipe.outputs;
				break;
			case "factory-output":
			case "factory-input":
				const recipePart = {
					itemClass: details.partClassName,
					amountPerMinute: 1,
				};
				if (details.type === "factory-output") {
					inputs = [recipePart];
					outputs = [];
				} else {
					inputs = [];
					outputs = [recipePart];
				}
				multiplier = settings.factoryIoRate.value;
				if (settings.autoRateForFactoryIo.value) {
					useAutoMultiplier = true;
				}
				break;
			case "extraction":
				const part = satisfactoryDatabase.parts[details.partClassName];
				if (!part) {
					throw new Error(`Part with class name ${details.partClassName} does not exist.`);
				}
				inputs = [];
				outputs = [ {
					itemClass: details.partClassName,
					amountPerMinute: 60
				} ];
				break;
			case "power-production":
				const powerBuilding = satisfactoryDatabase.powerProducers[details.powerBuildingClassName];
				const fuel = powerBuilding?.fuels[details.fuelClassName];
				if (!powerBuilding || !fuel) {
					throw new Error(`Power building with class name ${details.powerBuildingClassName} or fuel ${details.fuelClassName} does not exist.`);
				}
				inputs = fuel.inputs.map(input => ({...input}));
				outputs = fuel.outputs.map(output => ({...output}));
				break;
			case "factory-reference":
				const page = context.appState.pages.find(p => p.id === details.factoryId);
				if (!page) {
					throw new Error(`Factory page with id ${details.factoryId} does not exist.`);
				}
				inputs = [];
				outputs = [];
				for (const node of page.nodes.values()) {
					if (node.properties.type !== "production") {
						continue;
					}
					if (node.properties.details.type === "factory-input") {
						inputs.push({
							itemClass: node.properties.details.partClassName,
							amountPerMinute: node.properties.multiplier,
						});
						extInputNodeIds.push(node.id);
					} else if (node.properties.details.type === "factory-output") {
						outputs.push({
							itemClass: node.properties.details.partClassName,
							amountPerMinute: node.properties.multiplier,
						});
						extOutputNodeIds.push(node.id);
					}
				}
				break;
			default:
				assertUnreachable(details);
		}
		// A new building comes out upright; turning it is something you do afterwards.
		const maxJointsPerSide = Math.max(inputs.length, outputs.length);
		const nodeSize = productionNodeSize(maxJointsPerSide, 0);
		const inputSlots = jointSlots(inputs.length, maxJointsPerSide, "input", 0);
		const outputSlots = jointSlots(outputs.length, maxJointsPerSide, "output", 0);
		const children: GraphNode<GraphNodeResourceJointProperties>[] = [];
		const resourceJoints: ResourceJointInfo[] = [];
		for (let i = 0; i < inputs.length; i++) {
			const input = inputs[i];
			const jointNode = new GraphNode(
				idGen.nextId(),
				context,
				inputSlots[i],
				NodePriorities.RESOURCE_JOINT,
				[],
				null,
				[],
				{
					type: "resource-joint",
					resourceClassName: input.itemClass,
					jointType: "input",
					locked: true,
					layoutOrientation: "left",
				}
			);
			if (details.type === "factory-reference") {
				const externalId = extInputNodeIds[i];
				details.jointsToExternalNodes[jointNode.id] = externalId;
			}
			children.push(jointNode);
			resourceJoints.push({ id: jointNode.id, type: "input" });
		}
		for (let i = 0; i < outputs.length; i++) {
			const output = outputs[i];
			const jointNode = new GraphNode(
				idGen.nextId(),
				context,
				outputSlots[i],
				NodePriorities.RESOURCE_JOINT,
				[],
				null,
				[],
				{
					type: "resource-joint",
					resourceClassName: output.itemClass,
					jointType: "output",
					locked: true,
					layoutOrientation: "right",
				}
			);
			if (details.type === "factory-reference") {
				const externalId = extOutputNodeIds[i];
				details.jointsToExternalNodes[jointNode.id] = externalId;
			}
			children.push(jointNode);
			resourceJoints.push({ id: jointNode.id, type: "output" });
		}
		const properties: GraphNodeProductionProperties = {
			type: "production",
			details,
			multiplier,
			autoMultiplier: useAutoMultiplier,
			resourceJoints: resourceJoints,
		};
		const parent = new GraphNode(idGen.nextId(), context, position, NodePriorities.RECIPE, edges, null, [], properties, nodeSize);
		return { parent, children };
	}

	static fromJSON(json: GraphNodeJson, context: PageContext): GraphNode {
		return new GraphNode(
			json.id,
			context,
			{ x: json.position.x, y: json.position.y },
			json.priority,
			json.edges,
			json.parentNode,
			json.children,
			json.properties as GraphNodeProperties,
			json.size,
		);
	}

	applyJson(json: any): void {
		this.position.applyJson(json.position);
		applyJsonToSet(json.edges, this.edges);
		this.parentNode = json.parentNode;
		applyJsonToSet(json.children, this.children);
		applyJsonToObject(json.properties, this.properties as Record<string, any>);
		this.size.x = json.size.x;
		this.size.y = json.size.y;
	}

	private toJSON(): GraphNodeJson {
		return {
			id: this.id,
			position: this.position.toJSON(),
			priority: this.priority,
			edges: Array.from(this.edges),
			parentNode: this.parentNode,
			children: Array.from(this.children),
			properties: $state.snapshot(this.properties),
			size: this.size,
		};
	}

	afterPaste(mapper: IdMapper, pasteSource: PasteSource) {
		const newEdges = Array.from(this.edges.values()
			.filter(id => mapper.hasOldId(id))
			.map(id => mapper.mapId(id)));
		this.edges.clear();
		for (const newId of newEdges) {
			this.edges.add(newId);
		}
		const newParentNode = this.parentNode ? mapper.mapId(this.parentNode) : null;
		this.parentNode = newParentNode;
		const newChildren = Array.from(this.children.values()
			.map(id => mapper.mapId(id)));
		this.children.clear();
		for (const newId of newChildren) {
			this.children.add(newId);
		}
		if (this.properties.type === "production") {
			for (const joint of this.properties.resourceJoints) {
				joint.id = mapper.mapId(joint.id);
			}
			if (this.properties.details.type === "factory-reference") {
				if (pasteSource === "external") {
					this.properties.details.factoryId = mapper.mapId(this.properties.details.factoryId);
				}
				const newJointsToExternalNodes = Object.fromEntries(
					Object.entries(this.properties.details.jointsToExternalNodes)
						.map(([jointId, extNodeId]) => [
							mapper.mapId(jointId),
							pasteSource === "external" ? mapper.mapId(extNodeId) : extNodeId
						])
				);
				this.properties.details.jointsToExternalNodes = newJointsToExternalNodes;
			}
		}
	}

	onDragStart(): void {
		this.dragStartPosition = { x: this.position.x, y: this.position.y };
	}

	move(totalDeltaX: number, totalDeltaY: number, gridSnap: number): void {
		this.position.x = roundToNearest(this.dragStartPosition.x + totalDeltaX, gridSnap);
		this.position.y = roundToNearest(this.dragStartPosition.y + totalDeltaY, gridSnap);
	}

	getAbsolutePosition(page: GraphPage): IVector2D {
		const parentNode = this.parentNode ? page.nodes.get(this.parentNode) : null;
		if (!parentNode) {
			if (this.parentNode)
				console.warn(`Node ${this.id} has no parent node, returning its own position as absolute position.`);
			return { x: this.position.x, y: this.position.y };
		}
		const parentPosition = parentNode.getAbsolutePosition(page);
		return {
			x: parentPosition.x + this.position.x,
			y: parentPosition.y + this.position.y,
		};
	}

	get rotation(): Rotation {
		return this.properties.type === "production"
			? normaliseRotation(this.properties.rotation)
			: 0;
	}

	/** Turn the building a quarter turn clockwise, or several. */
	rotateBy(quarters: Rotation): void {
		this.setRotation(((this.rotation + quarters) % 4) as Rotation);
	}

	setRotation(rotation: Rotation): void {
		const properties = this.properties;
		if (properties.type !== "production") {
			return;
		}
		const previous = normaliseRotation(properties.rotation);
		if (previous === rotation) {
			return;
		}
		if (rotation === 0) {
			// Upright is the absence of a rotation, not a rotation of zero. Keeping it
			// that way means turning a building and turning it back leaves the save
			// exactly as it was, and gives other people in a room nothing to apply.
			delete properties.rotation;
		} else {
			properties.rotation = rotation;
		}
		// The ports are still sitting in the old frame; say so, or the turn would
		// reshuffle them instead of moving them.
		this.relayoutJoints(previous);
	}

	get clockSpeed(): number {
		return this.properties.type === "production"
			? clampClockSpeed(this.properties.clockSpeed ?? 1)
			: 1;
	}

	setClockSpeed(clockSpeed: number): void {
		const properties = this.properties;
		if (properties.type !== "production") {
			return;
		}
		const wanted = clampClockSpeed(clockSpeed);
		if (wanted === 1) {
			// Normal speed is the absence of a clock speed, so a building that was never
			// touched and one that was set back to 100% save identically.
			delete properties.clockSpeed;
		} else {
			properties.clockSpeed = wanted;
		}
	}

	/** How many somersloops this building would take if it were full. */
	get sloopSlots(): number {
		return this.properties.type === "production"
			? sloopSlotsOf(buildingOf(this.properties.details))
			: 0;
	}

	get sloops(): number {
		return this.properties.type === "production"
			? clampSloops(this.properties.sloops ?? 0, buildingOf(this.properties.details))
			: 0;
	}

	setSloops(sloops: number): void {
		const properties = this.properties;
		if (properties.type !== "production") {
			return;
		}
		const wanted = clampSloops(sloops, buildingOf(properties.details));
		if (wanted === 0) {
			delete properties.sloops;
		} else {
			properties.sloops = wanted;
		}
	}

	reorderRecipeJoints(page: GraphPage) {
		const properties = this.properties;
		if (properties.type !== "production") {
			return;
		}
		const inputJoints = properties.resourceJoints.filter(joint => joint.type === "input");
		const outputJoints = properties.resourceJoints.filter(joint => joint.type === "output");
		if (inputJoints.length > 1) {
			this.reorderRecipeJointsRow(page, "input");
		}
		if (outputJoints.length > 1) {
			this.reorderRecipeJointsRow(page, "output");
		}
	}
	
	private reorderRecipeJointsRow(page: GraphPage, sameRowJointsType: "input" | "output") {
		const recipeNode = this as GraphNode<GraphNodeProductionProperties>;
		const sameRowJoints = recipeNode.properties.resourceJoints
			.filter(joint => joint.type === sameRowJointsType);
		if (sameRowJoints.length <= 1) {
			return;
		}
		
		const centerPoint = recipeNode.getAbsolutePosition(page);
		const layoutOrientation = (page.nodes.get(sameRowJoints[0].id)?.properties as (GraphNodeResourceJointProperties|undefined))?.layoutOrientation ?? "left";
		let zeroAxis: "x" | "y";
		let reverseOrder: boolean;
		switch (layoutOrientation) {
			case "top":
				zeroAxis = "y";
				reverseOrder = true;
				break;
			case "bottom":
				zeroAxis = "y";
				reverseOrder = true;
				break;
			case "left":
				zeroAxis = "x";
				reverseOrder = false;
				break;
			case "right":
				zeroAxis = "x";
				reverseOrder = false;
				break;
		}
		
		const jointTargets = sameRowJoints
			.map(srcJoint => {
				const jointNode = page.nodes.get(srcJoint.id) as GraphNode|undefined;
				const edge = page.edges.get(jointNode?.edges.values().next().value || "");
				let refJoint: GraphNode | undefined;
				if (edge && jointNode) {
					let refJointId: Id | undefined;
					if (edge.startNodeId === jointNode.id) {
						refJointId = edge.endNodeId;
					} else if (edge.endNodeId === jointNode.id) {
						refJointId = edge.startNodeId;
					}
					if (refJointId) {
						refJoint = page.nodes.get(refJointId) as GraphNode|undefined;
					}
				}
				if (!refJoint) {
					refJoint = jointNode ?? recipeNode;
				}
				const pos = refJoint.getAbsolutePosition(page);
				const direction = {
					x: zeroAxis !== "x" ? pos.x - centerPoint.x : 1,
					y: zeroAxis !== "y" ? pos.y - centerPoint.y : 1,
				};
				let angle = Math.atan2(direction.y, direction.x);
				if (angle < -Math.PI) {
					angle += 2 * Math.PI;
				} else if (angle > Math.PI) {
					angle -= 2 * Math.PI;
				}
				return { nodePos: jointNode?.position, angle };
			})
			.sort((a, b) => {
				if (!a.nodePos || !b.nodePos) {
					return 0;
				}
				const aPosSum = a.nodePos.x + a.nodePos.y;
				const bPosSum = b.nodePos.x + b.nodePos.y;
				return aPosSum - bPosSum;
			});
		
		if (jointTargets.every(({angle}) => angle === jointTargets[0].angle)) {
			return;
		}

		const originalPositions = jointTargets.map(t => $state.snapshot(t.nodePos));

		const sortedTargets = jointTargets
			.toSorted((a, b) => {
				const angleA = a.angle;
				const angleB = b.angle;
				if (reverseOrder) {
					return angleB - angleA;
				} else {
					return angleA - angleB;
				}
			});
		
		for (let i = 0; i < sortedTargets.length; i++) {
			const target = sortedTargets[i];
			const newPosition = originalPositions[i];
			if (!target.nodePos || !newPosition) {
				continue;
			}
			target.nodePos.x = newPosition.x;
			target.nodePos.y = newPosition.y;
		}
	}

	updateExternalFactoryJoints(): void {
		if (this.properties.type !== "production" || this.properties.details.type !== "factory-reference") {
			return;
		}
		const details = this.properties.details;
		const externalPage = this.context.appState.pages.find(p => p.id === details.factoryId);
		if (!externalPage) {
			throw new Error(`External factory page with id ${details.factoryId} does not exist.`);
		}
		const currentlyUsedExternalJoints = Object.values(details.jointsToExternalNodes);
		const newUsedExternalJoints: Id[] = [];
		const jointsToAdd: {type: "input" | "output", itemClass: string, externalId: Id}[] = [];
		for (const node of externalPage.nodes.values()) {
			if (node.properties.type !== "production") {
				continue;
			}
			if (node.properties.details.type === "factory-input" || node.properties.details.type === "factory-output") {
				newUsedExternalJoints.push(node.id);
				if (currentlyUsedExternalJoints.includes(node.id)) {
					continue;
				}
				const type = node.properties.details.type === "factory-input" ? "input" : "output";
				jointsToAdd.push({
					type,
					itemClass: node.properties.details.partClassName,
					externalId: node.id,
				});
			}
		}
		// delete old joints
		const extToLocalJoints: Record<Id, Id> = {};
		for (const [localId, externalId] of Object.entries(details.jointsToExternalNodes)) {
			extToLocalJoints[externalId] = localId;
		}
		const localJointsToRemove = currentlyUsedExternalJoints
			.filter(id => !newUsedExternalJoints.includes(id))
			.map(id => extToLocalJoints[id]);
		this.properties.resourceJoints = this.properties.resourceJoints
			.filter(joint => !localJointsToRemove.includes(joint.id));
		for (const localJointId of localJointsToRemove) {
			delete details.jointsToExternalNodes[localJointId];
			this.children.delete(localJointId);
			this.context.page.removeNode(localJointId);
		}
		// add new joints
		for (const joint of jointsToAdd) {
			const newJointTmpPosition = {
				x: this.size.x / 2,
				y: this.size.y / 2,
			}
			const newJoint: GraphNode<GraphNodeResourceJointProperties> = new GraphNode(
				this.context.page.idGen.nextId(),
				this.context,
				newJointTmpPosition,
				NodePriorities.RESOURCE_JOINT,
				[],
				this.id,
				[],
				{
					type: "resource-joint",
					resourceClassName: joint.itemClass,
					jointType: joint.type,
					locked: true,
					layoutOrientation: joint.type === "input" ? "left" : "right",
				}
			);
			this.context.page.nodes.set(newJoint.id, newJoint);
			this.properties.resourceJoints.push({ id: newJoint.id, type: joint.type });
			details.jointsToExternalNodes[newJoint.id] = joint.externalId;
			this.children.add(newJoint.id);
		}

		this.onJointCountChanged();
	}

	private onJointCountChanged(): void {
		this.relayoutJoints(this.rotation);
	}

	/**
	 * Put every port back on its edge and size the box to fit them.
	 *
	 * `currentFrame` is the rotation the ports are sitting in at the moment, which is
	 * not the building's rotation while a turn is being applied. Undoing it recovers the
	 * order the ports are in in the building's own frame, so a turn moves the ports
	 * rather than rearranging them.
	 */
	private relayoutJoints(currentFrame: Rotation): void {
		const properties = this.properties;
		if (properties.type !== "production") {
			return;
		}
		const page = this.context.page;
		const rotation = normaliseRotation(properties.rotation);
		const undo = ((4 - currentFrame) % 4) as Rotation;
		const rowInOwnOrder = (type: "input" | "output") => properties.resourceJoints
			.filter(joint => joint.type === type)
			.map(joint => page.nodes.get(joint.id))
			.filter(node => node !== undefined)
			.sort((a, b) => rotateQuarters(a.position, undo).y - rotateQuarters(b.position, undo).y);

		const rows = {
			input: rowInOwnOrder("input"),
			output: rowInOwnOrder("output"),
		};
		const maxJointsPerSide = Math.max(rows.input.length, rows.output.length);
		this.size = productionNodeSize(maxJointsPerSide, rotation);

		for (const type of ["input", "output"] as const) {
			const row = rows[type];
			const slots = jointSlots(row.length, maxJointsPerSide, type, rotation);
			const side = jointSide(type, rotation);
			for (let i = 0; i < row.length; i++) {
				row[i].position.x = slots[i].x;
				row[i].position.y = slots[i].y;
				const jointProperties = row[i].properties;
				if (jointProperties.type === "resource-joint") {
					jointProperties.layoutOrientation = side;
				}
			}
		}
	}
}
