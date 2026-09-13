import { describe, expect, test } from "vitest";
import { AppState } from "$lib/datamodel/AppState.svelte";
import type { GraphNode, GraphNodeTextNoteProperties } from "$lib/datamodel/GraphNode.svelte";
import type { GraphPage } from "$lib/datamodel/GraphPage.svelte";
import { applyDiffToJson, computeNodeDiff } from "./objectDiff";

/*
 * A note edited on one machine has to arrive on another. The text lives in
 * `properties.content` while the box size is a field of its own, so a change that
 * carries the size but not the text means something is dropping the nested value.
 */

function newPage(): GraphPage {
	return AppState.newDefault().currentPage!;
}

function note(page: GraphPage, content: string) {
	return page.makeNewNode({ type: "text-note", content }, { x: 0, y: 0 }) as GraphNode<GraphNodeTextNoteProperties>;
}

/** What the sending side works out and the receiving side applies. */
function sendAndApply(from: GraphNode, to: GraphNode, before: any) {
	const ops = computeNodeDiff(before, from.asJson);
	const received = JSON.parse(JSON.stringify(to.asJson));
	applyDiffToJson(received, ops);
	to.applyJson(received);
	return ops;
}

describe("a note edited on one machine reaching another", () => {
	test("the text is carried across", () => {
		const here = newPage();
		const there = newPage();
		const mine = note(here, "<p>first</p>");
		const theirs = note(there, "<p>first</p>");

		const before = JSON.parse(JSON.stringify(mine.asJson));
		mine.properties.content = "<p>second</p>";
		const ops = sendAndApply(mine, theirs, before);

		expect(ops.some(op => op.path === "properties.content"), "a change to the text should be sent")
			.toBe(true);
		expect(theirs.properties.content).toBe("<p>second</p>");
	});

	test("formatting inside the text is carried across", () => {
		const here = newPage();
		const there = newPage();
		const mine = note(here, "<p>plain</p>");
		const theirs = note(there, "<p>plain</p>");

		const before = JSON.parse(JSON.stringify(mine.asJson));
		mine.properties.content = '<p><span style="color: #ff0000">red</span></p>';
		sendAndApply(mine, theirs, before);

		expect(theirs.properties.content).toContain("color");
		expect(theirs.properties.content).toContain("red");
	});

	test("the size travels with it", () => {
		const here = newPage();
		const there = newPage();
		const mine = note(here, "<p>a</p>");
		const theirs = note(there, "<p>a</p>");

		const before = JSON.parse(JSON.stringify(mine.asJson));
		mine.properties.content = "<p>a much longer note</p>";
		mine.size.x = 200;
		mine.size.y = 60;
		sendAndApply(mine, theirs, before);

		expect(theirs.size.x, "size arrives").toBe(200);
		expect(theirs.properties.content, "and so does the text").toBe("<p>a much longer note</p>");
	});

	test("several edits in a row all arrive", () => {
		// Typing produces a stream of changes, each diffed against the last one sent.
		const here = newPage();
		const there = newPage();
		const mine = note(here, "");
		const theirs = note(there, "");

		let lastSent = JSON.parse(JSON.stringify(mine.asJson));
		for (const text of ["<p>a</p>", "<p>ab</p>", "<p>abc</p>", "<p>abcd</p>"]) {
			mine.properties.content = text;
			sendAndApply(mine, theirs, lastSent);
			lastSent = JSON.parse(JSON.stringify(mine.asJson));
			expect(theirs.properties.content, `after typing ${text}`).toBe(text);
		}
	});

	test("clearing a note clears it on the other side too", () => {
		const here = newPage();
		const there = newPage();
		const mine = note(here, "<p>something</p>");
		const theirs = note(there, "<p>something</p>");

		const before = JSON.parse(JSON.stringify(mine.asJson));
		mine.properties.content = "";
		sendAndApply(mine, theirs, before);

		expect(theirs.properties.content).toBe("");
	});
});
