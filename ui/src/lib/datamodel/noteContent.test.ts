// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { filterStyle, looksLikeHtml, noteContentToPlainText, noteContentToSafeHtml, shouldApplyIncomingNote } from "./noteContent";

/*
 * Note content is shared. In a session it arrives from someone else's machine, and a
 * modified client can send anything it likes - so what gets rendered has to be cleaned
 * on arrival rather than trusted because our own editor produced it.
 *
 * Older saves hold plain text with real newlines, which has to keep rendering the way
 * it always did instead of being handed to the browser as markup.
 */

describe("telling old plain text from formatted text", () => {
	test("plain writing is not mistaken for markup", () => {
		expect(looksLikeHtml("Smelter bank for the north wall")).toBe(false);
		expect(looksLikeHtml("60/min -> 2 smelters")).toBe(false);
		expect(looksLikeHtml("a < b and c > d")).toBe(false);
	});

	test("real markup is recognised", () => {
		expect(looksLikeHtml("<p>Hello</p>")).toBe(true);
		expect(looksLikeHtml('<span style="color: red">Hi</span>')).toBe(true);
	});
});

describe("notes written before formatting existed", () => {
	test("plain text is shown as written", () => {
		expect(noteContentToSafeHtml("Smelter bank")).toBe("Smelter bank");
	});

	test("line breaks are kept", () => {
		expect(noteContentToSafeHtml("one\ntwo")).toBe("one<br>two");
		expect(noteContentToSafeHtml("one\r\ntwo")).toBe("one<br>two");
	});

	test("characters that look like markup are shown, not interpreted", () => {
		expect(noteContentToSafeHtml("a < b & c > d"))
			.toBe("a &lt; b &amp; c &gt; d");
	});

	test("an empty note stays empty", () => {
		expect(noteContentToSafeHtml("")).toBe("");
	});
});

describe("formatting that is allowed through", () => {
	test.each([
		"<p>Hello</p>",
		"<strong>Bold</strong>",
		"<em>Italic</em>",
		"<u>Underlined</u>",
		"<ul><li>One</li><li>Two</li></ul>",
		"<h2>Heading</h2>",
		"<blockquote>Quoted</blockquote>",
	])("keeps %s", (html) => {
		expect(noteContentToSafeHtml(html)).not.toBe("");
	});

	test("colour and size survive, since that is the whole point", () => {
		const out = noteContentToSafeHtml('<p><span style="color: #ff0000; font-size: 18px">Red</span></p>');
		expect(out).toContain("color");
		expect(out).toContain("Red");
	});

	test("Quill's own class names survive", () => {
		const out = noteContentToSafeHtml('<p class="ql-align-center">Centred</p>');
		expect(out).toContain("ql-align-center");
	});
});

describe("what must never reach the page", () => {
	// Content with real formatting in it goes through the cleaner.
	test.each([
		["<p>ok</p><script>alert(1)</script>", "script"],
		["<p>ok</p><img src=x onerror=alert(1)>", "onerror"],
		['<p><a href="javascript:alert(1)">click</a></p>', "javascript:"],
		['<p>ok</p><iframe src="https://example.com"></iframe>', "iframe"],
		['<p onclick="alert(1)">text</p>', "onclick"],
		['<div style="background:url(javascript:alert(1))">x</div>', "javascript:"],
		["<p>ok</p><object data='x'></object>", "object"],
		["<p>ok</p><embed src='x'>", "embed"],
		['<p>ok</p><form action="/x"><input name="y"></form>', "form"],
		['<p onmouseover="alert(1)">hover</p>', "onmouseover"],
		["<p>ok</p><svg><script>alert(1)</script></svg>", "script"],
	])("strips %s", (dangerous, mustNotContain) => {
		const out = noteContentToSafeHtml(dangerous).toLowerCase();
		expect(out, `"${mustNotContain}" survived cleaning`).not.toContain(mustNotContain);
	});

	// Content with no formatting at all takes the older plain-text route, where the
	// protection is escaping rather than stripping - it must end up inert either way.
	test.each([
		"<script>alert(1)</script>",
		"<img src=x onerror=alert(1)>",
		"<svg onload=alert(1)>",
	])("renders %s as inert text rather than markup", (dangerous) => {
		const out = noteContentToSafeHtml(dangerous);
		expect(out, "nothing may be left that the browser would treat as a tag")
			.not.toMatch(/<[a-z/!]/i);
		expect(out).toContain("&lt;");
	});

	test("the readable text inside something dangerous is kept", () => {
		// Stripping the attack should not silently eat what the person wrote.
		expect(noteContentToSafeHtml('<p onclick="alert(1)">Keep me</p>')).toContain("Keep me");
	});

	test("no event handler attribute of any kind survives", () => {
		const out = noteContentToSafeHtml(
			'<p onload="x" onerror="x" onfocus="x" onblur="x" oninput="x">text</p>',
		);
		expect(out).not.toMatch(/\son[a-z]+\s*=/i);
	});

	test("links and images are removed entirely rather than defanged", () => {
		const out = noteContentToSafeHtml('<p><a href="https://example.com">link</a><img src="x.png"></p>');
		expect(out).not.toContain("<a");
		expect(out).not.toContain("<img");
	});
});

