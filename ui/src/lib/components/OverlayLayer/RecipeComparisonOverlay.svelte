<script lang="ts">
	import { onDestroy, onMount } from "svelte";
	import type { EventStream, ShowRecipeComparisonEvent } from "$lib/EventStream.svelte";
	import { satisfactoryDatabase } from "$lib/satisfactoryDatabase";
	import { recipesProducing } from "$lib/datamodel/recipeComparison";
	import { floatToString } from "$lib/utilties";
	import SfIconView from "../SFIconView.svelte";

	interface Props {
		event: ShowRecipeComparisonEvent;
		dismissEventStream: EventStream;
		onclose: () => void;
	}
	const { event, dismissEventStream, onclose }: Props = $props();

	onMount(() => dismissEventStream.addListener(onclose));
	onDestroy(() => dismissEventStream.removeListener(onclose));

	const part = $derived(satisfactoryDatabase.parts[event.itemClass]);
	const itemName = $derived(part?.displayName ?? event.itemClass);
	const options = $derived(recipesProducing(event.itemClass));

	/**
	 * The one that gets the most out of each megawatt. Only worth pointing at when
	 * there is something to compare it against.
	 */
	const cheapestOnPower = $derived.by(() => {
		const withPower = options.filter(option => option.powerPerOutput > 0);
		if (withPower.length < 2) {
			return undefined;
		}
		return withPower.reduce((best, option) => option.powerPerOutput < best.powerPerOutput ? option : best);
	});
</script>

<div class="background"></div>
<div class="recipe-comparison-overlay">
	<div class="title">
		{#if part}
			<SfIconView icon={part.icon} quality="min" size={28} />
		{/if}
		<span>Ways to make {itemName}</span>
	</div>

	<div class="content scrollbar-thin">
		{#each options as option (option.recipeClassName)}
			<div class="option" class:alternate={option.isAlternate}>
				<div class="heading">
					<span class="name">{option.displayName}</span>
					{#if option.isAlternate}
						<span class="tag">Alternate</span>
					{/if}
					{#if cheapestOnPower?.recipeClassName === option.recipeClassName}
						<span class="tag best">Least power</span>
					{/if}
				</div>

				<div class="figures">
					<span>{option.buildingDisplayName}</span>
					<span>{floatToString(option.outputPerMinute, 4)}/min each</span>
					<span>{floatToString(option.powerPerOutput, 3)} MW per {itemName}/min</span>
				</div>

				<div class="parts">
					{#each option.inputs as input (input.itemClass)}
						<span class="part">
							{#if satisfactoryDatabase.parts[input.itemClass]}
								<SfIconView icon={satisfactoryDatabase.parts[input.itemClass].icon} quality="min" size={18} />
							{/if}
							{floatToString(input.perOutput, 3)} × {input.displayName}
						</span>
					{/each}
					{#each option.byproducts as byproduct (byproduct.itemClass)}
						<span class="part byproduct">
							{#if satisfactoryDatabase.parts[byproduct.itemClass]}
								<SfIconView icon={satisfactoryDatabase.parts[byproduct.itemClass].icon} quality="min" size={18} />
							{/if}
							+{floatToString(byproduct.perOutput, 3)} × {byproduct.displayName}
						</span>
					{/each}
				</div>
			</div>
		{:else}
			<div class="nothing">Nothing in the game makes this.</div>
		{/each}
	</div>

	<div class="footnote">
		Everything is per one {itemName} a minute, so recipes of different sizes line up.
	</div>
</div>

<style lang="scss">
	.background {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background-color: var(--popup-block-area-background-color);
		pointer-events: none;
	}

	.recipe-comparison-overlay {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		background-color: var(--popup-background-color);
		border: 1px solid var(--popup-border-color);
		padding: 24px;
		border-radius: var(--rounded-border-radius-big);
		box-shadow: var(--shadow-high);
		width: min(95vw, 640px);
		max-height: 85vh;
		display: flex;
		flex-direction: column;
	}

	.title {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		font-size: 1.5rem;
		font-weight: bold;
		margin-bottom: 16px;
		color: var(--text);
	}

	.content {
		flex: 1;
		overflow-y: auto;
		padding-right: 8px;
	}

	.option {
		padding: 10px 12px;
		border: 1px solid var(--popup-border-color);
		border-radius: var(--rounded-border-radius);
		margin-bottom: 8px;

		&.alternate {
			border-style: dashed;
		}
	}

	.heading {
		display: flex;
		align-items: center;
		gap: 8px;

		.name {
			font-weight: bold;
		}

		.tag {
			font-size: 11px;
			padding: 1px 6px;
			border-radius: var(--rounded-border-radius);
			background-color: var(--background-100);
			color: var(--text-muted);

			&.best {
				color: var(--text);
			}
		}
	}

	.figures {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		margin-top: 4px;
		font-size: 12px;
		color: var(--text-muted);
	}

	.parts {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		margin-top: 6px;
		font-size: 13px;

		.part {
			display: flex;
			align-items: center;
			gap: 4px;
		}

		.byproduct {
			color: var(--text-muted);
		}
	}

	.nothing {
		color: var(--text-muted);
	}

	.footnote {
		margin-top: 14px;
		font-size: 12px;
		color: var(--text-muted);
		text-align: center;
	}
</style>
