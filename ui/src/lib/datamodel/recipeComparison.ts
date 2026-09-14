/**
 * Every way the game gives you of making one thing, lined up so they can be compared.
 *
 * Everything is quoted per item produced per minute rather than per machine, because
 * the recipes are all different sizes - a Pure Iron Ingot refinery makes 65 a minute
 * and a smelter 30, and comparing those two head to head says nothing.
 */

import { satisfactoryDatabase } from "$lib/satisfactoryDatabase";
import { nodePower } from "./nodePower";

export interface RecipePart {
	itemClass: string;
	displayName: string;
	/** Per minute, from one machine. */
	perMinute: number;
	/** Per one of the item this recipe is being compared for. */
	perOutput: number;
}

export interface RecipeOption {
	recipeClassName: string;
	displayName: string;
	isAlternate: boolean;
	buildingClassName: string | undefined;
	buildingDisplayName: string;
	/** How many of the item one machine makes per minute. */
	outputPerMinute: number;
	/** Machines needed for one of the item per minute. */
	machinesPerOutput: number;
	/** Megawatts per one of the item per minute. */
	powerPerOutput: number;
	inputs: RecipePart[];
	/** Anything else that comes out alongside. */
	byproducts: RecipePart[];
}

/**
 * Alternates are named two different ways and neither covers all of them: Turbofuel is
 * only marked in its class name, Pure Aluminum Ingot only in the name shown to players.
 * Either mark is enough.
 */
export function isAlternateRecipe(recipeClassName: string): boolean {
	if (recipeClassName.startsWith("Recipe_Alternate_")) {
		return true;
	}
	return satisfactoryDatabase.recipes[recipeClassName]?.recipeDisplayName.startsWith("Alternate") ?? false;
}

function partOf(itemClass: string, perMinute: number, outputPerMinute: number): RecipePart {
	return {
		itemClass,
		displayName: satisfactoryDatabase.parts[itemClass]?.displayName ?? itemClass,
		perMinute,
		perOutput: outputPerMinute > 0 ? perMinute / outputPerMinute : 0,
	};
}

/** Every recipe that produces `itemClass`, the standard ones first. */
export function recipesProducing(itemClass: string): RecipeOption[] {
	const options: RecipeOption[] = [];
	for (const recipe of Object.values(satisfactoryDatabase.recipes)) {
		const output = recipe.outputs.find(part => part.itemClass === itemClass);
		if (!output) {
			continue;
		}
		const outputPerMinute = output.amountPerMinute;
		const building = satisfactoryDatabase.buildings[recipe.producedIn];
		// One machine's worth, so the power figure picks up recipes that draw a
		// variable amount rather than their building's base.
		const power = nodePower({
			details: { type: "recipe", recipeClassName: recipe.className },
			multiplier: 1,
		});
		options.push({
			recipeClassName: recipe.className,
			displayName: recipe.recipeDisplayName,
			isAlternate: isAlternateRecipe(recipe.className),
			buildingClassName: recipe.producedIn,
			buildingDisplayName: building?.displayName ?? recipe.producedIn,
			outputPerMinute,
			machinesPerOutput: outputPerMinute > 0 ? 1 / outputPerMinute : 0,
			powerPerOutput: outputPerMinute > 0 ? power.consumed / outputPerMinute : 0,
			inputs: recipe.inputs.map(part => partOf(part.itemClass, part.amountPerMinute, outputPerMinute)),
			byproducts: recipe.outputs
				.filter(part => part.itemClass !== itemClass)
				.map(part => partOf(part.itemClass, part.amountPerMinute, outputPerMinute)),
		});
	}

	return options.sort((a, b) =>
		Number(a.isAlternate) - Number(b.isAlternate) ||
		a.displayName.localeCompare(b.displayName, "en"));
}
