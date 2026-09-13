import { describe, expect, test } from "vitest";
import { LocalStorageState } from "./localStorageState.svelte";
import { allSettings, settingGroups, settings, settingsInGroup, Setting } from "./settings.svelte";

/*
 * The settings page is generated from the registry, so the registry itself is what can
 * go wrong: two options sharing a storage key would quietly become one option, and an
 * option in a group the page does not draw would exist but never be reachable.
 */

describe("the registry", () => {
	test("no two settings share a storage key", () => {
		const keys = allSettings.map(setting => setting.key);
		expect(new Set(keys).size, `duplicate key among ${keys.join(", ")}`).toBe(keys.length);
	});

	test("every setting is in a group the page draws", () => {
		for (const setting of allSettings) {
			expect(settingGroups, `"${setting.label}" would never be shown`).toContain(setting.group);
		}
	});

	test("every group has something in it", () => {
		for (const group of settingGroups) {
			expect(settingsInGroup(group).length, `"${group}" would be an empty heading`).toBeGreaterThan(0);
		}
	});

	test("the groups between them cover everything", () => {
		const shown = settingGroups.flatMap(group => settingsInGroup(group));
		expect(shown.length).toBe(allSettings.length);
	});

	test("a choice setting's default is one of its own options", () => {
		for (const setting of allSettings) {
			if (setting.control.type !== "choice") {
				continue;
			}
			const values = setting.control.options.map(option => option.value);
			expect(values, `"${setting.label}" defaults to something you cannot pick`)
				.toContain(setting.defaultValue);
		}
	});

	test("a number setting's default is inside its own range", () => {
		for (const setting of allSettings) {
			if (setting.control.type !== "number") {
				continue;
			}
			expect(setting.defaultValue).toBeGreaterThanOrEqual(setting.control.min);
			expect(setting.defaultValue).toBeLessThanOrEqual(setting.control.max);
		}
	});
});

describe("a setting on a machine that has never been touched", () => {
	test("reads as its default", () => {
		const fresh = new Setting<boolean>({
			key: "test-never-written",
			label: "Never written",
			group: "Debug",
			defaultValue: true,
			control: { type: "toggle" },
		});
		expect(fresh.value).toBe(true);
		expect(fresh.isDefault).toBe(true);
	});
});

describe("changing a setting", () => {
	test("is remembered for next time", () => {
		const key = "test-remembered";
		const first = new Setting<string>({
			key,
			label: "Remembered",
			group: "Debug",
			defaultValue: "a",
			control: { type: "choice", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] },
		});
		first.value = "b";

		// A second run of the app reads the same key from scratch.
		const later = new LocalStorageState<string>(key, "a");
		expect(later.value).toBe("b");
	});

	test("it stops counting as the default", () => {
		const setting = new Setting<boolean>({
			key: "test-not-default",
			label: "Not default",
			group: "Debug",
			defaultValue: false,
			control: { type: "toggle" },
		});
		setting.value = true;
		expect(setting.isDefault).toBe(false);
	});

	test("resetting puts the default back", () => {
		const setting = new Setting<number>({
			key: "test-reset",
			label: "Reset",
			group: "Debug",
			defaultValue: 60,
			control: { type: "number", min: 0, max: 100, step: 1 },
		});
		setting.value = 12;
		setting.reset();
		expect(setting.value).toBe(60);
		expect(setting.isDefault).toBe(true);
	});
});

describe("settings that older versions already stored", () => {
	test("the theme keeps the key it has always had", () => {
		// Changing this key would silently put everyone back on the default theme.
		expect(settings.darkTheme.key).toBe("dark-theme");
	});
});
