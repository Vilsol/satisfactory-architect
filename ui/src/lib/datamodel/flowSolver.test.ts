import { describe, expect, test } from "vitest";
import { solveFlow, type FlowEdgeSpec, type FlowNodeSpec } from "./flowSolver";

/*
 * The solver knows nothing about Satisfactory - it just moves numbers along a
 * graph. These cases are the same factories used in throughputsCalculator.test.ts,
 * stripped down to producers, consumers and belts.
 */

function solve(nodes: FlowNodeSpec[], edges: FlowEdgeSpec[]) {
	const result = solveFlow(nodes, edges);
	return {
		flow: Object.fromEntries(result.edgeFlow),
		surplus: Object.fromEntries(result.surplus),
		shortfall: Object.fromEntries(result.shortfall),
		total: result.totalFlow,
	};
}

describe("straight runs", () => {
	test("producer exactly feeds consumer", () => {
		const r = solve(
			[{ id: "p", supply: 60 }, { id: "c", demand: 60 }],
			[{ id: "belt", from: "p", to: "c" }],
		);
		expect(r.flow).toEqual({ belt: 60 });
		expect(r.surplus).toEqual({ p: 0 });
		expect(r.shortfall).toEqual({ c: 0 });
	});

	test("producer makes more than the consumer wants", () => {
		const r = solve(
			[{ id: "p", supply: 60 }, { id: "c", demand: 30 }],
			[{ id: "belt", from: "p", to: "c" }],
		);
		expect(r.flow).toEqual({ belt: 30 });
		expect(r.surplus).toEqual({ p: 30 });
		expect(r.shortfall).toEqual({ c: 0 });
	});

	test("consumer wants more than the producer makes", () => {
		const r = solve(
			[{ id: "p", supply: 60 }, { id: "c", demand: 120 }],
			[{ id: "belt", from: "p", to: "c" }],
		);
		expect(r.flow).toEqual({ belt: 60 });
		expect(r.surplus).toEqual({ p: 0 });
		expect(r.shortfall).toEqual({ c: 60 });
	});

	test("a pass-through node in the middle changes nothing", () => {
		const r = solve(
			[{ id: "p", supply: 60 }, { id: "s" }, { id: "c", demand: 60 }],
			[{ id: "in", from: "p", to: "s" }, { id: "out", from: "s", to: "c" }],
		);
		expect(r.flow).toEqual({ in: 60, out: 60 });
	});
});

describe("splitting", () => {
	test("two equal consumers", () => {
		const r = solve(
			[{ id: "p", supply: 60 }, { id: "s" }, { id: "a", demand: 30 }, { id: "b", demand: 30 }],
			[
				{ id: "trunk", from: "p", to: "s" },
				{ id: "toA", from: "s", to: "a" },
				{ id: "toB", from: "s", to: "b" },
			],
		);
		expect(r.flow).toEqual({ trunk: 60, toA: 30, toB: 30 });
	});

	test("two unequal consumers", () => {
		const r = solve(
			[{ id: "p", supply: 60 }, { id: "s" }, { id: "a", demand: 45 }, { id: "b", demand: 15 }],
			[
				{ id: "trunk", from: "p", to: "s" },
				{ id: "toA", from: "s", to: "a" },
				{ id: "toB", from: "s", to: "b" },
			],
		);
		expect(r.flow).toEqual({ trunk: 60, toA: 45, toB: 15 });
	});

	test("a diamond splits evenly, which is the whole point of the tie-break", () => {
		// Both legs rejoin, so any split summing to 60 moves the same total.
		// Only the smallest sum of squares picks one, and it picks 30/30.
		const r = solve(
			[{ id: "p", supply: 60 }, { id: "s" }, { id: "m" }, { id: "c", demand: 60 }],
			[
				{ id: "in", from: "p", to: "s" },
				{ id: "left", from: "s", to: "m" },
				{ id: "right", from: "s", to: "m" },
				{ id: "out", from: "m", to: "c" },
			],
		);
		expect(r.flow).toEqual({ in: 60, left: 30, right: 30, out: 60 });
	});
});

