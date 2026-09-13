import { describe, expect, test } from "vitest";
import { AppState } from "./AppState.svelte";
import { GraphEdge } from "./GraphEdge.svelte";
import { GraphNode, type GraphNodeProductionProperties, type GraphNodeResourceJointProperties } from "./GraphNode.svelte";
import { GraphPage } from "./GraphPage.svelte";
import { calculateThroughputs } from "./throughputsCalculator";

/*
 * Expectations here are derived from how Satisfactory factories actually behave,
 * not from what the calculator currently does.
 *
 * A belt carries one rate: `flow`, how much actually travels along it. Anything
 * made but not shipped shows up as `surplus` on the output joint that made it, and
 * anything wanted but not received as `shortfall` on the input joint that wanted it.
 *
 *  - a belt never carries more than the things behind it can make
 *  - flow in == flow out at every splitter and merger
 *  - a surplus is reported on the producer that has it, a shortfall on the consumer
 *    that suffers it, and never as an inflated number on some belt in between
 */

const IRON_ORE = "Desc_OreIron_C";
const IRON_INGOT = "Desc_IronIngot_C";
const IRON_ROD = "Desc_IronRod_C";
const MINER_MK1 = "Build_MinerMk1_C";

class Graph {
	readonly page: GraphPage;
	private y = 0;

	constructor() {
		this.page = AppState.newDefault().currentPage!;
	}

	private nextPos() {
		this.y += 300;
		return { x: 0, y: this.y };
	}

	/** Mk1 miner. Base 60/min, scaled by purity and overclock multiplier. */
	miner(part: string = IRON_ORE, options: { purity?: 0.5 | 1 | 2; multiplier?: number } = {}) {
		const node = this.page.makeNewNode({
			type: "extraction",
			partClassName: part,
			buildingClassName: MINER_MK1,
			purityModifier: options.purity ?? 1,
		}, this.nextPos()) as GraphNode<GraphNodeProductionProperties>;
		node.properties.multiplier = options.multiplier ?? 1;
		return node;
	}

	building(recipeClassName: string, multiplier = 1, page: GraphPage = this.page) {
		const node = page.makeNewNode({
			type: "recipe",
			recipeClassName,
		}, this.nextPos()) as GraphNode<GraphNodeProductionProperties>;
		node.properties.multiplier = multiplier;
		return node;
	}

	get appState() {
		return this.page.context.appState;
	}

	/** A second page in the same save, so it can be referenced from the first. */
	factoryPage(name: string) {
		const page = GraphPage.newDefault(this.appState, name);
		this.appState.addPage(page);
		return page;
	}

	/** A node standing in for a whole other page. */
	factoryReference(factoryPage: GraphPage) {
		return this.page.makeNewNode({
			type: "factory-reference",
			factoryId: factoryPage.id,
			jointsToExternalNodes: {},
		}, this.nextPos()) as GraphNode<GraphNodeProductionProperties>;
	}

	splitter(resourceClassName: string = IRON_ORE) {
		return this.page.makeNewNode({ type: "splitter", resourceClassName }, this.nextPos());
	}

	merger(resourceClassName: string = IRON_ORE) {
		return this.page.makeNewNode({ type: "merger", resourceClassName }, this.nextPos());
	}

	/** The joint a belt actually attaches to. Splitters/mergers are their own joint. */
	private port(node: GraphNode, direction: "input" | "output", resourceClassName?: string): GraphNode {
		if (node.properties.type !== "production") {
			return node;
		}
		const owner = node.context.page;
		const candidates = node.properties.resourceJoints
			.filter(j => j.type === direction)
			.map(j => owner.nodes.get(j.id) as GraphNode<GraphNodeResourceJointProperties>)
			.filter(j => !resourceClassName || j.properties.resourceClassName === resourceClassName);
		if (candidates.length !== 1) {
			throw new Error(`expected exactly 1 ${direction} joint on ${node.id}, found ${candidates.length}`);
		}
		return candidates[0];
	}

	out(node: GraphNode, resourceClassName?: string) {
		return this.port(node, "output", resourceClassName);
	}

	in(node: GraphNode, resourceClassName?: string) {
		return this.port(node, "input", resourceClassName);
	}

	/** A sink that consumes a fixed rate, and a source that supplies one. */
	sink(part: string, ratePerMinute: number, page: GraphPage = this.page) {
		const node = page.makeNewNode({
			type: "factory-output",
			partClassName: part,
		}, this.nextPos()) as GraphNode<GraphNodeProductionProperties>;
		node.properties.multiplier = ratePerMinute;
		return node;
	}

	source(part: string, ratePerMinute: number, page: GraphPage = this.page) {
		const node = page.makeNewNode({
			type: "factory-input",
			partClassName: part,
		}, this.nextPos()) as GraphNode<GraphNodeProductionProperties>;
		node.properties.multiplier = ratePerMinute;
		return node;
	}

	/** Belt from a supplier port to a consumer port. */
	belt(from: GraphNode, to: GraphNode, options: { drain?: boolean } = {}): GraphEdge {
		const owner = from.context.page;
		const edge = new GraphEdge(owner.context, owner.idGen.nextId(), "item-flow", "", "", {
			displayType: "curved",
			isDrainLine: options.drain ?? false,
			startOrientation: null,
			endOrientation: null,
		});
		owner.addEdgeBetweenNodes(edge, from, to);
		return edge;
	}

	solve() {
		for (const page of this.appState.pages) {
			calculateThroughputs(page);
		}
	}
}

/** What a belt carries, rounded to kill float dust from fractional multipliers. */
function flow(edge: GraphEdge) {
	return Math.round(edge.flow * 1e6) / 1e6;
}

function expectFlow(edge: GraphEdge, rate: number, label: string) {
	expect.soft(flow(edge), `${label} should carry ${rate}/min`).toBe(rate);
}

/** Made but not shipped, on an output joint. */
function surplusOf(g: Graph, node: GraphNode, resourceClassName?: string) {
	return Math.round(g.out(node, resourceClassName).surplus * 1e6) / 1e6;
}

/** Wanted but not received, on an input joint. */
function shortfallOf(g: Graph, node: GraphNode, resourceClassName?: string) {
	return Math.round(g.in(node, resourceClassName).shortfall * 1e6) / 1e6;
}

