<script lang="ts">
	import { satisfactoryDatabase } from "$lib/satisfactoryDatabase";
	import { portFactor } from "$lib/datamodel/overclocking";
	import type { SFPowerFuel, SFRecipe } from "$lib/satisfactoryDatabaseTypes";
	import SfIconView from "../SFIconView.svelte";
	import EdgeAnnotation from "../EdgeAnnotation.svelte";
	import { getNodeRadius, isNodeSelectable } from "../../datamodel/nodeTypeProperties.svelte";
	import { settings } from "$lib/settings.svelte";
	import SvgInput from "../SvgInput.svelte";
	import { assertUnreachable, floatToString, getSlackColor, isThroughputBalanced, parseFloatExpr } from "$lib/utilties";
	import type { GraphNode, GraphNodeProductionProperties, GraphNodeResourceJointProperties } from "../../datamodel/GraphNode.svelte";
	import type { Id } from "../../datamodel/IdGen.svelte";

	interface Props {
		node: GraphNode<GraphNodeResourceJointProperties>;
	}
	const {
		node,
	}: Props = $props();

	const page = $derived(node.context.page);
	const { productionRate, setProductionRate, isEditable } = $derived.by(() => {
		const parent = node.parentNode ? page.nodes.get(node.parentNode) : undefined;
		const parentProperties = parent?.properties;
		if (parentProperties?.type !== "production") {
			return {
				outputIcon: undefined,
				productionRate: undefined,
				setProductionRate: undefined,
			};
		}
		
		const parentDetails = parentProperties.details;
		let productionRate: number | undefined;
		let setProductionRate: ((value: number) => void) | undefined;
		let isEditable = true;
		switch (parentDetails.type) {
			case "recipe":
			case "power-production":
				let recipe: SFRecipe|SFPowerFuel;
				if (parentDetails.type === "recipe") {
					recipe = satisfactoryDatabase.recipes[parentDetails.recipeClassName];
				} else {
					recipe = satisfactoryDatabase.powerProducers[parentDetails.powerBuildingClassName]
						?.fuels[parentDetails.fuelClassName];
				}
				const recipeParts = node.properties.jointType === "input" ? recipe?.inputs : recipe?.outputs;
				const recipePart = recipeParts?.find(p => p.itemClass === node.properties.resourceClassName);
				const amountPerMinute = recipePart?.amountPerMinute;
				if (amountPerMinute !== undefined) {
					const tuning = portFactor(parentProperties, node.properties.jointType);
					productionRate = amountPerMinute * parentProperties.multiplier * tuning;
					setProductionRate = ((value: number) => parentProperties.multiplier = value / amountPerMinute / tuning);
				}
				break;
			case "factory-output":
			case "factory-input":
				const factoryPart = satisfactoryDatabase.parts[parentDetails.partClassName];
				if (factoryPart) {
					productionRate = parentProperties.multiplier;
					setProductionRate = ((value: number) => parentProperties.multiplier = value);
				}
				isEditable = !parentProperties.autoMultiplier;
				break;
			case "extraction":
				const productionBuilding = satisfactoryDatabase.extractionBuildings[parentDetails.buildingClassName];
				const purityModifier = parentDetails.purityModifier ?? 1;
				if (productionBuilding && purityModifier) {
					const tuning = portFactor(parentProperties, node.properties.jointType);
					productionRate = productionBuilding.baseProductionRate * purityModifier * parentProperties.multiplier * tuning;
					setProductionRate = ((value: number) => parentProperties.multiplier = value / productionBuilding.baseProductionRate / purityModifier / tuning);
				}
				break;
			case "factory-reference":
				function getExternalNodeProperties(pageId: Id, externalId?: Id): GraphNodeProductionProperties | undefined {
					if (!externalId)
						return undefined;
					const factoryPage = page.context.appState.pages.find(p => p.id === pageId);
					const externalNode = factoryPage ? factoryPage.nodes.get(externalId) : undefined;
					if (!externalNode || externalNode.properties.type !== "production") {
						return undefined;
					}
					return externalNode.properties;
				}
				const factoryId = parentDetails.factoryId;
				const externalNodeId = parentDetails.jointsToExternalNodes[node.id];
				const externalNodeProperties = getExternalNodeProperties(factoryId, externalNodeId);
				isEditable = externalNodeProperties ? !externalNodeProperties.autoMultiplier : false;
				if (externalNodeProperties) {
					productionRate = externalNodeProperties.multiplier;
					if (isEditable) {
						setProductionRate = ((value: number) => {
							const externalNodeProperties = getExternalNodeProperties(factoryId, externalNodeId);
							if (externalNodeProperties) {
								externalNodeProperties.multiplier = value;
							}
						});
					}
				}
				break;
		}

		return {
			productionRate,
			setProductionRate,
			isEditable,
		};
	});

	const {suggestedThroughput, throughputColor} = $derived.by(() => {
		const fallback = {suggestedThroughput: 0, throughputColor: ""};
		if (node.edges.size === 0) {
			return fallback;
		}
		let total = 0;
		for (const edgeId of node.edges.values()) {
			const edge = page.edges.get(edgeId);
			if (edge === undefined) {
				continue;
			}
			total += edge.flow;
		}

		// The point of the suggestion is to offer the rate that matches THE OTHER SIDE,
		// so an over-supplied consumer can be scaled up to swallow what it is being
		// given, not just a producer scaled down. What actually flows is the smaller of
		// the two and so would only ever offer scaling down.
		const suggestedThroughput = node.balanceTarget;
		if (isThroughputBalanced(suggestedThroughput, productionRate ?? 0)) {
			return fallback;
		}
		const throughputColor = getSlackColor(node.shortfall, node.surplus, total);
		return { suggestedThroughput, throughputColor };
	});

	const isSelected = $derived(page.selectedNodes.has(node.id));
	const isSelectable = $derived(isNodeSelectable(node));
	const highlightAttachable = $derived(page.highlightedNodes.attachable.has(node.id));
	const highlightHovered = $derived(page.highlightedNodes.hovered.has(node.id));

	const resource = $derived(satisfactoryDatabase.parts[node.properties.resourceClassName]);

	const outerRadius = getNodeRadius(node);
	const innerRadius = outerRadius - 4;
	const inputWidth = outerRadius * 2.2;
	
	const suggestionX = $derived.by(() => {
		const offset = outerRadius - 3;
		if (node.properties.jointType === "input") {
			return -offset;
		} else if (node.properties.jointType === "output") {
			return offset;
		} else {
			assertUnreachable(node.properties.jointType);
		}
	});
	const suggestionAlign = $derived(node.properties.jointType === "input" ? "right" : "left");

	/**
	 * How much this joint is short of, or has spare. Worked out by the calculation and
	 * otherwise only used to tint things - showing the figure saves the reader working
	 * it out from two other numbers.
	 */
	const slack = $derived.by(() => {
		if (node.shortfall > 0) {
			return { text: `-${floatToString(node.shortfall, 3)}`, color: "var(--underflow-color)" };
		}
		if (node.surplus > 0) {
			return { text: `+${floatToString(node.surplus, 3)}`, color: "var(--overflow-color)" };
		}
		return null;
	});

	
	function onProductionRateChange(value: string, isEnter: boolean) {
		const parsedValue = parseFloatExpr(value, !isEnter);
		if (!isNaN(parsedValue)) {
			setProductionRate!(parsedValue);
		}
	}
