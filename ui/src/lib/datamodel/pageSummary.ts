/**
 * What a page needs, what it makes and what it costs to run.
 *
 * The inputs and outputs are the page's own declared interface - the factory input
 * and output nodes - rather than anything inferred, so the figures match what was
 * deliberately set rather than shifting as the middle of the factory is edited.
 */

import { satisfactoryDatabase } from "$lib/satisfactoryDatabase";
import type { GraphPage } from "./GraphPage.svelte";
import { nodePower } from "./nodePower";
import { buildingOf, clampSloops } from "./overclocking";

export interface SummaryEntry {
	itemClass: string;
	displayName: string;
	ratePerMinute: number;
}

export interface PageSummary {
	inputs: SummaryEntry[];
	outputs: SummaryEntry[];
	/** Megawatts drawn by the buildings on this page. */
	powerUsed: number;
	/** Megawatts generated on this page. */
	powerMade: number;
	/** Total machines, counting a building set to x2.5 as 2.5. */
	buildingCount: number;
	/** Somersloops sitting in those machines. */
	sloopsUsed: number;
	/** Belts or pipes carrying more than any single line in the game can. */
	overloadedBelts: number;
}

function add(into: Map<string, number>, itemClass: string, rate: number) {
	if (!(rate > 0)) {
		return;
	}
	into.set(itemClass, (into.get(itemClass) ?? 0) + rate);
}

function toEntries(from: Map<string, number>): SummaryEntry[] {
	return [...from.entries()]
		.map(([itemClass, ratePerMinute]) => ({
			itemClass,
			displayName: satisfactoryDatabase.parts[itemClass]?.displayName ?? itemClass,
			ratePerMinute,
		}))
		.sort((a, b) => b.ratePerMinute - a.ratePerMinute || a.displayName.localeCompare(b.displayName, "en"));
}

export function summarisePage(page: GraphPage, overloadedBelts = 0): PageSummary {
	const inputs = new Map<string, number>();
	const outputs = new Map<string, number>();
	let powerUsed = 0;
	let powerMade = 0;
	let buildingCount = 0;
	let sloopsUsed = 0;

	for (const node of page.nodes.values()) {
		if (node.properties.type !== "production") {
			continue;
		}
		const props = node.properties;
		const details = props.details;

		if (details.type === "factory-input") {
			add(inputs, details.partClassName, props.multiplier);
			continue;
		}
		if (details.type === "factory-output") {
			add(outputs, details.partClassName, props.multiplier);
			continue;
		}
		if (details.type === "factory-reference") {
			continue; // its own page reports these
		}

		if (!satisfactoryDatabase.buildings[buildingOf(details) ?? ""]) {
			continue;
		}
		const machines = Math.max(props.multiplier, 0);
		buildingCount += machines;
		sloopsUsed += clampSloops(props.sloops ?? 0, buildingOf(details)) * machines;
		const power = nodePower(props);
		powerUsed += power.consumed;
		powerMade += power.produced;
	}

	return {
		inputs: toEntries(inputs),
		outputs: toEntries(outputs),
		powerUsed,
		powerMade,
		buildingCount,
		sloopsUsed,
		overloadedBelts,
	};
}
