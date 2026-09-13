import { LocalStorageState } from "$lib/localStorageState.svelte";
import { latestAppVersion, StorageKeys } from "./constants";

export const globals = $state({
	mousePosition: {
		x: 0,
		y: 0,
	},
	pageMousePosition: {
		x: 0,
		y: 0,
	} as { x: number; y: number } | null,
});

let stateChangeBlockers = 0;
export function blockStateChanges() {
	stateChangeBlockers++;
}
export function unblockStateChanges() {
	stateChangeBlockers--;
}
export function trackStateChanges(): boolean {
	return stateChangeBlockers === 0;
}

export const appVersion = new LocalStorageState(StorageKeys.appVersion, latestAppVersion);
