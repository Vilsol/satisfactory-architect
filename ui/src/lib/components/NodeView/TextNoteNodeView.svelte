<script lang="ts">
	import { settings } from "$lib/settings.svelte";
	import { isNodeSelectable } from "../../datamodel/nodeTypeProperties.svelte";
	import type { GraphNode, GraphNodeTextNoteProperties } from "../../datamodel/GraphNode.svelte";
	import { shouldApplyIncomingNote } from "../../datamodel/noteContent";
	import { applyNoteContent } from "./noteEditor";
	// Quill reaches for `document` as soon as it is imported, and this page is
	// prerendered on a server that has none. It is pulled in after mount instead, which
	// also keeps it out of the main bundle until a note actually needs it.
	import type QuillEditor from "quill";

	interface Props {
		node: GraphNode<GraphNodeTextNoteProperties>;
	}
	const {
		node,
	}: Props = $props();

	const page = $derived(node.context.page);

	/**
	 * Slack around the note for the formatting bar to float in.
	 *
	 * A foreignObject clips whatever sticks out of it. The bar is centred over the note
	 * and is several hundred pixels wide, so too little room here clips BOTH ends of it
	 * - the buttons are still drawn but the ones near the edges cannot be clicked, which
	 * looks like those particular buttons being broken.
	 */
	const TOOLBAR_ROOM = 360;

	const isSelected = $derived(page.selectedNodes.has(node.id));
	const isSelectable = $derived(isNodeSelectable(node));

	let div: HTMLDivElement|null = $state(null);
	let editorHost: HTMLDivElement|null = $state(null);
	let quill: QuillEditor|null = $state(null);
	/**
	 * The last text this note put into, or took out of, the editor. Compared against
	 * what arrives so the editor is not rewritten with something it already has.
	 */
	let lastApplied: string|null = null;

	function updateSize() {
		if (!div) return;
		const rect = div.getBoundingClientRect();
		const scale = page.view.scale;
		node.size.x = rect.width / scale;
		node.size.y = rect.height / scale;
	}

	$effect(() => {
		const host = editorHost;
		if (!host || quill) {
			return;
		}
		let abandoned = false;
		void (async () => {
			const [{ default: Quill }] = await Promise.all([
				import("quill"),
				import("quill/dist/quill.bubble.css"),
			]);
			if (abandoned || !editorHost) {
				return;
			}
			startEditor(Quill, host);
		})();
		return () => {
			abandoned = true;
		};
	});

	function startEditor(Quill: typeof QuillEditor, host: HTMLDivElement) {
		quill = new Quill(host, {
			theme: "bubble",
			placeholder: "Note",
			modules: {
				toolbar: [
					["bold", "italic", "underline", "strike"],
					[{ size: ["small", false, "large", "huge"] }],
					[{ color: [] }, { background: [] }],
					[{ list: "ordered" }, { list: "bullet" }],
					["clean"],
				],
			},
		});
		// Factory notes are full of item names and rates, so the spelling underlines are
		// noise rather than help.
		quill.root.setAttribute("spellcheck", "false");

		// Whatever is already stored, shown safely - it may have come from someone else.
		applyContent(node.properties.content);
		quill.on("text-change", (_delta, _old, source) => {
			// Only a person typing is an edit. Putting someone else's text in also
			// raises this, and writing that straight back starts a loop between the
			// two machines - and, because this runs inside an effect that reads the
			// same value, makes the effect depend on its own output.
			if (source !== "user") {
				return;
			}
			lastApplied = quill!.getSemanticHTML();
			node.properties.content = lastApplied;
			setTimeout(updateSize, 0);
		});
		updateSize();
	}

	/** Put stored text into the editor without it counting as an edit. */
	function applyContent(content: string) {
		if (!quill) {
			return;
		}
		lastApplied = content;
		applyNoteContent(quill, content);
	}

	// Someone else edited this note.
	$effect(() => {
		const incoming = node.properties.content;
		if (!quill) {
			return;
		}
		if (!shouldApplyIncomingNote(incoming, lastApplied)) {
			return;
		}
		applyContent(incoming);
		setTimeout(updateSize, 0);
	});

	$effect(updateSize);
</script>

<g
	class="text-note"
	class:selectable={isSelectable}
	class:selected={isSelected}
