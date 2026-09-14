import { describe, expect, test } from "vitest";
import { AppState } from "./AppState.svelte";
import { GraphEdge } from "./GraphEdge.svelte";
import type { GraphNode, GraphNodeProductionProperties, GraphNodeSplitterMergerProperties } from "./GraphNode.svelte";
import type { GraphPage } from "./GraphPage.svelte";
import { calculateThroughputs } from "./throughputsCalculator";

/*
 * Putting a splitter into the middle of a belt that already exists: one belt becomes
 * two, with the new node between them.
 *
 * The belt carries settings of its own - how it is drawn, which way it leaves its port,
 * whether it is an overflow line - and those have to end up somewhere sensible rather
 * than being quietly lost or duplicated onto the wrong half.
 */

const PLATE_RECIPE = "Recipe_IronPlate_C";
const INGOT_RECIPE = "Recipe_IngotIron_C";

function newPage(): GraphPage {
	return AppState.newDefault().currentPage!;
}

function build(page: GraphPage, recipeClassName: string) {
	return page.makeNewNode({ type: "recipe", recipeClassName }, { x: 0, y: 0 }) as GraphNode<GraphNodeProductionProperties>;
}

function joint(page: GraphPage, node: GraphNode<GraphNodeProductionProperties>, type: "input" | "output") {
	const id = (node.properties).resourceJoints.find(j => j.type === type)!.id;
	return page.nodes.get(id)!;
}

function belt(page: GraphPage, from: GraphNode, to: GraphNode, properties: Partial<GraphEdge["properties"]> = {}) {
	const edge = new GraphEdge(page.context, page.idGen.nextId(), "item-flow", "", "", {
		displayType: "curved",
		isDrainLine: false,
		startOrientation: null,
		endOrientation: null,
		...properties,
	});
	page.addEdgeBetweenNodes(edge, from, to);
	return edge;
}

/** A smelter feeding a constructor, which is one belt carrying iron ingots. */
function twoMachinesOnABelt(page: GraphPage, properties: Partial<GraphEdge["properties"]> = {}) {
	const smelter = build(page, INGOT_RECIPE);
	const constructor = build(page, PLATE_RECIPE);
	const from = joint(page, smelter, "output");
	const to = joint(page, constructor, "input");
	return { smelter, constructor, from, to, edge: belt(page, from, to, properties) };
}

describe("putting a node into the middle of a belt", () => {
	test("one belt becomes two", () => {
		const page = newPage();
		const { edge } = twoMachinesOnABelt(page);
		expect(page.edges.size).toBe(1);

		page.splitEdge(edge, "splitter", { x: 100, y: 100 });

		expect(page.edges.size).toBe(2);
	});

	test("the new node sits between the two ends it used to join", () => {
		const page = newPage();
		const { from, to, edge } = twoMachinesOnABelt(page);

		const inserted = page.splitEdge(edge, "splitter", { x: 100, y: 100 })!;

		const edges = Array.from(page.edges.values());
		const first = edges.find(e => e.startNodeId === from.id)!;
		const second = edges.find(e => e.endNodeId === to.id)!;
		expect(first.endNodeId, "the first half should end at the new node").toBe(inserted.id);
		expect(second.startNodeId, "the second half should start at it").toBe(inserted.id);
	});

	test("the old belt is gone", () => {
		const page = newPage();
		const { edge } = twoMachinesOnABelt(page);
		page.splitEdge(edge, "splitter", { x: 100, y: 100 });
		expect(page.edges.has(edge.id)).toBe(false);
	});

	test("both ends know about the belts they are now on", () => {
		const page = newPage();
		const { from, to, edge } = twoMachinesOnABelt(page);
		page.splitEdge(edge, "splitter", { x: 100, y: 100 });

		expect(from.edges.size, "the machine it came from").toBe(1);
		expect(to.edges.size, "the machine it goes to").toBe(1);
		expect(from.edges.has(edge.id), "and not the belt that no longer exists").toBe(false);
	});

	test("it carries the item the belt was carrying", () => {
		const page = newPage();
		const { edge } = twoMachinesOnABelt(page);
		const inserted = page.splitEdge(edge, "splitter", { x: 100, y: 100 })!;
		const properties = inserted.properties as GraphNodeSplitterMergerProperties;
		expect(properties.resourceClassName).toBe("Desc_IronIngot_C");
	});

	test("it lands where it was dropped", () => {
		const page = newPage();
		const { edge } = twoMachinesOnABelt(page);
		const inserted = page.splitEdge(edge, "splitter", { x: 250, y: -150 })!;
		expect({ x: inserted.position.x, y: inserted.position.y }).toEqual({ x: 250, y: -150 });
	});

	test("a merger can go in just as well", () => {
		const page = newPage();
		const { edge } = twoMachinesOnABelt(page);
		const inserted = page.splitEdge(edge, "merger", { x: 100, y: 100 })!;
		expect(inserted.properties.type).toBe("merger");
	});
});

