import { describe, expect, test } from "vitest";
import {
	ROTATIONS, jointSide, jointSlots, normaliseRotation, productionNodeSize,
	rotateQuarters, rotateSide, type Rotation,
} from "./productionLayout";

/*
 * Rotating a building is meant to read as picking the thing up and turning it a quarter
 * turn: the ports end up where they would end up, in the order they would end up in.
 *
 * These are written from that, not from what the layout code happens to do. Screen
 * coordinates have y pointing down, so a quarter turn clockwise on screen sends
 * (x, y) to (-y, x) - the right side becomes the bottom.
 */

describe("turning a point a quarter at a time", () => {
	test("not turning it leaves it alone", () => {
		expect(rotateQuarters({ x: 3, y: 7 }, 0)).toEqual({ x: 3, y: 7 });
	});

	test("one quarter clockwise sends the right side to the bottom", () => {
		expect(rotateQuarters({ x: 10, y: 0 }, 1)).toEqual({ x: 0, y: 10 });
	});

	test("and the left side to the top", () => {
		expect(rotateQuarters({ x: -10, y: 0 }, 1)).toEqual({ x: 0, y: -10 });
	});

	test("half a turn is the opposite corner", () => {
		expect(rotateQuarters({ x: 4, y: -9 }, 2)).toEqual({ x: -4, y: 9 });
	});

	test("four quarters is back where it started", () => {
		let point = { x: 5, y: -3 };
		for (let i = 0; i < 4; i++) {
			point = rotateQuarters(point, 1);
		}
		expect(point).toEqual({ x: 5, y: -3 });
	});

	test("the centre does not move, whichever way you turn it", () => {
		for (const rotation of ROTATIONS) {
			expect(rotateQuarters({ x: 0, y: 0 }, rotation)).toEqual({ x: 0, y: 0 });
		}
	});
});

describe("which side of the building a port ends up on", () => {
	test("upright, what goes in comes in from the left and out to the right", () => {
		expect(jointSide("input", 0)).toBe("left");
		expect(jointSide("output", 0)).toBe("right");
	});

	test("a quarter turn puts the inputs on top", () => {
		expect(jointSide("input", 1)).toBe("top");
		expect(jointSide("output", 1)).toBe("bottom");
	});

	test("upside down swaps the two sides over", () => {
		expect(jointSide("input", 2)).toBe("right");
		expect(jointSide("output", 2)).toBe("left");
	});

	test("three quarters puts the inputs underneath", () => {
		expect(jointSide("input", 3)).toBe("bottom");
		expect(jointSide("output", 3)).toBe("top");
	});

	test("in and out are never on the same side", () => {
		for (const rotation of ROTATIONS) {
			expect(jointSide("input", rotation)).not.toBe(jointSide("output", rotation));
		}
	});

	test("turning a side four times brings it back", () => {
		let side = rotateSide("left", 1);
		side = rotateSide(side, 1);
		side = rotateSide(side, 1);
		side = rotateSide(side, 1);
		expect(side).toBe("left");
	});
});

describe("the size of the box", () => {
	test("upright, it grows downwards as ports are added", () => {
		const one = productionNodeSize(1, 0);
		const four = productionNodeSize(4, 0);
		expect(four.y).toBeGreaterThan(one.y);
		expect(four.x).toBe(one.x);
	});

	test("on its side, it grows sideways instead", () => {
		const one = productionNodeSize(1, 1);
		const four = productionNodeSize(4, 1);
		expect(four.x).toBeGreaterThan(one.x);
		expect(four.y).toBe(one.y);
	});

	test("turning it swaps its width and height", () => {
		const upright = productionNodeSize(4, 0);
		expect(productionNodeSize(4, 1)).toEqual({ x: upright.y, y: upright.x });
		expect(productionNodeSize(4, 3)).toEqual({ x: upright.y, y: upright.x });
	});

	test("upside down is the same shape as upright", () => {
		expect(productionNodeSize(4, 2)).toEqual(productionNodeSize(4, 0));
	});

	test("it lands on the grid, so buildings line up", () => {
		for (const rotation of ROTATIONS) {
			for (let count = 1; count <= 6; count++) {
				const size = productionNodeSize(count, rotation);
				expect(size.x % 50, `width for ${count} ports at ${rotation}`).toBe(0);
				expect(size.y % 50, `height for ${count} ports at ${rotation}`).toBe(0);
			}
		}
	});
});