>
	<rect
		class="background"
		x={-node.size.x / 2}
		y={-node.size.y / 2}
		width={node.size.x}
		height={node.size.y}
	/>
	<foreignObject
		class="note-frame"
		x={-node.size.x / 2 - TOOLBAR_ROOM}
		y={-node.size.y / 2 - TOOLBAR_ROOM}
		width={node.size.x + TOOLBAR_ROOM * 2}
		height={node.size.y + TOOLBAR_ROOM * 2}
	>
		<div class="overflow-area" style="padding: {TOOLBAR_ROOM}px;">
			<div class="content-wrapper" bind:this={div}>
				<div class="content" bind:this={editorHost}></div>
			</div>
		</div>
	</foreignObject>
	{#if settings.debugShowNodeIds.value}
		<text
			x="0"
			y={-node.size.y / 2}
			text-anchor="middle"
			style="pointer-events: none; font-size: 11px; font-family: monospace;"
		>
			n {node.id}
		</text>
	{/if}
</g>

<style lang="scss">
	.text-note {
		.background {
			fill: var(--node-background-color);
			stroke: var(--node-border-color);
			stroke-width: var(--rounded-border-width);
			rx: var(--rounded-border-radius-big);
			ry: var(--rounded-border-radius-big);
			transition: stroke 0.1s ease-in-out;
		}

		// The box is far bigger than the note so the formatting bar has somewhere to
		// float. That empty space sits over other things on the page, so nothing in it
		// may catch the pointer - only the note itself and the bar, which switch it
		// back on. The foreignObject is hit-testable in its own right, so turning it
		// off on the div inside is not enough.
		.note-frame {
			pointer-events: none;
		}

		.overflow-area {
			pointer-events: none;
			width: max-content;
			height: max-content;
		}

		.content-wrapper {
			pointer-events: auto;
			padding: 4px 8px;
			width: max-content;
			height: max-content;
			min-width: 50px;
			min-height: 50px;
		}

		.content {
			width: max-content;
			height: max-content;
			font-size: 12px;
		}

		&:hover:not(.selected) {
			.background {
				stroke: var(--node-border-hover-color);
			}
		}

		&.selected {
			.background {
				stroke: var(--node-border-selected-color);
			}
		}
	}

	// Quill draws its own chrome; keep it out of the way of the note itself.
	.text-note :global(.ql-editor) {
		padding: 0;
		width: max-content;
		height: max-content;
		min-width: 42px;
		line-height: 1.35;
		overflow: visible;
	}

	.text-note :global(.ql-container) {
		font-family: inherit;
		font-size: inherit;
		border: none;
		width: max-content;
		height: max-content;
	}

	.text-note :global(.ql-editor.ql-blank::before) {
		left: 0;
		right: 0;
		font-style: normal;
		opacity: 0.45;
		color: inherit;
	}

	// Quill indents both the list and each item by 1.5em, which on a small note reads as
	// a large empty margin. The marker is drawn by a ::before pulled back by the item's
	// own indent, so the two have to stay in step.
	.text-note :global(.ql-editor ol),
	.text-note :global(.ql-editor ul) {
		padding-left: 0;
	}

	.text-note :global(.ql-editor li) {
		padding-left: 1.2em;
	}

	.text-note :global(.ql-editor li > .ql-ui:before) {
		margin-left: -1.2em;
		width: 1em;
	}

	// Formatting must show even if something on the page has flattened these tags.
	.text-note :global(.ql-editor strong),
	.text-note :global(.ql-editor b) {
		font-weight: 700;
	}

	.text-note :global(.ql-editor em),
	.text-note :global(.ql-editor i) {
		font-style: italic;
	}

	.text-note :global(.ql-editor u) {
		text-decoration: underline;
	}

	.text-note :global(.ql-editor s) {
		text-decoration: line-through;
	}

	// The formatting bar floats over the canvas rather than being part of the note, so
	// it must not inherit the note's width - otherwise it wraps into a tall column.
	.text-note :global(.ql-bubble .ql-tooltip) {
		pointer-events: auto;
		width: max-content;
		max-width: none;
		white-space: nowrap;
		z-index: 10;
	}

	.text-note :global(.ql-bubble .ql-toolbar) {
		display: flex;
		flex-wrap: nowrap;
		align-items: center;
		width: max-content;
	}

	.text-note :global(.ql-bubble .ql-toolbar .ql-formats) {
		display: inline-flex;
		flex-wrap: nowrap;
		margin-right: 8px;
	}

	// Quill puts its colour grids in a popup of their own; keep those readable too.
	.text-note :global(.ql-bubble .ql-picker-options) {
		white-space: normal;
		width: max-content;
	}
</style>
