import { describe, expect, test } from "vitest";
import { AppState } from "./AppState.svelte";
import { GraphEdge } from "./GraphEdge.svelte";
import { solveFlow, type FlowEdgeSpec, type FlowNodeSpec } from "./flowSolver";
import type { GraphNode, GraphNodeProductionProperties } from "./GraphNode.svelte";
import type { GraphPage } from "./GraphPage.svelte";
import { calculateThroughputs } from "./throughputsCalculator";

/*
 * "Overflow Only" belts, the dashed lines you get from the belt context menu.
 *
 * What the name promises: this belt only carries what is left once the ordinary
 * belts have taken what they need. Everything below is written from that reading,
 * so where a test fails it means either the feature or the name is wrong.
 */

function solve(nodes: FlowNodeSpec[], edges: FlowEdgeSpec[]) {
	const result = solveFlow(nodes, edges);
	return {
		flow: Object.fromEntries(result.edgeFlow),
		shortfall: Object.fromEntries(result.shortfall),
		surplus: Object.fromEntries(result.surplus),
		total: result.totalFlow,
	};
}

describe("what the name promises", () => {
	test("the ordinary belt is filled first and the overflow takes the rest", () => {
		const r = solve(
			[{ id: "p", supply: 60 }, { id: "s" }, { id: "keep", demand: 50 }, { id: "dump", demand: 500 }],
			[
				{ id: "trunk", from: "p", to: "s" },
				{ id: "toKeep", from: "s", to: "keep" },
				{ id: "toDump", from: "s", to: "dump", isDrain: true },
			],
		);
		expect(r.flow.toKeep).toBe(50);
		expect(r.flow.toDump).toBe(10);
	});

	test("nothing overflows when the ordinary belt can use it all", () => {
		const r = solve(
			[{ id: "p", supply: 60 }, { id: "s" }, { id: "keep", demand: 60 }, { id: "dump", demand: 500 }],
			[
				{ id: "trunk", from: "p", to: "s" },
				{ id: "toKeep", from: "s", to: "keep" },
				{ id: "toDump", from: "s", to: "dump", isDrain: true },
			],
		);
		expect(r.flow.toKeep).toBe(60);
		expect(r.flow.toDump).toBe(0);
	});

	test("two overflow belts share what is left between them", () => {
		const r = solve(
			[
				{ id: "p", supply: 100 }, { id: "s" }, { id: "keep", demand: 40 },
				{ id: "dumpA", demand: 500 }, { id: "dumpB", demand: 500 },
			],
			[
				{ id: "trunk", from: "p", to: "s" },
				{ id: "toKeep", from: "s", to: "keep" },
				{ id: "toA", from: "s", to: "dumpA", isDrain: true },
				{ id: "toB", from: "s", to: "dumpB", isDrain: true },
			],
		);
		expect(r.flow.toKeep).toBe(40);
		expect(r.flow.toA).toBe(30);
		expect(r.flow.toB).toBe(30);
	});
});

describe("marking a belt as overflow must not cost the factory anything", () => {
	test("it never reduces how much is delivered overall", () => {
		const nodes: FlowNodeSpec[] = [
			{ id: "p", supply: 60 }, { id: "s" }, { id: "a", demand: 40 }, { id: "b", demand: 40 },
		];
		const plain = solve(nodes, [
			{ id: "trunk", from: "p", to: "s" },
			{ id: "toA", from: "s", to: "a" },
			{ id: "toB", from: "s", to: "b" },
		]);
		const withOverflow = solve(nodes, [
			{ id: "trunk", from: "p", to: "s" },
			{ id: "toA", from: "s", to: "a" },
			{ id: "toB", from: "s", to: "b", isDrain: true },
		]);
		expect(withOverflow.total, "the same 60/min still gets delivered").toBe(plain.total);
		expect(withOverflow.flow.toA, "but it is routed down the ordinary belt").toBe(40);
		expect(withOverflow.flow.toB).toBe(20);
	});

	test("a consumer reachable only through an overflow belt is still fed", () => {
		// There is no choice to make here, so "overflow only" has nothing to defer to.
		const r = solve(
			[{ id: "p", supply: 60 }, { id: "c", demand: 60 }],
			[{ id: "only", from: "p", to: "c", isDrain: true }],
		);
		expect(r.flow.only, "the only route still carries everything").toBe(60);
		expect(r.shortfall.c).toBe(0);
	});

	test("marking the single belt of a chain as overflow changes nothing", () => {
		const r = solve(
			[{ id: "p", supply: 60 }, { id: "s" }, { id: "c", demand: 60 }],
			[
				{ id: "in", from: "p", to: "s", isDrain: true },
				{ id: "out", from: "s", to: "c" },
			],
		);
		expect(r.flow).toEqual({ in: 60, out: 60 });
	});
});

