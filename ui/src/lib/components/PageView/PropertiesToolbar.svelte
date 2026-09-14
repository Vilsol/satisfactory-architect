<script lang="ts">
	import type { GraphNodeProductionProperties, ProductionExtractionDetails } from "$lib/datamodel/GraphNode.svelte";
	import type { GraphPage } from "$lib/datamodel/GraphPage.svelte";
	import type { Id } from "$lib/datamodel/IdGen.svelte";
	import { floatToString, formatPower, loadFileFromDisk, openLinkInNewTab, parseFloatExpr, saveFileToDisk, showConfirmationPrompt } from "$lib/utilties";
	import { getContext, untrack } from "svelte";
	import PresetSvg from "../icons/PresetSvg.svelte";
	import type { SvgPresetName } from "../icons/svgPresets";
	import { satisfactoryDatabase } from "$lib/satisfactoryDatabase";
	import { nodePower } from "$lib/datamodel/nodePower";
	import { buildingOf, clampClockSpeed } from "$lib/datamodel/overclocking";
	import SfIconView from "../SFIconView.svelte";
	import type { EventStream } from "$lib/EventStream.svelte";
	import { settings } from "$lib/settings.svelte";
	import type { AppState } from "$lib/datamodel/AppState.svelte";
	import { changelog } from "$lib/datamodel/constants";

	interface Props {
		page: GraphPage;
	}
	const {
		page,
	}: Props = $props();

	const appState = getContext<AppState>("app-state");
	const eventStream = getContext<EventStream>("overlay-layer-event-stream");

	interface AggregateResult<T> {
		hasValues: boolean;
		value: T | undefined;
		setValues: (value: T) => void;
	}
	function aggregateValues<I, V>(items: I[], getValue: (value: I) => V, setValue: (items: I, value: V) => void): AggregateResult<V> {
		function setValues(value: V) {
			for (const item of items) {
				setValue(item, value);
			}
		}
		if (items.length === 0) {
			return { hasValues: false, value: undefined, setValues };
		}
		const first = getValue(items[0]);
		for (let i = 1; i < items.length; i++) {
			const value = getValue(items[i]);
			if (value !== first) {
				return { hasValues: true, value: undefined, setValues };
			}
		}
		return { hasValues: true, value: first, setValues };
	}

	const selectedNodes = $derived.by(() => Array.from(
		page.selectedNodes.values()
			.map(id => page.nodes.get(id))
			.filter(n => n !== undefined)
	));
	const selectedEdges = $derived.by(() => Array.from(
		page.selectedEdges.values()
			.map(id => page.edges.get(id))
			.filter(e => e !== undefined)
	));
	const aggPurityModifier = $derived.by(() => {
		const purityValues = selectedNodes
			.values()
			.map(node => node.properties)
			.filter(properties => properties.type === "production")
			.map(properties => properties as GraphNodeProductionProperties)
			.filter(properties => properties.details.type === "extraction")
			.map(properties => properties.details as ProductionExtractionDetails)
			.filter(details => {
				const building = satisfactoryDatabase.extractionBuildings[details.buildingClassName];
				return building && building.supportsPurity;
			});
		return aggregateValues(
			Array.from(purityValues),
			v => v.purityModifier,
			(v, value) => v.purityModifier = value,
		);
	});
	const aggAutoMultiplier = $derived.by(() => {
		const multiplierValues = selectedNodes
			.values()
			.map(node => node.properties)
			.filter(properties => properties.type === "production")
			.map(properties => properties as GraphNodeProductionProperties)
			.filter(properties => properties.details.type === "factory-input" || properties.details.type === "factory-output");

		return aggregateValues(
			Array.from(multiplierValues),
			v => v.autoMultiplier,
			(v, value) => {
				v.autoMultiplier = value;
				settings.autoRateForFactoryIo.value = value;
			},
		);
	});;
	const aggCustomColor = $derived.by(() => {
		const customColorValues = selectedNodes
			.values()
			.map(node => node.properties)
			.filter(properties => properties.type === "production")
			.map(properties => properties as GraphNodeProductionProperties);

		return aggregateValues(
			Array.from(customColorValues),
			v => v.customColor,
			(v, value) => v.customColor = value
		);
	});
	const overclockableNodes = $derived(selectedNodes.filter(
		node => node.properties.type === "production" && buildingOf(node.properties.details) !== undefined
	));
	const aggClockSpeed = $derived.by(() => aggregateValues(
		overclockableNodes,
		node => node.clockSpeed,
		(node, value) => node.setClockSpeed(value),
	));
	const sloopableNodes = $derived(selectedNodes.filter(node => node.sloopSlots > 0));
	/**
	 * The fullest the whole selection can go. A constructor and a manufacturer together
	 * stop at the one somersloop the constructor has room for.
	 */
	const sloopSlotsAvailable = $derived(sloopableNodes.length === 0
		? 0
		: Math.min(...sloopableNodes.map(node => node.sloopSlots)));
	const aggSloops = $derived.by(() => aggregateValues(
		sloopableNodes,
		node => node.sloops,
		(node, value) => node.setSloops(value),
	));

	function clockSpeedAsText(): string {
		return aggClockSpeed.value === undefined ? "" : floatToString(aggClockSpeed.value * 100, 4);
	}
	// The box is typed into, so it cannot read straight off the nodes - it would fight
	// every keystroke. It follows them, and hands what was typed back when editing ends.
	let clockSpeedText = $state("");
	$effect(() => {
		clockSpeedText = clockSpeedAsText();
	});
	function commitClockSpeed() {
		const parsed = parseFloatExpr(clockSpeedText, false);
		if (isNaN(parsed)) {
			clockSpeedText = clockSpeedAsText();
			return;
		}
		const clamped = clampClockSpeed(parsed / 100);
		aggClockSpeed.setValues(clamped);
		clockSpeedText = floatToString(clamped * 100, 4);
	}

	const aggDisplayType = $derived.by(() => {
		return aggregateValues(
			selectedEdges,
			v => v.properties.displayType,
			(v, value) => v.properties.displayType = value,
		);
	});
	const aggStartOrientation = $derived.by(() => {
		const edges = selectedEdges.filter(e => {
			if (!e.startNode) return false;
			if (e.startNode.properties.type !== "resource-joint") return true;
			return !e.startNode.properties.locked;
		});
		return aggregateValues(
			edges,
			v => v.properties.startOrientation,
			(v, value) => v.properties.startOrientation = value,
		);
	});
	const aggEndOrientation = $derived.by(() => {
		const edges = selectedEdges.filter(e => {
			if (!e.endNode) return false;
			if (e.endNode.properties.type !== "resource-joint") return true;
			return !e.endNode.properties.locked;
		});
		return aggregateValues(
			edges,
			v => v.properties.endOrientation,
			(v, value) => v.properties.endOrientation = value,
		);
	});
	const aggIsDrainLine = $derived.by(() => {
		return aggregateValues(
			selectedEdges,
			v => v.properties.isDrainLine,
			(v, value) => v.properties.isDrainLine = value,
		);
	});

	let initialNodeMultipliers: Record<Id, number> = {};
	$effect(() => {
		initialNodeMultipliers = {};
		for (const nodeId of page.selectedNodes.values()) {
			untrack(() => {
				const node = page.nodes.get(nodeId);
				if (node && node.properties.type === "production" && !node.properties.autoMultiplier) {
					initialNodeMultipliers[node.id] = node.properties.multiplier;
				}
				
			});
		}
		if (Object.values(initialNodeMultipliers).length === 1) {
			const firstId = Object.keys(initialNodeMultipliers)[0];
			nodesMultiplier = initialNodeMultipliers[firstId];
			initialNodeMultipliers[firstId] = 1.0;
		} else {
			nodesMultiplier = 1.0;
		}
	});
	let nodesMultiplier: number = $state(1.0);
	function setNodesMultiplier(value: number) {
		nodesMultiplier = value;
		for (const nodeId of page.selectedNodes.values()) {
			const node = page.nodes.get(nodeId);
			const initialMultiplier = initialNodeMultipliers[nodeId] ?? 1.0;
			if (node && node.properties.type === "production" && !node.properties.autoMultiplier) {
				node.properties.multiplier = initialMultiplier * nodesMultiplier;
			}
		}
	}
	/** Anything that can be turned - unlike the multiplier, auto-rate ones count too. */
	const hasRotatableNodesSelected = $derived.by(() => {
		for (const nodeId of page.selectedNodes.values()) {
			if (page.nodes.get(nodeId)?.properties.type === "production") {
				return true;
			}
		}
		return false;
	});

	const hasProductionNodesSelected = $derived.by(() => {
		for (const nodeId of page.selectedNodes.values()) {
			const node = page.nodes.get(nodeId);
			if (node && node.properties.type === "production" && !node.properties.autoMultiplier) {
				return true;
			}
		}
		return false;
	});

	interface UsedBuilding {
		buildingClassName: string;
		displayName: string;
		icon: string;
		count: number;
	}
	const usedBuildings: UsedBuilding[] = $derived.by(() => {
		const used: Record<string, UsedBuilding> = {};
		for (const node of selectedNodes) {
			if (node.properties.type !== "production") continue;
			const buildingClassName = buildingOf(node.properties.details);
			if (!buildingClassName) continue;
			if (!used[buildingClassName]) {
				const building = satisfactoryDatabase.buildings[buildingClassName];
				if (!building)
					continue;
				used[buildingClassName] = {
					buildingClassName: buildingClassName,
					displayName: building.displayName,
					icon: building.icon,
					count: 0,
				};
			}
			used[buildingClassName].count += node.properties.multiplier;
		}
		return Object.values(used).toReversed();
	});
	const { powerConsumed, powerProduced } = $derived.by(() => {
		let powerConsumed = 0;
		let powerProduced = 0;
		for (const node of selectedNodes) {
			if (node.properties.type !== "production") continue;
			const power = nodePower(node.properties);
			powerConsumed += power.consumed;
			powerProduced += power.produced;
		}
		return { powerConsumed, powerProduced };
	});

	function showMenu() {
		eventStream.emit({
			type: "showContextMenu",
			x: 0,
			y: 30,
			items: [
				{
					label: "Save All Pages",
					icon: "save-as",
					onClick: saveAllPages,
				},
				{
					label: "Save Current Page",
					icon: "export",
					onClick: saveCurrentPage,
				},
				{
					label: "Load File",
					icon: "load",
					onClick: loadFile,
				},
				{
					label: "Import File",
					icon: "import",
					onClick: importFile,
				},
				{
					label: "Multi-User Collaboration",
					icon: "refresh",
					onClick: () => eventStream.emit({ type: "showConnectionOverlay" }),
				},
				{
					label: "Settings",
					icon: "settings",
					onClick: () => eventStream.emit({ type: "showSettings" }),
				},
				{
					label: "Show changelog",
					icon: "note",
					onClick: () => eventStream.emit({
						type: "showChangelog",
						changelog: changelog,
					}),
				},
				{
					label: "View on GitHub",
					icon: "github",
					onClick: () => openLinkInNewTab("https://github.com/ArthurHeitmann/satisfactory-architect"),
				},
			]
		});
	}

	function saveAllPages() {
		const jsonData = JSON.stringify(appState.toJSON());
		saveFileToDisk("save.json", jsonData);
	}

	function saveCurrentPage() {
		const jsonData = JSON.stringify(appState.toJSON({ filterPageIds: [page.id] }));
		saveFileToDisk(`${page.name}.json`, jsonData);
	}

	async function loadFile() {
		const text = await loadFileFromDisk();
		if (!text) return;
		let jsonData;
		try {
			jsonData = JSON.parse(text);
		} catch (error) {
			console.error("Failed to parse JSON from file", error);
			return;
		}
		const answer = await showConfirmationPrompt(eventStream, {
			message: "After loading this file, any unsaved changes will be lost. \nDo you want to continue?",
			confirmLabel: "Load",
		});
		if (answer !== true) {
			return;
		}
		appState.replaceFromJSON(jsonData);
	}

	async function importFile() {
		const text = await loadFileFromDisk();
		if (!text) return;
		let jsonData;
		try {
			jsonData = JSON.parse(text);
		} catch (error) {
			console.error("Failed to parse JSON from file", error);
			return;
		}
		appState.insertPagesFromJSON(jsonData, "external");
	}
	
	function onMultiplierChange(value: string, isEnter: boolean) {
		const parsedValue = parseFloatExpr(value, !isEnter);
		if (!isNaN(parsedValue)) {
			setNodesMultiplier(parsedValue);
		}
	}

	type DisplayMethod = {text: string} | {icon: SvgPresetName};
