import { describe, expect, test } from "vitest";
import {
	cleanUserName, colorForUserId, displayIdentity, fallbackName, isPresetColor,
	MAX_USER_NAME_LENGTH, normaliseColor, USER_COLORS,
} from "./userIdentity.svelte";

describe("giving somebody a colour when they have not picked one", () => {
	test("the same person always gets the same colour", () => {
		expect(colorForUserId("abc-123")).toBe(colorForUserId("abc-123"));
	});

	test("it is always one of the offered colours", () => {
		for (const id of ["a", "abc-123", "", "zzzzzzzzzzzz", "user-9"]) {
			expect(USER_COLORS).toContain(colorForUserId(id));
		}
	});

	test("different people mostly get different colours", () => {
		const ids = Array.from({ length: 40 }, (_, i) => `user-${i}`);
		const used = new Set(ids.map(colorForUserId));
		expect(used.size, "the palette should actually get spread around").toBeGreaterThan(4);
	});
});

describe("a stand-in name", () => {
	test("uses the tail of the id so two people are told apart", () => {
		expect(fallbackName("aaaa-bbbb-1234")).not.toBe(fallbackName("aaaa-bbbb-5678"));
	});

	test("copes with an id that has nothing usable in it", () => {
		expect(fallbackName("---")).toBe("User");
		expect(fallbackName("")).toBe("User");
	});
});

describe("what to actually show for somebody", () => {
	test("their own name and colour win", () => {
		expect(displayIdentity("u1", { name: "Ada", color: "#123456" }))
			.toEqual({ name: "Ada", color: "#123456" });
	});

	test("blank or missing values fall back", () => {
		const shown = displayIdentity("aaaa-1234", { name: "   ", color: "" });
		expect(shown.name).toBe("User 1234");
		expect(USER_COLORS).toContain(shown.color);
	});

	test("no identity at all still gives something to draw", () => {
		const shown = displayIdentity("aaaa-1234", undefined);
		expect(shown.name).toBe("User 1234");
		expect(USER_COLORS).toContain(shown.color);
	});
});

describe("tidying a name before it goes to other people", () => {
	test("trims and collapses whitespace", () => {
		expect(cleanUserName("  Ada   Lovelace  ")).toBe("Ada Lovelace");
	});

	test("newlines cannot be smuggled in", () => {
		expect(cleanUserName("Ada\nLovelace")).toBe("Ada Lovelace");
		expect(cleanUserName("Ada\n\n\tB")).toBe("Ada B");
	});

	test("over-long names are cut", () => {
		const long = "x".repeat(200);
		expect(cleanUserName(long).length).toBe(MAX_USER_NAME_LENGTH);
	});

	test("an empty name stays empty so the fallback takes over", () => {
		expect(cleanUserName("   ")).toBe("");
	});
});

describe("accepting a colour from somebody else", () => {
	test("a plain hex colour is kept", () => {
		expect(normaliseColor("#AABBCC")).toBe("#aabbcc");
		expect(normaliseColor("  #123456 ")).toBe("#123456");
	});

	test("short hex is expanded", () => {
		expect(normaliseColor("#abc")).toBe("#aabbcc");
	});

	test("anything that is not a hex colour is refused", () => {
		// These arrive over the network and go straight into an inline style.
		for (const bad of [
			"red",
			"rgb(1,2,3)",
			"url(javascript:alert(1))",
			"#12345",
			"#abcdeg",
			"; background: url(x)",
			"",
			"expression(alert(1))",
		]) {
			expect(normaliseColor(bad), `${bad} should not be accepted`).toBe("");
		}
	});

	test("a refused colour falls back to one we chose", () => {
		const shown = displayIdentity("aaaa-1234", { name: "Ada", color: "url(javascript:alert(1))" });
		expect(USER_COLORS).toContain(shown.color);
		expect(shown.name).toBe("Ada");
	});

	test("a freely picked colour is not mistaken for a preset", () => {
		expect(isPresetColor("#e14434")).toBe(true);
		expect(isPresetColor("#E14434")).toBe(true);
		expect(isPresetColor("#010203")).toBe(false);
		expect(isPresetColor("")).toBe(false);
	});
});