</script>

<g
	class="resource-joint-node-view"
	class:selectable={isSelectable}
	class:selected={isSelected}
	class:highlight-attachable={highlightAttachable}
	class:highlight-hovered={highlightHovered}
	class:locked={node.properties.locked}
	data-tooltip={node.properties.locked ? resource?.displayName : undefined}
>
	<circle r={outerRadius} />
	<SfIconView
		icon={resource.icon}
		x={-innerRadius}
		y={-innerRadius}
		size={innerRadius * 2}
	/>
	{#if productionRate !== undefined}
		<SvgInput
			x={-inputWidth / 2}
			y={11}
			width={inputWidth}
			height={9}
			fontSize={11}
			isEditable={isEditable && setProductionRate !== undefined}
			textAlign={"center"}
			value={floatToString(productionRate, 4)}
			onChange={setProductionRate !== undefined ? (value) => onProductionRateChange(value, false) : undefined}
			onEnter={setProductionRate !== undefined ? (value) => onProductionRateChange(value, true) : undefined}
		/>
	{/if}
	{#if setProductionRate && suggestedThroughput !== 0}
		<EdgeAnnotation
			x={suggestionX}
			y={-outerRadius/2 - 6.5}
			text={floatToString(suggestedThroughput, 3)}
			color={throughputColor}
			align={suggestionAlign}
			onClick={() => setProductionRate(suggestedThroughput)}
		/>
	{/if}
	{#if slack}
		<EdgeAnnotation
			x={suggestionX}
			y={-outerRadius / 2 - 19.5}
			text={slack.text}
			color={slack.color}
			align={suggestionAlign}
			fontSize={8}
		/>
	{/if}
	{#if settings.debugShowNodeIds.value}
		<text
			x="0"
			y="-10"
			text-anchor="middle"
			style="pointer-events: none; font-size: 11px; font-family: monospace;"
		>
			n {node.id}
		</text>
	{/if}
</g>

<style lang="scss">
	.resource-joint-node-view {
		circle {
			fill: var(--node-background-color);
			stroke: var(--node-border-color);
			stroke-width: var(--rounded-border-width);
			transition: stroke 0.1s ease-in-out;
		}

		&.locked :global(:not(:where(text, foreignObject, foreignObject *))) {
			cursor: cell;
		}
		
		&.selectable:hover:not(:where(.selected, .highlight-hovered)) {
			circle {
				stroke: var(--node-border-hover-color);
			}
		}
	
		&:where(.highlight-attachable) {
			circle {
				stroke: var(--node-border-highlight-color);
			}
		}
	
		&:where(.selected, .highlight-hovered) {
			circle {
				stroke: var(--node-border-selected-color);
			}
		}
	}

	
</style>
