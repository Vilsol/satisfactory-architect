import { describe, expect, test } from "vitest";
import { iconLayers } from "./iconLayers";

/*
 * An icon is drawn as up to two pictures: a tiny blurred stand-in, and the real thing
 * over the top once it has loaded. Small icons skip the real thing entirely and live on
 * the stand-in.
 *
 * The one rule that matters: whatever the combination, SOMETHING has to be drawn. An
 * icon that decides to draw neither is an icon that is not there.
 */

const combinations = [
	{ quality: "max" as const, hasStandIn: true },
	{ quality: "max" as const, hasStandIn: false },
	{ quality: "min" as const, hasStandIn: true },
	{ quality: "min" as const, hasStandIn: false },
];

describe("what an icon draws", () => {
	test("something is always drawn, whatever the situation", () => {
		for (const combination of combinations) {
			for (const realHasLoaded of [false, true]) {
				const { showStandIn, showReal } = iconLayers({ ...combination, realHasLoaded });
				expect(showStandIn || showReal, JSON.stringify({ ...combination, realHasLoaded }))
					.toBe(true);
			}
		}
	});

	test("a full size icon shows the stand-in until the real one arrives", () => {
		expect(iconLayers({ quality: "max", hasStandIn: true, realHasLoaded: false }))
			.toEqual({ showStandIn: true, showReal: true });
		expect(iconLayers({ quality: "max", hasStandIn: true, realHasLoaded: true }))
			.toEqual({ showStandIn: false, showReal: true });
	});

	test("with no stand-in it just shows the real one", () => {
		expect(iconLayers({ quality: "max", hasStandIn: false, realHasLoaded: false }))
			.toEqual({ showStandIn: false, showReal: true });
	});

	test("a small icon lives on the stand-in and never fetches the real one", () => {
		expect(iconLayers({ quality: "min", hasStandIn: true, realHasLoaded: false }))
			.toEqual({ showStandIn: true, showReal: false });
	});

	test("a small icon with no stand-in falls back to the real one", () => {
		// Stand-ins are fetched separately, so early on there may not be one yet.
		expect(iconLayers({ quality: "min", hasStandIn: false, realHasLoaded: false }))
			.toEqual({ showStandIn: false, showReal: true });
	});

	test("a small icon does not go blank when its stand-in turns up late", () => {
		// The one that broke the page tabs: the real icon had already loaded and was
		// then dropped in favour of a stand-in that was never switched on, leaving
		// nothing at all.
		expect(iconLayers({ quality: "min", hasStandIn: true, realHasLoaded: true }))
			.toEqual({ showStandIn: true, showReal: false });
	});
});
