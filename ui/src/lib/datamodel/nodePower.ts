/**
 * What one building on the page draws, and what it makes.
 *
 * This used to be worked out in two places that disagreed: the page summary took the
 * building's base draw, while the properties toolbar preferred the recipe's own figure
 * where it had one. For a Particle Accelerator that is 0.1 MW against 1500 MW. Both
 * now come through here.
 *
 * Draw is raised to the game's power exponent, because that is what the exponent is
 * for. Output is scaled straight by how hard the building is running, so a generator
 * burning two and a half times the fuel makes two and a half times the power.
 */

import { satisfactoryDatabase } from "$lib/satisfactoryDatabase";
import type { GraphNodeProductionProperties } from "./GraphNode.svelte";
import { buildingOf, outputFactor, powerFactor } from "./overclocking";

export interface NodePower {
	/** Megawatts drawn. */
	consumed: number;
	/** Megawatts made. */
	produced: number;
}

const nothing: NodePower = { consumed: 0, produced: 0 };

type PowerProperties = Pick<GraphNodeProductionProperties, "details" | "multiplier" | "clockSpeed" | "sloops">;

export function nodePower(props: PowerProperties): NodePower {
	const building = satisfactoryDatabase.buildings[buildingOf(props.details) ?? ""];
	if (!building) {
		return nothing;
	}
	const machines = Math.max(props.multiplier, 0);
	if (machines === 0) {
		return nothing;
	}

	let baseConsumption = building.powerConsumption;
	if (props.details.type === "recipe") {
		const recipe = satisfactoryDatabase.recipes[props.details.recipeClassName];
		if (recipe?.customPowerConsumption) {
			baseConsumption = recipe.customPowerConsumption.max;
		}
	}

	return {
		consumed: baseConsumption * machines * powerFactor(props),
		produced: building.powerProduction * machines * outputFactor(props),
	};
}
