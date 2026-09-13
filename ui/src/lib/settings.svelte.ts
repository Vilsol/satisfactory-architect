/**
 * Preferences - everything that belongs to this browser rather than to the factory.
 *
 * Nothing here goes through `asJson`, which matters: that one projection feeds
 * localStorage, undo/redo and network sync all at once, so anything added to it has to
 * answer for all three. A preference answers for none of them - it is not part of the
 * document, it does not travel to other people in a room, and undo does not touch it.
 *
 * Each setting is declared once, with its storage key, its default and enough about
 * itself for the settings page to draw it. That is the whole point of the registry: the
 * page is generated from this list, so adding an option is one entry here rather than
 * one entry here plus a control over there that someone forgets to add.
 */

import { LocalStorageState } from "$lib/localStorageState.svelte";
import { StorageKeys } from "./datamodel/constants";
import type { GraphEdgeDisplayType } from "./datamodel/GraphEdge.svelte";

export type SettingGroup = "Appearance" | "Defaults" | "Collaboration" | "Debug";

/** The order the settings page shows the groups in. */
export const settingGroups: readonly SettingGroup[] = ["Appearance", "Defaults", "Collaboration", "Debug"];

export type SettingControl<T> =
	{ type: "toggle" } |
	{ type: "number", min: number, max: number, step: number, unit?: string } |
	{ type: "choice", options: readonly { value: T, label: string }[] };

export interface SettingOptions<T> {
	key: string;
	label: string;
	/** One line under the label. Say what changes, not what the option is called again. */
	description?: string;
	group: SettingGroup;
	defaultValue: T;
	control: SettingControl<T>;
}

export class Setting<T> {
	readonly key: string;
	readonly label: string;
	readonly description: string;
	readonly group: SettingGroup;
	readonly defaultValue: T;
	readonly control: SettingControl<T>;
	private readonly storage: LocalStorageState<T>;

	constructor(options: SettingOptions<T>) {
		this.key = options.key;
		this.label = options.label;
		this.description = options.description ?? "";
		this.group = options.group;
		this.defaultValue = options.defaultValue;
		this.control = options.control;
		this.storage = new LocalStorageState<T>(options.key, options.defaultValue);
	}

	get value(): T {
		return this.storage.value;
	}

	set value(newValue: T) {
		this.storage.value = newValue;
	}

	get isDefault(): boolean {
		return this.storage.value === this.defaultValue;
	}

	reset(): void {
		this.value = this.defaultValue;
	}
}

export const settings = {
	darkTheme: new Setting<boolean>({
		// Key kept from before there was a settings page, so nobody's theme flips.
		key: StorageKeys.darkTheme,
		label: "Dark theme",
		group: "Appearance",
		defaultValue: true,
		control: { type: "toggle" },
	}),
	showTransportTier: new Setting<boolean>({
		key: "show-transport-tier",
		label: "Show belt and pipe tier",
		description: "Under the rate on every belt, the lowest tier that can carry it.",
		group: "Appearance",
		defaultValue: true,
		control: { type: "toggle" },
	}),
	showFactorySummary: new Setting<boolean>({
		key: "show-factory-summary",
		label: "Show factory summary",
		description: "The panel with the page's totals.",
		group: "Appearance",
		defaultValue: true,
		control: { type: "toggle" },
	}),

	defaultEdgeDisplayType: new Setting<GraphEdgeDisplayType>({
		key: "default-edge-display-type",
		label: "Belt style",
		description: "What a belt looks like when you draw a new one.",
		group: "Defaults",
		defaultValue: "curved",
		control: {
			type: "choice",
			options: [
				{ value: "straight", label: "Straight" },
				{ value: "curved", label: "Curved" },
				{ value: "angled", label: "Angled" },
				{ value: "teleport", label: "Teleport" },
			],
		},
	}),
	defaultGridSnap: new Setting<boolean>({
		key: "default-grid-snap",
		label: "Grid snap on new pages",
		description: "Existing pages keep whatever they were saved with.",
		group: "Defaults",
		defaultValue: true,
		control: { type: "toggle" },
	}),
	autoRateForFactoryIo: new Setting<boolean>({
		key: "auto-rate-for-factory-io",
		label: "Auto rate for factory inputs and outputs",
		description: "New ones work their rate out from what they are connected to.",
		group: "Defaults",
		defaultValue: false,
		control: { type: "toggle" },
	}),
	factoryIoRate: new Setting<number>({
		key: "default-factory-io-rate",
		label: "Factory input and output rate",
		description: "The rate a new one starts at, when it is not on auto.",
		group: "Defaults",
		defaultValue: 60,
		control: { type: "number", min: 0, max: 100000, step: 1, unit: "/min" },
	}),

	showOtherCursors: new Setting<boolean>({
		key: "show-other-cursors",
		label: "Show other people's cursors",
		group: "Collaboration",
		defaultValue: true,
		control: { type: "toggle" },
	}),

	debugConsoleLog: new Setting<boolean>({
		key: "debug-console-log",
		label: "Debug log",
		description: "Writes what the app is doing to the browser console.",
		group: "Debug",
		defaultValue: false,
		control: { type: "toggle" },
	}),
	debugShowNodeIds: new Setting<boolean>({
		key: "debug-show-node-ids",
		label: "Show node IDs",
		group: "Debug",
		defaultValue: false,
		control: { type: "toggle" },
	}),
	debugShowEdgeIds: new Setting<boolean>({
		key: "debug-show-edge-ids",
		label: "Show edge IDs",
		group: "Debug",
		defaultValue: false,
		control: { type: "toggle" },
	}),
};

export const allSettings: Setting<any>[] = Object.values(settings);

export function settingsInGroup(group: SettingGroup): Setting<any>[] {
	return allSettings.filter(setting => setting.group === group);
}

export function resetAllSettings(): void {
	for (const setting of allSettings) {
		setting.reset();
	}
}
