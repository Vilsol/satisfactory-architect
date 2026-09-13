import { expect, test } from "vitest";
import { AppState } from "./AppState.svelte";
import { GraphEdge } from "./GraphEdge.svelte";
import type { GraphNode, GraphNodeProductionProperties } from "./GraphNode.svelte";
import type { GraphPage } from "./GraphPage.svelte";
import { calculateThroughputs } from "./throughputsCalculator";

/*
 * A page recalculates inside a $effect, so the calculation must never read back a
 * value it has written. Doing so makes the effect depend on its own output and
 * schedule itself over and over until Svelte bails out with
 * "effect_update_depth_exceeded".
 *
 * Effects do not actually run under vitest - the server build of Svelte is what gets
 * resolved, and there they do nothing. So rather than trying to observe the loop,
 * these tests check the invariant that prevents it directly: while the calculation
 * runs, reading any field it is responsible for producing is an error.
 *
 * Under the server build these are plain properties, which is what lets a test swap
 * in a getter that complains.
 */

const EDGE_OUTPUTS = ["flow", "shortfallAhead", "surplusBehind"] as const;
const NODE_OUTPUTS = ["surplus", "shortfall"] as const;

/**
 * Replace every field the calculation writes with one that throws if anything reads
 * it. Returns a function that puts the written values back.
 */
function forbidReadingOwnOutput(page: GraphPage): () => void {
	const written = new Map<object, Record<string, number>>();
	const targets: [object, readonly string[]][] = [
		...[...page.edges.values()].map(e => [e, EDGE_OUTPUTS] as [object, readonly string[]]),
		...[...page.nodes.values()].map(n => [n, NODE_OUTPUTS] as [object, readonly string[]]),
	];

	for (const [target, fields] of targets) {
		const store: Record<string, number> = {};
		written.set(target, store);
		for (const field of fields) {
			store[field] = (target as any)[field];
			Object.defineProperty(target, field, {
				get() {
					throw new Error(`calculateThroughputs read back its own output "${field}"`);
				},
				set(value: number) {
					store[field] = value;
				},
				configurable: true,
			});
		}
	}

	return () => {
		for (const [target, fields] of targets) {
			const store = written.get(target)!;
			for (const field of fields) {
				delete (target as any)[field];
				(target as any)[field] = store[field];
			}
		}
	};
}

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

function miner(page: GraphPage, x: number, y: number, purity: 0.5 | 1 | 2 = 1) {
	return page.makeNewNode({
		type: "extraction", partClassName: "Desc_OreIron_C",
		buildingClassName: "Build_MinerMk1_C", purityModifier: purity,
	}, { x, y }) as GraphNode<GraphNodeProductionProperties>;
}

function smelter(page: GraphPage, multiplier: number, x: number, y: number) {
	const node = page.makeNewNode({
		type: "recipe", recipeClassName: "Recipe_IngotIron_C",
	}, { x, y }) as GraphNode<GraphNodeProductionProperties>;
	node.properties.multiplier = multiplier;
	return node;
}

/** Everything the calculation is supposed to produce. */
function readAll(page: GraphPage) {
	return {
		edges: [...page.edges.values()].map(e => ({
			id: e.id, flow: e.flow, short: e.shortfallAhead, spare: e.surplusBehind,
		})),
		nodes: [...page.nodes.values()].map(n => ({
			id: n.id, surplus: n.surplus, shortfall: n.shortfall,
		})),
	};
}

/** Fill every result field with a value the real answer would never produce. */
function poison(page: GraphPage) {
	for (const edge of page.edges.values()) {
		edge.flow = 999;
		edge.shortfallAhead = 999;
		edge.surplusBehind = 999;
	}
	for (const node of page.nodes.values()) {
		node.surplus = 999;
		node.shortfall = 999;
	}
}

function expectUnaffectedByPreviousResults(build: () => GraphPage, label: string) {
	const clean = build();
	calculateThroughputs(clean);
	const expected = readAll(clean);

	const poisoned = build();
	poison(poisoned);
	calculateThroughputs(poisoned);
	expect(readAll(poisoned), `${label}: the answer must not depend on what was there before`)
		.toEqual(expected);

	// The important one: recalculating must not so much as look at last time's answer.
	const watched = build();
	const restore = forbidReadingOwnOutput(watched);
	try {
		expect(() => calculateThroughputs(watched), `${label}: must not read its own output`).not.toThrow();
	} finally {
		restore();
	}
	expect(readAll(watched), `${label}: still produces the right answer`).toEqual(expected);
}

test("a factory that is short of material", () => {
	expectUnaffectedByPreviousResults(() => {
		const page = newPage();
		const m = miner(page, 0, 0);
		const sp = page.makeNewNode({ type: "splitter", resourceClassName: "Desc_OreIron_C" }, { x: 300, y: 0 });
		const a = smelter(page, 4, 600, -200);
		const b = smelter(page, 4, 600, 200);
		belt(page, joint(page, m, "output"), sp);
		belt(page, sp, joint(page, a, "input"));
		belt(page, sp, joint(page, b, "input"));
		return page;
	}, "shortfall");
});

test("a factory with material to spare", () => {
	expectUnaffectedByPreviousResults(() => {
		const page = newPage();
		const m = miner(page, 0, 0);
		const sp = page.makeNewNode({ type: "splitter", resourceClassName: "Desc_OreIron_C" }, { x: 300, y: 0 });
		const s = smelter(page, 0.5, 600, 0);
		belt(page, joint(page, m, "output"), sp);
		belt(page, sp, joint(page, s, "input"));
		return page;
	}, "surplus");
});

test("a factory that balances exactly", () => {
	expectUnaffectedByPreviousResults(() => {
		const page = newPage();
		const m = miner(page, 0, 0);
		const s = smelter(page, 2, 400, 0);
		belt(page, joint(page, m, "output"), joint(page, s, "input"));
		return page;
	}, "balanced");
});

test("a long chain where the shortage is carried back several belts", () => {
	expectUnaffectedByPreviousResults(() => {
		const page = newPage();
		const m = miner(page, 0, 0, 0.5);
		const first = page.makeNewNode({ type: "splitter", resourceClassName: "Desc_OreIron_C" }, { x: 200, y: 0 });
		const second = page.makeNewNode({ type: "splitter", resourceClassName: "Desc_OreIron_C" }, { x: 400, y: 0 });
		const third = page.makeNewNode({ type: "splitter", resourceClassName: "Desc_OreIron_C" }, { x: 600, y: 0 });
		const s = smelter(page, 6, 900, 0);
		belt(page, joint(page, m, "output"), first);
		belt(page, first, second);
		belt(page, second, third);
		belt(page, third, joint(page, s, "input"));
		return page;
	}, "long chain");
});

test("recalculating repeatedly always lands on the same answer", () => {
	const page = newPage();
	const m = miner(page, 0, 0);
	const sp = page.makeNewNode({ type: "splitter", resourceClassName: "Desc_OreIron_C" }, { x: 300, y: 0 });
	const a = smelter(page, 4, 600, -200);
	const b = smelter(page, 1, 600, 200);
	belt(page, joint(page, m, "output"), sp);
	belt(page, sp, joint(page, a, "input"));
	belt(page, sp, joint(page, b, "input"));

	calculateThroughputs(page);
	const first = readAll(page);
	for (let i = 0; i < 5; i++) {
		calculateThroughputs(page);
		expect(readAll(page), `run ${i + 2} must match the first`).toEqual(first);
	}
});
