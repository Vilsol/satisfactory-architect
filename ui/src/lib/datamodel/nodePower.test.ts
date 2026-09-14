import { describe, expect, test } from "vitest";
import type { GraphNodeProductionProperties } from "./GraphNode.svelte";
import { nodePower } from "./nodePower";

type Props = Pick<GraphNodeProductionProperties, "details" | "multiplier" | "clockSpeed" | "sloops">;

const constructors = (over: Partial<Props> = {}): Props => ({
	details: { type: "recipe", recipeClassName: "Recipe_IronPlate_C" },
	multiplier: 1,
	...over,
});
const coalGenerators = (over: Partial<Props> = {}): Props => ({
	details: {
		type: "power-production",
		powerBuildingClassName: "Build_GeneratorCoal_C",
		fuelClassName: "Desc_Coal_C",
	},
	multiplier: 1,
	...over,
});

describe("what a building draws", () => {
	test("a constructor draws its 4 MW, and two of them draw 8", () => {
		expect(nodePower(constructors()).consumed).toBeCloseTo(4, 6);
		expect(nodePower(constructors({ multiplier: 2 })).consumed).toBeCloseTo(8, 6);
	});

	test("run at 250% it draws 13.43 MW, not 10", () => {
		expect(nodePower(constructors({ clockSpeed: 2.5 })).consumed).toBeCloseTo(13.431, 2);
	});

	test("a somersloop quadruples the draw", () => {
		expect(nodePower(constructors({ sloops: 1 })).consumed).toBeCloseTo(16, 6);
	});

	test("a half-built building draws its fraction", () => {
		expect(nodePower(constructors({ multiplier: 0.5 })).consumed).toBeCloseTo(2, 6);
	});

	test("a negative count draws nothing rather than generating power", () => {
		expect(nodePower(constructors({ multiplier: -3 })).consumed).toBe(0);
	});
});

describe("recipes that draw a variable amount", () => {
	// The page summary used to ignore these and report the building's 0.1 MW base,
	// while the toolbar reported 1500. One of them was wrong by four orders of magnitude.
	const collider: Props = {
		details: { type: "recipe", recipeClassName: "Recipe_SpaceElevatorPart_9_C" },
		multiplier: 1,
	};

	test("the recipe's own figure wins over the building's base", () => {
		expect(nodePower(collider).consumed).toBeCloseTo(1500, 6);
	});

	test("and it scales with speed like anything else", () => {
		expect(nodePower({ ...collider, clockSpeed: 2.5 }).consumed).toBeCloseTo(1500 * 2.5 ** 1.321929, 1);
	});
});

describe("what a building makes", () => {
	test("a coal generator makes 75 MW and draws nothing", () => {
		const power = nodePower(coalGenerators());
		expect(power.produced).toBeCloseTo(75, 6);
		expect(power.consumed).toBe(0);
	});

	test("run at 250% it makes 2.5x, in step with the fuel it burns", () => {
		expect(nodePower(coalGenerators({ clockSpeed: 2.5 })).produced).toBeCloseTo(187.5, 6);
	});
});

describe("nodes that are not buildings", () => {
	test("a factory input neither draws nor makes anything", () => {
		const power = nodePower({
			details: { type: "factory-input", partClassName: "Desc_OreIron_C" },
			multiplier: 100,
		});
		expect(power).toEqual({ consumed: 0, produced: 0 });
	});
});
