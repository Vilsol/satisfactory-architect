<script lang="ts">
	import { getContext, onDestroy, onMount } from "svelte";
	import type { EventStream } from "$lib/EventStream.svelte";
	import type { AppState } from "$lib/datamodel/AppState.svelte";
	import { checkDataModelConsistency, repairDataModelConsistency } from "$lib/datamodel/consistencyTools";
	import { allSettings, resetAllSettings, settingGroups, settingsInGroup, type Setting } from "$lib/settings.svelte";
	import IdentitySettings from "./IdentitySettings.svelte";

	interface Props {
		dismissEventStream: EventStream;
		onclose: () => void;
	}
	const { dismissEventStream, onclose }: Props = $props();

	const appState = getContext<AppState>("app-state");

	onMount(() => dismissEventStream.addListener(onclose));
	onDestroy(() => dismissEventStream.removeListener(onclose));

	const anyChanged = $derived(allSettings.some(setting => !setting.isDefault));

	/**
	 * A number field has to tolerate being empty while it is being typed in, so the
	 * setting is only written once what is there parses.
	 */
	function onNumberInput(setting: Setting<number>, raw: string) {
		const parsed = Number(raw);
		if (raw.trim() === "" || Number.isNaN(parsed)) {
			return;
		}
		if (setting.control.type !== "number") {
			return;
		}
		setting.value = Math.min(Math.max(parsed, setting.control.min), setting.control.max);
	}
</script>

<div class="background"></div>
<div class="settings-overlay">
	<div class="title">Settings</div>

	<div class="content scrollbar-thin">
		{#each settingGroups as group}
			<div class="group">
				<div class="group-title">{group}</div>

				{#each settingsInGroup(group) as setting (setting.key)}
					<div class="setting">
						{#if setting.control.type === "toggle"}
							<label class="row toggle-row">
								<input
									type="checkbox"
									checked={setting.value}
									onchange={e => setting.value = e.currentTarget.checked}
								/>
								<span class="labels">
									<span class="label">{setting.label}</span>
									{#if setting.description}
										<span class="hint">{setting.description}</span>
									{/if}
								</span>
							</label>
						{:else}
							<div class="row">
								<span class="labels">
									<span class="label">{setting.label}</span>
									{#if setting.description}
										<span class="hint">{setting.description}</span>
									{/if}
								</span>
								{#if setting.control.type === "choice"}
									<div class="choices">
										{#each setting.control.options as option (option.value)}
											<button
												type="button"
												class="choice"
												class:chosen={setting.value === option.value}
												onclick={() => setting.value = option.value}
											>{option.label}</button>
										{/each}
									</div>
								{:else if setting.control.type === "number"}
									<span class="number-field">
										<input
											type="number"
											min={setting.control.min}
											max={setting.control.max}
											step={setting.control.step}
											value={setting.value}
											oninput={e => onNumberInput(setting, e.currentTarget.value)}
										/>
										{#if setting.control.unit}
											<span class="unit">{setting.control.unit}</span>
										{/if}
									</span>
								{/if}
							</div>
						{/if}
					</div>
				{/each}

				{#if group === "Collaboration"}
					<div class="setting identity">
						<IdentitySettings ownUserId={appState?.serverConnection?.ownUserId ?? null} />
					</div>
				{/if}

				{#if group === "Debug"}
					<div class="setting actions">
						<button type="button" onclick={() => checkDataModelConsistency(appState)}>Check Consistency</button>
						<button type="button" onclick={() => repairDataModelConsistency(appState)}>Repair Inconsistencies</button>
					</div>
				{/if}
			</div>
		{/each}
	</div>

	<div class="buttons">
		<button class="secondary" disabled={!anyChanged} onclick={resetAllSettings}>Reset to defaults</button>
		<button class="confirm" onclick={onclose}>Close</button>
	</div>
</div>

<style lang="scss">
	.background {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background-color: var(--popup-block-area-background-color);
		pointer-events: none;
	}

	.settings-overlay {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		background-color: var(--popup-background-color);
		border: 1px solid var(--popup-border-color);
		padding: 24px;
		border-radius: var(--rounded-border-radius-big);
		box-shadow: var(--shadow-high);
		width: min(95vw, 560px);
		max-height: 85vh;
		display: flex;
		flex-direction: column;
	}

	.title {
		font-size: 1.5rem;
		font-weight: bold;
		margin-bottom: 16px;
		text-align: center;
		color: var(--text);
	}

	.content {
		flex: 1;
		overflow-y: auto;
		padding-right: 8px;
		margin-bottom: 20px;
	}

	.group {
		margin-bottom: 22px;

		&:last-child {
			margin-bottom: 0;
		}
	}

	.group-title {
		font-size: 0.8rem;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--background-600);
		border-bottom: 1px solid var(--popup-border-color);
		padding-bottom: 6px;
		margin-bottom: 10px;
	}

	.setting {
		padding: 6px 0;
	}

	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}

	// The whole row is the hit target for a checkbox, not just the box itself.
	.toggle-row {
		justify-content: flex-start;
		cursor: pointer;

		input[type="checkbox"] {
			flex-shrink: 0;
			width: 16px;
			height: 16px;
			accent-color: var(--primary);
			cursor: pointer;
		}
	}

	.labels {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.label {
		font-size: 0.95rem;
	}

	.hint {
		font-size: 11px;
		opacity: 0.6;
	}

	.choices {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		flex-shrink: 0;
	}

	.choice {
		background-color: var(--popup-button-background-color);
		color: var(--text);
		border: 1px solid transparent;
		border-radius: 6px;
		padding: 5px 10px;
		font-size: 0.85rem;
		font-family: inherit;
		cursor: pointer;

		&:hover {
			background-color: var(--popup-button-hover-background-color);
		}

		&.chosen {
			border-color: var(--primary);
			color: var(--primary);
		}
	}

	.number-field {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;

		input {
			width: 90px;
			padding: 7px 10px;
			border-radius: var(--rounded-border-radius);
			border: 1px solid var(--popup-border-color);
			background-color: var(--background);
			color: inherit;
			font-size: 0.9rem;
			font-family: inherit;

			&:focus {
				border-color: var(--primary);
				outline: none;
			}
		}

		.unit {
			font-size: 11px;
			opacity: 0.6;
		}
	}

	.identity {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding-top: 10px;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		padding-top: 8px;
	}

	.buttons {
		display: flex;
		justify-content: center;
		gap: 10px;
	}

	button {
		background-color: var(--popup-button-background-color);
		color: var(--text);
		padding: 10px 20px;
		border: none;
		border-radius: 6px;
		font-weight: bold;
		font-family: inherit;
		cursor: pointer;
		transition: background-color 0.2s;

		&:hover:not(:disabled) {
			background-color: var(--popup-button-hover-background-color);
		}

		&:active:not(:disabled) {
			background-color: var(--popup-button-active-background-color);
		}

		&:disabled {
			opacity: 0.45;
			cursor: default;
		}
	}

	.actions button {
		padding: 7px 12px;
		font-weight: normal;
		font-size: 0.85rem;
	}

	.buttons .confirm {
		padding: 10px 30px;
	}
</style>
