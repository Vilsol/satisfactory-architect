/**
 * Solving A·x = b, by elimination with partial pivoting.
 *
 * Small and dense is all this needs to be: the biggest system the recipe data can
 * throw at it is a few hundred rows, which is a fraction of a millisecond.
 *
 * Partial pivoting - taking the biggest remaining coefficient in the column as the
 * one to divide by - is what keeps a long chain of recipes from losing its accuracy
 * to a tiny pivot part way down.
 */

export type SolveResult =
	| { ok: true; x: number[] }
	/** No single answer: the rows either repeat each other or contradict each other. */
	| { ok: false; reason: "singular" };

/**
 * How small a pivot has to be, against the biggest number in the matrix, before it
 * counts as nothing at all. Relative rather than absolute, so a system written in
 * items per minute and one written in items per second are judged the same way.
 */
const pivotTolerance = 1e-12;

export function solveLinearSystem(a: readonly (readonly number[])[], b: readonly number[]): SolveResult {
	const size = a.length;
	if (b.length !== size) {
		throw new Error(`Right hand side has ${b.length} values for ${size} equations.`);
	}
	for (const row of a) {
		if (row.length !== size) {
			throw new Error(`Matrix is ${size} rows of which one has ${row.length} columns.`);
		}
	}
	if (size === 0) {
		return { ok: true, x: [] };
	}

	// Work on a copy - the caller's matrix is theirs.
	const m = a.map((row, i) => [...row, b[i]]);

	let largest = 0;
	for (const row of m) {
		for (const value of row) {
			largest = Math.max(largest, Math.abs(value));
		}
	}
	if (largest === 0) {
		return { ok: false, reason: "singular" };
	}
	const tolerance = largest * pivotTolerance;

	for (let column = 0; column < size; column++) {
		let best = column;
		for (let row = column + 1; row < size; row++) {
			if (Math.abs(m[row][column]) > Math.abs(m[best][column])) {
				best = row;
			}
		}
		if (Math.abs(m[best][column]) <= tolerance) {
			return { ok: false, reason: "singular" };
		}
		if (best !== column) {
			const swap = m[best];
			m[best] = m[column];
			m[column] = swap;
		}

		const pivot = m[column][column];
		for (let row = column + 1; row < size; row++) {
			const factor = m[row][column] / pivot;
			if (factor === 0) {
				continue;
			}
			for (let col = column; col <= size; col++) {
				m[row][col] -= factor * m[column][col];
			}
		}
	}

	const x = new Array<number>(size).fill(0);
	for (let row = size - 1; row >= 0; row--) {
		let sum = m[row][size];
		for (let col = row + 1; col < size; col++) {
			sum -= m[row][col] * x[col];
		}
		x[row] = sum / m[row][row];
	}
	return { ok: true, x };
}
