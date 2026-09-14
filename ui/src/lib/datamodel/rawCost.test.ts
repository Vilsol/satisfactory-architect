import { describe, expect, test } from "vitest";
import { rawCostOf, solveRecipeFlows, type FlowRecipe } from "./rawCost";

const ORE = "Desc_OreIron_C";
const PLASTIC = "Desc_Plastic_C";
const RUBBER = "Desc_Rubber_C";
const ACID = "Desc_SulfuricAcid_C";

function costed(options: Parameters<typeof rawCostOf>[0]) {
	const result = rawCostOf(options);
	expect(result.ok, `expected a cost, got ${result.ok ? "" : result.reason}`).toBe(true);
	return result as Extract<typeof result, { ok: true }>;
}

function rawRate(result: ReturnType<typeof costed>, itemClass: string): number {
	return result.raws.find(r => r.itemClass === itemClass)?.perMinute ?? 0;
}

function machines(result: ReturnType<typeof costed>, recipeClassName: string): number {
	return result.steps.find(s => s.recipeClassName === recipeClassName)?.machines ?? 0;
}

describe("costing a chain down to the ore", () => {
	test("an iron plate is one and a half ore", () => {
		// 30 ingot makes 20 plate, and 30 ore makes 30 ingot.
		const result = costed({ recipeClassName: "Recipe_IronPlate_C", itemClass: "Desc_IronPlate_C", creditByproducts: true });
		expect(result.raws).toHaveLength(1);
		expect(rawRate(result, ORE)).toBeCloseTo(1.5, 9);
	});

	test("a reinforced iron plate is twelve ore, through both of its branches", () => {
		// 6 plate/min needs 9 ingot; 12 screws/min needs 3 rod, which needs 3 ingot.
		const result = costed({
			recipeClassName: "Recipe_IronPlateReinforced_C",
			itemClass: "Desc_IronPlateReinforced_C",
			creditByproducts: true,
		});
		expect(rawRate(result, ORE)).toBeCloseTo(12, 9);
		expect(machines(result, "Recipe_IronPlateReinforced_C")).toBeCloseTo(0.2, 9);
		expect(machines(result, "Recipe_Screw_C")).toBeCloseTo(0.3, 9);
		expect(machines(result, "Recipe_IronRod_C")).toBeCloseTo(0.2, 9);
		expect(machines(result, "Recipe_IngotIron_C")).toBeCloseTo(0.4, 9);
	});

	test("asking for more of it costs proportionally more", () => {
		const one = costed({ recipeClassName: "Recipe_IronPlate_C", itemClass: "Desc_IronPlate_C", creditByproducts: true });
		const twenty = costed({ recipeClassName: "Recipe_IronPlate_C", itemClass: "Desc_IronPlate_C", rate: 20, creditByproducts: true });
		expect(rawRate(twenty, ORE)).toBeCloseTo(rawRate(one, ORE) * 20, 9);
	});

	test("the machines and the power are totalled", () => {
		const result = costed({ recipeClassName: "Recipe_IronPlate_C", itemClass: "Desc_IronPlate_C", creditByproducts: true });
		// A constructor at 0.05 and a smelter at 0.05, both 4 MW.
		expect(result.machineCount).toBeCloseTo(0.1, 9);
		expect(result.totalPower).toBeCloseTo(0.4, 9);
	});
});

describe("recipes that hand something back", () => {
	// Encased Uranium Cell takes 40 sulfuric acid and returns 10, for 25 cells.
	const encased = { recipeClassName: "Recipe_UraniumCell_C", itemClass: "Desc_NuclearFuelRod_C" };

	test("credited, only the acid it actually eats is paid for", () => {
		const result = costed({
			recipeClassName: "Recipe_UraniumCell_C",
			itemClass: "Desc_UraniumCell_C",
			creditByproducts: true,
		});
		// (40 - 10) / 25 = 1.2 a minute, rather than 1.6.
		expect(machines(result, "Recipe_SulfuricAcid_C")).toBeGreaterThan(0);
		const acidMade = machines(result, "Recipe_SulfuricAcid_C") * 50;
		expect(acidMade).toBeCloseTo(1.2, 6);
	});

	test("uncredited, the acid it hands back is paid for anyway and shows up spare", () => {
		const result = costed({
			recipeClassName: "Recipe_UraniumCell_C",
			itemClass: "Desc_UraniumCell_C",
			creditByproducts: false,
		});
		const acidMade = machines(result, "Recipe_SulfuricAcid_C") * 50;
		expect(acidMade).toBeCloseTo(1.6, 6);
		expect(result.surplus.find(s => s.itemClass === ACID)?.perMinute).toBeCloseTo(0.4, 6);
	});
});