describe("1:1 chains", () => {
	test("miner exactly feeds one smelter", () => {
		// 60/min ore in, smelter x2 consumes 30*2 = 60/min. Nothing is wasted or missing.
		const g = new Graph();
		const miner = g.miner();
		const smelter = g.building("Recipe_IngotIron_C", 2);
		const belt = g.belt(g.out(miner), g.in(smelter));
		g.solve();

		expectFlow(belt, 60, "miner -> smelter");
	});

	test("miner over-produces for a half-sized smelter", () => {
		// 60/min available, only 30/min wanted. 30 travels; the other 30 is spare
		// at the miner, which is where it physically is.
		const g = new Graph();
		const miner = g.miner();
		const smelter = g.building("Recipe_IngotIron_C", 1);
		const belt = g.belt(g.out(miner), g.in(smelter));
		g.solve();

		expectFlow(belt, 30, "miner -> smelter");
		expect.soft(surplusOf(g, miner), "the miner has 30/min going nowhere").toBe(30);
		expect.soft(shortfallOf(g, smelter), "the smelter gets everything it wants").toBe(0);
	});

	test("miner under-produces for an oversized smelter", () => {
		// 60/min available, 120/min wanted. The belt carries what exists; the smelter
		// records what it is missing.
		const g = new Graph();
		const miner = g.miner();
		const smelter = g.building("Recipe_IngotIron_C", 4);
		const belt = g.belt(g.out(miner), g.in(smelter));
		g.solve();

		expectFlow(belt, 60, "miner -> smelter");
		expect.soft(shortfallOf(g, smelter), "the smelter is 60/min short").toBe(60);
		expect.soft(surplusOf(g, miner), "the miner ships everything it mines").toBe(0);
	});

	test("impure node halves the miner's rate", () => {
		const g = new Graph();
		const miner = g.miner(IRON_ORE, { purity: 0.5 });
		const smelter = g.building("Recipe_IngotIron_C", 1);
		const belt = g.belt(g.out(miner), g.in(smelter));
		g.solve();

		expectFlow(belt, 30, "impure miner -> smelter");
	});

	test("three stage chain: miner -> smelter -> constructor", () => {
		// 60 ore -> 60 ingot -> rods. Constructor x4 eats 15*4 = 60 ingot/min.
		const g = new Graph();
		const miner = g.miner();
		const smelter = g.building("Recipe_IngotIron_C", 2);
		const constructor = g.building("Recipe_IronRod_C", 4);
		const oreBelt = g.belt(g.out(miner), g.in(smelter));
		const ingotBelt = g.belt(g.out(smelter, IRON_INGOT), g.in(constructor, IRON_INGOT));
		g.solve();

		expectFlow(oreBelt, 60, "ore belt");
		expectFlow(ingotBelt, 60, "ingot belt");
	});
});

describe("one splitter", () => {
	test("splits evenly between two equal smelters", () => {
		// 60 ore -> two smelters wanting 30 each.
		const g = new Graph();
		const miner = g.miner();
		const splitter = g.splitter();
		const smelterA = g.building("Recipe_IngotIron_C", 1);
		const smelterB = g.building("Recipe_IngotIron_C", 1);
		const trunk = g.belt(g.out(miner), splitter);
		const toA = g.belt(splitter, g.in(smelterA));
		const toB = g.belt(splitter, g.in(smelterB));
		g.solve();

		expectFlow(trunk, 60, "trunk");
		expectFlow(toA, 30, "branch to A");
		expectFlow(toB, 30, "branch to B");
	});

	test("splits unevenly between two differently sized smelters", () => {
		// 60 ore, A wants 45 (x1.5), B wants 15 (x0.5). Total demand matches supply,
		// so a real factory balances perfectly - the split is NOT 30/30.
		const g = new Graph();
		const miner = g.miner();
		const splitter = g.splitter();
		const smelterA = g.building("Recipe_IngotIron_C", 1.5);
		const smelterB = g.building("Recipe_IngotIron_C", 0.5);
		const trunk = g.belt(g.out(miner), splitter);
		const toA = g.belt(splitter, g.in(smelterA));
		const toB = g.belt(splitter, g.in(smelterB));
		g.solve();

		expectFlow(trunk, 60, "trunk");
		expectFlow(toA, 45, "branch to big smelter");
		expectFlow(toB, 15, "branch to small smelter");
	});

	test("splitter conserves flow across three uneven branches", () => {
		// 120 ore (x2 miner) -> 60 / 30 / 30.
		const g = new Graph();
		const miner = g.miner(IRON_ORE, { multiplier: 2 });
		const splitter = g.splitter();
		const big = g.building("Recipe_IngotIron_C", 2);
		const mid = g.building("Recipe_IngotIron_C", 1);
		const small = g.building("Recipe_IngotIron_C", 1);
		const trunk = g.belt(g.out(miner), splitter);
		const toBig = g.belt(splitter, g.in(big));
		const toMid = g.belt(splitter, g.in(mid));
		const toSmall = g.belt(splitter, g.in(small));
		g.solve();

		expectFlow(trunk, 120, "trunk");
		expectFlow(toBig, 60, "branch to x2 smelter");
		expectFlow(toMid, 30, "branch to first x1 smelter");
		expectFlow(toSmall, 30, "branch to second x1 smelter");

		const outPush = flow(toBig) + flow(toMid) + flow(toSmall);
		expect.soft(outPush, "splitter must push out exactly what it takes in").toBe(flow(trunk));
	});
});

