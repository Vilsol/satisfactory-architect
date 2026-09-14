import { describe, expect, test } from "vitest";
import { iconPreview } from "./iconPreviewsLoader.svelte";

/*
 * Runs with no browser, which is the prerender's situation. Asking for a stand-in there
 * has to come back empty rather than throwing or trying to fetch anything: an icon with
 * no stand-in is drawn from its real image, which is exactly what should happen.
 */

describe("asking for an icon's stand-in before it is to hand", () => {
	test("comes back empty rather than failing", () => {
		expect(iconPreview("IconDesc_PortableMiner")).toBe("");
	});

	test("an icon nobody has ever heard of is empty too", () => {
		expect(iconPreview("NotAnIcon")).toBe("");
	});

	test("asking repeatedly is still safe", () => {
		for (let i = 0; i < 5; i++) {
			expect(() => iconPreview("IconDesc_PortableMiner")).not.toThrow();
		}
	});
});
