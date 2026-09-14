import { describe, expect, test } from "vitest";
import { edgeRect, nodeRect, overlaps, snapOutwards, visibleRect, warmupMargin, WARMUP_FRACTIONS, type Rect } from "./viewportCulling";

/*
 * Deciding what is worth drawing. Only what is on screen needs to exist, which is what
 * keeps a big factory from costing a big factory's worth of work to open.
 *
 * The one rule that matters: drawing something that turns out to be off screen is
 * wasteful, but NOT drawing something that is on screen is a bug. Everything here is
 * written to be generous in that direction.
 */

const screen = { width: 1000, height: 800 };

describe("working out what part of the page is on screen", () => {
	test("with no panning or zooming it is the screen itself", () => {
		expect(visibleRect({ x: 0, y: 0 }, 1, screen.width, screen.height, 0))
			.toEqual({ left: 0, top: 0, right: 1000, bottom: 800 });
	});

	test("panning right shows the part of the page to the left", () => {
		// The page is pushed right by 200, so the left edge of the screen is at -200.
		expect(visibleRect({ x: 200, y: 0 }, 1, screen.width, screen.height, 0).left).toBe(-200);
	});

	test("zooming out shows more of the page", () => {
		const zoomedOut = visibleRect({ x: 0, y: 0 }, 0.5, screen.width, screen.height, 0);
		const normal = visibleRect({ x: 0, y: 0 }, 1, screen.width, screen.height, 0);
		expect(zoomedOut.right - zoomedOut.left).toBeGreaterThan(normal.right - normal.left);
		expect(zoomedOut.right).toBe(2000);
	});

	test("zooming in shows less", () => {
		expect(visibleRect({ x: 0, y: 0 }, 2, screen.width, screen.height, 0).right).toBe(500);
	});

	test("the margin reaches beyond the screen on every side", () => {
		const r = visibleRect({ x: 0, y: 0 }, 1, screen.width, screen.height, 300);
		expect(r).toEqual({ left: -300, top: -300, right: 1300, bottom: 1100 });
	});

	test("a silly scale does not produce a rectangle that contains nothing", () => {
		// Better to draw the whole factory than to draw none of it.
		for (const scale of [0, -1, NaN, Infinity]) {
			const r = visibleRect({ x: 0, y: 0 }, scale, screen.width, screen.height, 0);
			expect(overlaps(r, { left: -1e6, top: -1e6, right: 1e6, bottom: 1e6 }), `scale ${scale}`).toBe(true);
		}
	});
});

describe("whether two boxes touch", () => {
	const middle: Rect = { left: 0, top: 0, right: 100, bottom: 100 };

	test("one inside the other", () => {
		expect(overlaps(middle, { left: 10, top: 10, right: 20, bottom: 20 })).toBe(true);
	});

	test("overlapping corners", () => {
		expect(overlaps(middle, { left: 90, top: 90, right: 200, bottom: 200 })).toBe(true);
	});

	test("clear of each other", () => {
		expect(overlaps(middle, { left: 200, top: 0, right: 300, bottom: 100 })).toBe(false);
		expect(overlaps(middle, { left: 0, top: -300, right: 100, bottom: -200 })).toBe(false);
	});

	test("just touching counts as touching", () => {
		expect(overlaps(middle, { left: 100, top: 0, right: 200, bottom: 100 })).toBe(true);
	});

	test("it does not matter which way round they are given", () => {
		const other = { left: 50, top: 50, right: 150, bottom: 150 };
		expect(overlaps(middle, other)).toBe(overlaps(other, middle));
	});
});

describe("the box around a building", () => {
	test("is its size, centred on where it is", () => {
		expect(nodeRect({ x: 100, y: 200 }, { x: 100, y: 250 }))
			.toEqual({ left: 50, top: 75, right: 150, bottom: 325 });
	});

	test("something with no size still has a box worth testing", () => {
		// Joints record no size until they have been drawn once.
		const r = nodeRect({ x: 10, y: 10 }, { x: 0, y: 0 });
		expect(r.right).toBeGreaterThan(r.left);
		expect(r.bottom).toBeGreaterThan(r.top);
	});
});

describe("the box around a belt", () => {
	test("covers both of its ends", () => {
		const r = edgeRect({ x: 0, y: 0 }, { x: 300, y: 400 });
		expect(r.left).toBeLessThanOrEqual(0);
		expect(r.top).toBeLessThanOrEqual(0);
		expect(r.right).toBeGreaterThanOrEqual(300);
		expect(r.bottom).toBeGreaterThanOrEqual(400);
	});

	test("allows for the curve bulging out past its ends", () => {
		const r = edgeRect({ x: 0, y: 0 }, { x: 400, y: 0 });
		expect(r.top, "a curve between two points on a line still leaves the line").toBeLessThan(0);
		expect(r.bottom).toBeGreaterThan(0);
	});

	test("ends given the other way round give the same box", () => {
		expect(edgeRect({ x: 300, y: 400 }, { x: 0, y: 0 })).toEqual(edgeRect({ x: 0, y: 0 }, { x: 300, y: 400 }));
	});

	test("a belt crossing the screen with both ends off it is still drawn", () => {
		// The thing culling is most likely to get wrong.
		const view = visibleRect({ x: 0, y: 0 }, 1, 1000, 800, 0);
		const acrossHorizontally = edgeRect({ x: -5000, y: 400 }, { x: 5000, y: 400 });
		const acrossVertically = edgeRect({ x: 500, y: -5000 }, { x: 500, y: 5000 });
		expect(overlaps(view, acrossHorizontally)).toBe(true);
		expect(overlaps(view, acrossVertically)).toBe(true);
	});

	test("a belt nowhere near the screen is not drawn", () => {
		const view = visibleRect({ x: 0, y: 0 }, 1, 1000, 800, 0);
		expect(overlaps(view, edgeRect({ x: 9000, y: 9000 }, { x: 9500, y: 9500 }))).toBe(false);
	});
});

