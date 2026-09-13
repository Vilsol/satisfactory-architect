/**
 * Note text, and making it safe to put on screen.
 *
 * Notes used to hold plain text and now hold formatted text, stored as HTML in the
 * same `content` field. Two things follow from that:
 *
 *  - Saves written before this change hold plain text with real newlines in it. That
 *    has to keep rendering the way it always did rather than being fed to the browser
 *    as markup.
 *  - In a shared session the content arrives from somebody else's machine. Their
 *    editor produces tidy markup, but nothing stops a modified client sending whatever
 *    it likes, so anything shown has to be cleaned first - on the way in, not on the
 *    way out of the editor.
 */

import DOMPurify from "dompurify";

/** The formatting a note is allowed to carry. Anything else is dropped. */
const ALLOWED_TAGS = [
	"p", "br", "span", "div",
	"strong", "b", "em", "i", "u", "s",
	"ul", "ol", "li",
	"h1", "h2", "h3",
	"blockquote",
];

/**
 * `style` carries the colour and size, and `class` carries Quill's own size and
 * alignment markers. No href, no src, nothing that loads or navigates.
 */
const ALLOWED_ATTR = ["style", "class"];

/**
 * CSS a note is allowed to carry. An allowlist rather than a list of things to block,
 * because `style` can reach a long way - `url(...)`, `expression(...)` and escapes are
 * all ways to get code or a network request out of what looks like a colour.
 */
const ALLOWED_CSS_PROPERTIES = new Set([
	"color",
	"background-color",
	"font-size",
	"font-weight",
	"font-style",
	"text-decoration",
	"text-align",
]);

/** Values may only look like colours, lengths and keywords. */
const SAFE_CSS_VALUE = /^[a-z0-9#.,%\s'"()-]+$/i;
const UNSAFE_CSS = /url\s*\(|expression\s*\(|javascript:|@import|\\|\/\*/i;

/** Keep only the declarations a note is allowed to carry, dropping the rest. */
export function filterStyle(style: string): string {
	const kept: string[] = [];
	for (const declaration of style.split(";")) {
		const at = declaration.indexOf(":");
		if (at < 0) {
			continue;
		}
		const property = declaration.slice(0, at).trim().toLowerCase();
		const value = declaration.slice(at + 1).trim();
		if (!ALLOWED_CSS_PROPERTIES.has(property)) {
			continue;
		}
		if (!value || UNSAFE_CSS.test(value) || !SAFE_CSS_VALUE.test(value)) {
			continue;
		}
		kept.push(`${property}: ${value}`);
	}
	return kept.join("; ");
}

let styleHookInstalled = false;
function installStyleHook(): void {
	if (styleHookInstalled) {
		return;
	}
	styleHookInstalled = true;
	DOMPurify.addHook("afterSanitizeAttributes", (node) => {
		const element = node as Element;
		if (typeof element.getAttribute !== "function" || !element.hasAttribute("style")) {
			return;
		}
		const safe = filterStyle(element.getAttribute("style") ?? "");
		if (safe) {
			element.setAttribute("style", safe);
		} else {
			element.removeAttribute("style");
		}
	});
}

/** Looks like it was written as markup rather than typed as plain text. */
export function looksLikeHtml(content: string): boolean {
	return /<(p|br|span|div|strong|b|em|i|u|s|ul|ol|li|h[1-3]|blockquote)\b[^>]*>/i.test(content);
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/**
 * Turn whatever is stored on a note into markup that is safe to render.
 *
 * Plain text from an older save is escaped and its line breaks kept. Markup is passed
 * through a cleaner that strips scripts, event handlers and anything that can load or
 * navigate.
 */
export function noteContentToSafeHtml(content: string): string {
	if (!content) {
		return "";
	}
	if (!looksLikeHtml(content)) {
		return escapeHtml(content).replace(/\r?\n/g, "<br>");
	}
	installStyleHook();
	return DOMPurify.sanitize(content, {
		ALLOWED_TAGS,
		ALLOWED_ATTR,
		// Keep it to a fragment of text; no embedded documents or shadow content.
		FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "a", "img"],
		FORBID_ATTR: ["href", "src", "srcset", "formaction", "xlink:href"],
		ALLOW_DATA_ATTR: false,
		USE_PROFILES: { html: true },
	});
}

/** Plain text of a note, for searching and for naming it in a list. */
export function noteContentToPlainText(content: string): string {
	if (!content) {
		return "";
	}
	if (!looksLikeHtml(content)) {
		return content;
	}
	const cleaned = noteContentToSafeHtml(content);
	const withBreaks = cleaned
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(p|div|li|h[1-3]|blockquote)>/gi, "\n");
	const stripped = withBreaks.replace(/<[^>]*>/g, "");
	return stripped
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/**
 * Whether text arriving from elsewhere should replace what the editor is showing.
 *
 * The only question is whether it differs from what was last put in. Comparing against
 * the editor's own output does not work, because the editor rewrites markup into its
 * own shape, so it never matches what was stored and every update looks like a change.
 *
 * Note that having the note focused is deliberately NOT a reason to skip. Refusing
 * updates while focused means that once somebody clicks into a note to read it, they
 * stop seeing anyone else's edits entirely - which looks exactly like sync being
 * broken. The caret is put back afterwards instead.
 */
export function shouldApplyIncomingNote(incoming: string, lastApplied: string | null): boolean {
	return incoming !== lastApplied;
}
