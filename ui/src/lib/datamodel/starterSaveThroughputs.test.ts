import { expect, test } from "vitest";
import { AppState } from "./AppState.svelte";
import type { GraphNode } from "./GraphNode.svelte";
import type { GraphPage } from "./GraphPage.svelte";
import { starterSaveJson } from "./starterSave";
import { calculateThroughputs } from "./throughputsCalculator";

/*
 * Characterisation snapshot of the save every new user starts with.
 *
 * It exists so that a change to the calculator produces a reviewable diff against
 * real user-facing data instead of a silent shift.
 */

function describeEnd(page: GraphPage, node: GraphNode | undefined): string {
	if (!node) return "?";
	const props = node.properties as any;
	if (props.type === "resource-joint") {
		const parent = node.parentNode ? page.nodes.get(node.parentNode) : undefined;
		const parentProps = parent?.properties as any;
		const what = parentProps?.details?.recipeClassName
			?? parentProps?.details?.partClassName
			?? parentProps?.details?.buildingClassName
			?? parentProps?.type
			?? "?";
		return `${what}.${props.jointType}`;
	}
	return props.type;
}

function report(page: GraphPage): string {
	return [...page.edges.values()]
		.sort((a, b) => a.id.localeCompare(b.id, "en"))
		.map(e => {
			const from = describeEnd(page, page.nodes.get(e.startNodeId));
			const to = describeEnd(page, page.nodes.get(e.endNodeId));
			const round = (n: number) => Math.round(n * 1e4) / 1e4;
			const label = `${e.id.padEnd(6)} ${from} -> ${to}`;
			return `${label.padEnd(74).slice(0, 74)}  flow=${round(e.flow)}`;
		})
		.join("\n");
}

function slackReport(page: GraphPage): string {
	const rows: string[] = [];
	for (const node of [...page.nodes.values()].sort((a, b) => a.id.localeCompare(b.id, "en"))) {
		const round = (n: number) => Math.round(n * 1e4) / 1e4;
		if (node.shortfall > 0) rows.push(`  short ${round(node.shortfall)} at ${describeEnd(page, node)}`);
		if (node.surplus > 0) rows.push(`  spare ${round(node.surplus)} at ${describeEnd(page, node)}`);
	}
	return rows.length ? rows.join("\n") : "  (nothing short or spare)";
}

test("starter save throughputs", () => {
	const state = AppState.fromJSON(JSON.parse(starterSaveJson));
	for (const page of state.pages) {
		calculateThroughputs(page);
	}
	for (const page of state.pages) {
		expect(`${report(page)}\n${slackReport(page)}`).toMatchSnapshot(page.name);
	}
});