describe("one merger", () => {
	test("merges two equal miners into one big smelter", () => {
		// 60 + 60 = 120 ore, smelter x4 wants 120.
		const g = new Graph();
		const minerA = g.miner();
		const minerB = g.miner();
		const merger = g.merger();
		const smelter = g.building("Recipe_IngotIron_C", 4);
		const fromA = g.belt(g.out(minerA), merger);
		const fromB = g.belt(g.out(minerB), merger);
		const trunk = g.belt(merger, g.in(smelter));
		g.solve();

		expectFlow(fromA, 60, "feed from miner A");
		expectFlow(fromB, 60, "feed from miner B");
		expectFlow(trunk, 120, "merged trunk");
	});

	test("merges two UNEQUAL miners into one smelter", () => {
		// A normal node gives 60, an impure node gives 30. Smelter x3 wants exactly 90.
		// Each miner can only ever deliver what it mines, so the feeds are 60 and 30.
		const g = new Graph();
		const normal = g.miner(IRON_ORE, { purity: 1 });
		const impure = g.miner(IRON_ORE, { purity: 0.5 });
		const merger = g.merger();
		const smelter = g.building("Recipe_IngotIron_C", 3);
		const fromNormal = g.belt(g.out(normal), merger);
		const fromImpure = g.belt(g.out(impure), merger);
		const trunk = g.belt(merger, g.in(smelter));
		g.solve();

		expectFlow(fromNormal, 60, "feed from normal node");
		expectFlow(fromImpure, 30, "feed from impure node");
		expectFlow(trunk, 90, "merged trunk");
	});

	test("merger conserves demand: what it is asked for equals what it asks upstream", () => {
		const g = new Graph();
		const normal = g.miner(IRON_ORE, { purity: 1 });
		const impure = g.miner(IRON_ORE, { purity: 0.5 });
		const merger = g.merger();
		const smelter = g.building("Recipe_IngotIron_C", 3);
		const fromNormal = g.belt(g.out(normal), merger);
		const fromImpure = g.belt(g.out(impure), merger);
		const trunk = g.belt(merger, g.in(smelter));
		g.solve();

		const intoMerger = flow(fromNormal) + flow(fromImpure);
		expect.soft(intoMerger, "a merger sends on exactly what it receives")
			.toBe(flow(trunk));
	});
});

describe("several suppliers feeding one consumer", () => {
	test("two unequal miners belted straight into one smelter", () => {
		// No merger node at all - both belts land on the smelter's input joint.
		// 60 + 30 = 90, smelter x3 wants 90.
		const g = new Graph();
		const normal = g.miner(IRON_ORE, { purity: 1 });
		const impure = g.miner(IRON_ORE, { purity: 0.5 });
		const smelter = g.building("Recipe_IngotIron_C", 3);
		const fromNormal = g.belt(g.out(normal), g.in(smelter));
		const fromImpure = g.belt(g.out(impure), g.in(smelter));
		g.solve();

		expectFlow(fromNormal, 60, "belt from normal node");
		expectFlow(fromImpure, 30, "belt from impure node");
	});

	test("one miner feeding two smelters of different sizes, no splitter", () => {
		// 120/min miner, smelters want 80 and 40.
		const g = new Graph();
		const miner = g.miner(IRON_ORE, { multiplier: 2 });
		const big = g.building("Recipe_IngotIron_C", 8 / 3);
		const small = g.building("Recipe_IngotIron_C", 4 / 3);
		const toBig = g.belt(g.out(miner), g.in(big));
		const toSmall = g.belt(g.out(miner), g.in(small));
		g.solve();

		expectFlow(toBig, 80, "belt to big smelter");
		expectFlow(toSmall, 40, "belt to small smelter");
	});
});

describe("mixed direct and split supply", () => {
	test("two miners, one splitter, two smelters of 80 and 40", () => {
		// miner1 -> smelterA directly.
		// miner2 -> splitter -> smelterA and smelterB.
		// Supply 120, demand 120, and a feasible assignment exists:
		//   miner1 gives all 60 to A, splitter gives 20 to A and 40 to B.
		const g = new Graph();
		const miner1 = g.miner();
		const miner2 = g.miner();
		const splitter = g.splitter();
		const smelterA = g.building("Recipe_IngotIron_C", 8 / 3); // wants 80
		const smelterB = g.building("Recipe_IngotIron_C", 4 / 3); // wants 40

		const direct = g.belt(g.out(miner1), g.in(smelterA));
		const trunk = g.belt(g.out(miner2), splitter);
		const splitToA = g.belt(splitter, g.in(smelterA));
		const splitToB = g.belt(splitter, g.in(smelterB));
		g.solve();

		expectFlow(direct, 60, "miner1 -> smelterA direct");
		expectFlow(trunk, 60, "miner2 -> splitter trunk");
		expectFlow(splitToA, 20, "splitter -> smelterA");
		expectFlow(splitToB, 40, "splitter -> smelterB");
	});

	test("no belt may be asked for more than its whole upstream can mine", () => {
		// Same factory. The trunk is fed by a single 60/min miner, so nothing
		// downstream can legitimately demand more than 60/min through it.
		const g = new Graph();
		const miner1 = g.miner();
		const miner2 = g.miner();
		const splitter = g.splitter();
		const smelterA = g.building("Recipe_IngotIron_C", 8 / 3);
		const smelterB = g.building("Recipe_IngotIron_C", 4 / 3);

		g.belt(g.out(miner1), g.in(smelterA));
		const trunk = g.belt(g.out(miner2), splitter);
		g.belt(splitter, g.in(smelterA));
		g.belt(splitter, g.in(smelterB));
		g.solve();

		expect.soft(flow(trunk), "the trunk cannot carry more than the single miner behind it")
			.toBeLessThanOrEqual(60);
	});
});

describe("the answer must not depend on the order things were built", () => {
	/** Two miners feeding two smelters, one directly and one through a splitter. */
	function mixedSupplyFactory(bigSmelterFirst: boolean) {
		const g = new Graph();
		const miner1 = g.miner();
		const miner2 = g.miner();
		const splitter = g.splitter();
		const big = bigSmelterFirst ? g.building("Recipe_IngotIron_C", 8 / 3) : null;
		const small = g.building("Recipe_IngotIron_C", 4 / 3);
		const bigSmelter = big ?? g.building("Recipe_IngotIron_C", 8 / 3);

		const direct = g.belt(g.out(miner1), g.in(bigSmelter));
		const trunk = g.belt(g.out(miner2), splitter);
		const splitToBig = g.belt(splitter, g.in(bigSmelter));
		const splitToSmall = g.belt(splitter, g.in(small));
		g.solve();
		return {
			direct: flow(direct),
			trunk: flow(trunk),
			splitToBig: flow(splitToBig),
			splitToSmall: flow(splitToSmall),
		};
	}

	test("same factory, smelters declared in opposite order, same numbers", () => {
		expect(mixedSupplyFactory(true)).toEqual(mixedSupplyFactory(false));
	});

	test("same factory, belts declared in opposite order, same numbers", () => {
		function build(directBeltFirst: boolean) {
			const g = new Graph();
			const miner1 = g.miner();
			const miner2 = g.miner();
			const splitter = g.splitter();
			const big = g.building("Recipe_IngotIron_C", 8 / 3);
			const small = g.building("Recipe_IngotIron_C", 4 / 3);

			const direct = directBeltFirst ? g.belt(g.out(miner1), g.in(big)) : null;
			const trunk = g.belt(g.out(miner2), splitter);
			const splitToBig = g.belt(splitter, g.in(big));
			const splitToSmall = g.belt(splitter, g.in(small));
			const directBelt = direct ?? g.belt(g.out(miner1), g.in(big));
			g.solve();
			return {
				direct: flow(directBelt),
				trunk: flow(trunk),
				splitToBig: flow(splitToBig),
				splitToSmall: flow(splitToSmall),
			};
		}
		expect(build(true)).toEqual(build(false));
	});
});

