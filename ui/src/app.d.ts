// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces

import type { AppState } from "$lib/datamodel/AppState.svelte";
import type { ServerConnection } from "$lib/sync/ServerConnection.svelte";

declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	/** Exposed when the app is loaded with `?e2e=1` URL parameter. */
	interface Window {
		__appState?: AppState;
		__serverConnection?: ServerConnection;
	}
}

interface ImportMetaEnv {
	/**
	 * The collaboration server this build talks to, e.g. "wss://example.com/ws".
	 * Unset means "the same host as the page", which is what a deployment that serves
	 * both from one origin wants.
	 */
	readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

export {};
