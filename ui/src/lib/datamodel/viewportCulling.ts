/**
 * Deciding what is worth drawing.
 *
 * A page holds everything in the factory, but only what is on screen has to exist as
 * components in the document. Building one costs about a quarter of a millisecond, so on
 * a page with hundreds of them the ones nobody can see are most of the time it takes to
 * open.
 *
 * One rule runs through all of this: drawing something that turns out to be off screen
 * only wastes a little work, but failing to draw something that is on screen is a bug
 * somebody sees. Every bound here is therefore drawn generously.
 */

import type { IVector2D } from "./GraphView.svelte";

export interface Rect {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/** Whatever is drawn is at least this big, so nothing is culled for measuring as a dot. */
const MINIMUM_EXTENT = 40;

/**
 * The part of the page on screen, in page coordinates.
 *
 * `margin` reaches beyond the screen so that things are already there by the time they
 * are scrolled into view rather than appearing as you arrive at them.
 */
export function visibleRect(
	offset: IVector2D,
	scale: number,
	screenWidth: number,
	screenHeight: number,
	margin: number,
): Rect {
	// A scale of zero or worse would put the whole page at one point. Drawing everything
	// is the safe way to be wrong.
	if (!Number.isFinite(scale) || scale <= 0) {
		return { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
	}
	return {
		left: (0 - offset.x) / scale - margin,
		top: (0 - offset.y) / scale - margin,
		right: (screenWidth - offset.x) / scale + margin,
		bottom: (screenHeight - offset.y) / scale + margin,
	};
}

/** Whether two boxes touch at all. Sharing an edge counts. */
export function overlaps(a: Rect, b: Rect): boolean {
	return a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom;
}

/** The box around something drawn at a point with a size. */
export function nodeRect(centre: IVector2D, size: IVector2D): Rect {
	const halfWidth = Math.max(Math.abs(size.x) / 2, MINIMUM_EXTENT);
	const halfHeight = Math.max(Math.abs(size.y) / 2, MINIMUM_EXTENT);
	return {
		left: centre.x - halfWidth,
		top: centre.y - halfHeight,
		right: centre.x + halfWidth,
		bottom: centre.y + halfHeight,
	};
}

/**
 * The box around a belt.
 *
 * A belt is not a straight line between its ends: it curves, it can be routed round
 * corners, and its straight form can be nudged sideways. Rather than work out each of
 * those, the box around the two ends is padded by a share of its own size, which covers
 * all of them and keeps long belts across the screen from being culled.
 */
export function edgeRect(start: IVector2D, end: IVector2D): Rect {
	const left = Math.min(start.x, end.x);
	const right = Math.max(start.x, end.x);
	const top = Math.min(start.y, end.y);
	const bottom = Math.max(start.y, end.y);
	const padding = Math.max((right - left + bottom - top) / 4, MINIMUM_EXTENT);
	return {
		left: left - padding,
		top: top - padding,
		right: right + padding,
		bottom: bottom + padding,
	};
}

/**
 * Round a rectangle outwards to a grid.
 *
 * Without this the set of things being drawn changes on every single frame of a pan, and
 * building and tearing down a handful of buildings every frame costs more than it saves.
 * Rounded out, the set only changes once the view has actually moved a step, so panning
 * is mostly free and the work arrives in occasional chunks instead.
 */
export function snapOutwards(rect: Rect, step: number): Rect {
	if (!Number.isFinite(step) || step <= 0) {
		return rect;
	}
	return {
		left: Math.floor(rect.left / step) * step,
		top: Math.floor(rect.top / step) * step,
		right: Math.ceil(rect.right / step) * step,
		bottom: Math.ceil(rect.bottom / step) * step,
	};
}

/**
 * How much of the margin is kept on each pass while a page is first drawn.
 *
 * Opening a page builds everything on screen and everything in the margin around it, and
 * the margin is about half of that. Since the margin is off screen by definition, it can
 * be filled in over the next few passes without anybody seeing it happen - what shows up
 * in the first frame is the same either way, it just arrives about twice as soon.
 *
 * A handful of passes rather than one, so the rest arrives as a few small pieces instead
 * of one lump large enough to drop a frame.
 */
export const WARMUP_FRACTIONS: readonly number[] = [0, 0.35, 0.7, 1];

export function warmupMargin(fullMargin: number, step: number): number {
	const clamped = Math.min(Math.max(step, 0), WARMUP_FRACTIONS.length - 1);
	return fullMargin * WARMUP_FRACTIONS[clamped];
}