describe("splitter trees and diamonds", () => {
	test("diamond: split then merge back into one smelter", () => {
		// 60 ore splits down two belts and recombines. Nothing is created or lost.
		const g = new Graph();
		const miner = g.miner();
		const splitter = g.splitter();
		const merger = g.merger();
		const smelter = g.building("Recipe_IngotIron_C", 2);

		const trunkIn = g.belt(g.out(miner), splitter);
		const left = g.belt(splitter, merger);
		const right = g.belt(splitter, merger);
		const trunkOut = g.belt(merger, g.in(smelter));
		g.solve();

		expectFlow(trunkIn, 60, "trunk into splitter");
		expectFlow(trunkOut, 60, "trunk out of merger");
		expect.soft(flow(left) + flow(right), "the two diamond legs must carry 60 between them")
			.toBe(60);
		// Which way round the 60 goes has one answer: spreading the load evenly is
		// what picks 30 and 30 over 60 and 0.
		expectFlow(left, 30, "left diamond leg");
		expectFlow(right, 30, "right diamond leg");
	});

	test("two level splitter tree with uneven leaves", () => {
		// 120 ore. Root splits to a sub-splitter (feeding 30 and 30) and to a 60 smelter.
		const g = new Graph();
		const miner = g.miner(IRON_ORE, { multiplier: 2 });
		const root = g.splitter();
		const sub = g.splitter();
		const leafA = g.building("Recipe_IngotIron_C", 1); // 30
		const leafB = g.building("Recipe_IngotIron_C", 1); // 30
		const leafC = g.building("Recipe_IngotIron_C", 2); // 60

		const trunk = g.belt(g.out(miner), root);
		const rootToSub = g.belt(root, sub);
		const rootToC = g.belt(root, g.in(leafC));
		const subToA = g.belt(sub, g.in(leafA));
		const subToB = g.belt(sub, g.in(leafB));
		g.solve();

		expectFlow(trunk, 120, "trunk");
		expectFlow(rootToSub, 60, "root -> sub splitter");
		expectFlow(rootToC, 60, "root -> 60/min smelter");
		expectFlow(subToA, 30, "sub -> leaf A");
		expectFlow(subToB, 30, "sub -> leaf B");
	});

	test("two miners merged then split to two smelters", () => {
		// 60 + 60 into a merger, back out to smelters wanting 80 and 40.
		const g = new Graph();
		const minerA = g.miner();
		const minerB = g.miner();
		const merger = g.merger();
		const splitter = g.splitter();
		const big = g.building("Recipe_IngotIron_C", 8 / 3); // 80
		const small = g.building("Recipe_IngotIron_C", 4 / 3); // 40

		const fromA = g.belt(g.out(minerA), merger);
		const fromB = g.belt(g.out(minerB), merger);
		const spine = g.belt(merger, splitter);
		const toBig = g.belt(splitter, g.in(big));
		const toSmall = g.belt(splitter, g.in(small));
		g.solve();

		expectFlow(fromA, 60, "miner A feed");
		expectFlow(fromB, 60, "miner B feed");
		expectFlow(spine, 120, "merger -> splitter spine");
		expectFlow(toBig, 80, "splitter -> 80/min smelter");
		expectFlow(toSmall, 40, "splitter -> 40/min smelter");
	});
});

describe("drain lines carry only what is left over", () => {
	test("normal branch is satisfied before the drain branch", () => {
		// 60/min in. A smelter wants 30. The drain belt exists to dump the rest.
		const g = new Graph();
		const miner = g.miner();
		const splitter = g.splitter();
		const smelter = g.building("Recipe_IngotIron_C", 1); // 30
		const overflow = g.sink(IRON_ORE, 200); // will take anything

		const trunk = g.belt(g.out(miner), splitter);
		const toSmelter = g.belt(splitter, g.in(smelter));
		const toDrain = g.belt(splitter, g.in(overflow), { drain: true });
		g.solve();

		// The 200/min sink is a real consumer, so the factory really is short on ore
		// and the trunk is legitimately unbalanced. What matters is the split:
		expect.soft(flow(trunk), "the miner still only mines 60").toBe(60);
		expect.soft(flow(toSmelter), "the real consumer gets its full 30 before the drain").toBe(30);
		expect.soft(flow(toDrain), "the drain takes the remaining 30").toBe(30);
	});

	test("a drain line does not steal from the normal branch when supply is tight", () => {
		// Only 30/min available and the smelter wants all 30. The drain gets nothing.
		const g = new Graph();
		const miner = g.miner(IRON_ORE, { purity: 0.5 }); // 30
		const splitter = g.splitter();
		const smelter = g.building("Recipe_IngotIron_C", 1); // 30
		const overflow = g.sink(IRON_ORE, 200);

		g.belt(g.out(miner), splitter);
		const toSmelter = g.belt(splitter, g.in(smelter));
		const toDrain = g.belt(splitter, g.in(overflow), { drain: true });
		g.solve();

		expect.soft(flow(toSmelter), "the smelter is fed first").toBe(30);
		expect.soft(flow(toDrain), "nothing is left to drain").toBe(0);
	});
});

