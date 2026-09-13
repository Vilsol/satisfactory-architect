import { describe, expect, test } from "vitest";
import { AppState } from "./AppState.svelte";
import { GraphEdge } from "./GraphEdge.svelte";
import type { GraphNode, GraphNodeProductionProperties, GraphNodeResourceJointProperties } from "./GraphNode.svelte";
import type { GraphPage } from "./GraphPage.svelte";
import { ROTATIONS, type Rotation } from "./productionLayout";

/*
 * Turning a building should read as picking it up and turning it: the same ports, in the
 * same order, on the sides they would end up on. What it must NOT do is lose which port
 * is which, or leave a belt attached to a port that has moved out from under it.
 *
 * Iron Plate: 30 ingots in, 20 plates out. Heavy Modular Frame has four inputs, which is
 * what makes the order worth checking.
 */

const PLATE_RECIPE = "Recipe_IronPlate_C";
const FOUR_INPUT_RECIPE = "Recipe_Alternate_ModularFrameHeavy_C";

function newPage(): GraphPage {
	return AppState.newDefault().currentPage!;
}

function build(page: GraphPage, recipeClassName: string) {
	return page.makeNewNode({ type: "recipe", recipeClassName }, { x: 0, y: 0 }) as GraphNode<GraphNodeProductionProperties>;
}

function row(page: GraphPage, node: GraphNode<GraphNodeProductionProperties>, type: "input" | "output") {
	return node.properties.resourceJoints
		.filter(joint => joint.type === type)
		.map(joint => page.nodes.get(joint.id) as GraphNode<GraphNodeResourceJointProperties>);
}

function belt(page: GraphPage, from: GraphNode, to: GraphNode) {
	const edge = new GraphEdge(page.context, page.idGen.nextId(), "item-flow", "", "", {
		displayType: "curved", isDrainLine: false, startOrientation: null, endOrientation: null,
	});
	page.addEdgeBetweenNodes(edge, from, to);
	return edge;
}

describe("a building nobody has turned", () => {
	test("is upright", () => {
		const page = newPage();
		expect(build(page, PLATE_RECIPE).rotation).toBe(0);
	});

	test("says nothing about rotation when it is saved", () => {
		// Saves from before this existed have no rotation in them, and an upright
		// building should keep writing them the same way.
		const page = newPage();
		const node = build(page, PLATE_RECIPE);
		expect(node.asJson.properties.rotation).toBeUndefined();
	});

	test("has its input on the left and its output on the right", () => {
		const page = newPage();
		const node = build(page, PLATE_RECIPE);
		expect(row(page, node, "input")[0].properties.layoutOrientation).toBe("left");
		expect(row(page, node, "output")[0].properties.layoutOrientation).toBe("right");
	});
});