describe("contention", () => {
	test("two producers sharing one consumer are used equally", () => {
		const r = solve(
			[{ id: "p1", supply: 60 }, { id: "p2", supply: 60 }, { id: "c", demand: 60 }],
			[{ id: "one", from: "p1", to: "c" }, { id: "two", from: "p2", to: "c" }],
		);
		expect(r.flow).toEqual({ one: 30, two: 30 });
		expect(r.surplus).toEqual({ p1: 30, p2: 30 });
	});

	test("one supply direct, one through a splitter", () => {
		// m1 reaches only A, so A must take all 60 from it; the splitter covers B's
		// 40 and tops A up with the remaining 20.
		const r = solve(
			[
				{ id: "m1", supply: 60 }, { id: "m2", supply: 60 }, { id: "sp" },
				{ id: "a", demand: 80 }, { id: "b", demand: 40 },
			],
			[
				{ id: "direct", from: "m1", to: "a" },
				{ id: "trunk", from: "m2", to: "sp" },
				{ id: "toA", from: "sp", to: "a" },
				{ id: "toB", from: "sp", to: "b" },
			],
		);
		expect(r.flow).toEqual({ direct: 60, trunk: 60, toA: 20, toB: 40 });
		expect(r.shortfall).toEqual({ a: 0, b: 0 });
	});

	test("one shared producer, no splitter anywhere", () => {
		const r = solve(
			[
				{ id: "a", supply: 60 }, { id: "b", supply: 60 },
				{ id: "x", demand: 90 }, { id: "y", demand: 30 },
			],
			[
				{ id: "aToX", from: "a", to: "x" },
				{ id: "bToX", from: "b", to: "x" },
				{ id: "bToY", from: "b", to: "y" },
			],
		);
		expect(r.flow).toEqual({ aToX: 60, bToX: 30, bToY: 30 });
	});

	test("three producers, one of them shared", () => {
		const r = solve(
			[
				{ id: "a", supply: 60 }, { id: "b", supply: 60 }, { id: "c", supply: 30 },
				{ id: "x", demand: 135 }, { id: "y", demand: 15 },
			],
			[
				{ id: "aToX", from: "a", to: "x" },
				{ id: "bToX", from: "b", to: "x" },
				{ id: "cToX", from: "c", to: "x" },
				{ id: "cToY", from: "c", to: "y" },
			],
		);
		expect(r.flow).toEqual({ aToX: 60, bToX: 60, cToX: 15, cToY: 15 });
	});
});

describe("shortages are reported where they are, not dumped on one belt", () => {
	test("four producers short of two consumers", () => {
		// 60 + 60 + 60 + 30 = 210 available, 240 wanted. No belt may carry more than
		// the producer behind it makes, and the 30 shortfall is shared by the consumers.
		const r = solve(
			[
				{ id: "m1", supply: 60 }, { id: "m2", supply: 60 },
				{ id: "m3", supply: 60 }, { id: "m4", supply: 30 },
				{ id: "s" }, { id: "a", demand: 120 }, { id: "b", demand: 120 },
			],
			[
				{ id: "f1", from: "m1", to: "s" }, { id: "f2", from: "m2", to: "s" },
				{ id: "f3", from: "m3", to: "s" }, { id: "f4", from: "m4", to: "s" },
				{ id: "toA", from: "s", to: "a" }, { id: "toB", from: "s", to: "b" },
			],
		);
		expect(r.total).toBe(210);
		expect(r.flow.f1).toBe(60);
		expect(r.flow.f2).toBe(60);
		expect(r.flow.f3).toBe(60);
		expect(r.flow.f4).toBe(30);
		expect(r.flow.toA).toBe(105);
		expect(r.flow.toB).toBe(105);
		expect(r.shortfall).toEqual({ a: 15, b: 15 });
		expect(r.surplus).toEqual({ m1: 0, m2: 0, m3: 0, m4: 0 });
	});
});

