// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from "vitest";
import type QuillEditor from "quill";
import { applyNoteContent } from "./noteEditor";

/*
 * A note gets its text put into it whenever it is first drawn and whenever somebody else
 * edits it. Neither is something the person at this machine asked for, so neither may
 * take the keyboard off whatever they are actually doing.
 *
 * It matters more than it sounds: while a note has the keyboard, every shortcut on the
 * page - copy, paste, delete, rotate - goes into the note instead of to the page.
 */

let Quill: typeof QuillEditor;

beforeEach(async () => {
	document.body.innerHTML = "";
	// jsdom has no layout, so a Range cannot say where it is. The editor asks when it
	// scrolls the caret into view; nothing here depends on the answer.
	if (!Range.prototype.getBoundingClientRect) {
		Range.prototype.getBoundingClientRect = () => new DOMRect();
		Range.prototype.getClientRects = () => Object.assign([], { item: () => null }) as any;
	}
	({ default: Quill } = await import("quill"));
});

function editor() {
	const host = document.createElement("div");
	document.body.appendChild(host);
	return new Quill(host);
}

function somethingElseToFocus() {
	const input = document.createElement("input");
	document.body.appendChild(input);
	return input;
}

describe("text arriving in a note nobody is in", () => {
	test("does not take the keyboard off what you were typing in", () => {
		const quill = editor();
		const elsewhere = somethingElseToFocus();
		elsewhere.focus();

		applyNoteContent(quill, "<p>someone else typed this</p>");

		expect(document.activeElement, "the note stole the keyboard").toBe(elsewhere);
		expect(quill.hasFocus()).toBe(false);
	});

	test("does not grab the keyboard when nothing had it", () => {
		// This is what happens on every note the moment the page is drawn.
		const quill = editor();

		applyNoteContent(quill, "<p>drawn for the first time</p>");

		expect(quill.hasFocus(), "a note grabbed the keyboard on its own").toBe(false);
	});

	test("with several notes on the page, none of them ends up holding it", () => {
		const notes = [editor(), editor(), editor()];
		for (const note of notes) {
			applyNoteContent(note, "<p>a note</p>");
		}
		expect(notes.some(note => note.hasFocus()), "one of the notes kept the keyboard").toBe(false);
	});

	test("the text still arrives", () => {
		const quill = editor();
		applyNoteContent(quill, "<p>the text</p>");
		expect(quill.getText()).toContain("the text");
	});
});

describe("text arriving in the note you are typing in", () => {
	test("leaves you in it", () => {
		const quill = editor();
		quill.focus();
		applyNoteContent(quill, "<p>their edit</p>");
		expect(quill.hasFocus(), "you were thrown out of the note you were editing").toBe(true);
	});

	test("puts the caret back rather than throwing it to the start", () => {
		const quill = editor();
		applyNoteContent(quill, "<p>abcdef</p>");
		quill.focus();
		quill.setSelection(4, 0);

		applyNoteContent(quill, "<p>abcdefgh</p>");

		expect(quill.getSelection()?.index).toBe(4);
	});

	test("the caret does not run off the end of a note that got shorter", () => {
		const quill = editor();
		applyNoteContent(quill, "<p>a long piece of text</p>");
		quill.focus();
		quill.setSelection(15, 0);

		applyNoteContent(quill, "<p>short</p>");

		const caret = quill.getSelection()?.index ?? 0;
		expect(caret).toBeLessThanOrEqual(quill.getLength() - 1);
	});
});

describe("what arrives is cleaned on the way in", () => {
	test("a script sent by someone else never reaches the page", () => {
		const quill = editor();
		applyNoteContent(quill, "<p>ok</p><script>alert(1)</script>");
		expect(quill.root.innerHTML.toLowerCase()).not.toContain("script");
	});
});
