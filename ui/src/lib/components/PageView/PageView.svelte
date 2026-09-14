<script module lang="ts">
	/**
	 * The last size the canvas was measured at, remembered across pages.
	 *
	 * Changing page rebuilds the whole canvas, so a freshly bound size starts at zero -
	 * and with no size there is no viewport, so nothing can be left out of exactly the
	 * render that most needs it. The window rarely changes size between one page and the
	 * next, so last time's measurement is a good enough starting point, and the real one
	 * arrives a moment later either way.
	 */
	let lastCanvasWidth = 0;
	let lastCanvasHeight = 0;
</script>

<script lang="ts">
	import { gridSize } from "$lib/datamodel/constants";
	import { globals } from "$lib/datamodel/globals.svelte";
	import { settings } from "$lib/settings.svelte";
	import type { GraphNode, NewNodeDetails } from "$lib/datamodel/GraphNode.svelte";
	import { edgeRect, nodeRect, overlaps, snapOutwards, visibleRect, warmupMargin, WARMUP_FRACTIONS } from "$lib/datamodel/viewportCulling";
	import type { GraphPage } from "$lib/datamodel/GraphPage.svelte";
	import type { Id } from "$lib/datamodel/IdGen.svelte";
	import { isNodeSelectable } from "$lib/datamodel/nodeTypeProperties.svelte";
	import { calculateThroughputs } from "$lib/datamodel/throughputsCalculator";
	import { EventStream, type ContextMenuItem } from "$lib/EventStream.svelte";
	import { pluralStr, getClipboardText, assertUnreachable, targetsInput } from "$lib/utilties";
	import { getContext } from "svelte";
	import { fade } from "svelte/transition";
	import EdgeView from "../EdgeView/EdgeView.svelte";
	import NodeView from "../NodeView/NodeView.svelte";
	import UserEvents, { type CursorEvent } from "../UserEvents.svelte";
	import Toolbar from "./ToolModeSelector.svelte";
	import PropertiesToolbar from "./PropertiesToolbar.svelte";
	import CursorOverlay from "./CursorOverlay.svelte";
	import ConnectionStatus from "./ConnectionStatus.svelte";
	import FactorySummary from "./FactorySummary.svelte";
	import FindNode from "./FindNode.svelte";

	interface Props {
		page: GraphPage;
	}
	const { page }: Props = $props();

	const commandQueue = page.context.appState.serverConnection.dispatchCommandQueue;
	commandQueue.watchNodeList(page.id, () => Array.from(page.nodes.values()));
	commandQueue.watchEdgeList(page.id, () => Array.from(page.edges.values()));

	const serverConnection = page.context.appState.serverConnection;

	const sortedNodes = $derived.by(() => {
		return Array.from(page.nodes.entries()).sort((a, b) => {
			const aNode = a[1];
			const bNode = b[1];
			return aNode.priority - bNode.priority;
		});
	});

	/**
	 * Only what is on screen is built.
	 *
	 * Everything on the page exists in the model either way; this decides what exists as
	 * components in the document. Each one costs about a quarter of a millisecond to
	 * build and a belt about twice that, so on a page with a few hundred of them the ones
	 * nobody can see are most of the time it takes to open the page.
	 *
	 * The margin is roughly a screen in every direction, so things are already there
	 * before they are scrolled to rather than appearing as you arrive.
	 */
	let canvasArea: HTMLDivElement | null = $state(null);
	let canvasWidth = $state(lastCanvasWidth);
	let canvasHeight = $state(lastCanvasHeight);

	/**
	 * Watched rather than measured.
	 *
	 * Asking an element how big it is makes the browser lay the page out then and there,
	 * and doing that while the page is still being built holds up everything behind it.
	 * A resize observer reports the same number afterwards, for free, and the size from
	 * last time is a good enough starting point until it does.
	 */
	$effect(() => {
		const element = canvasArea;
		if (!element) {
			return;
		}
		const observer = new ResizeObserver((entries) => {
			const box = entries[0]?.contentRect;
			if (!box) {
				return;
			}
			canvasWidth = box.width;
			canvasHeight = box.height;
			lastCanvasWidth = box.width;
			lastCanvasHeight = box.height;
		});
		observer.observe(element);
		return () => observer.disconnect();
	});
	/**
	 * How far past the edge of the screen to keep things.
	 *
	 * Nothing pops in without it: what is on screen is worked out in the same update as
	 * the pan, so it would be correct at zero. It is here so that panning about does not
	 * build and throw away the same buildings over and over at the boundary.
	 */
	const fullViewportMargin = $derived(
		Math.max(canvasWidth, canvasHeight) / Math.max(page.view.scale, 0.01) / 2,
	);

	/**
	 * Which pass of filling in the margin this page is on.
	 *
	 * The first frame of a page carries only what is on screen; the margin around it
	 * follows over the next few passes. It is off screen either way, so nothing is seen
	 * arriving late - the page simply appears about twice as soon.
	 */
	let warmupStep = $state(0);
	const viewportMargin = $derived(warmupMargin(fullViewportMargin, warmupStep));

	$effect(() => {
		// Nothing reactive is read here, so this runs once, when the page is opened.
		let step = 0;
		let cancel: (() => void) | undefined;
		const soon = (run: () => void) => {
			// Filling the margin is work nobody is waiting on, so it goes after anything
			// the browser would rather be doing. Not every browser offers that yet.
			if (typeof requestIdleCallback === "function") {
				const id = requestIdleCallback(run, { timeout: 200 });
				return () => cancelIdleCallback(id);
			}
			const id = requestAnimationFrame(() => run());
			return () => cancelAnimationFrame(id);
		};
		const advance = () => {
			step += 1;
			warmupStep = step;
			cancel = step < WARMUP_FRACTIONS.length - 1 ? soon(advance) : undefined;
		};
		cancel = soon(advance);
		return () => cancel?.();
	});
	const viewport = $derived(snapOutwards(
		visibleRect(
			page.view.offset,
			page.view.scale,
			canvasWidth,
			canvasHeight,
			viewportMargin,
		),
		// Rounded to a step so the set only changes once the view has really moved.
		// The step is a fixed distance on the page rather than a share of the screen:
		// tying it to the zoom means the grid itself moves as you zoom, and the set is
		// then redone in large uneven lumps instead of a thin ring at a time.
		gridSize * 8,
	));

	/**
	 * Things that stay regardless of where they are.
	 *
	 * Something picked out, hovered, or half way through being dragged has to keep
	 * existing even once it has been dragged off the edge, or it would vanish from under
	 * the pointer mid-gesture.
	 */
	function isPinned(node: GraphNode): boolean {
		if (page.selectedNodes.has(node.id) || page.highlightedNodes.hovered.has(node.id)) {
			return true;
		}
		if (page.highlightedNodes.attachable.has(node.id)) {
			return true;
		}
		if (node.properties.type === "resource-joint" && node.properties.jointDragType !== undefined) {
			return true;
		}
		return node.id === page.userEventsPriorityNodeId;
	}

	const visibleNodes = $derived.by(() => {
		if (canvasWidth === 0 || canvasHeight === 0) {
			return sortedNodes;
		}
		return sortedNodes.filter(([, node]) =>
			isPinned(node) || overlaps(viewport, nodeRect(node.getAbsolutePosition(page), node.size)),
		);
	});

	const visibleEdges = $derived.by(() => {
		if (canvasWidth === 0 || canvasHeight === 0) {
			return Array.from(page.edges.entries());
		}
		return Array.from(page.edges.entries()).filter(([, edge]) => {
			if (page.selectedEdges.has(edge.id)) {
				return true;
			}
			const start = edge.startNodePosition;
			const end = edge.endNodePosition;
			// A belt whose ends are not both known yet is left in; it is being drawn.
			if (!start || !end) {
				return true;
			}
			return overlaps(viewport, edgeRect(start, end));
		});
	});
	const enableUserEvents = $derived(!page.userEventsPriorityNodeId);

	let svg: SVGSVGElement;
	let svgTopGroup: SVGGElement;

	const eventStream = getContext<EventStream>("overlay-layer-event-stream");

	interface BBox {
		x: number;
		y: number;
		width: number;
		height: number;
	}

	interface DragHandler {
		onStart?: () => void;
		onDrag: (deltaX: number, deltaY: number, scale: number) => void;
		onEnd?: () => void;
	}

	let activeDragHandler: DragHandler | null = $state(null);
	let selectionAreaRaw: BBox | null = $state(null);
	let selectionArea: BBox | null = $derived.by(() => {
		if (!selectionAreaRaw) {
			return null;
		}
		return {
			x: selectionAreaRaw.width < 0 ? selectionAreaRaw.x + selectionAreaRaw.width : selectionAreaRaw.x,
			y: selectionAreaRaw.height < 0 ? selectionAreaRaw.y + selectionAreaRaw.height : selectionAreaRaw.y,
			width: Math.abs(selectionAreaRaw.width),
			height: Math.abs(selectionAreaRaw.height)
		};
	});
	const initiallySelectedIds = new Set<Id>();

	function createPanViewHandler(): DragHandler {
		return {
			onDrag: (deltaX, deltaY) => {
				page.view.offset.x += deltaX;
				page.view.offset.y += deltaY;
			}
		};
	}

	function createSelectionBoxHandler(startEvent: { clientX: number; clientY: number; hasShiftKey: boolean }): DragHandler {
		const point = page.screenToPageCoords({ x: startEvent.clientX, y: startEvent.clientY });
		
		return {
			onStart: () => {
				selectionAreaRaw = {
					x: point.x,
					y: point.y,
					width: 0,
					height: 0
				};
				initiallySelectedIds.clear();
				if (startEvent.hasShiftKey) {
					const selectedSet = page.toolMode === "select-nodes" ? page.selectedNodes : page.selectedEdges;
					for (const id of selectedSet) {
						initiallySelectedIds.add(id);
					}
				} else {
					page.clearAllSelection();
				}
			},
			onDrag: (deltaX, deltaY, scale) => {
				selectionAreaRaw!.width += deltaX / scale;
				selectionAreaRaw!.height += deltaY / scale;
				updateSelectedNodesOrEdges();
			},
			onEnd: () => {
				selectionAreaRaw = null;
			}
		};
	}

	// Determines which drag handler to use based on current state
	function getDragHandler(cursorEvent: CursorEvent): DragHandler | null {
		// Middle mouse button or touch: always pan view
		if (cursorEvent.isMiddleButton || cursorEvent.isTouchEvent) {
			return createPanViewHandler();
		}

		// CTRL + left click: always pan view
		if (cursorEvent.hasCtrlKey) {
			return createPanViewHandler();
		}

		// Drag-view mode: always pan regardless of button
		if (page.toolMode === "drag-view") {
			return createPanViewHandler();
		}

		// Left click on SVG background in select modes: selection box
		if (cursorEvent.target === svg) {
			if (page.toolMode === "select-nodes" || page.toolMode === "select-edges") {
				return createSelectionBoxHandler(cursorEvent);
			}
		}

		return null;
	}

	let isFindOpen = $state(false);

	const nudgeKeys: Record<string, {x: number, y: number}> = {
		ArrowLeft: {x: -1, y: 0},
		ArrowRight: {x: 1, y: 0},
		ArrowUp: {x: 0, y: -1},
		ArrowDown: {x: 0, y: 1},
	};

	function selectEverything() {
		page.selectedNodes.clear();
		page.selectedEdges.clear();
		for (const node of page.nodes.values()) {
			if (node.parentNode === null && isNodeSelectable(node)) {
				page.selectedNodes.add(node.id);
			}
		}
	}

	/** Copy the selection and drop it back on the page, offset a little. */
	function duplicateSelection() {
		if (page.selectedNodes.size === 0) {
			return;
		}
		const json = page.selectionAsJson();
		if (!json) {
			return;
		}
		const offset = page.view.enableGridSnap ? page.view.gridSnap : 25;
		page.insertJson(json, "local");
		for (const nodeId of page.selectedNodes) {
			const node = page.nodes.get(nodeId);
			if (node && node.parentNode === null) {
				page.moveNode(node, offset, offset);
			}
		}
	}

	function nudgeSelection(direction: {x: number, y: number}, fine: boolean) {
		const step = fine ? 1 : (page.view.enableGridSnap ? page.view.gridSnap : 10);
		for (const nodeId of page.selectedNodes) {
			const node = page.nodes.get(nodeId);
			if (node && node.parentNode === null) {
				page.moveNode(node, direction.x * step, direction.y * step);
			}
		}
	}

	function onKeyDown(key: string, event: KeyboardEvent) {
		if (event.ctrlKey && key === "z") {
			page.history.undo();
			event.preventDefault();
		} else if (event.ctrlKey && key === "y") {
			page.history.redo();
			event.preventDefault();
		} else if (key === "Delete" || key === "Backspace") {
			page.removeSelectedNodesAndEdges();
		} else if (event.ctrlKey && key === "c") {
			page.copyOrCutSelection("copy");
		} else if (event.ctrlKey && key === "x") {
			page.copyOrCutSelection("cut");
		} else if (event.ctrlKey && key === "a") {
			selectEverything();
			event.preventDefault();
		} else if (event.ctrlKey && key === "d") {
			duplicateSelection();
			event.preventDefault();
		} else if (event.ctrlKey && key === "f") {
			isFindOpen = true;
			event.preventDefault();
		} else if (!event.ctrlKey && (key === "r" || key === "R")) {
			// Shift turns it the other way. Ctrl+R is the browser's reload, so it is left
			// alone.
			page.rotateSelectedNodes(event.shiftKey ? 3 : 1);
			event.preventDefault();
		} else if (key === "Escape") {
			isFindOpen = false;
			page.clearAllSelection();
		} else if (key in nudgeKeys && page.selectedNodes.size > 0) {
			nudgeSelection(nudgeKeys[key], event.shiftKey);
			event.preventDefault();
		}
	}
	function onClick(event: CursorEvent) {
		if (!event.hasPrimaryButton) {
			return;
		}
		if (event.hasShiftKey) {
			return;
		}
		if (event.target !== svg) {
			return;
		}
		if (page.toolMode === "select-nodes" || page.toolMode === "select-edges" || page.toolMode === "drag-view") {
			page.clearAllSelection();
		} else if (page.toolMode === "add-note") {
			const point = page.screenToPageCoords({x: event.clientX, y: event.clientY});
			page.makeNewNode(
				{type: "text-note", content: "New Note"},
				point
			);
			// Placing a note is a one-shot action, so hand the pointer back rather than
			// dropping another note on the next click.
			page.toolMode = "select-nodes";
		} else {
			assertUnreachable(page.toolMode);
		}
	}

	function onContextMenu(event: MouseEvent) {
		if (event.target !== svg && event.target !== svgTopGroup) {
			return;
		}
		event.preventDefault();
		const items: ContextMenuItem[] = [];
		items.push({
			label: "Add Node",
			icon: "add",
			onClick: () => eventStream.emit({
				type: "showProductionSelector",
				page: page,
				x: event.clientX,
				y: event.clientY,
				onSelect: (details) => addNewProductionNode(details, event),
			})
		});
		if (page.selectedNodes.size > 0) {
			items.push({
				label: `Copy ${pluralStr("Node", page.selectedNodes.size)}`,
				icon: "copy",
				hint: "Ctrl+C",
				onClick: () => page.copyOrCutSelection("copy")
			});
			items.push({
				label: `Cut ${pluralStr("Node", page.selectedNodes.size)}`,
				icon: "cut",
				hint: "Ctrl+X",
				onClick: () => page.copyOrCutSelection("cut")
			});
		}
		if (window.navigator.clipboard && window.isSecureContext) {
			items.push({
				label: "Paste",
				icon: "paste",
				hint: "Ctrl+V",
				onClick: () => paste()
			});
		}
		eventStream.emit({
			type: "showContextMenu",
			x: event.clientX,
			y: event.clientY,
			items
		});
	}

	function onDoubleClick(event: MouseEvent, isTouchEvent: boolean) {
		if (event.target !== svg && event.target !== svgTopGroup) {
			return;
		}
		if (page.toolMode !== "select-nodes" && page.toolMode !== "select-edges") {
			return;
		}
		eventStream.emit({
			type: "showProductionSelector",
			page: page,
			x: event.clientX,
			y: event.clientY,
			autofocus: !isTouchEvent,
			onSelect: (details) => addNewProductionNode(details, event),
		});
	}

	async function paste(clipboardData: string|null = null, e: Event|null = null) {
		if (e && targetsInput(e)) {
			return;
		}
		clipboardData ??= await getClipboardText();
		if (!clipboardData) {
			return;
		}
		const cursorPoint = page.screenToPageCoords(globals.mousePosition);
		let jsonData;
		try {
			jsonData = JSON.parse(clipboardData);
		} catch (error) {
			console.log("Clipboard data is not valid JSON", error);
			return;
		}
		page.insertJson(jsonData, "local", cursorPoint);
	}

	function addNewProductionNode(productionDetails: NewNodeDetails, event: MouseEvent) {
		const point = page.screenToPageCoords({x: event.clientX, y: event.clientY});
		page.makeNewNode(productionDetails, { x: point.x, y: point.y });
	}

	function updateSelectedNodesOrEdges() {
		if (!selectionAreaRaw) {
			return;
		}
		const selectedIds: Id[] = [];
		if (page.toolMode === "select-nodes") {
			for (const [id, node] of page.nodes.entries()) {
				if (!isNodeSelectable(node) || node.parentNode !== null) {
					continue;
				}
				const nodePosition = node.position;
				const nodeSize = node.size;
				const nodeBBox: BBox = {
					x: nodePosition.x - nodeSize.x / 2,
					y: nodePosition.y - nodeSize.y / 2,
					width: nodeSize.x,
					height: nodeSize.y
				};
				const intersects = (
					selectionArea!.x < nodeBBox.x + nodeBBox.width &&
					selectionArea!.x + selectionArea!.width > nodeBBox.x &&
					selectionArea!.y < nodeBBox.y + nodeBBox.height &&
					selectionArea!.y + selectionArea!.height > nodeBBox.y
				);
				if (intersects) {
					selectedIds.push(id);
				}
			}
			page.selectedNodes.clear();
			for (const id of [...initiallySelectedIds, ...selectedIds]) {
				page.selectedNodes.add(id);
			}
		} else if (page.toolMode === "select-edges") {
			for (const [id, edge] of page.edges.entries()) {
				if (!edge.pathPoints) {
					continue;
				}
				for (const point of [edge.pathPoints.startPoint, edge.pathPoints.endPointWithoutArrow]) {
					if (!point) {
						continue;
					}
					if (
						selectionArea!.x < point.x &&
						selectionArea!.x + selectionArea!.width > point.x &&
						selectionArea!.y < point.y &&
						selectionArea!.y + selectionArea!.height > point.y
					) {
						selectedIds.push(id);
						break;
					}
				}
			}
			page.selectedEdges.clear();
			for (const id of [...initiallySelectedIds, ...selectedIds]) {
				page.selectedEdges.add(id);
			}
		}
	}

	$effect(() => {
		if (settings.debugConsoleLog.value) {
			console.log($state.snapshot(page));
			for (const edge of page.edges.values()) {
				const startNode = page.nodes.get(edge.startNodeId);
				const endNode = page.nodes.get(edge.endNodeId);
				if (!startNode || !endNode) {
					console.warn("EdgeView: Edge references invalid node", $state.snapshot(edge));
				} else {
					for (const n of [startNode, endNode]) {
						if (!n.edges.has(edge.id)) {
							console.warn("EdgeView: missing double link in", $state.snapshot(edge), "to", $state.snapshot(n));
						}
					}
				}
			}
		}
	});

	$effect(() => {
		page.history.onDataChange();
	});

	$effect(() => {
		calculateThroughputs(page);
	});

	$effect(() => {
		page.svgElement = svg;
	});

	$effect(() => {
		const mousePos = globals.mousePosition;
		if (svg) {
			globals.pageMousePosition = page.screenToPageCoords(mousePos);
		}
	});
