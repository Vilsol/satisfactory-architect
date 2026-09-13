import { describe, expect, test } from "vitest";
import { AppState } from "./AppState.svelte";
import type { GraphNode, GraphNodeProductionProperties, GraphNodeResourceJointProperties } from "./GraphNode.svelte";
import type { GraphPage } from "./GraphPage.svelte";
import { jointRate, machinesToMatch, ratePerMachine } from "./jointRates";

/*
 * When a new building is dragged out of an existing joint, it should come out already
 * sized so the two ends agree - one Iron Ore joint running at 120/min should produce a
 * smelter bank big enough to eat 120/min, not a single smelter.
 */

const ORE = "Desc_OreIron_C";
const INGOT = "Desc_IronIngot_C";

function newPage() {
	return AppState.newDefault().currentPage!;
}

function joint(page: GraphPage, node: GraphNode, direction: "input" | "output", itemClass?: string) {
	const props = node.properties as GraphNodeProductionProperties;
	const found = props.resourceJoints
		.filter(j => j.type === direction)
		.map(j => page.nodes.get(j.id) as GraphNode<GraphNodeResourceJointProperties>)
		.filter(j => !itemClass || j.properties.resourceClassName === itemClass);
	return found[0];
}

function recipe(page: GraphPage, recipeClassName: string, multiplier: number) {
	const node = page.makeNewNode({ type: "recipe", recipeClassName }, { x: 0, y: 0 }) as GraphNode<GraphNodeProductionProperties>;
	node.properties.multiplier = multiplier;
	return node;
}

describe("what one machine moves through a joint", () => {
	test("a recipe input is the recipe's own amount", () => {
		const page = newPage();
		const smelter = recipe(page, "Recipe_IngotIron_C", 5);
		expect(ratePerMachine(page, joint(page, smelter, "input"))).toBe(30);
		expect(ratePerMachine(page, joint(page, smelter, "output"))).toBe(30);
	});

	test("a recipe with different input and output amounts", () => {
		// Iron Plate: 30 ingots in, 20 plates out.
		const page = newPage();
		const constructor = recipe(page, "Recipe_IronPlate_C", 1);
		expect(ratePerMachine(page, joint(page, constructor, "input"))).toBe(30);
		expect(ratePerMachine(page, joint(page, constructor, "output"))).toBe(20);
	});

	test("a miner accounts for the purity of its node", () => {
		const page = newPage();
		const make = (purity: 0.5 | 1 | 2) => {
			const m = page.makeNewNode({
				type: "extraction", partClassName: ORE,
				buildingClassName: "Build_MinerMk1_C", purityModifier: purity,
			}, { x: 0, y: 0 }) as GraphNode<GraphNodeProductionProperties>;
			return ratePerMachine(page, joint(page, m, "output"));
		};
		expect(make(0.5)).toBe(30);
		expect(make(1)).toBe(60);
		expect(make(2)).toBe(120);
	});

	test("a factory input or output is its own rate, so one machine is one unit", () => {
		const page = newPage();
		const source = page.makeNewNode({ type: "factory-input", partClassName: ORE }, { x: 0, y: 0 }) as GraphNode<GraphNodeProductionProperties>;
		expect(ratePerMachine(page, joint(page, source, "output"))).toBe(1);
	});

	test("a joint belonging to nothing has no rate", () => {
		const page = newPage();
		const splitter = page.makeNewNode({ type: "splitter", resourceClassName: ORE }, { x: 0, y: 0 });
		expect(ratePerMachine(page, splitter)).toBeNull();
	});
});

describe("what a joint is actually running at", () => {
	test("it is the per-machine rate times the machine count", () => {
		const page = newPage();
		const smelter = recipe(page, "Recipe_IngotIron_C", 4);
		expect(jointRate(page, joint(page, smelter, "input"))).toBe(120);
		expect(jointRate(page, joint(page, smelter, "output"))).toBe(120);
	});

	test("fractional machine counts carry through", () => {
		const page = newPage();
		const smelter = recipe(page, "Recipe_IngotIron_C", 2.5);
		expect(jointRate(page, joint(page, smelter, "input"))).toBe(75);
	});
});

describe("sizing a new building to match what it was dragged from", () => {
	test("a 120/min ore joint asks for four smelters", () => {
		const page = newPage();
		const target = recipe(page, "Recipe_IngotIron_C", 1);
		expect(machinesToMatch(page, joint(page, target, "input"), 120)).toBe(4);
	});

	test("it sizes against the joint being connected, not the building's other side", () => {
		// Iron Plate takes 30 ingots and makes 20 plates. Feeding it 90 ingots needs
		// three constructors - sizing off the output would have given 4.5.
		const page = newPage();
		const target = recipe(page, "Recipe_IronPlate_C", 1);
		expect(machinesToMatch(page, joint(page, target, "input", INGOT), 90)).toBe(3);
	});

	test("dragging from an output into a consumer's input", () => {
		const page = newPage();
		const rods = recipe(page, "Recipe_IronRod_C", 1); // 15 ingots per machine
		expect(machinesToMatch(page, joint(page, rods, "input"), 60)).toBe(4);
	});

	test("fractional results are kept rather than rounded", () => {
		// The tool already runs buildings at fractional rates elsewhere.
		const page = newPage();
		const target = recipe(page, "Recipe_IngotIron_C", 1);
		expect(machinesToMatch(page, joint(page, target, "input"), 80)).toBeCloseTo(8 / 3, 10);
	});

	test("a miner is sized by its own purity", () => {
		const page = newPage();
		const impure = page.makeNewNode({
			type: "extraction", partClassName: ORE,
			buildingClassName: "Build_MinerMk1_C", purityModifier: 0.5,
		}, { x: 0, y: 0 }) as GraphNode<GraphNodeProductionProperties>;
		expect(machinesToMatch(page, joint(page, impure, "output"), 120)).toBe(4);
	});

	test("nothing sensible to say about a zero rate", () => {
		const page = newPage();
		const target = recipe(page, "Recipe_IngotIron_C", 1);
		expect(machinesToMatch(page, joint(page, target, "input"), 0)).toBeNull();
	});

	test("a joint with no owning building cannot be sized", () => {
		const page = newPage();
		const merger = page.makeNewNode({ type: "merger", resourceClassName: ORE }, { x: 0, y: 0 });
		expect(machinesToMatch(page, merger, 60)).toBeNull();
	});

	test("a building whose recipe no longer exists cannot be sized", () => {
		const page = newPage();
		const target = recipe(page, "Recipe_IngotIron_C", 1);
		const input = joint(page, target, "input");
		(target.properties.details as any).recipeClassName = "Recipe_Gone_C";
		expect(machinesToMatch(page, input, 60)).toBeNull();
	});
});
