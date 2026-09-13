import { describe, expect, test } from "vitest";
import { isThroughputBalanced, slackSeverity } from "./utilties";

describe("how strongly a problem is tinted", () => {
	test("a belt with nothing wrong is not tinted at all", () => {
		expect(slackSeverity(0, 100)).toBe(0);
		expect(slackSeverity(-5, 100)).toBe(0);
	});

	test("worse problems always look worse", () => {
		const flow = 100;
		const gaps = [1, 5, 10, 20, 50, 80, 150, 400, 5000];
		const severities = gaps.map(gap => slackSeverity(gap, flow));
		for (let i = 1; i < severities.length; i++) {
			expect(severities[i], `${gaps[i]} short must look worse than ${gaps[i - 1]} short`)
				.toBeGreaterThan(severities[i - 1]);
		}
	});

	test("it stays inside the usable range", () => {
		for (const [amount, reference] of [[1, 0], [1, 1e9], [1e9, 1], [0.001, 100], [1e6, 1e6]]) {
			const severity = slackSeverity(amount, reference);
			expect(severity).toBeGreaterThan(0);
			expect(severity).toBeLessThanOrEqual(1);
		}
	});

	test("even a tiny problem is visible", () => {
		expect(slackSeverity(1, 1000), "should not be so faint as to be invisible")
			.toBeGreaterThan(0.25);
	});

	test("only the ratio matters, not the units", () => {
		expect(slackSeverity(50, 100)).toBeCloseTo(slackSeverity(50_000, 100_000), 10);
	});

	test("a belt carrying nothing but wanted a lot is at full strength", () => {
		expect(slackSeverity(100, 0)).toBe(1);
	});
});

describe("deciding whether two rates agree", () => {
	test("identical rates agree", () => {
		expect(isThroughputBalanced(60, 60)).toBe(true);
		expect(isThroughputBalanced(0, 0)).toBe(true);
	});

	test("floating point noise still counts as agreement", () => {
		expect(isThroughputBalanced(60, 60 + 1e-12)).toBe(true);
		expect(isThroughputBalanced(0.1 + 0.2, 0.3)).toBe(true);
	});

	test("a genuinely small gap still counts as a gap", () => {
		expect(isThroughputBalanced(60, 56)).toBe(false);
		expect(isThroughputBalanced(60, 59.9)).toBe(false);
	});

	test("large gaps still disagree", () => {
		expect(isThroughputBalanced(60, 120)).toBe(false);
		expect(isThroughputBalanced(60, 0)).toBe(false);
	});
});