describe("contention: consumers competing for the same supply", () => {
	test("two miners, two smelters, one miner shared between them", () => {
		// A -> X, B -> X, B -> Y.  X wants 90, Y wants 30. Supply 120, demand 120.
		// The only feasible assignment: A gives all 60 to X, B gives 30 to X and 30 to Y.
		const g = new Graph();
		const minerA = g.miner();
		const minerB = g.miner();
		const smelterX = g.building("Recipe_IngotIron_C", 3); // 90
		const smelterY = g.building("Recipe_IngotIron_C", 1); // 30

		const aToX = g.belt(g.out(minerA), g.in(smelterX));
		const bToX = g.belt(g.out(minerB), g.in(smelterX));
		const bToY = g.belt(g.out(minerB), g.in(smelterY));
		g.solve();

		expectFlow(aToX, 60, "exclusive miner -> X");
		expectFlow(bToX, 30, "shared miner -> X");
		expectFlow(bToY, 30, "shared miner -> Y");
	});

	test("three miners feeding one smelter, one of them also feeding another", () => {
		// A(60) -> X, B(60) -> X, C(30 impure) -> X and C -> Y.
		// X wants 135, Y wants 15. Supply 150, demand 150.
		const g = new Graph();
		const minerA = g.miner();
		const minerB = g.miner();
		const minerC = g.miner(IRON_ORE, { purity: 0.5 });
		const smelterX = g.building("Recipe_IngotIron_C", 4.5); // 135
		const smelterY = g.building("Recipe_IngotIron_C", 0.5); // 15

		const aToX = g.belt(g.out(minerA), g.in(smelterX));
		const bToX = g.belt(g.out(minerB), g.in(smelterX));
		const cToX = g.belt(g.out(minerC), g.in(smelterX));
		const cToY = g.belt(g.out(minerC), g.in(smelterY));
		g.solve();

		expectFlow(aToX, 60, "miner A -> X");
		expectFlow(bToX, 60, "miner B -> X");
		expectFlow(cToX, 15, "shared miner C -> X");
		expectFlow(cToY, 15, "shared miner C -> Y");
	});

	test("contention one stage downstream: shared ingot supply", () => {
		// Two smelters make 60 ingots each. Constructor P wants 90, Q wants 30.
		// Smelter 1 feeds only P; smelter 2 feeds both.
		const g = new Graph();
		const mineOne = g.miner();
		const mineTwo = g.miner();
		const smelterOne = g.building("Recipe_IngotIron_C", 2);
		const smelterTwo = g.building("Recipe_IngotIron_C", 2);
		const rodsP = g.building("Recipe_IronRod_C", 6); // 90 ingot
		const rodsQ = g.building("Recipe_IronRod_C", 2); // 30 ingot

		g.belt(g.out(mineOne), g.in(smelterOne));
		g.belt(g.out(mineTwo), g.in(smelterTwo));
		const oneToP = g.belt(g.out(smelterOne, IRON_INGOT), g.in(rodsP, IRON_INGOT));
		const twoToP = g.belt(g.out(smelterTwo, IRON_INGOT), g.in(rodsP, IRON_INGOT));
		const twoToQ = g.belt(g.out(smelterTwo, IRON_INGOT), g.in(rodsQ, IRON_INGOT));
		g.solve();

		expectFlow(oneToP, 60, "exclusive smelter -> P");
		expectFlow(twoToP, 30, "shared smelter -> P");
		expectFlow(twoToQ, 30, "shared smelter -> Q");
	});

	test("shared supply reached through a splitter on both sides", () => {
		// minerShared -> splitter -> X and Y.  minerExtra -> X directly.
		// X wants 100, Y wants 20. Supply 60 + 60 = 120.
		const g = new Graph();
		const minerShared = g.miner();
		const minerExtra = g.miner();
		const splitter = g.splitter();
		const smelterX = g.building("Recipe_IngotIron_C", 10 / 3); // 100
		const smelterY = g.building("Recipe_IngotIron_C", 2 / 3); // 20

		const extraToX = g.belt(g.out(minerExtra), g.in(smelterX));
		const trunk = g.belt(g.out(minerShared), splitter);
		const toX = g.belt(splitter, g.in(smelterX));
		const toY = g.belt(splitter, g.in(smelterY));
		g.solve();

		expectFlow(extraToX, 60, "exclusive miner -> X");
		expectFlow(trunk, 60, "shared miner trunk");
		expectFlow(toX, 40, "splitter -> X");
		expectFlow(toY, 20, "splitter -> Y");
	});
});

describe("recipes with more than one input", () => {
	test("steel foundry pulls iron and coal independently", () => {
		// x1 foundry: 45 ore + 45 coal -> 45 steel. The two input belts must not
		// interfere with each other.
		const g = new Graph();
		const ore = g.source(IRON_ORE, 45);
		const coal = g.source("Desc_Coal_C", 45);
		const foundry = g.building("Recipe_IngotSteel_C", 1);

		const oreBelt = g.belt(g.out(ore), g.in(foundry, IRON_ORE));
		const coalBelt = g.belt(g.out(coal), g.in(foundry, "Desc_Coal_C"));
		g.solve();

		expectFlow(oreBelt, 45, "ore belt");
		expectFlow(coalBelt, 45, "coal belt");
	});

	test("starving one input does not change the other input's belt", () => {
		// Only 20 coal available. The ore belt still legitimately demands 45.
		const g = new Graph();
		const ore = g.source(IRON_ORE, 45);
		const coal = g.source("Desc_Coal_C", 20);
		const foundry = g.building("Recipe_IngotSteel_C", 1);

		const oreBelt = g.belt(g.out(ore), g.in(foundry, IRON_ORE));
		const coalBelt = g.belt(g.out(coal), g.in(foundry, "Desc_Coal_C"));
		g.solve();

		expectFlow(oreBelt, 45, "ore belt is unaffected by the coal shortage");
		expectFlow(coalBelt, 20, "coal belt carries what little coal there is");
		expect.soft(shortfallOf(g, foundry, "Desc_Coal_C"), "the foundry is 25/min short of coal").toBe(25);
	});
});

