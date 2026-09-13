/**
 * Where a production building's ports sit, and what happens to them when it is turned.
 *
 * A building can be turned in quarter turns. The box itself stays upright - the icon and
 * the rate stay the right way up and readable - but it changes shape and its ports move
 * to the sides they would be on if you had physically turned the thing.
 *
 * Everything here is worked out in the building's own frame: the ports are laid out as
 * though upright, and then that whole picture is turned. Doing it that way means the
 * ports keep their order relative to each other for free, which is what makes turning a
 * building read as turning rather than as the ports rearranging themselves.
 *
 * Screen coordinates have y pointing down, so a quarter turn clockwise on screen sends
 * (x, y) to (-y, x).
 */

import { ceilToNearest, floorToNearest } from "$lib/utilties";
import { gridSize, productionNodeHorizontalPadding, productionNodeIconSize, productionNodeVerticalPadding } from "./constants";
import type { IVector2D } from "./GraphView.svelte";
import type { LayoutOrientation } from "./GraphNode.svelte";

/** Quarter turns clockwise. */
export type Rotation = 0 | 1 | 2 | 3;

export const ROTATIONS: readonly Rotation[] = [0, 1, 2, 3];

/**
 * A rotation off a save file. Saves written before buildings could be turned have no
 * rotation at all, and a hand-edited or newer one may have something that is not a
 * rotation - either way the building is upright rather than the page failing to load.
 */
export function normaliseRotation(value: unknown): Rotation {
	if (value === 1 || value === 2 || value === 3) {
		return value;
	}
	return 0;
}

export function rotateQuarters(point: IVector2D, quarters: Rotation): IVector2D {
	switch (quarters) {
		case 1:
			return zeroless(-point.y, point.x);
		case 2:
			return zeroless(-point.x, -point.y);
		case 3:
			return zeroless(point.y, -point.x);
		default:
			return zeroless(point.x, point.y);
	}
}

/**
 * Negating a coordinate on the centre line gives -0, which compares unequal to the 0 it
 * came from. That would show up as a position having changed when nothing moved.
 */
function zeroless(x: number, y: number): IVector2D {
	return { x: x + 0, y: y + 0 };
}

const NEXT_SIDE: Record<LayoutOrientation, LayoutOrientation> = {
	left: "top",
	top: "right",
	right: "bottom",
	bottom: "left",
};

export function rotateSide(side: LayoutOrientation, quarters: Rotation): LayoutOrientation {
	let turned = side;
	for (let i = 0; i < quarters; i++) {
		turned = NEXT_SIDE[turned];
	}
	return turned;
}

/** Which edge a row of ports runs along. Upright, things come in on the left. */
export function jointSide(jointType: "input" | "output", rotation: Rotation): LayoutOrientation {
	return rotateSide(jointType === "input" ? "left" : "right", rotation);
}

/** The box as it would be with no rotation: fixed across, growing with the port count. */
function uprightSize(maxJointsPerSide: number): IVector2D {
	const alongPorts = Math.max(
		(maxJointsPerSide + 1) * gridSize,
		productionNodeIconSize + productionNodeVerticalPadding * 2,
	);
	const acrossPorts = productionNodeIconSize + productionNodeHorizontalPadding * 2;
	return {
		x: ceilToNearest(acrossPorts, gridSize),
		y: ceilToNearest(alongPorts, gridSize),
	};
}

/**
 * How big the box is. `maxJointsPerSide` is the busier of the two sides - the box has to
 * be long enough for whichever row has more in it.
 */
export function productionNodeSize(maxJointsPerSide: number, rotation: Rotation): IVector2D {
	const upright = uprightSize(maxJointsPerSide);
	return rotation % 2 === 0
		? upright
		: { x: upright.y, y: upright.x };
}

/**
 * Where each port in one row goes, relative to the middle of the building.
 *
 * `count` is how many are in this row and `maxJointsPerSide` how many are in the busier
 * one, so a lone input against four outputs still sits in the middle of the long edge
 * rather than being squashed up against the first output.
 */
export function jointSlots(
	count: number,
	maxJointsPerSide: number,
	jointType: "input" | "output",
	rotation: Rotation,
): IVector2D[] {
	const upright = uprightSize(maxJointsPerSide);
	const gap = floorToNearest(upright.y / count, gridSize);
	const start = -gap / 2 * (count - 1);
	const across = (jointType === "input" ? -1 : 1) * upright.x / 2;
	const slots: IVector2D[] = [];
	for (let i = 0; i < count; i++) {
		slots.push(rotateQuarters({ x: across, y: start + gap * i }, rotation));
	}
	return slots;
}