describe("turning a building", () => {
	test("puts the inputs on the side they were turned onto", () => {
		const page = newPage();
		const node = build(page, PLATE_RECIPE);
		node.rotateBy(1);
		expect(row(page, node, "input")[0].properties.layoutOrientation).toBe("top");
		expect(row(page, node, "output")[0].properties.layoutOrientation).toBe("bottom");
	});

	test("moves the ports onto that side", () => {
		const page = newPage();
		const node = build(page, PLATE_RECIPE);
		node.rotateBy(1);
		expect(row(page, node, "input")[0].position.y).toBe(-node.size.y / 2);
		expect(row(page, node, "output")[0].position.y).toBe(node.size.y / 2);
	});

	test("turns the box on its side with it", () => {
		const page = newPage();
		const node = build(page, FOUR_INPUT_RECIPE);
		const upright = { x: node.size.x, y: node.size.y };
		expect(upright.y).toBeGreaterThan(upright.x);
		node.rotateBy(1);
		expect({ x: node.size.x, y: node.size.y }).toEqual({ x: upright.y, y: upright.x });
	});

	test("four turns puts everything back exactly as it was", () => {
		const page = newPage();
		const node = build(page, FOUR_INPUT_RECIPE);
		const before = JSON.parse(JSON.stringify(page.asJson));
		for (let i = 0; i < 4; i++) {
			node.rotateBy(1);
		}
		expect(JSON.parse(JSON.stringify(page.asJson))).toEqual(before);
	});

	test("the ports keep their order rather than being shuffled", () => {
		// A rigid turn: the port that was at the top of the left column ends up at the
		// right-hand end of the top row, the way it would if you turned the thing.
		const page = newPage();
		const node = build(page, FOUR_INPUT_RECIPE);
		const inputs = row(page, node, "input");
		const orderedUpright = [...inputs].sort((a, b) => a.position.y - b.position.y);
		node.rotateBy(1);
		const orderedTurned = [...inputs].sort((a, b) => b.position.x - a.position.x);
		expect(orderedTurned.map(joint => joint.id)).toEqual(orderedUpright.map(joint => joint.id));
	});

	test("every port stays on the edge of the box", () => {
		const page = newPage();
		const node = build(page, FOUR_INPUT_RECIPE);
		for (const rotation of ROTATIONS) {
			node.setRotation(rotation);
			for (const type of ["input", "output"] as const) {
				for (const joint of row(page, node, type)) {
					const onSide = Math.abs(Math.abs(joint.position.x) - node.size.x / 2) < 0.001;
					const onTopOrBottom = Math.abs(Math.abs(joint.position.y) - node.size.y / 2) < 0.001;
					expect(onSide || onTopOrBottom, `${type} at ${rotation}`).toBe(true);
				}
			}
		}
	});

	test("no port ever lands on top of another", () => {
		const page = newPage();
		const node = build(page, FOUR_INPUT_RECIPE);
		for (const rotation of ROTATIONS) {
			node.setRotation(rotation);
			const places = row(page, node, "input").map(joint => `${joint.position.x},${joint.position.y}`);
			expect(new Set(places).size, `two ports share a place at ${rotation}`).toBe(places.length);
		}
	});

	test("the belts stay attached to the ports they were on", () => {
		const page = newPage();
		const source = build(page, PLATE_RECIPE);
		const sink = build(page, PLATE_RECIPE);
		const from = row(page, source, "output")[0];
		const to = row(page, sink, "input")[0];
		const belt = new GraphEdge(page.context, page.idGen.nextId(), "item-flow", "", "", {
			displayType: "curved", isDrainLine: false, startOrientation: null, endOrientation: null,
		});
		page.addEdgeBetweenNodes(belt, from, to);
		const edgeIds = Array.from(from.edges);

		source.rotateBy(1);

		expect(Array.from(from.edges), "the belt should still be on the same port").toEqual(edgeIds);
		expect(page.edges.size).toBe(1);
	});

	test("turning one building leaves its neighbours alone", () => {
		const page = newPage();
		const first = build(page, PLATE_RECIPE);
		const second = build(page, PLATE_RECIPE);
		const before = row(page, second, "input").map(joint => ({ ...joint.position }));
		first.rotateBy(2);
		expect(row(page, second, "input").map(joint => ({ x: joint.position.x, y: joint.position.y }))).toEqual(before);
	});

	test("turning to where it already is changes nothing", () => {
		const page = newPage();
		const node = build(page, FOUR_INPUT_RECIPE);
		const before = JSON.parse(JSON.stringify(page.asJson));
		node.setRotation(0);
		expect(JSON.parse(JSON.stringify(page.asJson))).toEqual(before);
	});

	test("the belt leaves the port in the direction the port now faces", () => {
		// Nothing recalculates this on purpose - the belt takes its direction from the
		// port's side, so turning the building re-curves the belt on its own.
		const page = newPage();
		const source = build(page, PLATE_RECIPE);
		const sink = build(page, PLATE_RECIPE);
		const from = row(page, source, "output")[0];
		const to = row(page, sink, "input")[0];
		const belt = new GraphEdge(page.context, page.idGen.nextId(), "item-flow", "", "", {
			displayType: "curved", isDrainLine: false, startOrientation: null, endOrientation: null,
		});
		page.addEdgeBetweenNodes(belt, from, to);

		expect(belt.orientationVectors?.startOffset, "upright, it leaves to the right")
			.toEqual({ x: 1, y: 0 });

		source.rotateBy(1);
		expect(belt.orientationVectors?.startOffset, "turned, it leaves downwards")
			.toEqual({ x: 0, y: 1 });
	});

	test("a text note cannot be turned", () => {
		const page = newPage();
		const note = page.makeNewNode({ type: "text-note", content: "hi" }, { x: 0, y: 0 });
		note.rotateBy(1);
		expect(note.rotation).toBe(0);
	});
});

