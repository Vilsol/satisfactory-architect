/**
 * Which of an icon's two pictures to draw.
 *
 * An icon is a tiny blurred stand-in with the real thing over the top once it has
 * loaded. Small icons skip the real thing altogether and live on the stand-in, which is
 * the point of having one: a page tab does not need to fetch a full size image.
 *
 * Worked out fresh each time rather than decided when the icon first appears. Stand-ins
 * are fetched separately from the rest of the application, so one can turn up after an
 * icon has already been drawn - and an icon that had settled on drawing the real image
 * must not then drop it in favour of a stand-in it never switched on, which leaves
 * nothing at all.
 */

export interface IconSituation {
	quality: "max" | "min";
	hasStandIn: boolean;
	realHasLoaded: boolean;
}

export interface IconLayers {
	showStandIn: boolean;
	showReal: boolean;
}

export function iconLayers({ quality, hasStandIn, realHasLoaded }: IconSituation): IconLayers {
	// Without a stand-in there is only ever the real thing, whatever size it is wanted at.
	const showReal = quality === "max" || !hasStandIn;
	return {
		// The stand-in stays until the real one is actually covering it.
		showStandIn: hasStandIn && !(showReal && realHasLoaded),
		showReal,
	};
}
