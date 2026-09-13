<script lang="ts">
	import type { GraphPage } from "$lib/datamodel/GraphPage.svelte";
	import { ServerConnectionState, type ServerConnection } from "$lib/sync/ServerConnection.svelte";
	import { settings } from "$lib/settings.svelte";
	import { displayIdentity } from "$lib/datamodel/userIdentity.svelte";
    import Cursor from "./Cursor.svelte";

	interface Props {
		page: GraphPage;
		serverConnection: ServerConnection;
	}
	const { page, serverConnection }: Props = $props();

	const isInRoom = $derived(serverConnection.state === ServerConnectionState.InRoom);

	// Filter other clients on the same page
	const visibleClients = $derived(
		serverConnection.otherClients.filter(client => client.currentPageId === page.id && client.userId !== serverConnection.ownUserId)
	);
</script>

{#if isInRoom && settings.showOtherCursors.value}
	<g class="cursor-overlay">
		{#each visibleClients as client (client.userId)}
			{@const shown = displayIdentity(client.userId, client.identity)}
			<Cursor x={client.cursor.x} y={client.cursor.y} color={shown.color} name={shown.name} />
		{/each}
	</g>
{/if}

<style>
	.cursor-overlay {
		pointer-events: none;
	}
</style>
