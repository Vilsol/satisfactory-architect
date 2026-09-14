import { describe, expect, test } from "vitest";
import { comparableItemOf, isAlternateRecipe, recipesProducing } from "./recipeComparison";

const INGOT = "Desc_IronIngot_C";
const ORE = "Desc_OreIron_C";

function option(itemClass: string, recipeClassName: string) {
	const found = recipesProducing(itemClass).find(o => o.recipeClassName === recipeClassName);
	expect(found, `no option for ${recipeClassName}`).toBeDefined();
	return found!;
}

describe("finding the recipes that make something", () => {
	test("every way of making an iron ingot is listed", () => {
		const names = recipesProducing(INGOT).map(o => o.recipeClassName);
		expect(names).toContain("Recipe_IngotIron_C");
		expect(names).toContain("Recipe_Alternate_PureIronIngot_C");
		expect(names).toContain("Recipe_Alternate_IngotIron_C");
		expect(names).toHaveLength(5);
	});

	test("the standard recipe comes first", () => {
		expect(recipesProducing(INGOT)[0].recipeClassName).toBe("Recipe_IngotIron_C");
	});

	test("something nothing makes comes back empty rather than undefined", () => {
		expect(recipesProducing("Desc_NotAThing_C")).toEqual([]);
	});
});

describe("telling alternates apart", () => {
	test("the usual naming is picked up", () => {
		expect(isAlternateRecipe("Recipe_Alternate_PureIronIngot_C")).toBe(true);
		expect(isAlternateRecipe("Recipe_IngotIron_C")).toBe(false);
	});

	test("the two that break the naming are still called right", () => {
		// One is an alternate only by its class name, the other only by its display name.
		expect(isAlternateRecipe("Recipe_Alternate_Turbofuel_C")).toBe(true);
		expect(isAlternateRecipe("Recipe_PureAluminumIngot_C")).toBe(true);
	});
});

describe("what each way costs", () => {
	test("a standard iron ingot takes one ore", () => {
		const standard = option(INGOT, "Recipe_IngotIron_C");
		expect(standard.outputPerMinute).toBe(30);
		expect(standard.inputs).toHaveLength(1);
		expect(standard.inputs[0].itemClass).toBe(ORE);
		expect(standard.inputs[0].perOutput).toBeCloseTo(1, 6);
	});

	test("pure iron ingots stretch the ore further but need water", () => {
		const pure = option(INGOT, "Recipe_Alternate_PureIronIngot_C");
		expect(pure.inputs.find(i => i.itemClass === ORE)!.perOutput).toBeCloseTo(35 / 65, 6);
		expect(pure.inputs.find(i => i.itemClass === "Desc_Water_C")!.perOutput).toBeCloseTo(20 / 65, 6);
	});

	test("machines needed for one a minute is the other side of the output", () => {
		expect(option(INGOT, "Recipe_IngotIron_C").machinesPerOutput).toBeCloseTo(1 / 30, 6);
	});

	test("power is per item a minute, so recipes of different sizes compare", () => {
		// A smelter draws 4 MW and makes 30 ingots a minute.
		expect(option(INGOT, "Recipe_IngotIron_C").powerPerOutput).toBeCloseTo(4 / 30, 6);
	});

	test("the building is named so a foundry recipe is not mistaken for a smelter one", () => {
		expect(option(INGOT, "Recipe_Alternate_IngotIron_C").buildingDisplayName).toBe("Foundry");
	});

	test("anything else that comes out is listed as a byproduct", () => {
		const withByproduct = recipesProducing("Desc_Plastic_C")
			.find(o => o.byproducts.length > 0);
		expect(withByproduct).toBeDefined();
	});
});

describe("which item a node is about", () => {
	test("a building is about what its recipe makes", () => {
		expect(comparableItemOf({
			type: "production",
			details: { type: "recipe", recipeClassName: "Recipe_IngotIron_C" },
			multiplier: 1,
			autoMultiplier: false,
			resourceJoints: [],
		})).toBe(INGOT);
	});

	test("a joint is about what it carries", () => {
		expect(comparableItemOf({
			type: "resource-joint",
			resourceClassName: ORE,
			jointType: "output",
			layoutOrientation: undefined,
			locked: false,
		})).toBe(ORE);
	});

	test("a factory output is about what the page makes", () => {
		expect(comparableItemOf({
			type: "production",
			details: { type: "factory-output", partClassName: INGOT },
			multiplier: 1,
			autoMultiplier: false,
			resourceJoints: [],
		})).toBe(INGOT);
	});

	test("a note is about nothing", () => {
		expect(comparableItemOf({ type: "text-note", content: "" } as never)).toBeUndefined();
	});
});
