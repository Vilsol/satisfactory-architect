<script lang="ts">
	import { base } from '$app/paths'
	import { iconPreview } from '$lib/iconPreviewsLoader.svelte';
	import { iconLayers } from './iconLayers';
	import { satisfactoryDatabase } from "$lib/satisfactoryDatabase";

	interface Props {
		icon: string;
		quality?: "max"|"min";
		size?: number;
		x?: number;
		y?: number;
	}
	const {
		icon,
		quality = "max",
		size,
		x = undefined,
		y = undefined,
	}: Props = $props();

	/** Set once the real image is actually up, so the stand-in can step aside. */
	let realHasLoaded = $state(false);
	const iconData = $derived(satisfactoryDatabase.icons[icon]);
	const resolution = $derived(quality === "max" ? iconData?.resolutions.at(0) : iconData?.resolutions.at(-1));
	const isInSvg = $derived(x !== undefined && y !== undefined);
	const imageSrc = $derived.by(() => {
		if (!iconData) {
			return "";
		}
		return `${base}/img/FactoryGame/${iconData?.name}_${resolution}.webp`;
	});
	const imagePreviewSrc = $derived.by(() => {
		if (!iconData) {
			return "";
		}
		return iconPreview(icon);
	});
	const layers = $derived(iconLayers({
		quality,
		hasStandIn: imagePreviewSrc !== "",
		realHasLoaded,
	}));
	const showPreview = $derived(layers.showStandIn);
	const showOriginal = $derived(layers.showReal);

	function onImageLoad() {
		realHasLoaded = true;
	}
</script>

{#if isInSvg}
	{#if showPreview}
		<image
			href={imagePreviewSrc}
			x={x}
			y={y}
			width={size}
			height={size}
		/>
	{/if}
	{#if showOriginal}
		<image
			href={imageSrc}
			x={x}
			y={y}
			width={size}
			height={size}
			onload={onImageLoad}
		/>
	{/if}
{:else}
	<div class="wrapper" style="width: {size}px; height: {size}px;">
		{#if showPreview}
			<img
				class="preview"
				src={imagePreviewSrc}
				width={size}
				height={size}
				loading={showOriginal ? "lazy" : "eager"}
			/>
		{/if}
		{#if showOriginal}
			<img
				src={imageSrc}
				width={size}
				height={size}
				loading="lazy"
				onload={onImageLoad}
			/>
		{/if}
	</div>
{/if}

<style lang="scss">
	.wrapper {
		position: relative;

		.preview {
			position: absolute;
			top: 0;
			left: 0;
		}
	}
</style>
