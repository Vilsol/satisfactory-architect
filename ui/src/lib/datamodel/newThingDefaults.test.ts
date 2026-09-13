import { afterEach, describe, expect, test } from "vitest";
import { AppState } from "./AppState.svelte";
import type { GraphNode, GraphNodeProductionProperties, GraphNodeResourceJointProperties } from "./GraphNode.svelte";
import type { GraphPage } from "./GraphPage.svelte";
import { GraphView } from "./GraphView.svelte";
import { resetAllSettings, settings } from "$lib/settings.svelte";

/*
 * A preference is only worth having if the thing it names actually reads it. These go
 * the whole way: change the setting, make the thing, look at what came out.
 *
 * The settings are module-level singletons, so each test puts them back afterwards.
 */

const ORE = "Desc_OreIron_C";

afterEach(() => resetAllSettings());

function newPage(): GraphPage {
	return AppState.newDefault().currentPage!;
}

function outputJoint(page: GraphPage, node: GraphNode): GraphNode<GraphNodeResourceJointProperties> {
	const props = node.properties as GraphNodeProductionProperties;
	const id = props.resourceJoints.find(joint => joint.type === "output")!.id;
	return page.nodes.get(id) as GraphNode<GraphNodeResourceJointProperties>;
}

/** Drag a new belt out of a joint, the way the canvas does. */
function dragOutABelt(page: GraphPage, from: GraphNode<GraphNodeResourceJointProperties>) {
	page.startMovingRecipeResourceJoint(
		from,
		{ x: 300, y: 0 },
		from.properties.jointType,
		"drag-to-connect",
		from.properties.resourceClassName,
		from.properties.layoutOrientation,
		null,
	);
	return Array.from(page.edges.values()).at(-1)!;
}

describe("the belt style you chose", () => {
	test("is what a newly drawn belt comes out as", () => {
		settings.defaultEdgeDisplayType.value = "angled";
		const page = newPage();
		const source = page.makeNewNode({ type: "factory-input", partClassName: ORE }, { x: 0, y: 0 });
		expect(dragOutABelt(page, outputJoint(page, source)).properties.displayType).toBe("angled");
	});

	test("curved is what you get having never chosen", () => {
		const page = newPage();
		const source = page.makeNewNode({ type: "factory-input", partClassName: ORE }, { x: 0, y: 0 });
		expect(dragOutABelt(page, outputJoint(page, source)).properties.displayType).toBe("curved");
	});
});

describe("grid snap on new pages", () => {
	test("a new page starts with it off if that is what you chose", () => {
		settings.defaultGridSnap.value = false;
		expect(GraphView.newDefault().enableGridSnap).toBe(false);
		expect(newPage().view.enableGridSnap).toBe(false);
	});

	test("a saved page keeps what it was saved with, whatever the setting says", () => {
		// Otherwise opening a shared factory would quietly change how it behaves.
		settings.defaultGridSnap.value = false;
		const restored = GraphView.fromJSON({ offset: { x: 0, y: 0 }, scale: 1, enableGridSnap: true });
		expect(restored.enableGridSnap).toBe(true);
	});
});

describe("the rate a factory input or output starts at", () => {
	test("is the one you chose", () => {
		settings.factoryIoRate.value = 120;
		const page = newPage();
		const source = page.makeNewNode({ type: "factory-input", partClassName: ORE }, { x: 0, y: 0 });
		expect((source.properties as GraphNodeProductionProperties).multiplier).toBe(120);
	});

	test("is 60 having never chosen", () => {
		const page = newPage();
		const source = page.makeNewNode({ type: "factory-input", partClassName: ORE }, { x: 0, y: 0 });
		expect((source.properties as GraphNodeProductionProperties).multiplier).toBe(60);
	});
});

describe("auto rate for factory inputs and outputs", () => {
	test("new ones come out on auto when that is turned on", () => {
		settings.autoRateForFactoryIo.value = true;
		const page = newPage();
		const source = page.makeNewNode({ type: "factory-output", partClassName: ORE }, { x: 0, y: 0 });
		expect((source.properties as GraphNodeProductionProperties).autoMultiplier).toBe(true);
	});

	test("and off when it is not", () => {
		const page = newPage();
		const source = page.makeNewNode({ type: "factory-output", partClassName: ORE }, { x: 0, y: 0 });
		expect((source.properties as GraphNodeProductionProperties).autoMultiplier).toBe(false);
	});

	test("a recipe is never put on auto by it", () => {
		settings.autoRateForFactoryIo.value = true;
		const page = newPage();
		const smelter = page.makeNewNode({ type: "recipe", recipeClassName: "Recipe_IngotIron_C" }, { x: 0, y: 0 });
		expect((smelter.properties as GraphNodeProductionProperties).autoMultiplier).toBe(false);
	});
});