describe("overflow belts", () => {
	test("an ordinary belt is filled before an overflow belt", () => {
		// 60 available. The real consumer wants 50, the dump will take anything.
		// Both splits move the same total, so only the overflow ranking decides it.
		const r = solve(
			[{ id: "p", supply: 60 }, { id: "s" }, { id: "c", demand: 50 }, { id: "dump", demand: 200 }],
			[
				{ id: "trunk", from: "p", to: "s" },
				{ id: "toC", from: "s", to: "c" },
				{ id: "toDump", from: "s", to: "dump", isDrain: true },
			],
		);
		expect(r.flow).toEqual({ trunk: 60, toC: 50, toDump: 10 });
	});

	test("an overflow belt gets nothing when supply is tight", () => {
		const r = solve(
			[{ id: "p", supply: 30 }, { id: "s" }, { id: "c", demand: 30 }, { id: "dump", demand: 200 }],
			[
				{ id: "trunk", from: "p", to: "s" },
				{ id: "toC", from: "s", to: "c" },
				{ id: "toDump", from: "s", to: "dump", isDrain: true },
			],
		);
		expect(r.flow).toEqual({ trunk: 30, toC: 30, toDump: 0 });
	});
});

describe("awkward shapes", () => {
	test("a loop between two pass-through nodes carries nothing round it", () => {
		const r = solve(
			[{ id: "p", supply: 60 }, { id: "a" }, { id: "b" }, { id: "c", demand: 60 }],
			[
				{ id: "feed", from: "p", to: "a" },
				{ id: "aToB", from: "a", to: "b" },
				{ id: "bToA", from: "b", to: "a" },
				{ id: "out", from: "b", to: "c" },
			],
		);
		expect(r.flow).toEqual({ feed: 60, aToB: 60, bToA: 0, out: 60 });
	});

	test("a consumer with no route to any producer gets nothing", () => {
		const r = solve(
			[{ id: "p", supply: 60 }, { id: "c", demand: 60 }, { id: "orphan", demand: 40 }],
			[{ id: "belt", from: "p", to: "c" }],
		);
		expect(r.flow).toEqual({ belt: 60 });
		expect(r.shortfall).toEqual({ c: 0, orphan: 40 });
	});

	test("a belt pointing at a node that does not exist is ignored", () => {
		const r = solve(
			[{ id: "p", supply: 60 }, { id: "c", demand: 60 }],
			[{ id: "belt", from: "p", to: "c" }, { id: "ghost", from: "p", to: "nowhere" }],
		);
		expect(r.flow).toEqual({ belt: 60, ghost: 0 });
	});

	test("an empty factory solves to nothing", () => {
		const r = solve([], []);
		expect(r.total).toBe(0);
		expect(r.flow).toEqual({});
	});

	test("a producer with nothing attached", () => {
		const r = solve([{ id: "p", supply: 60 }], []);
		expect(r.total).toBe(0);
		expect(r.surplus).toEqual({ p: 60 });
	});

	test("fractional rates survive", () => {
		const r = solve(
			[{ id: "p", supply: 2.8125 }, { id: "c", demand: 1.5 }],
			[{ id: "belt", from: "p", to: "c" }],
		);
		expect(r.flow).toEqual({ belt: 1.5 });
		expect(r.surplus).toEqual({ p: 1.3125 });
	});
});

describe("the answer does not depend on the order things were listed", () => {
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

	test("nodes reversed", () => {
		expect(solve([...nodes].reverse(), edges).flow).toEqual(solve(nodes, edges).flow);
	});

	test("belts reversed", () => {
		expect(solve(nodes, [...edges].reverse()).flow).toEqual(solve(nodes, edges).flow);
	});
});