</script>

{#snippet optionButton<T>(agg: AggregateResult<T>, value: T, canToggleToNull: boolean, display: DisplayMethod)}
	<button
		class="toggle-button"
		class:selected={agg.value === value}
		onclick={() => {
			if (agg.value === value) {
				if (canToggleToNull) {
					agg.setValues(null as any);
				}
			} else {
				agg.setValues(value);
			}
		}}
	>
		{#if "text" in display}
			<div class="button-text">{display.text}</div>
		{:else if "icon" in display}
			<PresetSvg name={display.icon} size={18} color="currentColor" />
		{/if}
	</button>
{/snippet}
{#snippet optionButtons<T>(agg: AggregateResult<T>, title: string, canToggleToNull: boolean, pairs: {v: T, display: DisplayMethod}[])}
	{#if agg.hasValues}
		<div class="option-group">
			{#if title}
				<div class="title">{title}</div>
			{/if}
			{#each pairs as pair}
				{@render optionButton(agg, pair.v, canToggleToNull, pair.display)}
			{/each}
		</div>
	{/if}
{/snippet}
	<div class="properties-toolbar scrollbar-hidden">
	<div class="option-group">
		<button class="click-button" onclick={showMenu}>
			<PresetSvg name={"hamburger-menu"} size={18} color="currentColor" />
		</button>
		<button class="click-button" onclick={() => page.history.undo()} disabled={!page.history.canUndo}>
			<PresetSvg name={"undo"} size={18} color="currentColor" />
		</button>
		<button class="click-button" onclick={() => page.history.redo()} disabled={!page.history.canRedo}>
			<PresetSvg name={"redo"} size={18} color="currentColor" />
		</button>
		<button class="toggle-button" class:selected={page.view.enableGridSnap} onclick={() => page.view.enableGridSnap = !page.view.enableGridSnap} data-tooltip="Grid Snap" data-tooltip-position="bottom">
			<PresetSvg name={"grid"} size={18} color="currentColor" />
		</button>
	</div>
	{@render optionButtons(aggAutoMultiplier, "", true, [
		{v: true, display: {text: "Auto Rate"}},
	])}
	{#if hasRotatableNodesSelected}
		<div class="option-group">
			<button
				class="click-button"
				onclick={() => page.rotateSelectedNodes(1)}
				data-tooltip="Rotate (R, Shift+R the other way)"
				data-tooltip-position="bottom"
			>
				<PresetSvg name={"rotate"} size={18} color="currentColor" />
			</button>
		</div>
	{/if}
	{#if hasProductionNodesSelected}
		<div class="option-group">
			<div class="title">Multiplier</div>
			<input
				class="multiplier-input"
				value={floatToString(nodesMultiplier, 4)}
				oninput={e => {
					const value = (e.target as HTMLInputElement).value;
					onMultiplierChange(value, false);
				}}
				onkeydown={e => {
					if (e.key === "Enter") {
						(e.target as HTMLInputElement).blur();
					}
				}}
				onblur={e => {
					const value = (e.target as HTMLInputElement).value;
					onMultiplierChange(value, true);
				}}
			/>
		</div>
	{/if}
	{#if aggClockSpeed.hasValues}
		<div class="option-group">
			<div class="title">Clock</div>
			<input
				class="multiplier-input"
				placeholder="--"
				bind:value={clockSpeedText}
				onkeydown={e => {
					if (e.key === "Enter") {
						(e.target as HTMLInputElement).blur();
					}
				}}
				onblur={commitClockSpeed}
			/>
			<span class="input-unit">%</span>
		</div>
	{/if}
	{#if sloopSlotsAvailable > 0}
		{@render optionButtons(aggSloops, "Sloops", false,
			Array.from({length: sloopSlotsAvailable + 1}, (_, count) => ({v: count, display: {text: String(count)}})))}
	{/if}
	{#if aggCustomColor.hasValues}
		<div class="option-group">
			<div class="title">Color</div>
			<button
				class="click-button color-button"
				style="--custom-color: {aggCustomColor.value ?? "--node-background-color"};"
				onclick={(e) => {
					const target = (e.currentTarget as HTMLElement);
					const rect = target.getBoundingClientRect();
					eventStream.emit({
						type: "showColorPicker",
						x: rect.left,
						y: rect.bottom + 4,
						currentColor: () => aggCustomColor.value,
						onSelect: (color) => aggCustomColor.setValues(color),
					});
				}}
			>
				<div class="circle"></div>
			</button>
		</div>
	{/if}
	{@render optionButtons(aggPurityModifier, "", false, [
		{v: 0.5 as const, display: {text: "Impure"}},
		{v: 1.0 as const, display: {text: "Normal"}},
		{v: 2.0 as const, display: {text: "Pure"}},
	])}
	{@render optionButtons(aggDisplayType, "", false, [
		{v: "straight" as const, display: {icon: "straight-line"}},
		{v: "curved" as const, display: {icon: "curved-line"}},
		{v: "angled" as const, display: {icon: "angled-line"}},
		{v: "teleport" as const, display: {icon: "teleport-line"}},
	])}
	{@render optionButtons(aggIsDrainLine, "", true, [
		{v: true, display: {text: "Overflow Only"}},
	])}
	{@render optionButtons(aggStartOrientation, "", true, [
		{v: "right" as const, display: {icon: "arrow-right-base-left"}},
		{v: "left" as const, display: {icon: "arrow-left-base-right"}},
		{v: "top" as const, display: {icon: "arrow-up-base-bottom"}},
		{v: "bottom" as const, display: {icon: "arrow-down-base-top"}},
	])}
	{@render optionButtons(aggEndOrientation, "", true, [
		{v: "left" as const, display: {icon: "arrow-right-base-right"}},
		{v: "right" as const, display: {icon: "arrow-left-base-left"}},
		{v: "bottom" as const, display: {icon: "arrow-up-base-top"}},
		{v: "top" as const, display: {icon: "arrow-down-base-bottom"}},
	])}
	<div class="spacer"></div>
	{#if usedBuildings.length > 0}
		<div class="option-group">
			{#each usedBuildings as building}
				{#if building.icon}
					<div class="used-building" data-tooltip={building.displayName} data-tooltip-position="bottom">
						<SfIconView icon={building.icon} size={24} quality="min" />
						<span class="building-count">{floatToString(building.count, 1)}</span>
					</div>
				{/if}
			{/each}
		</div>
	{/if}
	{#if powerConsumed !== 0 || powerProduced !== 0}
		<div class="option-group">
			{#if powerProduced !== 0}
				<PresetSvg name="power" size={18} color="currentColor" />
				<span class="power-value">+{formatPower(powerProduced)}</span>
			{/if}
			{#if powerConsumed !== 0}
				<PresetSvg name="power" size={18} color="currentColor" />
				<span class="power-value">{powerProduced === 0 ? "" : "-"}{formatPower(powerConsumed)}</span>
			{/if}
			{#if powerConsumed !== 0 && powerProduced !== 0}
				<span class="power-value">
					= {formatPower(powerProduced - powerConsumed)}
				</span>
			{/if}
		</div>
	{/if}
</div>

<style lang="scss">
	.properties-toolbar {
		box-sizing: border-box;
		height: var(--properties-toolbar-height);
		background-color: var(--properties-toolbar-background-color);
		border-bottom: 1px solid var(--properties-toolbar-border-color);
		display: flex;
		align-items: center;
		overflow-x: auto;
	}

	.option-group {
		display: flex;
		align-items: center;
		gap: 4px;
		height: 100%;
		border-right: 1px solid var(--toolbar-border-color);
		padding: 0 8px;
		white-space: nowrap;
		font-size: 14px;

		.title {
			margin-right: 4px;
		}

		.input-unit {
			margin-left: -2px;
			opacity: 0.6;
		}

		input {
			width: 60px;
		}

		:where(.toggle-button, .click-button) {
			display: flex;
			align-items: center;
			justify-content: center;
			border-radius: var(--rounded-border-radius);
			height: 24px;
			min-width: 24px;

			&:hover {
				background: var(--toggle-button-hover-background-color);
			}
			
			&:active {
				background: var(--toggle-button-active-background-color);
			}

			&:disabled {
				color: var(--toggle-button-disabled-text-color);
				cursor: default;
			}
		}
		
		.toggle-button {
			&.selected {
				color: var(--toggle-button-selected-text-color);
				background: var(--toggle-button-selected-background-color);
			}

			.button-text {
				padding: 0 4px;
			}
		}

		.color-button {
			.circle {
				width: 16px;
				height: 16px;
				border-radius: 50%;
				border: 2px solid var(--color-button-selected-border-color);
				background: var(--custom-color);
			}
		}

		.used-building {
			display: flex;
			align-items: center;
			gap: 4px;

			& + .used-building {
				margin-left: 4px;
			}
		}
	}

	.spacer {
		flex-grow: 1;

		& + .option-group {
			border-left: 1px solid var(--toolbar-border-color);
		}
	}
</style>
