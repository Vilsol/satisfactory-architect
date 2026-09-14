<script lang="ts">
	import { onDestroy, onMount } from "svelte";
	import type { EventStream, ShowRecipeComparisonEvent } from "$lib/EventStream.svelte";
	import { satisfactoryDatabase } from "$lib/satisfactoryDatabase";
	import { recipesProducing } from "$lib/datamodel/recipeComparison";
	import { rawCostOf, type RawCost } from "$lib/datamodel/rawCost";
	import { recipePreferences } from "$lib/recipePreferences.svelte";
	import { settings } from "$lib/settings.svelte";
	import { floatToString, formatPower } from "$lib/utilties";
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

	/**
	 * The whole chain under each option, costed down to ore. Re-run when the byproduct
	 * toggle moves or a recipe is chosen further down, because both change the answer.
	 */
	const costs = $derived.by(() => {
		const creditByproducts = settings.creditByproducts.value;
		const preferred = recipePreferences.all;
		const found = new Map<string, RawCost>();
		for (const option of options) {
			found.set(option.recipeClassName, rawCostOf({
				recipeClassName: option.recipeClassName,
				itemClass: event.itemClass,
				creditByproducts,
				preferred,
			}));
		}
		return found;
	});

	const chosen = $derived(recipePreferences.effectiveFor(event.itemClass));
	let openBreakdown: string | null = $state(null);
</script>

<div class="background"></div>
<div class="recipe-comparison-overlay">
	<div class="title">
		{#if part}
			<SfIconView icon={part.icon} quality="min" size={28} />
		{/if}
		<span>Ways to make {itemName}</span>
	</div>

	<label class="credit-toggle">
		<input type="checkbox" bind:checked={settings.creditByproducts.value} />
		<span>Count byproducts against the cost</span>
	</label>

	<div class="content scrollbar-thin">
		{#each options as option (option.recipeClassName)}
			{@const cost = costs.get(option.recipeClassName)}
			<div class="option" class:alternate={option.isAlternate}>
				<div class="heading">
					<span class="name">{option.displayName}</span>
					{#if option.isAlternate}
						<span class="tag">Alternate</span>
					{/if}
					{#if cheapestOnPower?.recipeClassName === option.recipeClassName}
						<span class="tag best">Least power</span>
					{/if}
					{#if chosen === option.recipeClassName}
						<span class="tag best">Assumed</span>
					{:else}
						<button class="use-button" onclick={() => recipePreferences.set(event.itemClass, option.recipeClassName)}>
							Use this one
						</button>
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

				{#if cost && !cost.ok}
					<div class="cost none">
						{cost.reason === "unsolvable"
							? "No finite cost - this and what feeds it go round in a circle."
							: "Nothing to cost."}
					</div>
				{:else if cost}
					<div class="cost">
						<div class="raws">
							{#each cost.raws as raw (raw.itemClass)}
								<span class="part">
									{#if satisfactoryDatabase.parts[raw.itemClass]}
										<SfIconView icon={satisfactoryDatabase.parts[raw.itemClass].icon} quality="min" size={18} />
									{/if}
									{floatToString(raw.perMinute, 4)} × {raw.displayName}
								</span>
							{:else}
								<span class="part">Comes straight out of the ground.</span>
							{/each}
						</div>
						<div class="figures">
							<span>{floatToString(cost.machineCount, 4)} machines in all</span>
							<span>{formatPower(cost.totalPower)} for the whole chain</span>
							{#if cost.steps.length > 1}
								<button
									class="link-button"
									onclick={() => openBreakdown = openBreakdown === option.recipeClassName ? null : option.recipeClassName}
								>
									{openBreakdown === option.recipeClassName ? "Hide" : "Show"} the {cost.steps.length} steps
								</button>
							{/if}
						</div>
						{#each cost.supplied as item (item.itemClass)}
							<div class="figures warn">
								Needs {floatToString(item.perMinute, 4)} × {item.displayName} from somewhere else - nothing makes it.
							</div>
						{/each}
						{#if cost.surplus.length > 0}
							<div class="figures">
								Spare: {cost.surplus.map(s => `${floatToString(s.perMinute, 4)} × ${s.displayName}`).join(", ")}
							</div>
						{/if}
						{#if openBreakdown === option.recipeClassName}
							<div class="steps">
								{#each cost.steps as step (step.recipeClassName + step.itemClass)}
									<div class="step">
										<span class="step-machines">{floatToString(step.machines, 4)}×</span>
										<span>{step.buildingDisplayName}</span>
										<span class="step-recipe">{step.displayName}</span>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
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

	.credit-toggle {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 12px;
		font-size: 13px;
		color: var(--text-muted);
		cursor: pointer;
	}

	.use-button {
		margin-left: auto;
		font-size: 11px;
		padding: 2px 8px;
		border-radius: var(--rounded-border-radius);
		border: 1px solid var(--popup-border-color);
		background-color: transparent;
		color: var(--text-muted);
		cursor: pointer;

		&:hover {
			color: var(--text);
		}
	}

	.link-button {
		border: none;
		background: none;
		padding: 0;
		font-size: 12px;
		color: var(--text-muted);
		text-decoration: underline;
		cursor: pointer;

		&:hover {
			color: var(--text);
		}
	}

	.cost {
		margin-top: 8px;
		padding-top: 8px;
		border-top: 1px solid var(--popup-border-color);

		&.none {
			font-size: 12px;
			color: var(--text-muted);
		}

		.raws {
			display: flex;
			flex-wrap: wrap;
			gap: 4px 14px;
			font-size: 13px;

			.part {
				display: flex;
				align-items: center;
				gap: 4px;
			}
		}

		.warn {
			color: var(--over-capacity-color);
		}
	}

	.steps {
		margin-top: 8px;
		font-size: 12px;

		.step {
			display: flex;
			gap: 8px;
			padding: 1px 0;
			color: var(--text-muted);
		}

		.step-machines {
			min-width: 52px;
			text-align: right;
		}

		.step-recipe {
			color: var(--text);
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
