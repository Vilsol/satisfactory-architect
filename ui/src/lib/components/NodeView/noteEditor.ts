/**
 * Putting stored text into a note's editor.
 *
 * Lives outside the component so it can be tested against a real editor: what it has to
 * get right is a side effect of the editor library, which no amount of reading the
 * component would reveal.
 */

import type QuillEditor from "quill";
import { noteContentToSafeHtml } from "$lib/datamodel/noteContent";

/**
 * Show `content` in the editor without it counting as an edit by the person using it.
 */
export function applyNoteContent(quill: QuillEditor, content: string): void {
	const hadFocus = quill.hasFocus();
	const caret = hadFocus ? quill.getSelection() : null;
	const focusedBefore = document.activeElement as HTMLElement | null;

	quill.clipboard.dangerouslyPasteHTML(noteContentToSafeHtml(content), "silent");

	if (hadFocus) {
		// Replacing the contents throws the caret to the start, which is unpleasant if
		// somebody else edits the note while this person is typing in it.
		if (caret) {
			const end = Math.max(quill.getLength() - 1, 0);
			quill.setSelection(Math.min(caret.index, end), 0, "silent");
		}
		return;
	}

	// Putting text in focuses the editor whether we asked for it or not: the editor sets
	// the caret afterwards, and setting a caret focuses. Neither drawing a note for the
	// first time nor receiving somebody else's edit is something this person did, so the
	// keyboard has to go back where it was. While a note holds it, every shortcut on the
	// page - copy, paste, delete - is typed into the note instead.
	quill.blur();
	if (focusedBefore && focusedBefore !== quill.root && focusedBefore.isConnected) {
		focusedBefore.focus();
	}
}
