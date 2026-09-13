import { describe, expect, test } from "vitest";
import { AppState } from "./AppState.svelte";
import { GraphNode, type GraphNodeProductionProperties, type GraphNodeResourceJointProperties } from "./GraphNode.svelte";
import { NodePriorities } from "./constants";
import { GraphEdge } from "./GraphEdge.svelte";
import type { GraphPage } from "./GraphPage.svelte";

/*
 * While somebody is pulling a new belt out of a building, everyone else should see
 * that building outlined in their colour - the same as if they had selected it.
 *
 * A drag in progress is an ordinary synced node: a temporary joint that remembers the
 * node it came from and whose drag it is. This collects those into a lookup keyed by
 * the thing being dragged out of.
 */

const ORE = "Desc_OreIron_C";

function newPage() {
	return AppState.newDefault().currentPage!;
}

function smelter(page: GraphPage) {
	return page.makeNewNode({ type: "recipe", recipeClassName: "Recipe_IngotIron_C" }, { x: 0, y: 0 }) as GraphNode<GraphNodeProductionProperties>;
}

function jointOf(page: GraphPage, node: GraphNode, direction: "input" | "output") {
	const props = node.properties as GraphNodeProductionProperties;
	return page.nodes.get(props.resourceJoints.find(j => j.type === direction)!.id)!;
}

/** Stand in for what starting a drag does: a temporary joint that remembers its origin. */
function startDrag(page: GraphPage, from: GraphNode, ownerUserId: string | null) {
	const temp = new GraphNode<GraphNodeResourceJointProperties>(
		page.idGen.nextId(),
		page.context,
		{ x: 100, y: 100 },
		NodePriorities.RESOURCE_JOINT,
		[],
		null,
		[],
		{
			type: "resource-joint",
			resourceClassName: ORE,
			jointType: "input",
			layoutOrientation: "left",
			locked: false,
			jointDragType: "drag-to-connect",
			dragStartNodeId: from.id,
			dragOwnerUserId: ownerUserId,
		},
	);
	page.addNodes(temp);
	const edge = new GraphEdge(page.context, page.idGen.nextId(), "item-flow", "", "", {
		displayType: "curved",
		isDrainLine: false,
		startOrientation: null,
		endOrientation: null,
	});
	page.addEdgeBetweenNodes(edge, from, temp);
	return { temp, edge };
}

describe("who is dragging out of what", () => {
	test("nothing is being dragged on a quiet page", () => {
		const page = newPage();
		smelter(page);
		expect(page.dragHighlightsByUser.nodes.size).toBe(0);
		expect(page.dragHighlightsByUser.edges.size).toBe(0);
	});

	test("everything caught up in the drag is marked", () => {
		const page = newPage();
		const building = smelter(page);
		const output = jointOf(page, building, "output");
		const { temp, edge } = startDrag(page, output, "user-ada");

		const { nodes, edges } = page.dragHighlightsByUser;
		expect(nodes.get(building.id), "the building it is coming out of").toBe("user-ada");
		expect(nodes.get(output.id), "the joint on that building").toBe("user-ada");
		expect(nodes.get(temp.id), "the loose end following the cursor").toBe("user-ada");
		expect(edges.get(edge.id), "and the belt stretched between them").toBe("user-ada");
	});

	test("two people dragging at once are kept apart", () => {
		const page = newPage();
		const one = smelter(page);
		const two = smelter(page);
		const ada = startDrag(page, jointOf(page, one, "output"), "user-ada");
		const bob = startDrag(page, jointOf(page, two, "input"), "user-bob");

		const { nodes, edges } = page.dragHighlightsByUser;
		expect(nodes.get(one.id)).toBe("user-ada");
		expect(nodes.get(two.id)).toBe("user-bob");
		expect(edges.get(ada.edge.id)).toBe("user-ada");
		expect(edges.get(bob.edge.id)).toBe("user-bob");
	});

	test("a drag with no owner recorded is ignored", () => {
		// Local-only drags carry no owner, and nobody else needs to see those.
		const page = newPage();
		const building = smelter(page);
		startDrag(page, jointOf(page, building, "output"), null);
		expect(page.dragHighlightsByUser.nodes.size).toBe(0);
		expect(page.dragHighlightsByUser.edges.size).toBe(0);
	});

	test("the lookup empties once the drag is finished", () => {
		const page = newPage();
		const building = smelter(page);
		const { temp } = startDrag(page, jointOf(page, building, "output"), "user-ada");
		expect(page.dragHighlightsByUser.nodes.size).toBeGreaterThan(0);

		page.removeNode(temp.id);
		expect(page.dragHighlightsByUser.nodes.size).toBe(0);
		expect(page.dragHighlightsByUser.edges.size).toBe(0);
	});

	test("a dangling drag that points at a deleted node does not break the lookup", () => {
		const page = newPage();
		const building = smelter(page);
		const output = jointOf(page, building, "output");
		startDrag(page, output, "user-ada");
		page.nodes.delete(output.id);

		expect(() => page.dragHighlightsByUser).not.toThrow();
		expect(page.dragHighlightsByUser.nodes.get(output.id), "still names the joint it came from").toBe("user-ada");
	});
});
