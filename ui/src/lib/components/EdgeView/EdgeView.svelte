<script lang="ts">
	import { getContext, onDestroy } from "svelte";
	import { blockStateChanges, unblockStateChanges } from "../../datamodel/globals.svelte";
	import { settings } from "$lib/settings.svelte";
	import type { GraphEdge, GraphEdgeDisplayType } from "../../datamodel/GraphEdge.svelte";
	import type { ContextMenuItem, ContextMenuItemButtonRow, EventStream } from "$lib/EventStream.svelte";
	import { assertUnreachable, bezierPoint, floatToString, getSlackColor, pluralStr } from "$lib/utilties";
	import { transportNeededFor } from "../../datamodel/transportTiers";
	import { updateEdgeOffsets } from "../../datamodel/straightEdgeRouting";
	import type { IVector2D } from "../../datamodel/GraphView.svelte";
	import { userCanChangeOrientationVector } from "../../datamodel/nodeTypeProperties.svelte";
	import UserEvents, { type DragEvent } from "../UserEvents.svelte";
	import type { LayoutOrientation } from "../../datamodel/GraphNode.svelte";
	import { edgeArrowLength, gridSize, splitterMergerNodeRadius } from "$lib/datamodel/constants";
	import EdgeAnnotation from "../EdgeAnnotation.svelte";

	interface Props {
		edge: GraphEdge;
	}
	const { edge }: Props = $props();
	
	const serverConnection = edge.context.appState.serverConnection;
	const commandQueue = serverConnection.dispatchCommandQueue;
	commandQueue.watchNodeOrEdgeChange(() => edge);
	
	let isRotating = $state(false);

	const eventStream = getContext<EventStream>("event-stream");
	const page = $derived(edge.context.page);
	
	const isSelected = $derived(page.selectedEdges.has(edge.id));
	
	function onClick(event: MouseEvent) {
		event.stopPropagation();
		if (event.shiftKey) {
			page.toggleEdgeSelection(edge);
		} else {
			page.selectEdge(edge);
		}
	}

	const {pathD, midPoint, arrowHeadPlaceholderPos} = $derived.by(() => {
		const fallback = {pathD: "", midPoint: null, arrowHeadPlaceholderPos: null};
		if (!edge.pathPoints)
			return fallback;
		
		const startX = edge.pathPoints.startPoint.x;
		const startY = edge.pathPoints.startPoint.y;
		const endX = edge.pathPoints.endPointWithoutArrow.x;
		const endY = edge.pathPoints.endPointWithoutArrow.y;
		const arrowHeadPlaceholderPos = {
			x: (edge.pathPoints.endPoint.x + endX) / 2,
			y: (edge.pathPoints.endPoint.y + endY) / 2,
		};
		if (edge.properties.displayType === "straight") {
			const midPoint = {
				x: (startX + endX) / 2,
				y: (startY + endY) / 2,
			};
			return {pathD: `M ${startX} ${startY} L ${endX} ${endY}`, midPoint, arrowHeadPlaceholderPos};
		} else if (edge.properties.displayType === "curved") {
			let ctrl1 = edge.pathPoints.startControlPointVector;
			let ctrl2 = edge.pathPoints.endControlPointVector;
			ctrl1 = {
				x: startX + ctrl1.x,
				y: startY + ctrl1.y,
			};
			ctrl2 = {
				x: endX + ctrl2.x,
				y: endY + ctrl2.y,
			};
			const start = { x: startX, y: startY };
			const end = { x: endX, y: endY };
			const midPoint = bezierPoint(start, end, ctrl1, ctrl2, 0.5);
			return {
				pathD: `M ${startX} ${startY} C ${ctrl1.x} ${ctrl1.y}, ${ctrl2.x} ${ctrl2.y}, ${endX} ${endY}`,
				midPoint,
				arrowHeadPlaceholderPos,
			};
		} else if (edge.properties.displayType === "angled") {
			const points = edge.straightEdgePoints;
			if (!points)
				return fallback;
			let pathD = `M ${startX} ${startY}`;
			for (const point of points) {
				pathD += ` L ${point.x} ${point.y}`;
			}
			pathD += ` L ${endX} ${endY}`;
			let midPoint: IVector2D;
			if (points.length >= 3 && points.length % 2 === 1) {
				const mid = points.length / 2;
				const p1 = points[Math.floor(mid)];
				const p2 = points[Math.ceil(mid)];
				midPoint = {
					x: (p1.x + p2.x) / 2,
					y: (p1.y + p2.y) / 2,
				};
			} else {
				const allPoints = [
					edge.pathPoints.startPoint,
					...points,
					edge.pathPoints.endPoint,
				];
				let maxP1P2 = [allPoints[0], allPoints[1]]
				let maxDist = Math.abs(allPoints[0].x - allPoints[1].x) + Math.abs(allPoints[0].y - allPoints[1].y);
				for (let i = 1; i < allPoints.length - 1; i++) {
					const p1 = allPoints[i];
					const p2 = allPoints[i + 1];
					const dist = Math.abs(p1.x - p2.x) + Math.abs(p1.y - p2.y);
					if (dist > maxDist) {
						maxDist = dist;
						maxP1P2 = [p1, p2];
					}
				}
				midPoint = {
					x: (maxP1P2[0].x + maxP1P2[1].x) / 2,
					y: (maxP1P2[0].y + maxP1P2[1].y) / 2,
				};
			}
			return {pathD, midPoint, arrowHeadPlaceholderPos};
		} else if (edge.properties.displayType === "teleport") {
			if (!edge.pathPoints || !edge.orientationVectors)
				return fallback;
			const startPoint = edge.pathPoints.startPoint;
			const endPoint = edge.pathPoints.endPointWithoutArrow;
			const startVec = edge.orientationVectors.startOffset;
			const endVec = edge.orientationVectors.endOffset;
			const lineLength = gridSize / 2;
			const miniRadius = 2.5;
			const startPointEnd = {
				x: startPoint.x + startVec.x * (lineLength - miniRadius*1),
				y: startPoint.y + startVec.y * (lineLength - miniRadius*1),
			};
			const endPointCircleStart = {
				x: endPoint.x + endVec.x * (lineLength - edgeArrowLength + miniRadius * 1),
				y: endPoint.y + endVec.y * (lineLength - edgeArrowLength + miniRadius * 1),
			};
			const endPointStart = {
				x: endPoint.x + endVec.x * (lineLength - edgeArrowLength - miniRadius * 1),
				y: endPoint.y + endVec.y * (lineLength - edgeArrowLength - miniRadius * 1),
			};
			const relCircle1 = `a ${miniRadius},${miniRadius} 0 1,0 ${startVec.x * miniRadius * 2},${startVec.y * miniRadius * 2} a ${miniRadius},${miniRadius} 0 1,0 ${startVec.x * miniRadius * -2},${startVec.y * miniRadius * -2}`;
			const relCircle2 = `M ${endPointCircleStart.x} ${endPointCircleStart.y} a ${miniRadius},${miniRadius} 0 1,0 ${endVec.x * miniRadius * -2},${endVec.y * miniRadius * -2} a ${miniRadius},${miniRadius} 0 1,0 ${endVec.x * miniRadius * 2},${endVec.y * miniRadius * 2}`;
			const pathD =
				`M ${startPoint.x} ${startPoint.y} L ${startPointEnd.x} ${startPointEnd.y} ${relCircle1}` +
				`${relCircle2} M ${endPointStart.x} ${endPointStart.y} L ${endPoint.x} ${endPoint.y}`;
			return {
				pathD,
				midPoint: null,
				arrowHeadPlaceholderPos: {
					x: (startPointEnd.x + endPointStart.x) / 2,
					y: (startPointEnd.y + endPointStart.y) / 2,
				},
			};
		} else {
			assertUnreachable(edge.properties.displayType);
		}
	});
	$effect(() => {
		if (edge.properties.displayType === "angled" && edge.straightEdgeCount !== null) {
			updateEdgeOffsets(edge.properties, edge.straightEdgeCount);
		}
	});
	const draggableEdges = $derived.by(() => {
		if (edge.properties.displayType !== "angled") {
			return [];
		}
		if (!edge.straightEdgePoints) {
			return [];
		}
		if (!edge.properties.straightLineOffsets || edge.properties.straightLineOffsets.length + 1 !== edge.straightEdgePoints.length) {
			return [];
		}

		const edges: {index: number, pathD: string, type: "vertical"|"horizontal"}[] = [];
		for (let i = 0; i < edge.properties.straightLineOffsets.length; i++) {
			const p1 = edge.straightEdgePoints[i + 0];
			const p2 = edge.straightEdgePoints[i + 1];
			const pathD = `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
			const type = p1.x === p2.x ? "vertical" : "horizontal";
			edges.push({index: i, pathD, type});
		}

		return edges;
	});

	const {canRotateStart, startButtonPosition, canRotateEnd, endButtonPosition} = $derived.by(() => {
		if (!edge.orientationVectors || !edge.startNode || !edge.endNode) {
			return { canRotateStart: false, startButtonPosition: {x: 0, y: 0}, canRotateEnd: false, endButtonPosition: {x: 0, y: 0} };
		}
		const canRotateStart = userCanChangeOrientationVector(edge.startNode, edge);
		const canRotateEnd = userCanChangeOrientationVector(edge.endNode, edge);
		const offset = 9;
		const startButtonPosition: IVector2D = {
			x: edge.startNodePosition!.x + edge.orientationVectors!.startOffset.x * (edge.startNodeRadius + offset),
			y: edge.startNodePosition!.y + edge.orientationVectors!.startOffset.y * (edge.startNodeRadius + offset),
		}
		const endButtonPosition: IVector2D = {
			x: edge.endNodePosition!.x + edge.orientationVectors!.endOffset.x * (edge.endNodeRadius + offset),
			y: edge.endNodePosition!.y + edge.orientationVectors!.endOffset.y * (edge.endNodeRadius + offset),
		}
		return {canRotateStart, startButtonPosition, canRotateEnd, endButtonPosition};
	});
	const color = $derived(getSlackColor(edge.shortfallAhead, edge.surplusBehind, edge.flow));
	/**
	 * Set when somebody else in the room has this belt picked out, or is part-way
	 * through dragging it out of a building.
	 */
	const remoteSelector = $derived.by(() => {
		const picked = serverConnection.remoteSelection.edges.get(edge.id);
		if (picked) {
			return picked;
		}
		const draggerId = page.dragHighlightsByUser.edges.get(edge.id);
		if (draggerId && draggerId !== serverConnection.ownUserId) {
			return serverConnection.identityOf(draggerId);
		}
		return undefined;
	});

	/** Both ends of a belt carry the same item, so either end can name it. */
	const itemClass = $derived.by(() => {
		for (const node of [edge.startNode, edge.endNode]) {
			const props = node?.properties;
			if (props && "resourceClassName" in props) {
				return props.resourceClassName;
			}
		}
		return undefined;
	});
	const transport = $derived(itemClass ? transportNeededFor(itemClass, edge.flow) : null);
	const overCapacity = $derived(transport?.exceedsEverything === true);

	const contextMenuItems = $derived.by(() => {
		const items: ContextMenuItem[] = [];
		if (isSelected && (page.selectedEdges.size > 1 || !page.selectedEdges.has(edge.id))) {
			const selectedCount = page.selectedEdges.size;
			items.push({
				label: `Delete ${pluralStr("Edge", selectedCount)}`,
				icon: "delete",
				hint: "Del",
				onClick: () => page.removeSelectedEdges(),
			});
		} else {
			items.push({
				label: "Delete Edge",
				icon: "delete",
				hint: "Del",
				onClick: () => page.removeEdge(edge.id),
			});
		}
		items.push({
			label: edge.properties.isDrainLine ? "Normal Line" : "Overflow Only",
			icon: "branch",
			onClick: () => edge.properties.isDrainLine = !edge.properties.isDrainLine,
		});
		items.push(<ContextMenuItemButtonRow<GraphEdgeDisplayType>>{
			onClick: (v) => edge.properties.displayType = v,
			currentValue: edge.properties.displayType,
			items: [
				{
					icon: "straight-line",
					value: "straight",
				},
				{
					icon: "curved-line",
					value: "curved",
				},
				{
					icon: "angled-line",
					value: "angled",
				},
				{
					icon: "teleport-line",
					value: "teleport",
				},
			]
		})
		return items;
	});

	let startOrientation: LayoutOrientation|null = null;
	function onOrientationRotateStart(type: "start"|"end") {
		isRotating = true;
		blockStateChanges();
		startOrientation = type === "start" ? edge.properties.startOrientation : edge.properties.endOrientation;
	}
	
	function onOrientationRotateEnd(type: "start"|"end") {
		isRotating = false;
		unblockStateChanges();
		const endOrientation = type === "start" ? edge.properties.startOrientation : edge.properties.endOrientation;
		if (startOrientation !== endOrientation) {
			page.history.onDataChange();
		}
	}

	function onOrientationRotate(e: DragEvent, type: "start"|"end") {
		const cursorPos = page.screenToPageCoords({x: e.cursorEvent.clientX, y: e.cursorEvent.clientY});
		const nodeCenter = type === "start" ? edge.startNodePosition : edge.endNodePosition;
		const delta = {
			x: cursorPos.x - nodeCenter!.x,
			y: cursorPos.y - nodeCenter!.y,
		};
		const angle = Math.atan2(delta.y, delta.x) / Math.PI * 180;
		let newOrientation: LayoutOrientation;
		if (angle >= -45 && angle < 45)
			newOrientation = "right";
		else if (angle >= 45 && angle < 135)
			newOrientation = "bottom";
		else if (angle >= 135 || angle < -135)
			newOrientation = "left";
		else
			newOrientation = "top";
			

		if (type === "start") {
			edge.properties.startOrientation = newOrientation;
		} else if (type === "end") {
			edge.properties.endOrientation = newOrientation;
		} else {
			assertUnreachable(type);
		}
	}

	/**
	 * Pulling the belt's middle out to put a splitter or merger into it.
	 *
	 * Nothing is changed while the drag is happening - what is drawn is only a preview,
	 * so letting go somewhere silly, or dismissing the menu, costs nothing.
	 */
	let insertPoint: IVector2D|null = $state(null);
	/** Where the belt was taken hold of, which is anywhere along it. */
	let insertFrom: IVector2D|null = null;

	function onInsertDragStart(e: DragEvent) {
		insertFrom = page.screenToPageCoords({x: e.cursorEvent.clientX, y: e.cursorEvent.clientY});
		insertPoint = insertFrom;
	}

	function onInsertDrag(e: DragEvent) {
		insertPoint = page.screenToPageCoords({x: e.cursorEvent.clientX, y: e.cursorEvent.clientY});
	}

	function onInsertDragEnd(e: DragEvent) {
		const dropPoint = insertPoint;
		const grabPoint = insertFrom;
		insertPoint = null;
		insertFrom = null;
		if (!dropPoint || !grabPoint) {
			return;
		}
		// A short drag is someone nudging the belt while clicking it, not asking for a
		// node. Same distance as dragging a new building out of a joint.
		const dragged = Math.hypot(dropPoint.x - grabPoint.x, dropPoint.y - grabPoint.y);
		if (dragged < gridSize) {
			return;
		}
		eventStream.emit({
			type: "showContextMenu",
			x: e.cursorEvent.clientX,
			y: e.cursorEvent.clientY,
			items: [
				{
					label: "Splitter",
					icon: "splitter",
					onClick: () => page.splitEdge(edge, "splitter", dropPoint),
				},
				{
					label: "Merger",
					icon: "merger",
					onClick: () => page.splitEdge(edge, "merger", dropPoint),
				},
			],
		});
	}

	let edgeDragStartValue: number|undefined;
	function onEdgeDrag(e: DragEvent, type: "horizontal"|"vertical", index: number) {
		const delta = type === "horizontal" ? e.totalDeltaY : e.totalDeltaX;
		const scale = page.view.scale;
		let newValue = (edgeDragStartValue ?? 0) + delta / scale;
		// if (page.view.enableGridSnap) {
		// 	newValue = roundToNearest(newValue, page.view.gridSnap);
		// }
		edge.properties.straightLineOffsets![index] = newValue;
	}

	onDestroy(() => {
		if (isRotating) {
			unblockStateChanges();
		}
	});
</script>

<g
	class="edge-view"
	class:isRotating
	class:selected={isSelected}
	data-edge-id={edge.id}
	oncontextmenu={(event) => {
		event.preventDefault();
		eventStream.emit({
			type: "showContextMenu",
			x: event.clientX,
			y: event.clientY,
			items: contextMenuItems,
		});		}}
	onclick={onClick}
	style="--edge-color: {color};"
>
	{#if pathD}
		<!--
			The belt itself is what you pull a splitter out of. This sits under the
			handles for rotating an end and for nudging a straight run sideways, so
			those keep the parts of the belt they are drawn on.
		-->
		<UserEvents
			onDragStart={onInsertDragStart}
			onDrag={onInsertDrag}
			onDragEnd={onInsertDragEnd}
			dragStartThreshold={4}
			id="edge {edge.id} insert node along belt"
		>
			{#snippet children({ listeners })}
				<path
					{...listeners}
					class="edge-view-hover-area"
					d={pathD}
				/>
			{/snippet}
		</UserEvents>
		{#if remoteSelector}
			<path
				class="remote-selection-path"
				d={pathD}
				style="--remote-select-color: {remoteSelector.color};"
			>
				<title>Selected by {remoteSelector.name}</title>
			</path>
		{/if}
		<path
			class="edge-view-path"
			class:over-capacity={overCapacity}
			d={pathD}
			marker-end={isSelected ? "url(#arrow-wide)" : "url(#arrow)"}
			stroke-dasharray={edge.properties.isDrainLine ? "1, 5" : "0"}
			stroke-linecap="round"
		/>
	{/if}
	{#if arrowHeadPlaceholderPos}
		<circle
			cx={arrowHeadPlaceholderPos.x}
			cy={arrowHeadPlaceholderPos.y}
			r={edgeArrowLength * 2/3}
			fill="transparent"
		/>
	{/if}
	{#each draggableEdges as draggableEdge}
		<UserEvents
			onDragStart={() => edgeDragStartValue = edge.properties.straightLineOffsets?.[draggableEdge.index]}
			onDrag={e => onEdgeDrag(e, draggableEdge.type, draggableEdge.index)}
		>
			{#snippet children({ listeners })}
				<path
					{...listeners}
					d={draggableEdge.pathD}
					stroke-width=10
					stroke="transparent"
					style="cursor: {draggableEdge.type === "horizontal" ? "row-resize" : "col-resize"}"
				/>
			{/snippet}
		</UserEvents>
	{/each}
	{#each [[canRotateStart, startButtonPosition, "start"], [canRotateEnd, endButtonPosition, "end"]] as const as [canRotate, buttonPosition, type]}
		{#if canRotate}
			<UserEvents
				onDragStart={() => onOrientationRotateStart(type)}
				onDragEnd={() => onOrientationRotateEnd(type)}
				onDrag={e => onOrientationRotate(e, type)}
				id="edge {edge.id} drag start"
			>
				{#snippet children({ listeners })}
					<g {...listeners} class="drag-button">
						<circle
							{...listeners}
							class="drag-button-outer"
							cx={buttonPosition.x}
							cy={buttonPosition.y}
						/>
						<circle
							{...listeners}
							class="drag-button-inner"
							cx={buttonPosition.x}
							cy={buttonPosition.y}
						/>
					</g>
				{/snippet}
			</UserEvents>
		{/if}
	{/each}
	{#if insertPoint && edge.startNodePosition && edge.endNodePosition}
		<g class="insert-preview">
			<line
				x1={edge.startNodePosition.x}
				y1={edge.startNodePosition.y}
				x2={insertPoint.x}
				y2={insertPoint.y}
			/>
			<line
				x1={insertPoint.x}
				y1={insertPoint.y}
				x2={edge.endNodePosition.x}
				y2={edge.endNodePosition.y}
			/>
			<circle cx={insertPoint.x} cy={insertPoint.y} r={splitterMergerNodeRadius} />
		</g>
	{/if}
	{#if midPoint}
		<!-- A belt with nothing flowing through it still deserves a splitter, so this
		     does not depend on there being a rate to show. -->
		<UserEvents
			onDragStart={onInsertDragStart}
			onDrag={onInsertDrag}
			onDragEnd={onInsertDragEnd}
			dragStartThreshold={4}
			id="edge {edge.id} insert node"
		>
			{#snippet children({ listeners })}
				<circle
					{...listeners}
					class="insert-handle"
					cx={midPoint.x}
					cy={midPoint.y}
					r="12"
				/>
			{/snippet}
		</UserEvents>
	{/if}
	{#if midPoint && edge.flow !== 0}
		<EdgeAnnotation
			x={midPoint.x}
			y={midPoint.y}
			text={floatToString(edge.flow)}
			color={color}
			align="center"
		/>
		{#if transport && settings.showTransportTier.value}
			<EdgeAnnotation
				x={midPoint.x}
				y={midPoint.y + 13}
				text={overCapacity
					? `> ${transport.isFluid ? "Pipe" : "Belt"} ${transport.tier.name}`
					: `${transport.isFluid ? "Pipe" : "Belt"} ${transport.tier.name}`}
				color={overCapacity ? "var(--over-capacity-color)" : "var(--edge-stroke-color)"}
				fontSize={7}
				fontWeight={400}
			/>
		{/if}
	{/if}
	{#if settings.debugShowEdgeIds.value && midPoint}
		<text
			x={midPoint.x}
			y={midPoint.y + 13}
			text-anchor="middle"
			class="edge-id-text"
		>
			e {edge.id}
		</text>
	{/if}
</g>

<style lang="scss">
	// Invisible, but it is what you grab to pull a splitter out of the belt.
	.insert-handle {
		fill: transparent;
		cursor: grab;
	}

	.insert-preview {
		pointer-events: none;

		line {
			stroke: var(--edge-stroke-color);
			stroke-width: 2;
			stroke-dasharray: 5 4;
			opacity: 0.7;
		}

		circle {
			fill: var(--node-background-color);
			stroke: var(--node-border-selected-color);
			stroke-width: 2;
			stroke-dasharray: 4 3;
		}
	}

	path {
		fill: none;
	}

	.edge-view-hover-area {
		stroke: transparent;
		stroke-width: 10;
		cursor: grab;
	}
	
	// Somebody else in the room has this picked out, drawn under the belt in their
	// own colour so both stay readable.
	.remote-selection-path {
		fill: none;
		stroke: var(--remote-select-color);
		stroke-width: 7;
		stroke-linecap: round;
		opacity: 0.45;
		pointer-events: none;
	}

	.edge-view-path {
		transition: stroke 0.1s ease-in-out;
		stroke: var(--edge-color);
		stroke-width: 2;

		// More than any single belt or pipe in the game can carry - the line has to be
		// split before this plan can actually be built.
		&.over-capacity {
			stroke: var(--over-capacity-color);
			stroke-width: 3;
			filter: drop-shadow(0 0 3px var(--over-capacity-color));
		}
	}

	.drag-button {
		cursor: move;
		color: var(--edge-drag-handle-color);
		opacity: 0;
		transition: opacity 0.1s ease-in-out;

		&:hover {
			opacity: 1 !important;
		}
	}

	.drag-button-outer {
		fill: transparent;
		stroke: currentColor;
		stroke-width: 1;
		r: 5;
	}

	.drag-button-inner {
		r: 2;
		fill: currentColor;
	}
	
	.edge-view {
		cursor: pointer;

		&:hover {
			.drag-button {
				opacity: 0.5;
			}
		}

		&.isRotating {
			.drag-button {
				opacity: 1 !important;
			}
		}

		&:where(:hover, .isRotating) {
			.edge-view-path {
				filter: brightness(var(--edge-hover-brightness));
			}
		}

		&.selected {
			.edge-view-path {
				filter: brightness(var(--edge-selected-brightness));
				stroke-width: 4;
			}
		}
	}

	.edge-id-text {
		font-size: 10px;
	}

	
</style>
