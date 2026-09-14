import { describe, expect, test } from "vitest";
import type { ProductionDetails } from "./GraphNode.svelte";
import { buildingOf, clampClockSpeed, clampSloops, inputFactor, outputFactor, portFactor, powerFactor, sloopSlotsOf } from "./overclocking";

const constructor: ProductionDetails = { type: "recipe", recipeClassName: "Recipe_IronPlate_C" };
const smelter: ProductionDetails = { type: "recipe", recipeClassName: "Recipe_IngotIron_C" };
const manufacturer: ProductionDetails = { type: "recipe", recipeClassName: "Recipe_Computer_C" };
const miner: ProductionDetails = {
	type: "extraction",
	partClassName: "Desc_OreIron_C",
	buildingClassName: "Build_MinerMk1_C",
	purityModifier: 1,
};
const coalGenerator: ProductionDetails = {
	type: "power-production",
	powerBuildingClassName: "Build_GeneratorCoal_C",
	fuelClassName: "Desc_Coal_C",
};

describe("which building a node is made of", () => {
	test("a recipe node is the building the recipe is produced in", () => {
		expect(buildingOf(constructor)).toBe("Build_ConstructorMk1_C");
		expect(buildingOf(smelter)).toBe("Build_SmelterMk1_C");
	});

	test("an extraction node names its own building", () => {
		expect(buildingOf(miner)).toBe("Build_MinerMk1_C");
	});

	test("a factory input has no building", () => {
		expect(buildingOf({ type: "factory-input", partClassName: "Desc_OreIron_C" })).toBeUndefined();
	});
});

describe("left alone", () => {
	test("a building at full speed with nothing in it makes and draws exactly its base", () => {
		expect(outputFactor({ details: constructor })).toBe(1);
		expect(powerFactor({ details: constructor })).toBe(1);
	});

	test("a node the data knows nothing about is left at its base", () => {
		const unknown: ProductionDetails = { type: "factory-output", partClassName: "Desc_OreIron_C" };
		expect(outputFactor({ details: unknown, clockSpeed: 2.5 })).toBe(2.5);
		expect(powerFactor({ details: unknown, clockSpeed: 2.5 })).toBe(2.5);
	});
});

describe("clock speed", () => {
	// The game shows a constructor - 4 MW at full speed - drawing 13.43 MW at 250%
	// and 1.6 MW at 50%. Both fall out of the exponent in the game's own data.
	test("a constructor at 250% makes 2.5x and draws 3.36x", () => {
		expect(outputFactor({ details: constructor, clockSpeed: 2.5 })).toBeCloseTo(2.5, 6);
		expect(powerFactor({ details: constructor, clockSpeed: 2.5 })).toBeCloseTo(13.431 / 4, 3);
	});

	test("a constructor at 50% makes half and draws 40%", () => {
		expect(outputFactor({ details: constructor, clockSpeed: 0.5 })).toBeCloseTo(0.5, 6);
		expect(powerFactor({ details: constructor, clockSpeed: 0.5 })).toBeCloseTo(0.4, 3);
	});

	test("a generator scales its power differently from a production building", () => {
		expect(powerFactor({ details: coalGenerator, clockSpeed: 2.5 })).toBeCloseTo(2.5 ** 1.6, 3);
	});

	test("speeds outside what the game allows are pulled back into range", () => {
		expect(clampClockSpeed(0)).toBe(0.01);
		expect(clampClockSpeed(-3)).toBe(0.01);
		expect(clampClockSpeed(99)).toBe(2.5);
		expect(clampClockSpeed(Number.NaN)).toBe(1);
	});
});

describe("somersloops", () => {
	test("a full set doubles what comes out and quadruples the draw", () => {
		expect(outputFactor({ details: constructor, sloops: 1 })).toBeCloseTo(2, 6);
		expect(powerFactor({ details: constructor, sloops: 1 })).toBeCloseTo(4, 6);
		expect(outputFactor({ details: manufacturer, sloops: 4 })).toBeCloseTo(2, 6);
		expect(powerFactor({ details: manufacturer, sloops: 4 })).toBeCloseTo(4, 6);
	});

	test("half a set gives half the extra", () => {
		expect(outputFactor({ details: manufacturer, sloops: 2 })).toBeCloseTo(1.5, 6);
		expect(powerFactor({ details: manufacturer, sloops: 2 })).toBeCloseTo(2.25, 6);
	});

	test("the smelter takes one, whatever the game's own data says", () => {
		// Docs.json reports no slots for the smelter and then says it can be boosted.
		expect(sloopSlotsOf("Build_SmelterMk1_C")).toBe(1);
		expect(outputFactor({ details: smelter, sloops: 1 })).toBeCloseTo(2, 6);
	});

	test("a miner takes none", () => {
		expect(sloopSlotsOf("Build_MinerMk1_C")).toBe(0);
		expect(outputFactor({ details: miner, sloops: 4 })).toBe(1);
	});

	test("more somersloops than there are slots is as full as it gets", () => {
		expect(clampSloops(9, "Build_ConstructorMk1_C")).toBe(1);
		expect(clampSloops(-1, "Build_ConstructorMk1_C")).toBe(0);
		expect(clampSloops(2.7, "Build_ManufacturerMk1_C")).toBe(2);
		expect(outputFactor({ details: constructor, sloops: 9 })).toBeCloseTo(2, 6);
	});
});

describe("both at once", () => {
	test("speed and somersloops multiply", () => {
		expect(outputFactor({ details: constructor, clockSpeed: 2.5, sloops: 1 })).toBeCloseTo(5, 6);
		expect(powerFactor({ details: constructor, clockSpeed: 2.5, sloops: 1 }))
			.toBeCloseTo((13.431 / 4) * 4, 2);
	});
});

describe("what goes in against what comes out", () => {
	test("speed moves both ends together", () => {
		expect(inputFactor({ details: constructor, clockSpeed: 2.5 })).toBeCloseTo(2.5, 6);
		expect(outputFactor({ details: constructor, clockSpeed: 2.5 })).toBeCloseTo(2.5, 6);
	});

	test("a somersloop moves only what comes out", () => {
		expect(inputFactor({ details: constructor, sloops: 1 })).toBe(1);
		expect(outputFactor({ details: constructor, sloops: 1 })).toBeCloseTo(2, 6);
	});

	test("a joint takes whichever end it is on", () => {
		const props = { details: manufacturer, clockSpeed: 2, sloops: 4 };
		expect(portFactor(props, "input")).toBeCloseTo(2, 6);
		expect(portFactor(props, "output")).toBeCloseTo(4, 6);
	});
});
