/**
 * Which recipe to assume for an item when costing a chain.
 *
 * Deliberately kept out of the save. Which alternates you have unlocked, and which
 * ones you like, is about the person reading the numbers rather than about the
 * factory - it should not travel to the other people in a room, and it has no place
 * on the undo stack. Same reasoning as the settings.
 */

import { LocalStorageState } from "./localStorageState.svelte";
import { chooseRecipeFor } from "./datamodel/rawCost";

const storageKey = "recipe-preferences";

const preferences = new LocalStorageState<Record<string, string>>(storageKey, {});

export const recipePreferences = {
	get all(): Record<string, string> {
		return preferences.value;
	},

	/** The recipe chosen for an item, or nothing if the default is being used. */
	chosenFor(itemClass: string): string | undefined {
		return preferences.value[itemClass];
	},

	/** What would actually be used for an item, chosen or not. */
	effectiveFor(itemClass: string): string | undefined {
		return chooseRecipeFor(itemClass, preferences.value)?.className;
	},

	set(itemClass: string, recipeClassName: string) {
		preferences.value = { ...preferences.value, [itemClass]: recipeClassName };
	},

	clear(itemClass: string) {
		const { [itemClass]: _removed, ...rest } = preferences.value;
		preferences.value = rest;
	},

	clearAll() {
		preferences.value = {};
	},

	get count(): number {
		return Object.keys(preferences.value).length;
	},
};
