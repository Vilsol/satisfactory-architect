<script lang="ts">
	import type { GraphPage } from "$lib/datamodel/GraphPage.svelte";
	import { summarisePage } from "$lib/datamodel/pageSummary";
	import { transportNeededFor } from "$lib/datamodel/transportTiers";
	import { floatToString } from "$lib/utilties";
	import { LocalStorageState } from "$lib/localStorageState.svelte";
	import SfIconView from "../SFIconView.svelte";
	import { satisfactoryDatabase } from "$lib/satisfactoryDatabase";

	interface Props {
		page: GraphPage;
	}

	const { page }: Props = $props();

	const isOpen = new LocalStorageState("factory-summary-open", true);

	const overloaded = $derived.by(() => {
		let count = 0;
		for (const edge of page.edges.values()) {
			for (const node of [edge.startNode, edge.endNode]) {
				const props = node?.properties;
				if (props && "resourceClassName" in props) {
					if (transportNeededFor(props.resourceClassName, edge.flow)?.exceedsEverything) {
						count++;
					}
					break;
				}
			}
		}
		return count;
	});

	const summary = $derived(summarisePage(page, overloaded));
	const iconOf = (itemClass: string) => satisfactoryDatabase.parts[itemClass]?.icon;
</script>

<div class="factory-summary" class:collapsed={!isOpen.value}>
	<button class="header" onclick={() => isOpen.value = !isOpen.value}>
		<span class="chevron">{isOpen.value ? "▾" : "▸"}</span>
		<span class="title">Factory Summary</span>
		{#if !isOpen.value}
			<span class="peek">{floatToString(summary.powerUsed - summary.powerMade, 4)} MW</span>
		{/if}
	</button>

	{#if isOpen.value}
		<div class="body">
			{#if summary.inputs.length > 0}
				<div class="section-title">Needs</div>
				{#each summary.inputs as entry (entry.itemClass)}
					<div class="row">
						{#if iconOf(entry.itemClass)}
							<span class="icon"><SfIconView icon={iconOf(entry.itemClass)!} size={16} /></span>
						{/if}
						<span class="name">{entry.displayName}</span>
						<span class="value">{floatToString(entry.ratePerMinute, 4)}/min</span>
					</div>
				{/each}
			{/if}

			{#if summary.outputs.length > 0}
				<div class="section-title">Makes</div>
				{#each summary.outputs as entry (entry.itemClass)}
					<div class="row">
						{#if iconOf(entry.itemClass)}
							<span class="icon"><SfIconView icon={iconOf(entry.itemClass)!} size={16} /></span>
						{/if}
						<span class="name">{entry.displayName}</span>
						<span class="value">{floatToString(entry.ratePerMinute, 4)}/min</span>
					</div>
				{/each}
			{/if}

			<div class="section-title">Running cost</div>
			<div class="row">
				<span class="name">Power drawn</span>
				<span class="value">{floatToString(summary.powerUsed, 4)} MW</span>
			</div>
			{#if summary.powerMade > 0}
				<div class="row">
					<span class="name">Power made</span>
					<span class="value">{floatToString(summary.powerMade, 4)} MW</span>
				</div>
				<div class="row net">
					<span class="name">Net</span>
					<span class="value">{floatToString(summary.powerMade - summary.powerUsed, 4)} MW</span>
				</div>
			{/if}
			<div class="row">
				<span class="name">Machines</span>
				<span class="value">{floatToString(summary.buildingCount, 4)}</span>
			</div>

			{#if summary.overloadedBelts > 0}
				<div class="row warning">
					<span class="name">Lines over capacity</span>
					<span class="value">{summary.overloadedBelts}</span>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style lang="scss">
	.factory-summary {
		position: absolute;
		top: calc(var(--properties-toolbar-height) + 10px);
		right: 10px;
		min-width: 190px;
		max-width: 260px;
		max-height: calc(100dvh - var(--properties-toolbar-height) - 60px);
		overflow-y: auto;
		background-color: var(--toolbar-background-color);
		border: 2px solid var(--toolbar-border-color);
		border-radius: var(--rounded-border-radius);
		font-size: 12px;
		user-select: none;
	}

	.header {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 5px 7px;
		background: none;
		border: none;
		color: inherit;
		font: inherit;
		cursor: pointer;
		text-align: left;
	}

	.chevron {
		opacity: 0.7;
	}

	.title {
		font-weight: 600;
		flex: 1;
	}

	.peek {
		opacity: 0.7;
	}

	.body {
		padding: 0 7px 6px;
	}

	.section-title {
		margin-top: 6px;
		margin-bottom: 2px;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		opacity: 0.6;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 1px 0;

		.name {
			flex: 1;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.value {
			font-variant-numeric: tabular-nums;
			opacity: 0.9;
		}

		&.net .value {
			font-weight: 600;
		}

		&.warning {
			color: var(--over-capacity-color);
			font-weight: 600;
		}
	}

	.icon {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
	}
</style>