describe("degenerate factories must not hang or produce nonsense", () => {
	test("a belt loop between two splitters terminates with finite numbers", () => {
		const g = new Graph();
		const miner = g.miner();
		const a = g.splitter();
		const b = g.splitter();
		const smelter = g.building("Recipe_IngotIron_C", 2);

		const feed = g.belt(g.out(miner), a);
		const aToB = g.belt(a, b);
		const bToA = g.belt(b, a); // the loop
		const out = g.belt(b, g.in(smelter));
		g.solve();

		for (const [label, edge] of [["feed", feed], ["a->b", aToB], ["b->a", bToA], ["out", out]] as const) {
			expect.soft(Number.isFinite(edge.flow), `${label} carries a finite rate`).toBe(true);
			expect.soft(edge.flow, `${label} does not run backwards`).toBeGreaterThanOrEqual(0);
		}
		expect.soft(flow(feed), "the miner still only mines 60").toBe(60);
	});

	test("a building switched off demands nothing", () => {
		const g = new Graph();
		const miner = g.miner();
		const smelter = g.building("Recipe_IngotIron_C", 0);
		const belt = g.belt(g.out(miner), g.in(smelter));
		g.solve();

		expectFlow(belt, 0, "belt to a switched off building");
		expect.soft(surplusOf(g, miner), "all 60/min is spare").toBe(60);
	});

	test("a splitter with nothing attached downstream", () => {
		const g = new Graph();
		const miner = g.miner();
		const splitter = g.splitter();
		const trunk = g.belt(g.out(miner), splitter);
		g.solve();

		expect.soft(flow(trunk), "nothing travels down a dead end").toBe(0);
		expect.soft(surplusOf(g, miner), "the miner's whole output is spare").toBe(60);
	});
});

describe("other building types", () => {
	test("coal generators burn coal and water", () => {
		// x4 coal generators: 15 coal + 45 water each.
		const g = new Graph();
		const coal = g.source("Desc_Coal_C", 60);
		const water = g.source("Desc_Water_C", 180);
		const generators = g.page.makeNewNode({
			type: "power-production",
			powerBuildingClassName: "Build_GeneratorCoal_C",
			fuelClassName: "Desc_Coal_C",
		}, { x: 0, y: 5000 }) as GraphNode<GraphNodeProductionProperties>;
		generators.properties.multiplier = 4;

		const coalBelt = g.belt(g.out(coal), g.in(generators, "Desc_Coal_C"));
		const waterPipe = g.belt(g.out(water), g.in(generators, "Desc_Water_C"));
		g.solve();

		expectFlow(coalBelt, 60, "coal belt");
		expectFlow(waterPipe, 180, "water pipe");
	});

	test("a factory input sized automatically takes exactly what is asked of it", () => {
		// autoMultiplier means "however much the thing downstream needs".
		const g = new Graph();
		const feed = g.source(IRON_ORE, 0);
		feed.properties.autoMultiplier = true;
		const smelter = g.building("Recipe_IngotIron_C", 3); // 90
		const belt = g.belt(g.out(feed), g.in(smelter));
		g.solve();

		expectFlow(belt, 90, "auto sized input");
	});

	test("an auto-sized input settles in a single pass and stays put", () => {
		// One calculation is enough: the rate worked out mid-pass is applied there and
		// then, not left for the next one. Solving again must not move anything.
		const g = new Graph();
		const feed = g.source(IRON_ORE, 0);
		feed.properties.autoMultiplier = true;
		const smelter = g.building("Recipe_IngotIron_C", 3);
		const belt = g.belt(g.out(feed), g.in(smelter));

		g.solve();
		expect.soft(feed.properties.multiplier, "the multiplier is worked out on the first pass").toBe(90);
		expect.soft(flow(belt), "and the belt it feeds is already right").toBe(90);

		g.solve();
		expect.soft(flow(belt), "solving again changes nothing").toBe(90);
		expect.soft(feed.properties.multiplier, "and does not drift").toBe(90);
	});
});

describe("a whole small factory", () => {
	test("ore -> ingots -> rods and plates, every belt balanced", () => {
		// 4 miners = 240 ore -> 8 smelters = 240 ingot.
		// 120 ingot goes to rods (x8 = 120), 120 goes to plates (x4 = 120).
		const g = new Graph();
		const oreSplitter = g.splitter();
		const miners = [g.miner(), g.miner(), g.miner(), g.miner()];
		const oreFeeds = miners.map(m => g.belt(g.out(m), oreSplitter));

		const smelterA = g.building("Recipe_IngotIron_C", 4); // 120 ore
		const smelterB = g.building("Recipe_IngotIron_C", 4); // 120 ore
		const oreToA = g.belt(oreSplitter, g.in(smelterA));
		const oreToB = g.belt(oreSplitter, g.in(smelterB));

		const rods = g.building("Recipe_IronRod_C", 8); // 120 ingot
		const plates = g.building("Recipe_IronPlate_C", 4); // 120 ingot
		const aToRods = g.belt(g.out(smelterA, IRON_INGOT), g.in(rods, IRON_INGOT));
		const bToPlates = g.belt(g.out(smelterB, IRON_INGOT), g.in(plates, IRON_INGOT));

		const screws = g.building("Recipe_Screw_C", 12); // 120 rod
		const rodsToScrews = g.belt(g.out(rods, IRON_ROD), g.in(screws, IRON_ROD));
		g.solve();

		for (const [i, feed] of oreFeeds.entries()) {
			expectFlow(feed, 60, `ore feed from miner ${i + 1}`);
		}
		expectFlow(oreToA, 120, "ore to smelter bank A");
		expectFlow(oreToB, 120, "ore to smelter bank B");
		expectFlow(aToRods, 120, "ingots to rod constructors");
		expectFlow(bToPlates, 120, "ingots to plate constructors");
		expectFlow(rodsToScrews, 120, "rods to screw constructors");
	});

	test("the same factory with one miner on an impure node stays consistent", () => {
		// 3 normal + 1 impure = 210 ore. Demand is still 240, so the factory is
		// short by 30 - but no belt may claim more than physically exists upstream.
		const g = new Graph();
		const oreSplitter = g.splitter();
		const miners = [g.miner(), g.miner(), g.miner(), g.miner(IRON_ORE, { purity: 0.5 })];
		const oreFeeds = miners.map(m => g.belt(g.out(m), oreSplitter));

		const smelterA = g.building("Recipe_IngotIron_C", 4);
		const smelterB = g.building("Recipe_IngotIron_C", 4);
		g.belt(oreSplitter, g.in(smelterA));
		g.belt(oreSplitter, g.in(smelterB));
		g.solve();

		const capacities = [60, 60, 60, 30];
		for (const [i, feed] of oreFeeds.entries()) {
			expect.soft(flow(feed), `miner ${i + 1} cannot push more than it mines`)
				.toBeLessThanOrEqual(capacities[i]);
			expect.soft(flow(feed), `miner ${i + 1} cannot carry more than it mines`)
				.toBeLessThanOrEqual(capacities[i]);
		}
	});
});