describe("choosing between routes", () => {
	test("a route that passes through an overflow belt is avoided", () => {
		// Both routes reach the same consumer. The dashed one should be the fallback.
		const r = solve(
			[{ id: "p", supply: 60 }, { id: "s" }, { id: "viaPlain" }, { id: "viaDashed" }, { id: "c", demand: 60 }],
			[
				{ id: "trunk", from: "p", to: "s" },
				{ id: "toPlain", from: "s", to: "viaPlain" },
				{ id: "toDashed", from: "s", to: "viaDashed", isDrain: true },
				{ id: "plainOut", from: "viaPlain", to: "c" },
				{ id: "dashedOut", from: "viaDashed", to: "c" },
			],
		);
		expect(r.flow.toPlain, "the plain route carries it all").toBe(60);
		expect(r.flow.toDashed, "the dashed route stays empty").toBe(0);
	});

	test("an overflow belt deep in a chain still repels flow at the junction before it", () => {
		// The dashed belt is one hop further along, not directly on the splitter.
		const r = solve(
			[
				{ id: "p", supply: 60 }, { id: "s" },
				{ id: "leftMid" }, { id: "rightMid" },
				{ id: "a", demand: 60 }, { id: "b", demand: 60 },
			],
			[
				{ id: "trunk", from: "p", to: "s" },
				{ id: "toLeft", from: "s", to: "leftMid" },
				{ id: "toRight", from: "s", to: "rightMid" },
				{ id: "leftOut", from: "leftMid", to: "a" },
				{ id: "rightOut", from: "rightMid", to: "b", isDrain: true },
			],
		);
		expect(r.flow.toLeft, "the junction already knows the right branch ends in a dashed belt").toBe(60);
		expect(r.flow.toRight).toBe(0);
	});
});

describe("how an unfilled overflow sink is described", () => {
	test("a dump that does not get filled is reported as being short", () => {
		// This is the bit that reads oddly: a dump is somewhere to put spare material,
		// not something with a requirement, yet it is recorded as 450/min short.
		const r = solve(
			[{ id: "p", supply: 60 }, { id: "s" }, { id: "keep", demand: 50 }, { id: "dump", demand: 500 }],
			[
				{ id: "trunk", from: "p", to: "s" },
				{ id: "toKeep", from: "s", to: "keep" },
				{ id: "toDump", from: "s", to: "dump", isDrain: true },
			],
		);
		expect(r.shortfall.keep, "the real consumer is satisfied").toBe(0);
		expect(r.shortfall.dump, "but the dump claims to be starving").toBe(490);
	});
});