describe("what the two halves inherit", () => {
	test("both are drawn the way the belt was", () => {
		const page = newPage();
		const { edge } = twoMachinesOnABelt(page, { displayType: "angled" });
		page.splitEdge(edge, "splitter", { x: 100, y: 100 });
		for (const half of page.edges.values()) {
			expect(half.properties.displayType).toBe("angled");
		}
	});

	test("each outer end keeps the direction it left its port in", () => {
		const page = newPage();
		const { from, to, edge } = twoMachinesOnABelt(page, { startOrientation: "top", endOrientation: "bottom" });
		page.splitEdge(edge, "splitter", { x: 100, y: 100 });

		const first = Array.from(page.edges.values()).find(e => e.startNodeId === from.id)!;
		const second = Array.from(page.edges.values()).find(e => e.endNodeId === to.id)!;
		expect(first.properties.startOrientation).toBe("top");
		expect(second.properties.endOrientation).toBe("bottom");
	});

	test("the two new inner ends are left to work themselves out", () => {
		const page = newPage();
		const { from, to, edge } = twoMachinesOnABelt(page, { startOrientation: "top", endOrientation: "bottom" });
		page.splitEdge(edge, "splitter", { x: 100, y: 100 });

		const first = Array.from(page.edges.values()).find(e => e.startNodeId === from.id)!;
		const second = Array.from(page.edges.values()).find(e => e.endNodeId === to.id)!;
		expect(first.properties.endOrientation, "where the first half arrives").toBeNull();
		expect(second.properties.startOrientation, "where the second half leaves").toBeNull();
	});

	test("an overflow line stays an overflow line on both halves", () => {
		const page = newPage();
		const { edge } = twoMachinesOnABelt(page, { isDrainLine: true });
		page.splitEdge(edge, "splitter", { x: 100, y: 100 });
		for (const half of page.edges.values()) {
			expect(half.properties.isDrainLine).toBe(true);
		}
	});

	test("the bends of the old belt are not carried over", () => {
		// They describe a shape between two points that are no longer joined, so keeping
		// them would put a kink in both halves.
		const page = newPage();
		const { edge } = twoMachinesOnABelt(page, { displayType: "straight", straightLineOffsets: [40, -20] });
		page.splitEdge(edge, "splitter", { x: 100, y: 100 });
		for (const half of page.edges.values()) {
			expect(half.properties.straightLineOffsets).toBeUndefined();
		}
	});
});

describe("what the factory does afterwards", () => {
	test("the same amount still gets through", () => {
		const page = newPage();
		const { smelter, constructor, edge } = twoMachinesOnABelt(page);
		smelter.properties.multiplier = 1;
		constructor.properties.multiplier = 1;
		calculateThroughputs(page);
		const before = edge.flow;
		expect(before).toBeGreaterThan(0);

		page.splitEdge(edge, "splitter", { x: 100, y: 100 });
		calculateThroughputs(page);

		for (const half of page.edges.values()) {
			expect(half.flow, "both halves should carry what the one belt carried").toBe(before);
		}
	});

	test("nothing is reported short or spare by the split itself", () => {
		const page = newPage();
		const { smelter, constructor, edge } = twoMachinesOnABelt(page);
		smelter.properties.multiplier = 1;
		constructor.properties.multiplier = 1;
		page.splitEdge(edge, "splitter", { x: 100, y: 100 });
		calculateThroughputs(page);

		for (const node of page.nodes.values()) {
			expect(node.shortfall, `${node.id} short`).toBe(0);
			expect(node.surplus, `${node.id} spare`).toBe(0);
		}
	});
});

describe("belts that cannot be split", () => {
	test("a belt whose ends carry no item is left alone", () => {
		const page = newPage();
		const a = page.makeNewNode({ type: "text-note", content: "a" }, { x: 0, y: 0 });
		const b = page.makeNewNode({ type: "text-note", content: "b" }, { x: 200, y: 0 });
		const edge = belt(page, a, b);

		expect(page.splitEdge(edge, "splitter", { x: 100, y: 0 })).toBeNull();
		expect(page.edges.size, "the belt should still be there, whole").toBe(1);
	});

	test("a belt that is no longer on the page is left alone", () => {
		const page = newPage();
		const { edge } = twoMachinesOnABelt(page);
		page.removeEdge(edge.id);
		expect(page.splitEdge(edge, "splitter", { x: 100, y: 100 })).toBeNull();
	});
});

describe("taking it back", () => {
	test("undo puts the one belt back", async () => {
		const page = newPage();
		const { edge } = twoMachinesOnABelt(page, { displayType: "angled" });
		// History is debounced, so let the state before the split settle first - that is
		// what a person doing this by hand would do anyway.
		page.history.onDataChange();
		await new Promise(resolve => setTimeout(resolve, 600));

		page.splitEdge(edge, "splitter", { x: 100, y: 100 });
		expect(page.edges.size).toBe(2);

		page.history.undo();

		expect(page.edges.size, "one belt again").toBe(1);
		expect(Array.from(page.edges.values())[0].properties.displayType, "drawn as it was").toBe("angled");
		expect(
			Array.from(page.nodes.values()).some(n => n.properties.type === "splitter"),
			"and the splitter is gone",
		).toBe(false);
	});
});
