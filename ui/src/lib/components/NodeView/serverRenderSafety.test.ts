import { describe, expect, test } from "vitest";

/*
 * The app is prerendered, so every component is loaded once on a server with no DOM.
 * A library that reaches for `document` while it is being imported will throw there,
 * and the page never renders at all.
 *
 * These run in the default node environment on purpose - that is what the prerender
 * looks like. Anything needing a real browser has to be pulled in after mount, not at
 * the top of the file.
 */

describe("components can be loaded without a browser", () => {
	test("the note editor", async () => {
		await expect(import("./TextNoteNodeView.svelte")).resolves.toBeDefined();
	});

	test("the node view it sits inside", async () => {
		await expect(import("./NodeView.svelte")).resolves.toBeDefined();
	});

	test("the label drawn on a belt, which measures its own text", async () => {
		await expect(import("../EdgeAnnotation.svelte")).resolves.toBeDefined();
	});

	test("the belt view it belongs to", async () => {
		await expect(import("../EdgeView/EdgeView.svelte")).resolves.toBeDefined();
	});

	test("the settings page", async () => {
		await expect(import("../OverlayLayer/SettingsOverlay.svelte")).resolves.toBeDefined();
	});

	test("the other node views", async () => {
		await expect(import("./ProductionNodeView.svelte")).resolves.toBeDefined();
		await expect(import("./ResourceJointNodeView.svelte")).resolves.toBeDefined();
		await expect(import("./SplitterMergerNodeView.svelte")).resolves.toBeDefined();
	});
});

describe("note content can be prepared without a browser", () => {
	test("plain text from an older save needs no DOM at all", async () => {
		const { noteContentToSafeHtml } = await import("../../datamodel/noteContent");
		expect(noteContentToSafeHtml("just words\nover two lines")).toBe("just words<br>over two lines");
	});
});