describe("the ranking must hold at any size of factory", () => {
	// An ordinary belt resists carrying more the more it already carries. If the
	// penalty that ranks overflow belts below ordinary ones were a fixed number, it
	// would stop being decisive once rates grew past it, and overflow belts would
	// quietly start behaving like ordinary ones with no warning.
	for (const scale of [1, 1e3, 1e6, 1e9]) {
		test(`ordinary belts win at ${scale.toExponential(0)}/min`, () => {
			const keep = 3 * scale;
			const spare = scale;
			const r = solve(
				[
					{ id: "p", supply: keep + spare }, { id: "s" },
					{ id: "keep", demand: keep }, { id: "dump", demand: 100 * scale },
				],
				[
					{ id: "trunk", from: "p", to: "s" },
					{ id: "toKeep", from: "s", to: "keep" },
					{ id: "toDump", from: "s", to: "dump", isDrain: true },
				],
			);
			expect(r.flow.toKeep, "the ordinary belt is filled first").toBe(keep);
			expect(r.flow.toDump, "the overflow gets only what is left").toBe(spare);
		});
	}

	test("it holds across a long chain of overflow belts too", () => {
		// A penalty has to outweigh a whole loop's worth of ordinary resistance, not
		// just one belt's, so the chain length matters as well as the rates.
		const nodes: FlowNodeSpec[] = [
			{ id: "p", supply: 4000 }, { id: "s" }, { id: "keep", demand: 3000 }, { id: "dump", demand: 10000 },
		];
		const edges: FlowEdgeSpec[] = [
			{ id: "trunk", from: "p", to: "s" },
			{ id: "toKeep", from: "s", to: "keep" },
		];
		let previous = "s";
		for (let i = 0; i < 12; i++) {
			nodes.push({ id: `hop${i}` });
			edges.push({ id: `dash${i}`, from: previous, to: `hop${i}`, isDrain: true });
			previous = `hop${i}`;
		}
		edges.push({ id: "dashEnd", from: previous, to: "dump", isDrain: true });

		const r = solve(nodes, edges);
		expect(r.flow.toKeep, "the ordinary belt is still filled first").toBe(3000);
		expect(r.flow.dashEnd, "and only the leftover goes down the dashed chain").toBe(1000);
	});
});

describe("wired up through a real page", () => {
	function page() {
		return AppState.newDefault().currentPage!;
	}
	function belt(p: GraphPage, a: GraphNode, b: GraphNode, drain: boolean) {
		const edge = new GraphEdge(p.context, p.idGen.nextId(), "item-flow", "", "", {
			displayType: "curved", isDrainLine: drain, startOrientation: null, endOrientation: null,
		});
		p.addEdgeBetweenNodes(edge, a, b);
		return edge;
	}
	function joint(p: GraphPage, node: GraphNode, direction: "input" | "output") {
		const props = node.properties as GraphNodeProductionProperties;
		return p.nodes.get(props.resourceJoints.find(j => j.type === direction)!.id)!;
	}

	test("the context menu toggle actually reaches the calculation", () => {
		const p = page();
		const miner = p.makeNewNode({
			type: "extraction", partClassName: "Desc_OreIron_C",
			buildingClassName: "Build_MinerMk1_C", purityModifier: 1,
		}, { x: 0, y: 0 }) as GraphNode<GraphNodeProductionProperties>;
		const splitter = p.makeNewNode({ type: "splitter", resourceClassName: "Desc_OreIron_C" }, { x: 300, y: 0 });
		const smelter = p.makeNewNode({ type: "recipe", recipeClassName: "Recipe_IngotIron_C" }, { x: 600, y: -200 }) as GraphNode<GraphNodeProductionProperties>;
		smelter.properties.multiplier = 1; // wants 30
		const dump = p.makeNewNode({ type: "factory-output", partClassName: "Desc_OreIron_C" }, { x: 600, y: 200 }) as GraphNode<GraphNodeProductionProperties>;
		dump.properties.multiplier = 500;

		belt(p, joint(p, miner, "output"), splitter, false);
		const toSmelter = belt(p, splitter, joint(p, smelter, "input"), false);
		const toDump = belt(p, splitter, joint(p, dump, "input"), true);

		calculateThroughputs(p);
		expect(toSmelter.flow, "the smelter gets its 30 first").toBe(30);
		expect(toDump.flow, "the overflow takes the other 30").toBe(30);

		// Flip it back to a normal line and the split becomes an ordinary even one.
		toDump.properties.isDrainLine = false;
		calculateThroughputs(p);
		expect(toSmelter.flow, "as a normal line the smelter still only wants 30").toBe(30);
		expect(toDump.flow).toBe(30);
	});
});