describe("a rotation that has been saved", () => {
	test("comes back the same way up", () => {
		const page = newPage();
		const node = build(page, FOUR_INPUT_RECIPE);
		node.setRotation(3);
		const saved = JSON.parse(JSON.stringify(page.asJson));

		const reopened = AppState.fromJSON({ ...JSON.parse(JSON.stringify(AppState.newDefault().asJson)), pages: [saved] } as any);
		const restored = reopened.pages[0].nodes.get(node.id) as GraphNode<GraphNodeProductionProperties>;
		expect(restored.rotation).toBe(3);
		expect(restored.size.x).toBe(node.size.x);
		expect(restored.size.y).toBe(node.size.y);
	});

	test("survives being turned and turned back through every angle", () => {
		const page = newPage();
		const node = build(page, FOUR_INPUT_RECIPE);
		const upright = JSON.parse(JSON.stringify(page.asJson));
		for (const rotation of ROTATIONS) {
			node.setRotation(rotation);
			node.setRotation(0);
			expect(JSON.parse(JSON.stringify(page.asJson)), `after a trip to ${rotation}`).toEqual(upright);
		}
	});
});

describe("turning everything that is selected", () => {
	test("turns the buildings in the selection", () => {
		const page = newPage();
		const selected = build(page, PLATE_RECIPE);
		const other = build(page, PLATE_RECIPE);
		page.selectedNodes.clear();
		page.selectedNodes.add(selected.id);

		page.rotateSelectedNodes(1);

		expect(selected.rotation).toBe(1);
		expect(other.rotation, "nothing outside the selection moves").toBe(0);
	});

	test("turning with nothing selected does nothing at all", () => {
		const page = newPage();
		build(page, PLATE_RECIPE);
		const before = JSON.parse(JSON.stringify(page.asJson));
		page.selectedNodes.clear();
		page.rotateSelectedNodes(1);
		expect(JSON.parse(JSON.stringify(page.asJson))).toEqual(before);
	});

	test("a selected port is left alone rather than breaking", () => {
		const page = newPage();
		const node = build(page, PLATE_RECIPE);
		const port = row(page, node, "input")[0];
		page.selectedNodes.clear();
		page.selectedNodes.add(port.id);
		expect(() => page.rotateSelectedNodes(1)).not.toThrow();
		expect(node.rotation).toBe(0);
	});
});

describe("the ports sorting themselves out after a turn", () => {
	test("a port fed from the left ends up on the left of the row", () => {
		// Ports reshuffle within their row so belts do not cross. That reads off which
		// side the other end of the belt is on, which changes when the row moves from a
		// column down the side to a row along the top.
		const page = newPage();
		const node = build(page, "Recipe_ModularFrame_C");
		const inputs = row(page, node, "input");
		expect(inputs).toHaveLength(2);

		const sources = inputs.map((input, i) => {
			const source = build(page, PLATE_RECIPE);
			source.position.x = i === 0 ? 400 : -400;
			source.position.y = -400;
			return source;
		});
		// Crossed on purpose: the first port is fed from the right.
		belt(page, row(page, sources[0], "output")[0], inputs[0]);
		belt(page, row(page, sources[1], "output")[0], inputs[1]);

		node.setRotation(1);
		node.reorderRecipeJoints(page);

		const fedFromLeft = inputs[1];
		const fedFromRight = inputs[0];
		expect(fedFromLeft.position.x).toBeLessThan(fedFromRight.position.x);
	});
});
