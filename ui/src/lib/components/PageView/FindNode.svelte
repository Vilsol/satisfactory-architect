<script lang="ts">
	import type { GraphPage } from "$lib/datamodel/GraphPage.svelte";
	import type { GraphNode } from "$lib/datamodel/GraphNode.svelte";
	import { isNodeSelectable, nodeDisplayName } from "$lib/datamodel/nodeTypeProperties.svelte";

	interface Props {
		page: GraphPage;
		open: boolean;
		onClose: () => void;
	}

	let { page, open, onClose }: Props = $props();

	let query = $state("");
	let highlighted = $state(0);
	let inputElement: HTMLInputElement | undefined = $state();

	const candidates = $derived.by(() => {
		const all: { node: GraphNode; name: string }[] = [];
		for (const node of page.nodes.values()) {
			if (node.parentNode !== null || !isNodeSelectable(node)) {
				continue;
			}
			all.push({ node, name: nodeDisplayName(node) });
		}
		return all.sort((a, b) => a.name.localeCompare(b.name, "en"));
	});

	const matches = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		const list = needle === ""
			? candidates
			: candidates.filter(c => c.name.toLowerCase().includes(needle));
		return list.slice(0, 40);
	});

	$effect(() => {
		if (open) {
			inputElement?.focus();
			inputElement?.select();
		}
	});

	$effect(() => {
		void matches;
		highlighted = 0;
	});

	function jumpTo(node: GraphNode) {
		page.clearAllSelection();
		page.selectedNodes.add(node.id);
		page.centerOnNode(node);
		onClose();
	}

	function onKeyDown(event: KeyboardEvent) {
		if (event.key === "Escape") {
			onClose();
			event.preventDefault();
		} else if (event.key === "ArrowDown") {
			highlighted = Math.min(highlighted + 1, matches.length - 1);
			event.preventDefault();
		} else if (event.key === "ArrowUp") {
			highlighted = Math.max(highlighted - 1, 0);
			event.preventDefault();
		} else if (event.key === "Enter") {
			const chosen = matches[highlighted];
			if (chosen) {
				jumpTo(chosen.node);
			}
			event.preventDefault();
		}
		event.stopPropagation();
	}
</script>

{#if open}
	<div class="find-node">
		<input
			bind:this={inputElement}
			bind:value={query}
			onkeydown={onKeyDown}
			placeholder="Find a building, splitter or note..."
			spellcheck="false"
		/>
		<div class="results">
			{#each matches as match, index (match.node.id)}
				<button
					class="result"
					class:highlighted={index === highlighted}
					onclick={() => jumpTo(match.node)}
					onmouseenter={() => highlighted = index}
				>
					{match.name}
				</button>
			{:else}
				<div class="empty">Nothing matches "{query}"</div>
			{/each}
		</div>
	</div>
{/if}

<style lang="scss">
	.find-node {
		position: absolute;
		top: calc(var(--properties-toolbar-height) + 10px);
		left: 50%;
		transform: translateX(-50%);
		width: min(360px, calc(100% - 40px));
		background-color: var(--toolbar-background-color);
		border: 2px solid var(--toolbar-border-color);
		border-radius: var(--rounded-border-radius);
		overflow: hidden;
		z-index: 5;
	}

	input {
		width: 100%;
		box-sizing: border-box;
		padding: 7px 9px;
		background: none;
		border: none;
		border-bottom: 1px solid var(--toolbar-border-color);
		color: inherit;
		font: inherit;
		font-size: 13px;

		&:focus {
			outline: none;
		}
	}

	.results {
		max-height: 260px;
		overflow-y: auto;
	}

	.result {
		display: block;
		width: 100%;
		padding: 5px 9px;
		background: none;
		border: none;
		color: inherit;
		font: inherit;
		font-size: 12px;
		text-align: left;
		cursor: pointer;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;

		&.highlighted {
			background-color: var(--toolbar-border-color);
		}
	}

	.empty {
		padding: 7px 9px;
		font-size: 12px;
		opacity: 0.6;
	}
</style>
