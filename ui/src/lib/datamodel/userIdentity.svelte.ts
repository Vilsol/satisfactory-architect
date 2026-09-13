/**
 * What this person calls themselves and the colour their cursor and selection show
 * in to everyone else in the room.
 *
 * Kept in this browser's preferences rather than in the save file - it describes the
 * person sitting here, not the factory.
 */

import { LocalStorageState } from "$lib/localStorageState.svelte";

/**
 * Colours to hand out to people who have not picked one. Chosen to stay apart from
 * each other and to be readable against both the light and the dark background.
 */
export const USER_COLORS: readonly string[] = [
	"#e14434", // red
	"#e58c1a", // orange
	"#d4b106", // gold
	"#5ba829", // green
	"#1fa8a0", // teal
	"#3d74b6", // blue
	"#7a5af8", // violet
	"#d2449b", // pink
];

/** A colour from the list, picked from the id so the same person keeps the same one. */
export function colorForUserId(userId: string): string {
	let hash = 0;
	for (let i = 0; i < userId.length; i++) {
		hash = (hash * 31 + userId.charCodeAt(i)) | 0;
	}
	return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
}

/** A readable stand-in for somebody who has not given a name. */
export function fallbackName(userId: string): string {
	const tail = userId.replace(/[^a-zA-Z0-9]/g, "").slice(-4).toUpperCase();
	return tail ? `User ${tail}` : "User";
}

/** What to show for someone, whatever they did or did not set. */
export function displayIdentity(
	userId: string,
	identity: { name?: string; color?: string } | undefined,
): { name: string; color: string } {
	const name = identity?.name?.trim();
	// Colours come from other people and are used directly in styles, so only a plain
	// hex value is accepted; anything else falls back to one we chose.
	const color = normaliseColor(identity?.color ?? "");
	return {
		name: name && name.length > 0 ? name : fallbackName(userId),
		color: color || colorForUserId(userId),
	};
}

/** True when a colour is one of the offered swatches rather than a free choice. */
export function isPresetColor(color: string): boolean {
	return USER_COLORS.includes(normaliseColor(color));
}

/**
 * Tidy a colour into a plain lower-case hex value, or "" when it is not one.
 *
 * Colours arrive from other people over the network and end up in inline styles, so
 * anything that is not a straightforward hex colour is dropped rather than trusted.
 */
export function normaliseColor(color: string): string {
	const trimmed = color.trim().toLowerCase();
	if (/^#[0-9a-f]{6}$/.test(trimmed)) {
		return trimmed;
	}
	if (/^#[0-9a-f]{3}$/.test(trimmed)) {
		return "#" + trimmed.slice(1).split("").map(c => c + c).join("");
	}
	return "";
}

export const MAX_USER_NAME_LENGTH = 24;

/** Names travel to other people's screens, so keep them short and free of newlines. */
export function cleanUserName(name: string): string {
	return name.replace(/\s+/g, " ").trim().slice(0, MAX_USER_NAME_LENGTH);
}

export const userName = new LocalStorageState<string>("user-name", "");
export const userColor = new LocalStorageState<string>("user-color", "");
