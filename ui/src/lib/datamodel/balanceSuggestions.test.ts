import { describe, expect, test } from "vitest";
import { AppState } from "./AppState.svelte";
import { GraphEdge } from "./GraphEdge.svelte";
import type { GraphNode, GraphNodeProductionProperties } from "./GraphNode.svelte";
import type { GraphPage } from "./GraphPage.svelte";
import { calculateThroughputs } from "./throughputsCalculator";

/*
 * Clicking the little number beside a joint sets that building's rate to whatever
 * would balance it against the other end of its belts. Both directions have to be
 * offered:
 *
 *   over-supplied  -> the consumer is offered "take all 60", as well as the producer
 *                     being offered "only make 30"
 *   under-supplied -> the producer is offered "make all 120", as well as the consumer
 *                     being offered "settle for 60"
 *
 * Offering only what actually flows would collapse both to the smaller of the two and
 * you could never scale a building UP to meet the other side.
 */

function newPage() {
	return AppState.newDefault().currentPage!;
}

function belt(page: GraphPage, a: GraphNode, b: GraphNode) {
	const edge = new GraphEdge(page.context, page.idGen.nextId(), "item-flow", "", "", {
		displayType: "curved", isDrainLine: false, startOrientation: null, endOrientation: null,
	});
	page.addEdgeBetweenNodes(edge, a, b);
	return edge;
}

function joint(page: GraphPage, node: GraphNode, direction: "input" | "output") {
	const props = node.properties as GraphNodeProductionProperties;
	return page.nodes.get(props.resourceJoints.find(j => j.type === direction)!.id)!;
}

function miner(page: GraphPage, purity: 0.5 | 1 | 2 = 1, multiplier = 1) {
	const node = page.makeNewNode({
		type: "extraction", partClassName: "Desc_OreIron_C",
		buildingClassName: "Build_MinerMk1_C", purityModifier: purity,
	}, { x: 0, y: 0 }) as GraphNode<GraphNodeProductionProperties>;
	node.properties.multiplier = multiplier;
	return node;
}

function smelter(page: GraphPage, multiplier: number) {
	const node = page.makeNewNode({
		type: "recipe", recipeClassName: "Recipe_IngotIron_C",
	}, { x: 400, y: 0 }) as GraphNode<GraphNodeProductionProperties>;
	node.properties.multiplier = multiplier;
	return node;
}

describe("an over-supplied belt", () => {
	test("offers the consumer the chance to grow into what is spare", () => {
		// 60/min mined, only 30/min wanted.
		const page = newPage();
		const m = miner(page);
		const s = smelter(page, 1);
		const line = belt(page, joint(page, m, "output"), joint(page, s, "input"));
		calculateThroughputs(page);

		expect(line.flow, "only 30 actually travels").toBe(30);
		expect(joint(page, s, "input").balanceTarget, "but the smelter could take all 60").toBe(60);
		expect(joint(page, m, "output").balanceTarget, "and the miner is only needed for 30").toBe(30);
	});
});

describe("an under-supplied belt", () => {
	test("offers the producer the chance to grow into what is wanted", () => {
		const page = newPage();
		const m = miner(page);
		const s = smelter(page, 4); // wants 120
		const line = belt(page, joint(page, m, "output"), joint(page, s, "input"));
		calculateThroughputs(page);

		expect(line.flow).toBe(60);
		expect(joint(page, m, "output").balanceTarget, "120 is wanted downstream").toBe(120);
		expect(joint(page, s, "input").balanceTarget, "only 60 exists upstream").toBe(60);
	});
});

describe("a balanced belt", () => {
	test("offers each side the rate it already has, so nothing is shown", () => {
		const page = newPage();
		const m = miner(page);
		const s = smelter(page, 2); // wants exactly 60
		belt(page, joint(page, m, "output"), joint(page, s, "input"));
		calculateThroughputs(page);

		expect(joint(page, m, "output").balanceTarget).toBe(60);
		expect(joint(page, s, "input").balanceTarget).toBe(60);
	});
});

describe("with other buildings competing", () => {
	test("a consumer is only offered what is genuinely going spare", () => {
		// One 60/min miner feeding two smelters that each want 15.
		const page = newPage();
		const m = miner(page);
		const splitter = page.makeNewNode({ type: "splitter", resourceClassName: "Desc_OreIron_C" }, { x: 200, y: 0 });
		const a = smelter(page, 0.5);
		const b = smelter(page, 0.5);
		belt(page, joint(page, m, "output"), splitter);
		belt(page, splitter, joint(page, a, "input"));
		belt(page, splitter, joint(page, b, "input"));
		calculateThroughputs(page);

		expect(joint(page, a, "input").balanceTarget, "its own 15 plus the 30 unused").toBe(45);
		expect(joint(page, b, "input").balanceTarget).toBe(45);
	});

	test("a producer is only offered demand nobody else is meeting", () => {
		const page = newPage();
		const one = miner(page, 0.5); // 30
		const two = miner(page, 0.5); // 30
		const merger = page.makeNewNode({ type: "merger", resourceClassName: "Desc_OreIron_C" }, { x: 200, y: 0 });
		const s = smelter(page, 4); // wants 120
		belt(page, joint(page, one, "output"), merger);
		belt(page, joint(page, two, "output"), merger);
		belt(page, merger, joint(page, s, "input"));
		calculateThroughputs(page);

		expect(joint(page, one, "output").balanceTarget, "its own 30 plus the 60 still unmet").toBe(90);
		expect(joint(page, two, "output").balanceTarget).toBe(90);
	});
});

describe("joints with nothing attached", () => {
	test("offer nothing", () => {
		const page = newPage();
		const m = miner(page);
		calculateThroughputs(page);
		expect(joint(page, m, "output").balanceTarget).toBe(0);
	});
});
