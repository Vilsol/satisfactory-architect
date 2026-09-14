import { beforeEach, describe, expect, test } from "vitest";
import { recipePreferences } from "./recipePreferences.svelte";

const INGOT = "Desc_IronIngot_C";
const PURE = "Recipe_Alternate_PureIronIngot_C";

describe("choosing which recipe to assume", () => {
	beforeEach(() => recipePreferences.clearAll());

	test("nothing is chosen to begin with, and the standard recipe is what gets used", () => {
		expect(recipePreferences.chosenFor(INGOT)).toBeUndefined();
		expect(recipePreferences.effectiveFor(INGOT)).toBe("Recipe_IngotIron_C");
	});

	test("choosing one sticks", () => {
		recipePreferences.set(INGOT, PURE);
		expect(recipePreferences.chosenFor(INGOT)).toBe(PURE);
		expect(recipePreferences.effectiveFor(INGOT)).toBe(PURE);
		expect(recipePreferences.count).toBe(1);
	});

	test("clearing one puts the default back without touching the others", () => {
		recipePreferences.set(INGOT, PURE);
		recipePreferences.set("Desc_IronPlate_C", "Recipe_IronPlate_C");
		recipePreferences.clear(INGOT);
		expect(recipePreferences.effectiveFor(INGOT)).toBe("Recipe_IngotIron_C");
		expect(recipePreferences.count).toBe(1);
	});

	test("a choice that does not make the item is ignored rather than believed", () => {
		recipePreferences.set(INGOT, "Recipe_IronPlate_C");
		expect(recipePreferences.effectiveFor(INGOT)).toBe("Recipe_IngotIron_C");
	});
});