describe("recipes that feed each other", () => {
	test("recycled plastic and rubber together still come out to a number", () => {
		// 60 plastic from 30 rubber, 60 rubber from 30 plastic: 1 plastic a minute
		// works out at 1/45 of one machine and 1/90 of the other.
		const result = costed({
			recipeClassName: "Recipe_Alternate_Plastic_1_C",
			itemClass: PLASTIC,
			creditByproducts: true,
			preferred: {
				[PLASTIC]: "Recipe_Alternate_Plastic_1_C",
				[RUBBER]: "Recipe_Alternate_RecycledRubber_C",
			},
		});
		expect(machines(result, "Recipe_Alternate_Plastic_1_C")).toBeCloseTo(1 / 45, 9);
		expect(machines(result, "Recipe_Alternate_RecycledRubber_C")).toBeCloseTo(1 / 90, 9);
	});
});

describe("things that cannot be made", () => {
	test("an item nothing produces is asked for rather than costed", () => {
		// Wood is only ever picked up off the ground.
		const result = costed({
			recipeClassName: "Recipe_Biomass_Wood_C",
			itemClass: "Desc_GenericBiomass_C",
			creditByproducts: true,
		});
		expect(result.supplied.map(s => s.itemClass)).toContain("Desc_Wood_C");
	});

	test("a recipe that does not exist is refused", () => {
		expect(rawCostOf({ recipeClassName: "Recipe_NotReal_C", itemClass: ORE, creditByproducts: true }))
			.toEqual({ ok: false, reason: "no-recipe" });
	});
});

describe("the chains that made this worth solving properly", () => {
	test("the dark matter chain costs out, byproducts and loops and all", () => {
		// Dark Matter Residue is a byproduct of six things made out of Dark Matter
		// Residue. Walking this tree would never have come back.
		const result = costed({
			recipeClassName: "Recipe_FicsoniumFuelRod_C",
			itemClass: "Desc_FicsoniumFuelRod_C",
			creditByproducts: true,
		});
		expect(result.steps.length).toBeGreaterThan(30);
		expect(rawRate(result, ORE)).toBeGreaterThan(0);
		// Plutonium waste comes out of a reactor, not a recipe.
		expect(result.supplied.map(s => s.itemClass)).toContain("Desc_PlutoniumWaste_C");
		for (const step of result.steps) {
			expect(Number.isFinite(step.machines)).toBe(true);
			expect(step.machines).toBeGreaterThan(0);
		}
	});

	test("unpackaging something is not a way of making it", () => {
		// Unpackage Water needs Packaged Water, which needs Water. The loop gains
		// nothing, so there is no answer, and saying so beats inventing one.
		expect(rawCostOf({
			recipeClassName: "Recipe_UnpackageWater_C",
			itemClass: "Desc_Water_C",
			creditByproducts: true,
		})).toEqual({ ok: false, reason: "unsolvable" });
	});
});

describe("the flow solver on its own", () => {
	const recipe = (key: string, makes: string, inputs: [string, number][], outputs: [string, number][]): FlowRecipe => ({
		key,
		makes,
		inputs: inputs.map(([itemClass, perMinute]) => ({ itemClass, perMinute })),
		outputs: outputs.map(([itemClass, perMinute]) => ({ itemClass, perMinute })),
	});

	test("a loop that gains more than it spends is fine", () => {
		const result = solveRecipeFlows({
			recipes: [recipe("a", "A", [["B", 1]], [["A", 2]]), recipe("b", "B", [["A", 1]], [["B", 2]])],
			terminals: new Set(),
			target: { itemClass: "A", perMinute: 1 },
			creditByproducts: true,
		});
		expect(result.ok).toBe(true);
		expect((result as any).runs.get("b")).toBeCloseTo(1 / 3, 9);
		expect((result as any).runs.get("a")).toBeCloseTo(2 / 3, 9);
	});

	test("a loop that exactly breaks even has no answer", () => {
		const result = solveRecipeFlows({
			recipes: [recipe("a", "A", [["B", 1]], [["A", 1]]), recipe("b", "B", [["A", 1]], [["B", 1]])],
			terminals: new Set(),
			target: { itemClass: "A", perMinute: 1 },
			creditByproducts: true,
		});
		expect(result).toEqual({ ok: false, reason: "unsolvable" });
	});

	test("a byproduct that more than covers an item retires that item's own recipe", () => {
		// Making A throws off five C and eats one, so the dedicated C recipe is not needed.
		const result = solveRecipeFlows({
			recipes: [
				recipe("a", "A", [["R", 1], ["C", 1]], [["A", 1], ["C", 5]]),
				recipe("c", "C", [["S", 1]], [["C", 1]]),
			],
			terminals: new Set(["R", "S"]),
			target: { itemClass: "A", perMinute: 1 },
			creditByproducts: true,
		});
		expect(result.ok).toBe(true);
		expect((result as any).dropped).toEqual(["C"]);
		expect((result as any).runs.get("a")).toBeCloseTo(1, 9);
		expect((result as any).net.get("C")).toBeCloseTo(4, 9);
	});
});
