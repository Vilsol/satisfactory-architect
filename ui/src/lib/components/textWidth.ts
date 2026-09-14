/**
 * How wide a piece of text will be drawn, without asking the document to measure it.
 *
 * The labels on belts size a background to fit their text. Asking the element itself,
 * with getBBox, makes the browser lay the page out then and there - and with a couple of
 * hundred labels on a decent sized factory that was the single most expensive thing
 * about opening a page.
 *
 * A canvas will measure the same text with the same font without touching the page at
 * all, and the answers agree to within half a pixel of what getBBox gives. Labels also
 * repeat heavily - a few hundred of them on a real page say only a couple of dozen
 * different things - so the answers are worth keeping.
 */

const widths = new Map<string, number>();
let context: CanvasRenderingContext2D | null | undefined;
let family: string | undefined;

/** The font everything on the canvas inherits, read from the page once. */
function pageFontFamily(): string {
	if (family === undefined) {
		family = typeof document !== "undefined"
			? getComputedStyle(document.documentElement).fontFamily || "sans-serif"
			: "sans-serif";
	}
	return family;
}

export function measureTextWidth(text: string, fontSize: number, fontWeight: number): number {
	if (!text) {
		return 0;
	}
	const key = `${fontWeight} ${fontSize} ${text}`;
	const known = widths.get(key);
	if (known !== undefined) {
		return known;
	}
	if (context === undefined) {
		// Prerendering has no canvas. A rough guess is fine there: nothing is looked at
		// until the browser has it, and the real measurement happens then.
		context = typeof document !== "undefined"
			? document.createElement("canvas").getContext("2d")
			: null;
	}
	let width: number;
	if (context) {
		context.font = `${fontWeight} ${fontSize}px ${pageFontFamily()}`;
		width = context.measureText(text).width;
	} else {
		width = text.length * fontSize * 0.55;
	}
	widths.set(key, width);
	return width;
}
