import { describe, expect, test } from "vitest";
import { measureTextWidth } from "./textWidth";

/*
 * These run with no document at all, which is the prerender's situation. Measuring has
 * to give a usable answer there rather than throwing, because the component that asks is
 * rendered on the server before it is ever rendered in a browser.
 */

describe("measuring text where there is no browser", () => {
	test("an answer comes back rather than an error", () => {
		expect(() => measureTextWidth("Belt Mk.3", 9, 500)).not.toThrow();
	});

	test("nothing is no width", () => {
		expect(measureTextWidth("", 9, 500)).toBe(0);
	});

	test("longer text is wider", () => {
		expect(measureTextWidth("1234567890", 9, 500))
			.toBeGreaterThan(measureTextWidth("12", 9, 500));
	});

	test("bigger text is wider", () => {
		expect(measureTextWidth("60", 18, 500)).toBeGreaterThan(measureTextWidth("60", 9, 500));
	});

	test("the same text measures the same every time", () => {
		// Labels repeat heavily, which is why the answers are kept.
		const first = measureTextWidth("Belt Mk.3", 9, 400);
		for (let i = 0; i < 5; i++) {
			expect(measureTextWidth("Belt Mk.3", 9, 400)).toBe(first);
		}
	});

	test("size and weight are part of what is remembered", () => {
		// Otherwise the first label drawn would fix the width for every other size.
		expect(measureTextWidth("60", 9, 400)).not.toBe(measureTextWidth("60", 20, 400));
	});
});