describe("what a screenful actually saves", () => {
	test("a building just off the edge is still drawn, thanks to the margin", () => {
		const view = visibleRect({ x: 0, y: 0 }, 1, 1000, 800, 400);
		expect(overlaps(view, nodeRect({ x: 1200, y: 400 }, { x: 100, y: 100 }))).toBe(true);
	});

	test("a building far away is left out", () => {
		const view = visibleRect({ x: 0, y: 0 }, 1, 1000, 800, 400);
		expect(overlaps(view, nodeRect({ x: 5000, y: 400 }, { x: 100, y: 100 }))).toBe(false);
	});

	test("zoomed far out, everything is on screen and nothing is left out", () => {
		const view = visibleRect({ x: 0, y: 0 }, 0.05, 1000, 800, 0);
		expect(overlaps(view, nodeRect({ x: 9000, y: 9000 }, { x: 100, y: 100 }))).toBe(true);
	});
});

describe("rounding the visible area to a step", () => {
	test("it only ever grows, never shrinks", () => {
		const r = { left: 130, top: 270, right: 410, bottom: 690 };
		const snapped = snapOutwards(r, 100);
		expect(snapped.left).toBeLessThanOrEqual(r.left);
		expect(snapped.top).toBeLessThanOrEqual(r.top);
		expect(snapped.right).toBeGreaterThanOrEqual(r.right);
		expect(snapped.bottom).toBeGreaterThanOrEqual(r.bottom);
	});

	test("small movements give the same rectangle, which is the whole point", () => {
		const a = snapOutwards({ left: 10, top: 10, right: 510, bottom: 510 }, 400);
		const b = snapOutwards({ left: 30, top: 30, right: 530, bottom: 530 }, 400);
		expect(a).toEqual(b);
	});

	test("moving a whole step does change it", () => {
		const a = snapOutwards({ left: 0, top: 0, right: 500, bottom: 500 }, 400);
		const b = snapOutwards({ left: 400, top: 0, right: 900, bottom: 500 }, 400);
		expect(a).not.toEqual(b);
	});

	test("negative coordinates round outwards too", () => {
		expect(snapOutwards({ left: -130, top: -130, right: -30, bottom: -30 }, 100))
			.toEqual({ left: -200, top: -200, right: -0, bottom: -0 });
	});

	test("a nonsense step leaves the rectangle alone", () => {
		const r = { left: 1, top: 2, right: 3, bottom: 4 };
		expect(snapOutwards(r, 0)).toEqual(r);
		expect(snapOutwards(r, NaN)).toEqual(r);
	});

	test("an unbounded view stays unbounded", () => {
		const all = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
		expect(snapOutwards(all, 400)).toEqual(all);
	});
});

describe("filling in the margin after the first frame", () => {
	/*
	 * The margin is off screen by definition, so it can be filled in a moment later
	 * without anybody seeing it happen. What must be right is that the first frame
	 * covers the screen itself, and that it ends up at the full margin.
	 */
	const full = 1000;

	test("the first pass keeps nothing beyond the screen", () => {
		expect(warmupMargin(full, 0)).toBe(0);
	});

	test("the last pass keeps all of it", () => {
		expect(warmupMargin(full, WARMUP_FRACTIONS.length - 1)).toBe(full);
	});

	test("it only ever grows", () => {
		let previous = -1;
		for (let step = 0; step < WARMUP_FRACTIONS.length; step++) {
			const margin = warmupMargin(full, step);
			expect(margin).toBeGreaterThan(previous);
			previous = margin;
		}
	});

	test("it never reaches past the margin it is filling towards", () => {
		for (let step = -2; step < WARMUP_FRACTIONS.length + 5; step++) {
			expect(warmupMargin(full, step)).toBeLessThanOrEqual(full);
			expect(warmupMargin(full, step)).toBeGreaterThanOrEqual(0);
		}
	});

	test("asking past the end just gives the full margin", () => {
		// Whatever schedules the passes must not be able to leave it short.
		expect(warmupMargin(full, 99)).toBe(full);
		expect(warmupMargin(full, -1)).toBe(0);
	});

	test("it gets there in a few passes, not dozens", () => {
		// Each pass costs a frame; this is meant to spread one lump over a few, not to
		// dribble the page in.
		expect(WARMUP_FRACTIONS.length).toBeGreaterThanOrEqual(2);
		expect(WARMUP_FRACTIONS.length).toBeLessThanOrEqual(6);
	});
});
