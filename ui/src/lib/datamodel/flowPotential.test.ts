import { describe, expect, test } from "vitest";
import { solveFlow, type FlowEdgeSpec, type FlowNodeSpec } from "./flowSolver";

/*
 * Besides what actually flows, each end of a belt needs to know what the OTHER side
 * could manage, so the tool can offer "you are being given 60, take all of it" as
 * well as "only 30 is wanted, make 30".
 *
 *  - potentialInflow:  what a consumer would receive if it asked for as much as it liked
 *  - potentialOutflow: what a producer would ship if it could make as much as it liked
 *
 * Only the one node is imagined to be unlimited. Everything else stays as it is, so
 * the answer accounts for whatever else is competing for the same material.
 */

function solve(nodes: FlowNodeSpec[], edges: FlowEdgeSpec[]) {
	const r = solveFlow(nodes, edges);
	return {
		flow: Object.fromEntries(r.edgeFlow),
		couldTake: Object.fromEntries(r.potentialInflow),
		couldShip: Object.fromEntries(r.potentialOutflow),
	};
}

describe("over-supplied: the consumer should be told it could take more", () => {
	test("a 60/min miner feeding a smelter that only wants 30", () => {
		const r = solve(
			[{ id: "miner", supply: 60 }, { id: "smelter", demand: 30 }],
			[{ id: "belt", from: "miner", to: "smelter" }],
		);
		expect(r.flow.belt).toBe(30);
		expect(r.couldTake.smelter, "the smelter could have all 60").toBe(60);
		expect(r.couldShip.miner, "but only 30 is wanted from the miner").toBe(30);
	});
});

describe("under-supplied: the producer should be told more is wanted", () => {
	test("a 60/min miner feeding a smelter that wants 120", () => {
		const r = solve(
			[{ id: "miner", supply: 60 }, { id: "smelter", demand: 120 }],
			[{ id: "belt", from: "miner", to: "smelter" }],
		);
		expect(r.flow.belt).toBe(60);
		expect(r.couldShip.miner, "120 is wanted downstream").toBe(120);
		expect(r.couldTake.smelter, "but only 60 exists upstream").toBe(60);
	});
});

describe("balanced factories suggest nothing new", () => {
	test("supply and demand already agree", () => {
		const r = solve(
			[{ id: "miner", supply: 60 }, { id: "smelter", demand: 60 }],
			[{ id: "belt", from: "miner", to: "smelter" }],
		);
		expect(r.couldTake.smelter).toBe(60);
		expect(r.couldShip.miner).toBe(60);
	});
});

describe("it accounts for whatever else is competing", () => {
	test("a consumer cannot claim material another consumer is already using", () => {
		// One 60/min miner feeding two smelters that want 20 each. Either smelter could
		// grow, but only into the 20 going spare - not into the other one's share.
		const r = solve(
			[
				{ id: "miner", supply: 60 }, { id: "split" },
				{ id: "a", demand: 20 }, { id: "b", demand: 20 },
			],
			[
				{ id: "trunk", from: "miner", to: "split" },
				{ id: "toA", from: "split", to: "a" },
				{ id: "toB", from: "split", to: "b" },
			],
		);
		expect(r.flow.toA).toBe(20);
		expect(r.couldTake.a, "20 already taken plus the 20 spare").toBe(40);
		expect(r.couldTake.b).toBe(40);
	});

	test("a producer cannot claim demand another producer is already meeting", () => {
		const r = solve(
			[
				{ id: "p1", supply: 20 }, { id: "p2", supply: 20 },
				{ id: "merge" }, { id: "c", demand: 60 },
			],
			[
				{ id: "from1", from: "p1", to: "merge" },
				{ id: "from2", from: "p2", to: "merge" },
				{ id: "trunk", from: "merge", to: "c" },
			],
		);
		expect(r.flow.trunk).toBe(40);
		expect(r.couldShip.p1, "its own 20 plus the 20 still unmet").toBe(40);
		expect(r.couldShip.p2).toBe(40);
	});

	test("a consumer with an exclusive supplier sees only that supplier's spare", () => {
		// exclusive feeds only A; shared feeds both. A wants 10, B wants 10.
		const r = solve(
			[
				{ id: "exclusive", supply: 50 }, { id: "shared", supply: 50 },
				{ id: "a", demand: 10 }, { id: "b", demand: 10 },
			],
			[
				{ id: "exToA", from: "exclusive", to: "a" },
				{ id: "shToA", from: "shared", to: "a" },
				{ id: "shToB", from: "shared", to: "b" },
			],
		);
		expect(r.couldTake.a, "both suppliers can reach A, so all 100 minus B's 10").toBe(90);
		expect(r.couldTake.b, "only the shared supplier reaches B").toBe(50);
	});
});

describe("awkward cases", () => {
	test("a consumer with nothing connected could take nothing", () => {
		const r = solve(
			[{ id: "miner", supply: 60 }, { id: "orphan", demand: 30 }],
			[],
		);
		expect(r.couldTake.orphan).toBe(0);
		expect(r.couldShip.miner).toBe(0);
	});

	test("a pass-through node is neither a producer nor a consumer", () => {
		const r = solve(
			[{ id: "p", supply: 60 }, { id: "s" }, { id: "c", demand: 60 }],
			[{ id: "in", from: "p", to: "s" }, { id: "out", from: "s", to: "c" }],
		);
		expect(r.couldTake.s).toBeUndefined();
		expect(r.couldShip.s).toBeUndefined();
	});

	test("working out the potentials does not disturb the answer", () => {
		const nodes: FlowNodeSpec[] = [
			{ id: "m1", supply: 60 }, { id: "m2", supply: 60 }, { id: "sp" },
			{ id: "a", demand: 80 }, { id: "b", demand: 40 },
		];
		const edges: FlowEdgeSpec[] = [
			{ id: "direct", from: "m1", to: "a" },
			{ id: "trunk", from: "m2", to: "sp" },
			{ id: "toA", from: "sp", to: "a" },
			{ id: "toB", from: "sp", to: "b" },
		];
		const r = solve(nodes, edges);
		expect(r.flow, "the mixed direct and split supply still solves correctly")
			.toEqual({ direct: 60, trunk: 60, toA: 20, toB: 40 });
	});
});