describe("a page referenced as a sub factory", () => {
	test("a reference node draws and supplies at the sub factory's own rates", () => {
		// The sub factory takes 60 ore/min and hands back 60 ingot/min.
		const g = new Graph();
		const sub = g.factoryPage("Iron ingots");
		g.source(IRON_ORE, 60, sub);
		g.sink(IRON_INGOT, 60, sub);

		const ref = g.factoryReference(sub);
		const miner = g.miner();
		const rods = g.building("Recipe_IronRod_C", 4); // 60 ingot

		const oreBelt = g.belt(g.out(miner), g.in(ref, IRON_ORE));
		const ingotBelt = g.belt(g.out(ref, IRON_INGOT), g.in(rods, IRON_INGOT));
		g.solve();

		expectFlow(oreBelt, 60, "ore into the sub factory");
		expectFlow(ingotBelt, 60, "ingots out of the sub factory");
	});

	test("a reference node with two inputs keeps them on the right belts", () => {
		// Steel sub factory: 45 ore + 45 coal in, 45 steel out. If the joint to
		// external node mapping crossed over, the rates would land on the wrong belts.
		const g = new Graph();
		const sub = g.factoryPage("Steel");
		g.source(IRON_ORE, 45, sub);
		g.source("Desc_Coal_C", 90, sub);
		g.sink("Desc_SteelIngot_C", 45, sub);

		const ref = g.factoryReference(sub);
		const oreSupply = g.source(IRON_ORE, 45);
		const coalSupply = g.source("Desc_Coal_C", 90);
		const steelOut = g.sink("Desc_SteelIngot_C", 45);

		const oreBelt = g.belt(g.out(oreSupply), g.in(ref, IRON_ORE));
		const coalBelt = g.belt(g.out(coalSupply), g.in(ref, "Desc_Coal_C"));
		const steelBelt = g.belt(g.out(ref, "Desc_SteelIngot_C"), g.in(steelOut));
		g.solve();

		expectFlow(oreBelt, 45, "ore belt into the reference");
		expectFlow(coalBelt, 90, "coal belt into the reference");
		expectFlow(steelBelt, 45, "steel belt out of the reference");
	});

	test("starving a sub factory shows up on its input belt only", () => {
		// The sub factory wants 60 ore but only 30 is mined.
		const g = new Graph();
		const sub = g.factoryPage("Iron ingots");
		g.source(IRON_ORE, 60, sub);
		g.sink(IRON_INGOT, 60, sub);

		const ref = g.factoryReference(sub);
		const miner = g.miner(IRON_ORE, { purity: 0.5 }); // 30
		const rods = g.building("Recipe_IronRod_C", 4);

		const oreBelt = g.belt(g.out(miner), g.in(ref, IRON_ORE));
		const ingotBelt = g.belt(g.out(ref, IRON_INGOT), g.in(rods, IRON_INGOT));
		g.solve();

		expectFlow(oreBelt, 30, "the ore belt carries what is mined");
		expect.soft(shortfallOf(g, ref, IRON_ORE), "the sub factory is 30/min short of ore").toBe(30);
		expectFlow(ingotBelt, 60, "the sub factory's rated output is unchanged");
	});

	test("two reference nodes pointing at the same sub factory", () => {
		const g = new Graph();
		const sub = g.factoryPage("Iron ingots");
		g.source(IRON_ORE, 60, sub);
		g.sink(IRON_INGOT, 60, sub);

		const refA = g.factoryReference(sub);
		const refB = g.factoryReference(sub);
		const minerA = g.miner();
		const minerB = g.miner();

		const toA = g.belt(g.out(minerA), g.in(refA, IRON_ORE));
		const toB = g.belt(g.out(minerB), g.in(refB, IRON_ORE));
		g.solve();

		expectFlow(toA, 60, "ore into the first copy");
		expectFlow(toB, 60, "ore into the second copy");
	});
});

describe("auto sized factory outputs", () => {
	test("a factory output sized automatically takes everything it is given", () => {
		// autoMultiplier on an output means "whatever comes out of the factory".
		const g = new Graph();
		const smelter = g.building("Recipe_IngotIron_C", 3); // makes 90 ingot
		const out = g.sink(IRON_INGOT, 0);
		out.properties.autoMultiplier = true;
		const belt = g.belt(g.out(smelter, IRON_INGOT), g.in(out));
		g.solve();

		expectFlow(belt, 90, "auto sized output");
	});

	test("an auto sized output settles in a single pass and stays put", () => {
		const g = new Graph();
		const smelter = g.building("Recipe_IngotIron_C", 3);
		const out = g.sink(IRON_INGOT, 0);
		out.properties.autoMultiplier = true;
		const belt = g.belt(g.out(smelter, IRON_INGOT), g.in(out));

		g.solve();
		expect.soft(out.properties.multiplier, "the multiplier is worked out on the first pass").toBe(90);
		expect.soft(flow(belt), "and the belt is already right").toBe(90);

		g.solve();
		expect.soft(flow(belt), "solving again changes nothing").toBe(90);
		expect.soft(out.properties.multiplier, "and does not drift").toBe(90);
	});
});

