import { blockStateChanges, unblockStateChanges } from "./globals.svelte";
import type { GraphPage } from "./GraphPage.svelte";
import type { Id } from "./IdGen.svelte";
import { solvePageFlows } from "./throughputsSolver";

/**
 * Work out what travels along every belt on a page, and where the factory comes up
 * short or has product to spare.
 *
 * Each belt gets one rate. A shortage or a surplus is recorded on the joint it
 * belongs to, and then spread along the belts leading to or from it so the lines can
 * be coloured and the trouble traced back by eye.
 *
 * A page recalculates inside a $effect, so everything here is worked out in plain
 * maps first and only written onto the belts and joints at the very end. Reading
 * back a value written in the same pass would make the effect depend on its own
 * output and run forever.
 */
export function calculateThroughputs(page: GraphPage) {
	blockStateChanges();
	try {
		const flows = solvePageFlows(page);

		const surplus = new Map<Id, number>();
		const shortfall = new Map<Id, number>();
		for (const node of page.nodes.values()) {
			// A joint with nothing attached is an unfinished plan, not a problem.
			const connected = node.edges.size > 0;
			surplus.set(node.id, connected ? flows.surplus.get(node.id) ?? 0 : 0);
			shortfall.set(node.id, connected ? flows.shortfall.get(node.id) ?? 0 : 0);
		}

		const { shortfallAhead, surplusBehind } = spreadSlackAlongBelts(page, surplus, shortfall);

		for (const edge of page.edges.values()) {
			edge.flow = flows.edgeFlow.get(edge.id) ?? 0;
			edge.shortfallAhead = shortfallAhead.get(edge.id) ?? 0;
			edge.surplusBehind = surplusBehind.get(edge.id) ?? 0;
		}
		for (const node of page.nodes.values()) {
			node.surplus = surplus.get(node.id) ?? 0;
			node.shortfall = shortfall.get(node.id) ?? 0;
			node.balanceTarget = node.edges.size > 0 ? flows.balanceTarget.get(node.id) ?? 0 : 0;
		}
		for (const [nodeId, rate] of flows.autoRates) {
			const node = page.nodes.get(nodeId);
			if (node?.properties.type === "production" && node.properties.multiplier !== rate) {
				node.properties.multiplier = rate;
			}
		}
	} finally {
		unblockStateChanges();
	}
}

/**
 * Carry each shortage backwards and each surplus forwards through the belts, so a
 * starved building tints everything feeding it rather than just its last belt.
 *
 * The worst value wins rather than the sum, so a shortage is never counted twice
 * where two routes lead to the same place.
 */
function spreadSlackAlongBelts(
	page: GraphPage,
	surplus: Map<Id, number>,
	shortfall: Map<Id, number>,
): { shortfallAhead: Map<Id, number>; surplusBehind: Map<Id, number> } {
	const incoming = new Map<Id, Id[]>();
	const outgoing = new Map<Id, Id[]>();
	const listIn = (map: Map<Id, Id[]>, key: Id) => {
		let list = map.get(key);
		if (!list) {
			list = [];
			map.set(key, list);
		}
		return list;
	};
	for (const edge of page.edges.values()) {
		listIn(outgoing, edge.startNodeId).push(edge.id);
		listIn(incoming, edge.endNodeId).push(edge.id);
	}

	const shortfallAhead = new Map<Id, number>();
	const surplusBehind = new Map<Id, number>();

	const walk = (
		startNodeId: Id,
		amount: number,
		step: Map<Id, Id[]>,
		onwardsFrom: (edgeId: Id) => Id | undefined,
		into: Map<Id, number>,
	) => {
		const seen = new Set<Id>();
		let frontier = [startNodeId];
		while (frontier.length > 0) {
			const next: Id[] = [];
			for (const nodeId of frontier) {
				if (seen.has(nodeId)) continue;
				seen.add(nodeId);
				for (const edgeId of step.get(nodeId) ?? []) {
					if (amount > (into.get(edgeId) ?? 0)) {
						into.set(edgeId, amount);
					}
					const onwards = onwardsFrom(edgeId);
					if (onwards !== undefined && !seen.has(onwards)) {
						next.push(onwards);
					}
				}
			}
			frontier = next;
		}
	};

	for (const node of page.nodes.values()) {
		const short = shortfall.get(node.id) ?? 0;
		if (short > 0) {
			walk(node.id, short, incoming, id => page.edges.get(id)?.startNodeId, shortfallAhead);
		}
		const spare = surplus.get(node.id) ?? 0;
		if (spare > 0) {
			walk(node.id, spare, outgoing, id => page.edges.get(id)?.endNodeId, surplusBehind);
		}
	}

	return { shortfallAhead, surplusBehind };
}
