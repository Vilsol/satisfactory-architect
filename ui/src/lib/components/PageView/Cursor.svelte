<script lang="ts">
    import { Spring } from "svelte/motion";
    import PresetSvg from "../icons/PresetSvg.svelte";

	interface Props {
		x: number,
		y: number,
		color: string,
		name?: string,
	}
	const { x, y, color, name }: Props = $props();

	const xSpring = Spring.of(() => x, { damping: 0.6, stiffness: 0.08 });
	const ySpring = Spring.of(() => y, { damping: 0.6, stiffness: 0.08 });
</script>

<g
	class="cursor"
	style="--cursor-x: {xSpring.current}px; --cursor-y: {ySpring.current}px;"
	>
	<PresetSvg name="cursor" size={20} color={color} />
	{#if name}
		<foreignObject x={14} y={16} width={160} height={22}>
			<div class="name-tag" style="--tag-color: {color};">{name}</div>
		</foreignObject>
	{/if}
</g>

<style>
	.cursor {
		transform: translate(var(--cursor-x), var(--cursor-y));
	}

	.name-tag {
		display: inline-block;
		max-width: 100%;
		padding: 1px 5px;
		border-radius: 4px;
		background-color: var(--tag-color);
		color: #fff;
		font-size: 10px;
		font-weight: 600;
		line-height: 14px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		/* The colour is the user's own, so guarantee the text stays readable on it. */
		text-shadow: 0 0 2px rgba(0, 0, 0, 0.55);
	}
</style>
