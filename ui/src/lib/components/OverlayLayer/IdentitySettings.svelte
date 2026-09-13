<script lang="ts">
	import {
		cleanUserName, fallbackName, isPresetColor, MAX_USER_NAME_LENGTH,
		normaliseColor, USER_COLORS, userColor, userName,
	} from "$lib/datamodel/userIdentity.svelte";

	interface Props {
		/** Used only to show what name you would be given if you pick none. */
		ownUserId: string | null;
	}
	const { ownUserId }: Props = $props();

	/** What the free-choice swatch should show: your colour if it is a custom one. */
	const customColor = $derived(
		userColor.value && !isPresetColor(userColor.value) ? userColor.value : "#7A5AF8",
	);
	const usingCustom = $derived(Boolean(userColor.value) && !isPresetColor(userColor.value));
</script>

<div class="field">
	<label for="display-name">Your Name</label>
	<input
		id="display-name"
		type="text"
		maxlength={MAX_USER_NAME_LENGTH}
		value={userName.value}
		oninput={(e) => userName.value = cleanUserName(e.currentTarget.value)}
		placeholder={fallbackName(ownUserId ?? "")}
	/>
	<p class="field-hint">Shown to everyone else in the session.</p>
</div>

<div class="field">
	<span class="label-like">Your Colour</span>
	<div class="color-choices">
		{#each USER_COLORS as choice (choice)}
			<button
				type="button"
				class="color-choice"
				class:chosen={userColor.value === choice}
				style="--choice: {choice};"
				aria-label={`Use colour ${choice}`}
				onclick={() => userColor.value = choice}
			></button>
		{/each}

		<!-- Any colour at all, through the browser's own picker. -->
		<label
			class="color-choice hue"
			class:chosen={usingCustom}
			style="--choice: {customColor};"
			title="Pick any colour"
		>
			<span class="sr-only">Pick any colour</span>
			<input
				type="color"
				value={customColor}
				oninput={(e) => userColor.value = normaliseColor(e.currentTarget.value)}
			/>
		</label>

		<button
			type="button"
			class="color-choice auto"
			class:chosen={!userColor.value}
			aria-label="Pick a colour for me"
			title="Pick one for me"
			onclick={() => userColor.value = ""}
		>A</button>
	</div>
</div>

<style lang="scss">
	// Mirrors the field styling in ConnectionOverlay. Svelte styles are scoped per
	// component, so it cannot be shared.
	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;

		label {
			font-size: 0.85rem;
			font-weight: 500;
			color: var(--background-600);
		}

		input[type="text"] {
			padding: 10px 12px;
			border-radius: var(--rounded-border-radius);
			border: 1px solid var(--popup-border-color);
			background-color: var(--background);
			color: inherit;
			font-size: 0.95rem;
			font-family: inherit;

			&:focus {
				border-color: var(--primary);
				outline: none;
			}

			&::placeholder {
				color: var(--background-400);
			}
		}
	}

	.field-hint {
		margin: 3px 0 0;
		font-size: 11px;
		opacity: 0.6;
	}

	.label-like {
		display: block;
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--background-600);
	}

	.color-choices {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}

	.color-choice {
		position: relative;
		width: 22px;
		height: 22px;
		padding: 0;
		border: 2px solid transparent;
		border-radius: 50%;
		background-color: var(--choice);
		cursor: pointer;

		&.auto {
			display: flex;
			align-items: center;
			justify-content: center;
			background-color: transparent;
			border-color: var(--toolbar-border-color);
			color: inherit;
			font-size: 11px;
			font-weight: 600;
		}

		// The full spectrum, so it reads as "any colour" rather than one more swatch.
		&.hue {
			background: conic-gradient(
				red, yellow, lime, aqua, blue, magenta, red
			);
			overflow: hidden;

			// The chosen colour shows in the middle so you can see what you picked.
			&::after {
				content: "";
				position: absolute;
				inset: 5px;
				border-radius: 50%;
				background-color: var(--choice);
			}

			input {
				position: absolute;
				inset: 0;
				width: 100%;
				height: 100%;
				opacity: 0;
				padding: 0;
				border: none;
				cursor: pointer;
			}
		}

		&.chosen {
			border-color: var(--text);
		}
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