describe("damaged saves must be skipped, not crash the calculator", () => {
	/** The healthy half of every graph below: a miner feeding a smelter. */
	function healthyPair(g: Graph) {
		const miner = g.miner();
		const smelter = g.building("Recipe_IngotIron_C", 2);
		return g.belt(g.out(miner), g.in(smelter));
	}

	test("a building whose recipe no longer exists is ignored", () => {
		const g = new Graph();
		const good = healthyPair(g);
		const broken = g.building("Recipe_IngotIron_C", 2);
		(broken.properties.details as any).recipeClassName = "Recipe_ThisWasRemoved_C";

		expect(() => g.solve()).not.toThrow();
		expectFlow(good, 60, "the healthy belt still works");
	});

	test("a building whose joint node was deleted is ignored", () => {
		const g = new Graph();
		const good = healthyPair(g);
		const broken = g.building("Recipe_IngotIron_C", 2);
		for (const joint of broken.properties.resourceJoints) {
			g.page.nodes.delete(joint.id);
		}

		expect(() => g.solve()).not.toThrow();
		expectFlow(good, 60, "the healthy belt still works");
	});

	test("a joint carrying an item the recipe does not use is ignored", () => {
		const g = new Graph();
		const good = healthyPair(g);
		const broken = g.building("Recipe_IngotIron_C", 2);
		const joint = g.in(broken) as GraphNode<GraphNodeResourceJointProperties>;
		joint.properties.resourceClassName = "Desc_Coal_C"; // iron ingots need ore, not coal

		expect(() => g.solve()).not.toThrow();
		expectFlow(good, 60, "the healthy belt still works");
	});

	test("a miner whose building no longer exists is ignored", () => {
		const g = new Graph();
		const good = healthyPair(g);
		const broken = g.miner();
		(broken.properties.details as any).buildingClassName = "Build_MinerMk9_C";

		expect(() => g.solve()).not.toThrow();
		expectFlow(good, 60, "the healthy belt still works");
	});

	test("a miner with no joints at all is ignored", () => {
		const g = new Graph();
		const good = healthyPair(g);
		const broken = g.miner();
		broken.properties.resourceJoints = [];

		expect(() => g.solve()).not.toThrow();
		expectFlow(good, 60, "the healthy belt still works");
	});

	test("a factory input with no joints at all is ignored", () => {
		const g = new Graph();
		const good = healthyPair(g);
		const broken = g.source(IRON_ORE, 60);
		broken.properties.resourceJoints = [];

		expect(() => g.solve()).not.toThrow();
		expectFlow(good, 60, "the healthy belt still works");
	});

	test("a miner saved without a purity value is treated as a normal node", () => {
		const g = new Graph();
		const miner = g.miner();
		delete (miner.properties.details as any).purityModifier;
		const smelter = g.building("Recipe_IngotIron_C", 2);
		const belt = g.belt(g.out(miner), g.in(smelter));
		g.solve();

		expectFlow(belt, 60, "a miner with no purity recorded mines 60");
	});

	test("a reference to a page that was deleted is ignored", () => {
		const g = new Graph();
		const good = healthyPair(g);
		const sub = g.factoryPage("Iron ingots");
		g.source(IRON_ORE, 60, sub);
		g.sink(IRON_INGOT, 60, sub);
		const ref = g.factoryReference(sub);
		(ref.properties.details as any).factoryId = "no-such-page";

		expect(() => g.solve()).not.toThrow();
		expectFlow(good, 60, "the healthy belt still works");
	});

	test("a reference whose joint mapping is empty is ignored", () => {
		const g = new Graph();
		const good = healthyPair(g);
		const sub = g.factoryPage("Iron ingots");
		g.source(IRON_ORE, 60, sub);
		g.sink(IRON_INGOT, 60, sub);
		const ref = g.factoryReference(sub);
		(ref.properties.details as any).jointsToExternalNodes = {};

		expect(() => g.solve()).not.toThrow();
		expectFlow(good, 60, "the healthy belt still works");
	});

	test("a reference pointing at a node that was deleted from the sub factory", () => {
		const g = new Graph();
		const good = healthyPair(g);
		const sub = g.factoryPage("Iron ingots");
		const subInput = g.source(IRON_ORE, 60, sub);
		g.sink(IRON_INGOT, 60, sub);
		const ref = g.factoryReference(sub);
		sub.nodes.delete(subInput.id);

		expect(() => g.solve()).not.toThrow();
		expectFlow(good, 60, "the healthy belt still works");
	});

	test("a belt attached to something that carries no items is ignored", () => {
		const g = new Graph();
		const good = healthyPair(g);
		const note = g.page.makeNewNode({ type: "text-note", content: "hello" }, { x: 9000, y: 9000 });
		const miner = g.miner();
		g.belt(g.out(miner), note);

		expect(() => g.solve()).not.toThrow();
		expectFlow(good, 60, "the healthy belt still works");
	});

	test("a reference whose own joint node was deleted is ignored", () => {
		const g = new Graph();
		const good = healthyPair(g);
		const sub = g.factoryPage("Iron ingots");
		g.source(IRON_ORE, 60, sub);
		g.sink(IRON_INGOT, 60, sub);
		const ref = g.factoryReference(sub);
		for (const joint of ref.properties.resourceJoints) {
			g.page.nodes.delete(joint.id);
		}

		expect(() => g.solve()).not.toThrow();
		expectFlow(good, 60, "the healthy belt still works");
	});

	test("a reference pointing at something that is not a building is ignored", () => {
		const g = new Graph();
		const good = healthyPair(g);
		const sub = g.factoryPage("Iron ingots");
		g.source(IRON_ORE, 60, sub);
		g.sink(IRON_INGOT, 60, sub);
		const ref = g.factoryReference(sub);
		const strayNote = sub.makeNewNode({ type: "text-note", content: "moved this" }, { x: 0, y: 0 });
		const mapping = (ref.properties.details as any).jointsToExternalNodes;
		for (const key of Object.keys(mapping)) {
			mapping[key] = strayNote.id;
		}

		expect(() => g.solve()).not.toThrow();
		expectFlow(good, 60, "the healthy belt still works");
	});
});

describe("drain lines are ranked by being drains, not by belt order", () => {
	test("a drain belt built before the normal belt still yields to it", () => {
		const g = new Graph();
		const miner = g.miner();
		const splitter = g.splitter();
		const overflow = g.sink(IRON_ORE, 200);
		const smelter = g.building("Recipe_IngotIron_C", 1); // 30

		g.belt(g.out(miner), splitter);
		const toDrain = g.belt(splitter, g.in(overflow), { drain: true });
		const toSmelter = g.belt(splitter, g.in(smelter));
		g.solve();

		expect.soft(flow(toSmelter), "the real consumer is still fed first").toBe(30);
		expect.soft(flow(toDrain), "the drain still only takes the remainder").toBe(30);
	});
});
