import { describe, expect, test } from "vitest";
import { AppState } from "$lib/datamodel/AppState.svelte";
import type { GraphNode, GraphNodeProductionProperties, GraphNodeResourceJointProperties } from "$lib/datamodel/GraphNode.svelte";
import type { GraphPage } from "$lib/datamodel/GraphPage.svelte";
import { applyDiffToJson, computeNodeDiff } from "./objectDiff";

/*
 * Rotation is an optional property, which is the interesting part: turning a building
 * back upright removes it rather than setting it to zero. A diff that only looks at the
 * keys it can still see would never tell anybody else the building had straightened up.
 *
 * The ports are nodes in their own right, so their new places travel as their own
 * changes - worth checking, because a building that arrives turned with its ports still
 * down the side is worse than one that never turned at all.
 */

const RECIPE = "Recipe_Alternate_ModularFrameHeavy_C";

function newPage(): GraphPage {
	return AppState.newDefault().currentPage!;
}

function build(page: GraphPage) {
	return page.makeNewNode({ type: "recipe", recipeClassName: RECIPE }, { x: 0, y: 0 }) as GraphNode<GraphNodeProductionProperties>;
}

function firstInput(page: GraphPage, node: GraphNode<GraphNodeProductionProperties>) {
	const id = node.properties.resourceJoints.find(joint => joint.type === "input")!.id;
	return page.nodes.get(id) as GraphNode<GraphNodeResourceJointProperties>;
}

function snapshot(node: GraphNode) {
	return JSON.parse(JSON.stringify(node.asJson));
}

/** What the turning machine works out, and what the other one makes of it. */
function sendAndApply(from: GraphNode, to: GraphNode, before: any) {
	const ops = computeNodeDiff(before, from.asJson);
	const received = snapshot(to);
	applyDiffToJson(received, ops);
	to.applyJson(received);
	return ops;
}

describe("a building turned on one machine", () => {
	test("is turned on the other one too", () => {
		const here = newPage();
		const there = newPage();
		const mine = build(here);
		const theirs = build(there);

		const before = snapshot(mine);
		mine.rotateBy(1);
		sendAndApply(mine, theirs, before);

		expect(theirs.rotation).toBe(1);
	});

	test("arrives the right shape", () => {
		const here = newPage();
		const there = newPage();
		const mine = build(here);
		const theirs = build(there);

		const before = snapshot(mine);
		mine.rotateBy(1);
		sendAndApply(mine, theirs, before);

		expect({ x: theirs.size.x, y: theirs.size.y }).toEqual({ x: mine.size.x, y: mine.size.y });
	});

	test("its ports arrive where they were moved to", () => {
		const here = newPage();
		const there = newPage();
		const mine = build(here);
		const theirs = build(there);
		const myPort = firstInput(here, mine);
		const theirPort = firstInput(there, theirs);

		const before = snapshot(myPort);
		mine.rotateBy(1);
		sendAndApply(myPort, theirPort, before);

		expect(theirPort.properties.layoutOrientation).toBe("top");
		expect({ x: theirPort.position.x, y: theirPort.position.y })
			.toEqual({ x: myPort.position.x, y: myPort.position.y });
	});

	test("straightening it back up straightens theirs too", () => {
		// The value is removed rather than set to zero, which is the case a diff is
		// most likely to miss.
		const here = newPage();
		const there = newPage();
		const mine = build(here);
		const theirs = build(there);

		mine.rotateBy(1);
		theirs.rotateBy(1);

		const before = snapshot(mine);
		mine.setRotation(0);
		const ops = sendAndApply(mine, theirs, before);

		expect(ops.some(op => op.path === "properties.rotation"), "the change should be sent")
			.toBe(true);
		expect(theirs.rotation).toBe(0);
	});

	test("turning it all the way round tells them nothing, because nothing changed", () => {
		const here = newPage();
		const there = newPage();
		const mine = build(here);
		build(there);

		const before = snapshot(mine);
		for (let i = 0; i < 4; i++) {
			mine.rotateBy(1);
		}
		expect(computeNodeDiff(before, mine.asJson)).toEqual([]);
	});
});
