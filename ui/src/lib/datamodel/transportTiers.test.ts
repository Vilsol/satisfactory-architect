import { describe, expect, test } from "vitest";
import { satisfactoryDatabase } from "$lib/satisfactoryDatabase";
import { BELT_TIERS, isFluid, PIPE_TIERS, transportNeededFor } from "./transportTiers";

const ORE = "Desc_OreIron_C";
const WATER = "Desc_Water_C";

describe("solid items go on belts", () => {
	test.each([
		[1, "Mk.1"], [60, "Mk.1"],
		[60.5, "Mk.2"], [120, "Mk.2"],
		[121, "Mk.3"], [270, "Mk.3"],
		[271, "Mk.4"], [480, "Mk.4"],
		[481, "Mk.5"], [780, "Mk.5"],
		[781, "Mk.6"], [1200, "Mk.6"],
	])("%d/min needs a %s belt", (rate, expected) => {
		const need = transportNeededFor(ORE, rate)!;
		expect(need.tier.name).toBe(expected);
		expect(need.exceedsEverything).toBe(false);
		expect(need.isFluid).toBe(false);
	});

	test("beyond the fastest belt it says so", () => {
		const need = transportNeededFor(ORE, 1201)!;
		expect(need.exceedsEverything).toBe(true);
		expect(need.tier.name).toBe("Mk.6");
	});
});

describe("fluids go in pipes", () => {
	test.each([
		[1, "Mk.1"], [300, "Mk.1"],
		[301, "Mk.2"], [600, "Mk.2"],
	])("%d/min needs a %s pipe", (rate, expected) => {
		const need = transportNeededFor(WATER, rate)!;
		expect(need.tier.name).toBe(expected);
		expect(need.isFluid).toBe(true);
		expect(need.exceedsEverything).toBe(false);
	});

	test("beyond the biggest pipe it says so", () => {
		const need = transportNeededFor(WATER, 601)!;
		expect(need.exceedsEverything).toBe(true);
	});

	test("a fluid rate a belt would cope with still needs a pipe tier", () => {
		// 400/min would be a Mk.4 belt, but water does not go on belts at all.
		expect(transportNeededFor(WATER, 400)!.tier.name).toBe("Mk.2");
	});
});

describe("nothing to advise", () => {
	test.each([0, -5, Number.NaN])("%s carries no recommendation", rate => {
		expect(transportNeededFor(ORE, rate)).toBeNull();
	});

	test("a rate a hair over a tier from floating point is not bumped up", () => {
		expect(transportNeededFor(ORE, 60 + 1e-9)!.tier.name).toBe("Mk.1");
	});
});

describe("the hand written fluid list", () => {
	test("every name in it is a real item in the game data", () => {
		const missing = [...BELT_TIERS, ...PIPE_TIERS].length > 0
			? ["Desc_Water_C", "Desc_LiquidOil_C", "Desc_NitrogenGas_C", "Desc_RocketFuel_C",
				"Desc_AluminaSolution_C", "Desc_SulfuricAcid_C", "Desc_NitricAcid_C",
				"Desc_DissolvedSilica_C", "Desc_DarkEnergy_C", "Desc_QuantumEnergy_C",
				"Desc_HeavyOilResidue_C", "Desc_LiquidFuel_C", "Desc_LiquidBiofuel_C",
				"Desc_LiquidTurboFuel_C", "Desc_IonizedFuel_C"]
				.filter(cls => !satisfactoryDatabase.parts[cls])
			: [];
		expect(missing, "these fluids no longer exist in the game data").toEqual([]);
	});

	test("obvious solids are not treated as fluids", () => {
		for (const cls of ["Desc_OreIron_C", "Desc_IronIngot_C", "Desc_Cement_C", "Desc_Coal_C"]) {
			expect(isFluid(cls), `${cls} should travel on a belt`).toBe(false);
		}
	});

	test("packaged fluids travel on belts, not in pipes", () => {
		// Packaging them is the whole point - they become ordinary items. Note the
		// trap: the fluid Fuel is Desc_LiquidFuel_C, while Desc_Fuel_C is the packaged
		// one that goes on a belt.
		for (const cls of ["Desc_PackagedAlumina_C", "Desc_Fuel_C", "Desc_PackagedOilResidue_C"]) {
			expect(satisfactoryDatabase.parts[cls], `${cls} should exist in the game data`).toBeDefined();
			expect(isFluid(cls), `${cls} is packaged, so it belongs on a belt`).toBe(false);
		}
		expect(isFluid("Desc_LiquidFuel_C"), "unpackaged Fuel is still a fluid").toBe(true);
	});

	test("tiers are listed slowest first, which the lookup relies on", () => {
		for (const tiers of [BELT_TIERS, PIPE_TIERS]) {
			for (let i = 1; i < tiers.length; i++) {
				expect(tiers[i].capacity).toBeGreaterThan(tiers[i - 1].capacity);
			}
		}
	});
});
