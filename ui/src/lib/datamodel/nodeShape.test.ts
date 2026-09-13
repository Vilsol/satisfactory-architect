import { describe, expect, test } from "vitest";
import { AppState } from "./AppState.svelte";
import type { GraphNode, GraphNodeProductionProperties } from "./GraphNode.svelte";
import { getNodeRadius } from "./nodeTypeProperties.svelte";

/*
 * Anything drawing an outline around a node has to know what shape it is. Only some
 * node types are round; the rest are rectangles described by their size, and asking
 * those for a radius gives zero rather than an error - which silently collapses any
 * outline drawn from it down to nothing.
 */

function newPage() {
	return AppState.newDefault().currentPage!;
}

describe("which nodes are round", () => {
	test("joints, splitters and mergers have a radius", () => {
		const page = newPage();
		const smelter = page.makeNewNode({ type: "recipe", recipeClassName: "Recipe_IngotIron_C" }, { x: 0, y: 0 }) as GraphNode<GraphNodeProductionProperties>;
		const joint = page.nodes.get(smelter.properties.resourceJoints[0].id)!;
		const splitter = page.makeNewNode({ type: "splitter", resourceClassName: "Desc_OreIron_C" }, { x: 0, y: 0 });
		const merger = page.makeNewNode({ type: "merger", resourceClassName: "Desc_OreIron_C" }, { x: 0, y: 0 });

		expect(getNodeRadius(joint)).toBeGreaterThan(0);
		expect(getNodeRadius(splitter)).toBeGreaterThan(0);
		expect(getNodeRadius(merger)).toBeGreaterThan(0);
	});

	test("buildings and notes have no radius, so their size has to be used instead", () => {
		const page = newPage();
		const smelter = page.makeNewNode({ type: "recipe", recipeClassName: "Recipe_IngotIron_C" }, { x: 0, y: 0 });
		const note = page.makeNewNode({ type: "text-note", content: "hello" }, { x: 0, y: 0 });

		expect(getNodeRadius(smelter), "a building is a rectangle").toBe(0);
		expect(getNodeRadius(note), "a note is a rectangle").toBe(0);
	});
});

describe("the rectangular nodes have a usable size", () => {
	test("a building has real width and height to draw around", () => {
		const page = newPage();
		const smelter = page.makeNewNode({ type: "recipe", recipeClassName: "Recipe_IngotIron_C" }, { x: 0, y: 0 });
		expect(smelter.size.x).toBeGreaterThan(0);
		expect(smelter.size.y).toBeGreaterThan(0);
	});

	test("a note has no size until it has been rendered and measured", () => {
		// Notes size themselves to their text once laid out, so anything drawing from
		// the size has to cope with getting nothing at all on the first frame.
		const page = newPage();
		const note = page.makeNewNode({ type: "text-note", content: "hello" }, { x: 0, y: 0 });
		expect(note.size.x).toBe(0);
		expect(note.size.y).toBe(0);
	});

	test("a bigger building is bigger to draw around", () => {
		// A recipe with more joints gets a taller body, so an outline drawn from the
		// size follows it rather than staying a fixed box.
		const page = newPage();
		const small = page.makeNewNode({ type: "recipe", recipeClassName: "Recipe_IngotIron_C" }, { x: 0, y: 0 });
		const big = page.makeNewNode({ type: "recipe", recipeClassName: "Recipe_ModularFrame_C" }, { x: 0, y: 0 });
		expect(big.size.y).toBeGreaterThanOrEqual(small.size.y);
	});
});