</script>

<svelte:window
	onpaste={e => paste(e.clipboardData?.getData("text/plain"), e)}
/>

<div class="page">
	<PropertiesToolbar page={page} />

	<UserEvents
		id="Page {page.id}"
		canStartDrag={enableUserEvents ? (e) => {
			return getDragHandler(e.cursorEvent) !== null;
		} : null}
		onDragStart={enableUserEvents ? (e) => {
			activeDragHandler = getDragHandler(e.cursorEvent);
			activeDragHandler?.onStart?.();
		} : null}
		onDrag={enableUserEvents ? (e) => {
			if (isNaN(e.deltaX) || isNaN(e.deltaY)) {
				return;
			}
			if (activeDragHandler) {
				activeDragHandler.onDrag(e.deltaX, e.deltaY, page.view.scale);
			} else {
				// Fallback to pan view when no handler (e.g., scroll wheel events)
				page.view.offset.x += e.deltaX;
				page.view.offset.y += e.deltaY;
			}
		} : null}
		onDragEnd={enableUserEvents ? () => {
			activeDragHandler?.onEnd?.();
			activeDragHandler = null;
		} : null}
		onZoom={enableUserEvents ? (deltaFactor, cursorX, cursorY) => {
			if (isNaN(deltaFactor) || isNaN(cursorX) || isNaN(cursorY) || deltaFactor === 0) {
				return;
			}
			const currentScale = page.view.scale;
			const newScale = currentScale * deltaFactor;
			if (newScale < 0.25 || newScale > 5) {
				return;
			}
			const svgRect = svg.getBoundingClientRect();
			const cursor = {
				x: cursorX - svgRect.left,
				y: cursorY - svgRect.top
			};
			const scaleDelta = currentScale - newScale;
			const point = page.screenToPageCoords(cursor);
			page.view.offset.x += point.x * scaleDelta;
			page.view.offset.y += point.y * scaleDelta;
			page.view.scale = newScale;
		} : null}
		onClick={enableUserEvents ? onClick : null}
		onContextMenu={enableUserEvents ? onContextMenu : null}
		onDoubleClick={enableUserEvents ? onDoubleClick : null}
		onKeyDown={enableUserEvents ? onKeyDown : null}
		allowMiddleClickDrag={true}
		allowMultiTouchDrag={true}
	>
		{#snippet children({ listeners })}
			<div class="canvas-area" bind:this={canvasArea}>
				<!--
					The grid is its own element rather than the background of the canvas.
					These are custom properties, and changing one invalidates the style of
					everything underneath the element it is set on - which, on the canvas,
					is every node and belt on the page. Paired with the pan and zoom changing
					in the same frame, that alone was the difference between 44 and 60 frames
					a second on a page with a few hundred machines. Nothing is under this one.
				-->
				<div
					class="graph-grid"
					style={
						`--offset-x: ${page.view.offset.x - gridSize/2 * page.view.scale}px;\n` +
						`--offset-y: ${page.view.offset.y - gridSize/2 * page.view.scale}px;\n` +
						`--square-size: ${page.view.scale * gridSize}px;`
					}
				></div>
				<svg
					class="graph-page-view"
					width="100%"
					height="100%"
					bind:this={svg}
					{...listeners}
				>
					<defs>
						<marker
							id="arrow"
							viewBox="0 0 11 10"
							refX="0"
							refY="5"
							markerWidth="10.5"
							markerHeight="10"
							orient="auto-start-reverse"
							markerUnits="userSpaceOnUse"
						>
							<path
								d="M 0 0 l 11 5 l -11 5 z"
								fill="context-stroke"
							/>
						</marker>
						<marker
							id="arrow-wide"
							viewBox="0 0 11 15"
							refX="0"
							refY="7.5"
							markerWidth="10.5"
							markerHeight="15"
							orient="auto-start-reverse"
							markerUnits="userSpaceOnUse"
						>
							<path
								d="M 0 0 l 11 7.5 l -11 7.5 z"
								fill="context-stroke"
							/>
						</marker>
					</defs>
					<g
						transform={
							`translate(${page.view.offset.x}, ${page.view.offset.y}) ` +
							`scale(${page.view.scale})`
						}
						bind:this={svgTopGroup}
					>
						{#each visibleEdges as [id, edge] (id)}
							<EdgeView {edge} />
						{/each}
						{#each visibleNodes as [id, node] (id)}
							<NodeView {node} />
						{/each}

						{#if selectionAreaRaw}
							<rect
								class="selection-area"
								x={selectionArea!.x}
								y={selectionArea!.y}
								width={selectionArea!.width}
								height={selectionArea!.height}
								transition:fade={{ duration: 100 }}
							/>
						{/if}

						<CursorOverlay {page} {serverConnection} />
					</g>
				</svg>
			</div>
		{/snippet}
	</UserEvents>

	<ConnectionStatus {serverConnection} />
	{#if settings.showFactorySummary.value}
		<FactorySummary {page} />
	{/if}
	<FindNode {page} open={isFindOpen} onClose={() => isFindOpen = false} />

	<Toolbar bind:activeMode={page.toolMode} x={40} y={10} />
</div>

<style lang="scss">
	.page {
		position: relative;
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
	}

	// Holds the grid and the canvas together, so "fill this" means the canvas and not
	// the whole page, which has the toolbar above it.
	.canvas-area {
		position: relative;
		flex: 1;
		min-height: 0;
		display: flex;
		// Keeps the stacking of the grid and the canvas to themselves. Without this the
		// canvas being lifted above the grid also lifts it above the overlay layer that
		// sits over the whole app, and clicking the page stops reaching it - which shows
		// up as menus that will not go away.
		isolation: isolate;
	}

	.graph-page-view {
		flex: 1;
		background-color: transparent;
		// Positioned so it stacks above the grid, which is positioned and would
		// otherwise paint over it.
		position: relative;
		z-index: 1;
	}

	.graph-grid {
		position: absolute;
		inset: 0;
		z-index: 0;
		pointer-events: none;
		background-image: var(--grid-background-image);
		background-color: var(--grid-background-color);
		background-position: var(--offset-x) var(--offset-y);
		background-size: var(--square-size) var(--square-size);
		background-repeat: repeat;
	}

	svg {
		user-select: none;
	}

	.selection-area {
		fill: var(--selection-area-background-color);
		stroke: var(--selection-area-border-color);
		stroke-width: 1;
		pointer-events: none;
	}

	:global(#arrow), :global(#arrow-wide) {
		path {
			fill: var(--edge-stroke-color);	// fallback for Safari which doesn't support context-stroke
			fill: context-stroke;
		}
	}
</style>
