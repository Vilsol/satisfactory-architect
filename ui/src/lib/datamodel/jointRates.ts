/**
 * How much material a single machine moves through one of its joints.
 *
 * Used when a new building is dragged out of an existing joint: the new one is sized
 * so that the joint it gets connected to runs at the same rate as the joint it came
 * from, rather than always arriving as a single machine.
 */

import { satisfactoryDatabase } from "$lib/satisfactoryDatabase";
import type { GraphNode, GraphNodeProductionProperties, GraphNodeResourceJointProperties } from "./GraphNode.svelte";
import type { GraphPage } from "./GraphPage.svelte";
import { portFactor } from "./overclocking";

function owningBuilding(page: GraphPage, joint: GraphNode): GraphNode<GraphNodeProductionProperties> | null {
	if (joint.properties.type !== "resource-joint" || joint.parentNode === null) {
		return null;
	}
	const parent = page.nodes.get(joint.parentNode);
	if (!parent || parent.properties.type !== "production") {
		return null;
	}
	return parent as GraphNode<GraphNodeProductionProperties>;
}

/**
 * What one machine pushes or pulls through this joint per minute, ignoring how many
 * machines there are. Null when the joint has no building, or the game data no longer
 * describes it.
 */
export function ratePerMachine(page: GraphPage, joint: GraphNode | undefined): number | null {
	if (!joint) {
		return null;
	}
	const building = owningBuilding(page, joint);
	if (!building) {
		return null;
	}
	const jointProps = joint.properties as GraphNodeResourceJointProperties;
	const details = building.properties.details;
	// How hard the building is being run, and which end of it this joint is on.
	const tuning = portFactor(building.properties, jointProps.jointType);

	switch (details.type) {
		case "recipe": {
			const recipe = satisfactoryDatabase.recipes[details.recipeClassName];
			if (!recipe) return null;
			const parts = jointProps.jointType === "input" ? recipe.inputs : recipe.outputs;
			const perMachine = parts.find(p => p.itemClass === jointProps.resourceClassName)?.amountPerMinute;
			return perMachine === undefined ? null : perMachine * tuning;
		}
		case "power-production": {
			const fuel = satisfactoryDatabase.powerProducers[details.powerBuildingClassName]
				?.fuels[details.fuelClassName];
			if (!fuel) return null;
			const parts = jointProps.jointType === "input" ? fuel.inputs : fuel.outputs;
			const perMachine = parts.find(p => p.itemClass === jointProps.resourceClassName)?.amountPerMinute;
			return perMachine === undefined ? null : perMachine * tuning;
		}
		case "extraction": {
			const extractor = satisfactoryDatabase.extractionBuildings[details.buildingClassName];
			if (!extractor) return null;
			return extractor.baseProductionRate * (details.purityModifier ?? 1) * tuning;
		}
		case "factory-input":
		case "factory-output":
			// These carry their rate directly in the multiplier.
			return 1;
		default:
			// A reference to another page is sized by that page, not from here.
			return null;
	}
}

/** What this joint is currently running at, across all of its machines. */
export function jointRate(page: GraphPage, joint: GraphNode | undefined): number | null {
	const perMachine = ratePerMachine(page, joint);
	if (perMachine === null) {
		return null;
	}
	const building = owningBuilding(page, joint!)!;
	return perMachine * building.properties.multiplier;
}

/**
 * How many machines the joint's building needs so that this joint runs at
 * `targetRate`. Fractions are kept - the tool runs buildings at fractional rates
 * everywhere else, and rounding here would silently miss the rate being matched.
 */
export function machinesToMatch(page: GraphPage, joint: GraphNode | undefined, targetRate: number | null): number | null {
	if (targetRate === null || !(targetRate > 0)) {
		return null;
	}
	const perMachine = ratePerMachine(page, joint);
	if (perMachine === null || !(perMachine > 0)) {
		return null;
	}
	return targetRate / perMachine;
}