describe("where the ports sit", () => {
	test("upright, inputs run down the left edge", () => {
		const size = productionNodeSize(3, 0);
		const slots = jointSlots(3, 3, "input", 0);
		expect(slots).toHaveLength(3);
		for (const slot of slots) {
			expect(slot.x).toBe(-size.x / 2);
		}
		expect(slots[0].y).toBeLessThan(slots[1].y);
		expect(slots[1].y).toBeLessThan(slots[2].y);
	});

	test("upright, outputs run down the right edge", () => {
		const size = productionNodeSize(3, 0);
		for (const slot of jointSlots(3, 3, "output", 0)) {
			expect(slot.x).toBe(size.x / 2);
		}
	});

	test("a single port sits in the middle of its edge", () => {
		expect(jointSlots(1, 1, "input", 0)[0].y).toBe(0);
		expect(jointSlots(1, 1, "input", 1)[0].x).toBe(0);
	});

	test("they are evenly spaced", () => {
		const slots = jointSlots(4, 4, "input", 0);
		const gaps = [slots[1].y - slots[0].y, slots[2].y - slots[1].y, slots[3].y - slots[2].y];
		expect(new Set(gaps).size, "uneven spacing").toBe(1);
	});

	test("they are centred on the building", () => {
		for (const rotation of ROTATIONS) {
			for (const count of [1, 2, 3, 5]) {
				const slots = jointSlots(count, count, "input", rotation);
				const middleX = slots.reduce((sum, s) => sum + s.x, 0) / count;
				const middleY = slots.reduce((sum, s) => sum + s.y, 0) / count;
				expect(middleX, `x at ${rotation} with ${count}`).toBeCloseTo(rotation % 2 === 0 ? slots[0].x : 0);
				expect(middleY, `y at ${rotation} with ${count}`).toBeCloseTo(rotation % 2 === 0 ? 0 : slots[0].y);
			}
		}
	});

	test("turned a quarter, they sit along the edge they were turned onto", () => {
		const size = productionNodeSize(3, 1);
		const slots = jointSlots(3, 3, "input", 1);
		for (const slot of slots) {
			expect(slot.y, "inputs should be along the top edge").toBe(-size.y / 2);
		}
	});

	test("every port stays on the edge of the box, whichever way it is turned", () => {
		for (const rotation of ROTATIONS) {
			const size = productionNodeSize(4, rotation);
			for (const type of ["input", "output"] as const) {
				for (const slot of jointSlots(4, 4, type, rotation)) {
					const onVerticalEdge = Math.abs(Math.abs(slot.x) - size.x / 2) < 0.001;
					const onHorizontalEdge = Math.abs(Math.abs(slot.y) - size.y / 2) < 0.001;
					expect(onVerticalEdge || onHorizontalEdge, `${type} at ${rotation} is ${JSON.stringify(slot)} inside ${JSON.stringify(size)}`).toBe(true);
					expect(Math.abs(slot.x)).toBeLessThanOrEqual(size.x / 2 + 0.001);
					expect(Math.abs(slot.y)).toBeLessThanOrEqual(size.y / 2 + 0.001);
				}
			}
		}
	});

	test("turning a port is the same as turning the building it is on", () => {
		// This is what makes it read as rotation rather than as ports jumping about.
		for (const rotation of ROTATIONS) {
			const upright = jointSlots(3, 3, "input", 0);
			const turned = jointSlots(3, 3, "input", rotation);
			expect(turned).toEqual(upright.map(slot => rotateQuarters(slot, rotation)));
		}
	});

	test("inputs and outputs line up across the building", () => {
		// Opposite edges, same spread: the building reads the same either way up.
		for (const rotation of ROTATIONS) {
			const inputs = jointSlots(3, 3, "input", rotation);
			const outputs = jointSlots(3, 3, "output", rotation);
			expect(outputs.map(slot => ({ x: -slot.x + 0, y: -slot.y + 0 })).reverse()).toEqual(inputs);
		}
	});

	test("a short row still spreads over the whole building", () => {
		// One input against four outputs: the input belongs in the middle, not squeezed
		// up against the first output.
		expect(jointSlots(1, 4, "input", 0)[0].y).toBe(0);
	});
});

describe("reading a rotation off an old save", () => {
	test("a save from before rotation existed is upright", () => {
		expect(normaliseRotation(undefined)).toBe(0);
		expect(normaliseRotation(null)).toBe(0);
	});

	test("nonsense is upright too, rather than breaking the page", () => {
		expect(normaliseRotation("2")).toBe(0);
		expect(normaliseRotation(7)).toBe(0);
		expect(normaliseRotation(1.5)).toBe(0);
		expect(normaliseRotation(-1)).toBe(0);
	});

	test("a real rotation comes through", () => {
		for (const rotation of ROTATIONS) {
			expect(normaliseRotation(rotation)).toBe(rotation);
		}
	});
});