describe("reading a note back as plain text", () => {
	test("markup is reduced to its words", () => {
		expect(noteContentToPlainText("<p>Hello <strong>there</strong></p>")).toBe("Hello there");
	});

	test("block endings and breaks become line breaks", () => {
		expect(noteContentToPlainText("<p>one</p><p>two</p>")).toBe("one\ntwo");
		expect(noteContentToPlainText("<p>one<br>two</p>")).toBe("one\ntwo");
	});

	test("list items come out on their own lines", () => {
		expect(noteContentToPlainText("<ul><li>one</li><li>two</li></ul>")).toBe("one\ntwo");
	});

	test("old plain text passes straight through", () => {
		expect(noteContentToPlainText("just words")).toBe("just words");
	});

	test("escaped characters are turned back into themselves", () => {
		expect(noteContentToPlainText("<p>a &lt; b &amp; c</p>")).toBe("a < b & c");
	});

	test("dangerous content contributes no text of its own", () => {
		expect(noteContentToPlainText("<script>alert(1)</script><p>real</p>")).toBe("real");
	});
});

describe("what a style attribute may say", () => {
	test("colour and size are kept, since that is the feature", () => {
		expect(filterStyle("color: #ff0000; font-size: 18px"))
			.toBe("color: #ff0000; font-size: 18px");
		expect(filterStyle("background-color: rgb(1, 2, 3)"))
			.toBe("background-color: rgb(1, 2, 3)");
	});

	test("properties nobody asked for are dropped", () => {
		expect(filterStyle("position: fixed; top: 0; color: red")).toBe("color: red");
		expect(filterStyle("width: 9999px")).toBe("");
	});

	test.each([
		"background: url(javascript:alert(1))",
		"color: expression(alert(1))",
		"background-color: url('http://example.com/track.png')",
		"color: \\0063olor",
		"font-size: 12px /* } body { display:none */",
	])("refuses %s", (style) => {
		expect(filterStyle(style)).toBe("");
	});

	test("an import cannot be smuggled in", () => {
		expect(filterStyle("color: red; @import url(x)")).toBe("color: red");
	});

	test("a style that says nothing allowed comes back empty", () => {
		expect(filterStyle("")).toBe("");
		expect(filterStyle("nonsense")).toBe("");
	});
});

describe("deciding whether to take an update from someone else", () => {
	test("new text from elsewhere is taken", () => {
		expect(shouldApplyIncomingNote("<p>new</p>", "<p>old</p>")).toBe(true);
	});

	test("text we already put in is not applied again", () => {
		// Without this the editor is rewritten on every change it caused itself, which
		// loops: applying fires a change, which writes back, which applies again.
		expect(shouldApplyIncomingNote("<p>same</p>", "<p>same</p>")).toBe(false);
	});

	test("the first update is taken, since nothing has been applied yet", () => {
		expect(shouldApplyIncomingNote("<p>first</p>", null)).toBe(true);
	});

	test("an emptied note is taken like any other change", () => {
		expect(shouldApplyIncomingNote("", "<p>was here</p>")).toBe(true);
	});

	test("being focused is not a reason to ignore an update", () => {
		// Skipping while focused meant that clicking into a note to read it stopped all
		// further updates from showing, which reads as sync being broken.
		expect(shouldApplyIncomingNote("<p>theirs</p>", "<p>mine</p>")).toBe(true);
	});
});
