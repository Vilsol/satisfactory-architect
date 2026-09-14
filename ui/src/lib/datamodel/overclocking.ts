/**
 * What running a building faster or slower, and putting somersloops in it, does to how
 * much it makes and how much power it draws.
 *
 * Both curves come from the game's own data rather than from a constant written down
 * here: production buildings and miners raise power to 1.321929, while generators and
 * the rest raise it to 1.6, so a single hard-coded exponent would be wrong for half of
 * them. See satisfactoryBuildingPower.ts.
 */

import { satisfactoryDatabase } from "$lib/satisfactoryDatabase";
import { buildingPower } from "$lib/satisfactoryBuildingPower";
import type { SFBuildingPower } from "$lib/satisfactoryDatabaseTypes";
import type { ProductionDetails } from "./GraphNode.svelte";

/** The slowest and fastest the game lets a building run. */
export const minClockSpeed = 0.01;
export const maxClockSpeed = 2.5;

/** Stands in for a building the data says nothing about: nothing scales, nothing fits. */
const noScaling: SFBuildingPower = {
	powerExponent: 1,
	sloopSlots: 0,
	sloopBoostPerSlot: 0,
	sloopPowerExponent: 1,
};

/** Which building a production node is made of, if the data knows. */
export function buildingOf(details: ProductionDetails): string | undefined {
	switch (details.type) {
		case "recipe":
			return satisfactoryDatabase.recipes[details.recipeClassName]?.producedIn;
		case "extraction":
			return details.buildingClassName;
		case "power-production":
			return details.powerBuildingClassName;
		default:
			return undefined;
	}
}

function powerDataOf(buildingClassName: string | undefined): SFBuildingPower {
	return buildingPower[buildingClassName ?? ""] ?? noScaling;
}

/** How many somersloops the building takes. */
export function sloopSlotsOf(buildingClassName: string | undefined): number {
	return powerDataOf(buildingClassName).sloopSlots;
}

export function clampClockSpeed(clockSpeed: number): number {
	if (!Number.isFinite(clockSpeed)) {
		return 1;
	}
	return Math.min(Math.max(clockSpeed, minClockSpeed), maxClockSpeed);
}

export function clampSloops(sloops: number, buildingClassName: string | undefined): number {
	if (!Number.isFinite(sloops)) {
		return 0;
	}
	return Math.min(Math.max(Math.floor(sloops), 0), sloopSlotsOf(buildingClassName));
}

/** Just the properties these sums need, so callers can pass a node or a fragment of one. */
export interface Overclockable {
	details: ProductionDetails;
	clockSpeed?: number;
	sloops?: number;
}

function factors(props: Overclockable) {
	const building = buildingOf(props.details);
	const power = powerDataOf(building);
	const clockSpeed = clampClockSpeed(props.clockSpeed ?? 1);
	const boost = 1 + clampSloops(props.sloops ?? 0, building) * power.sloopBoostPerSlot;
	return { power, clockSpeed, boost };
}

/**
 * What goes in, against the same building at full speed. Somersloops do not touch it -
 * making more out of the same ore is the whole point of them.
 */
export function inputFactor(props: Overclockable): number {
	return factors(props).clockSpeed;
}

/** What comes out, which does get whatever the somersloops add. */
export function outputFactor(props: Overclockable): number {
	const { clockSpeed, boost } = factors(props);
	return clockSpeed * boost;
}

/** Whichever of the two a joint on this building needs. */
export function portFactor(props: Overclockable, jointType: "input" | "output"): number {
	return jointType === "input" ? inputFactor(props) : outputFactor(props);
}

/** What it draws, against the same. */
export function powerFactor(props: Overclockable): number {
	const { power, clockSpeed, boost } = factors(props);
	return Math.pow(clockSpeed, power.powerExponent) * Math.pow(boost, power.sloopPowerExponent);
}
