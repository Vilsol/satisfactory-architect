import { describe, expect, test } from "vitest";
import { solveLinearSystem } from "./linearSolve";

function solved(a: number[][], b: number[]): number[] {
	const result = solveLinearSystem(a, b);
	expect(result.ok, `expected a solution, got ${result.ok ? "" : result.reason}`).toBe(true);
	return (result as { ok: true; x: number[] }).x;
}

describe("solving a system", () => {
	test("the identity hands back what it was given", () => {
		expect(solved([[1, 0], [0, 1]], [4, 7])).toEqual([4, 7]);
	});

	test("a single equation divides", () => {
		expect(solved([[4]], [10])).toEqual([2.5]);
	});

	test("a worked three by three comes out right", () => {
		//  2x +  y -  z =   8
		// -3x -  y + 2z = -11
		// -2x +  y + 2z =  -3
		const x = solved([[2, 1, -1], [-3, -1, 2], [-2, 1, 2]], [8, -11, -3]);
		expect(x[0]).toBeCloseTo(2, 9);
		expect(x[1]).toBeCloseTo(3, 9);
		expect(x[2]).toBeCloseTo(-1, 9);
	});

	test("a zero in the first pivot is swapped past rather than dividing by it", () => {
		const x = solved([[0, 1], [1, 0]], [1, 2]);
		expect(x[0]).toBeCloseTo(2, 9);
		expect(x[1]).toBeCloseTo(1, 9);
	});

	test("negative answers are fine", () => {
		const x = solved([[1, 1], [1, -1]], [0, 4]);
		expect(x[0]).toBeCloseTo(2, 9);
		expect(x[1]).toBeCloseTo(-2, 9);
	});
});

describe("systems with no single answer", () => {
	test("two equations saying the same thing are refused", () => {
		expect(solveLinearSystem([[1, 2], [2, 4]], [1, 2])).toEqual({ ok: false, reason: "singular" });
	});

	test("two equations contradicting each other are refused too", () => {
		expect(solveLinearSystem([[1, 2], [2, 4]], [1, 3])).toEqual({ ok: false, reason: "singular" });
	});

	test("a row of nothing is refused", () => {
		expect(solveLinearSystem([[0, 0], [0, 1]], [0, 1])).toEqual({ ok: false, reason: "singular" });
	});

	test("an empty system solves to nothing at all", () => {
		expect(solved([], [])).toEqual([]);
	});
});

describe("guarding against being called wrongly", () => {
	test("a matrix that is not square is rejected", () => {
		expect(() => solveLinearSystem([[1, 2, 3], [4, 5, 6]], [1, 2])).toThrow();
	});

	test("a right hand side of the wrong length is rejected", () => {
		expect(() => solveLinearSystem([[1, 0], [0, 1]], [1])).toThrow();
	});
});

describe("standing up to awkward numbers", () => {
	test("very different magnitudes still come out", () => {
		// Without pivoting the first row would wipe out the second.
		const x = solved([[1e-14, 1], [1, 1]], [1, 2]);
		expect(x[0]).toBeCloseTo(1, 6);
		expect(x[1]).toBeCloseTo(1, 6);
	});

	test("a long chain of dependencies stays accurate", () => {
		// Each unknown is half the one before it, ending at 1024.
		const size = 40;
		const a: number[][] = Array.from({ length: size }, () => new Array(size).fill(0));
		const b = new Array(size).fill(0);
		for (let i = 0; i < size; i++) {
			a[i][i] = 1;
			if (i > 0) a[i][i - 1] = -0.5;
		}
		b[0] = 1024;
		const x = solved(a, b);
		expect(x[0]).toBeCloseTo(1024, 6);
		expect(x[size - 1]).toBeCloseTo(1024 * 0.5 ** (size - 1), 12);
	});
});
