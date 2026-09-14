/**
 * The blurred stand-ins shown while a real icon is still loading.
 *
 * There are a couple of hundred of them and they are stored inline as base64, which
 * comes to about half a megabyte - more than the rest of the application put together.
 * Loading that before anything can be drawn costs every visitor time on every visit, to
 * avoid a flicker that only happens on a slow connection.
 *
 * So they are fetched separately, and asked for rather than read. Until they arrive
 * there is simply no stand-in, which is the same situation as an icon that never had one.
 */

let previews: Record<string, string> | null = $state(null);
let started = false;

function startLoading(): void {
	if (started || typeof window === "undefined") {
		return;
	}
	started = true;
	void import("./iconPreviews")
		.then((module) => {
			previews = module.iconPreviews;
		})
		.catch(() => {
			// Without these an icon is drawn from its real image instead, so there is
			// nothing to recover from.
			previews = {};
		});
}

/** The stand-in for an icon, or nothing if there is not one to hand. */
export function iconPreview(icon: string): string {
	if (previews === null) {
		startLoading();
		return "";
	}
	return previews[icon] ?? "";
}
