import { describe, expect, test } from "vitest";
import { AppState } from "./AppState.svelte";
import type { GraphNode, GraphNodeProductionProperties } from "./GraphNode.svelte";
import type { GraphPage } from "./GraphPage.svelte";
import { summarisePage } from "./pageSummary";
import { starterSaveJson } from "./starterSave";

const ORE = "Desc_OreIron_C";
const INGOT = "Desc_IronIngot_C";

function newPage() {
	return AppState.newDefault().currentPage!;
}

function source(page: GraphPage, part: string, rate: number) {
	const node = page.makeNewNode({ type: "factory-input", partClassName: part }, { x: 0, y: 0 }) as GraphNode<GraphNodeProductionProperties>;
	node.properties.multiplier = rate;
	return node;
}

function sink(page: GraphPage, part: string, rate: number) {
	const node = page.makeNewNode({ type: "factory-output", partClassName: part }, { x: 0, y: 0 }) as GraphNode<GraphNodeProductionProperties>;
	node.properties.multiplier = rate;
	return node;
}

function building(page: GraphPage, recipe: string, multiplier: number) {
	const node = page.makeNewNode({ type: "recipe", recipeClassName: recipe }, { x: 0, y: 0 }) as GraphNode<GraphNodeProductionProperties>;
	node.properties.multiplier = multiplier;
	return node;
}

describe("what the page needs and makes", () => {
	test("an empty page summarises to nothing", () => {
		const s = summarisePage(newPage());
		expect(s.inputs).toEqual([]);
		expect(s.outputs).toEqual([]);
		expect(s.powerUsed).toBe(0);
		expect(s.buildingCount).toBe(0);
	});

	test("declared inputs and outputs are listed with readable names", () => {
		const page = newPage();
		source(page, ORE, 120);
		sink(page, INGOT, 120);
		const s = summarisePage(page);

		expect(s.inputs).toEqual([{ itemClass: ORE, displayName: "Iron Ore", ratePerMinute: 120 }]);
		expect(s.outputs).toEqual([{ itemClass: INGOT, displayName: "Iron Ingot", ratePerMinute: 120 }]);
	});

	test("several nodes of the same item are added together", () => {
		const page = newPage();
		source(page, ORE, 60);
		source(page, ORE, 90);
		const s = summarisePage(page);
		expect(s.inputs).toEqual([{ itemClass: ORE, displayName: "Iron Ore", ratePerMinute: 150 }]);
	});

	test("the biggest item is listed first", () => {
		const page = newPage();
		source(page, ORE, 60);
		source(page, "Desc_Coal_C", 300);
		const s = summarisePage(page);
		expect(s.inputs.map(i => i.displayName)).toEqual(["Coal", "Iron Ore"]);
	});
});

describe("power and machines", () => {
	test("a bank of smelters draws power per machine", () => {
		// The smelter building draws 4 MW, so x4 is 16 MW across 4 machines.
		const page = newPage();
		building(page, "Recipe_IngotIron_C", 4);
		const s = summarisePage(page);
		expect(s.powerUsed).toBe(16);
		expect(s.powerMade).toBe(0);
		expect(s.buildingCount).toBe(4);
	});

	test("a fractional multiplier counts as a fraction of a machine", () => {
		const page = newPage();
		building(page, "Recipe_IngotIron_C", 2.5);
		const s = summarisePage(page);
		expect(s.buildingCount).toBe(2.5);
		expect(s.powerUsed).toBe(10);
	});

	test("generators make power rather than using it", () => {
		const page = newPage();
		const gen = page.makeNewNode({
			type: "power-production",
			powerBuildingClassName: "Build_GeneratorCoal_C",
			fuelClassName: "Desc_Coal_C",
		}, { x: 0, y: 0 }) as GraphNode<GraphNodeProductionProperties>;
		gen.properties.multiplier = 4;

		const s = summarisePage(page);
		expect(s.powerMade).toBe(300); // 75 MW each
		expect(s.powerUsed).toBe(0);
	});

	test("miners draw power too", () => {
		const page = newPage();
		const miner = page.makeNewNode({
			type: "extraction", partClassName: ORE,
			buildingClassName: "Build_MinerMk1_C", purityModifier: 1,
		}, { x: 0, y: 0 }) as GraphNode<GraphNodeProductionProperties>;
		miner.properties.multiplier = 3;
		expect(summarisePage(page).powerUsed).toBe(15); // 5 MW each
	});

	test("factory inputs and outputs are interface markers, not machines", () => {
		const page = newPage();
		source(page, ORE, 120);
		sink(page, INGOT, 120);
		const s = summarisePage(page);
		expect(s.buildingCount).toBe(0);
		expect(s.powerUsed).toBe(0);
	});

	test("a building the data does not recognise is skipped rather than crashing", () => {
		const page = newPage();
		const node = building(page, "Recipe_IngotIron_C", 2);
		(node.properties.details as any).recipeClassName = "Recipe_Removed_C";
		expect(() => summarisePage(page)).not.toThrow();
		expect(summarisePage(page).powerUsed).toBe(0);
	});
});

describe("the real starter save", () => {
	test("both pages summarise to something sensible", () => {
		const state = AppState.fromJSON(JSON.parse(starterSaveJson));
		for (const page of state.pages) {
			const s = summarisePage(page);
			expect(s.buildingCount, `${page.name} should have machines`).toBeGreaterThan(0);
			expect(s.powerUsed, `${page.name} should draw power`).toBeGreaterThan(0);
			expect(s.inputs.length + s.outputs.length, `${page.name} should declare an interface`)
				.toBeGreaterThan(0);
			for (const entry of [...s.inputs, ...s.outputs]) {
				expect(entry.displayName, "every item should resolve to a readable name")
					.not.toMatch(/^Desc_/);
			}
		}
	});
});

describe("buildings that have been tuned", () => {
	test("an overclocked building draws more than its base", () => {
		const page = newPage();
		const node = building(page, "Recipe_IronPlate_C", 1);
		const before = summarisePage(page).powerUsed;
		node.setClockSpeed(2.5);
		expect(summarisePage(page).powerUsed).toBeCloseTo(before * 2.5 ** 1.321929, 3);
	});

	test("somersloops are counted across every building on the page", () => {
		const page = newPage();
		expect(summarisePage(page).sloopsUsed).toBe(0);

		const constructors = building(page, "Recipe_IronPlate_C", 3);
		constructors.setSloops(1);
		// Three constructors with one somersloop each is three somersloops.
		expect(summarisePage(page).sloopsUsed).toBe(3);

		const manufacturers = building(page, "Recipe_Computer_C", 2);
		manufacturers.setSloops(4);
		expect(summarisePage(page).sloopsUsed).toBe(11);
	});

	test("a building that takes no somersloops never counts any", () => {
		const page = newPage();
		const miner = page.makeNewNode(
			{ type: "extraction", partClassName: ORE, buildingClassName: "Build_MinerMk1_C", purityModifier: 1 },
			{ x: 0, y: 0 },
		) as GraphNode<GraphNodeProductionProperties>;
		miner.setSloops(4);
		expect(summarisePage(page).sloopsUsed).toBe(0);
	});
});
