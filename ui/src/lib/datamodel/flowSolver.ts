/**
 * Flow solver for a single item type.
 *
 * Given producers with a fixed output rate, consumers with a fixed demand and
 * belts connecting them, work out how much actually travels along each belt.
 *
 * It solves for two things, in order:
 *
 *  1. Move as much as possible from producers to consumers.
 *  2. Among all the ways of doing that, pick the one that spreads the load most
 *     evenly, i.e. the one with the smallest sum of squared belt rates.
 *
 * Step 2 matters because step 1 on its own has no single answer. A splitter whose
 * two branches rejoin can send 30/30 or 60/0 and move the same total; without a
 * tie-break the numbers on screen would jump around whenever anything was edited.
 * Minimising the sum of squares picks 30/30, and picks it uniquely.
 */

const EPS = 1e-9;

export interface FlowNodeSpec {
	id: string;
	/** How much this node makes per minute. Omit for anything that only passes items along. */
	supply?: number;
	/** How much this node wants per minute. */
	demand?: number;
}

export interface FlowEdgeSpec {
	id: string;
	from: string;
	to: string;
	/** Overflow belts are only used once every ordinary belt has taken what it can. */
	isDrain?: boolean;
}

export interface FlowResult {
	/** How much travels along each belt. */
	edgeFlow: Map<string, number>;
	/** Produced but not shipped, per producer. */
	surplus: Map<string, number>;
	/** Wanted but not received, per consumer. */
	shortfall: Map<string, number>;
	/** Total moved from producers to consumers. */
	totalFlow: number;
	/**
	 * Per consumer: what it would receive if it asked for as much as it liked, with
	 * everything else left as it is. Lets the tool offer "you are being given more
	 * than you use - take all of it".
	 */
	potentialInflow: Map<string, number>;
	/** Per producer: what it would ship if it could make as much as it liked. */
	potentialOutflow: Map<string, number>;
}

interface Arc {
	to: number;
	/** Remaining room to push. Infinite for belts, finite for producer/consumer limits. */
	residual: number;
	/** Index of this arc's counterpart in adjacency[to]. */
	rev: number;
	/** Index into `edges` when this arc is a belt in its natural direction, else -1. */
	edge: number;
	/** True when pushing on this arc undoes flow on a belt. */
	isUndo: boolean;
	/** Extra preference cost. Drain belts carry a positive one so they are used last. */
	bias: number;
}

/**
 * Penalty that makes an overflow belt lose to an ordinary one whenever they compete.
 *
 * An ordinary belt resists carrying more the more it already carries - that is what
 * spreads load evenly - and that resistance grows with the rates involved. So a fixed
 * penalty is only decisive up to some size of factory, above which overflow belts
 * quietly start being treated as ordinary ones. Scaling it with the problem keeps the
 * ranking absolute at any rate.
 *
 * A belt can never carry more than the total produced, so its resistance is at most
 * 2 x that; a loop can string together at most one such belt per edge. Four times
 * that bound leaves plenty of margin.
 */
function drainPenalty(totalSupply: number, edgeCount: number): number {
	return 4 * (edgeCount + 1) * Math.max(totalSupply, 1) + 1;
}

class Network {
	readonly adjacency: Arc[][] = [];
	/** Flow currently on each belt, indexed the same as the edge list. */
	readonly edgeFlow: number[] = [];

	constructor(nodeCount: number) {
		for (let i = 0; i < nodeCount; i++) {
			this.adjacency.push([]);
		}
	}

	addArc(from: number, to: number, capacity: number, edge: number, bias: number): void {
		const forward: Arc = {
			to, residual: capacity, rev: this.adjacency[to].length, edge, isUndo: false, bias,
		};
		const backward: Arc = {
			to: from, residual: 0, rev: this.adjacency[from].length, edge, isUndo: true, bias: -bias,
		};
		this.adjacency[from].push(forward);
		this.adjacency[to].push(backward);
	}

	push(from: number, arc: Arc, amount: number): void {
		this.apply(arc, amount);
		this.journal?.push({ arc, amount });
	}

	private apply(arc: Arc, amount: number): void {
		arc.residual -= amount;
		this.adjacency[arc.to][arc.rev].residual += amount;
		if (arc.edge >= 0) {
			this.edgeFlow[arc.edge] += arc.isUndo ? -amount : amount;
		}
	}

	/**
	 * Start noting every push so it can be taken back again.
	 *
	 * Used for the "what could this end manage" probes. Copying the whole network to
	 * restore it afterwards would cost as much as the network is big, once per joint,
	 * which turns a quick calculation into a slow one on a large factory. Undoing only
	 * what was actually done costs as much as the probe did.
	 */
	beginRecording(): void {
		this.journal = [];
	}

	rollback(): void {
		const journal = this.journal;
		this.journal = null;
		if (!journal) {
			return;
		}
		for (let i = journal.length - 1; i >= 0; i--) {
			this.apply(journal[i].arc, -journal[i].amount);
		}
	}

	private journal: { arc: Arc; amount: number }[] | null = null;
}

/** Steepness of the squared-rate objective for one more unit along this arc. */
function gradient(network: Network, arc: Arc): number {
	if (arc.edge < 0) {
		return arc.bias;
	}
	const flow = network.edgeFlow[arc.edge];
	return (arc.isUndo ? -2 * flow : 2 * flow) + arc.bias;
}

export function solveFlow(nodes: FlowNodeSpec[], edges: FlowEdgeSpec[]): FlowResult {
	const index = new Map<string, number>();
	for (const node of nodes) {
		index.set(node.id, index.size);
	}
	const source = index.size;
	const sink = index.size + 1;
	const network = new Network(index.size + 2);

	let totalSupply = 0;
	for (const node of nodes) {
		if (node.supply !== undefined && node.supply > EPS) {
			totalSupply += node.supply;
		}
	}
	const penalty = drainPenalty(totalSupply, edges.length);

	const usableEdges: FlowEdgeSpec[] = [];
	for (const edge of edges) {
		const from = index.get(edge.from);
		const to = index.get(edge.to);
		if (from === undefined || to === undefined || from === to) {
			continue;
		}
		const at = usableEdges.length;
		usableEdges.push(edge);
		network.edgeFlow.push(0);
		network.addArc(from, to, Infinity, at, edge.isDrain ? penalty : 0);
	}

	for (const node of nodes) {
		const at = index.get(node.id)!;
		if (node.supply !== undefined && node.supply > EPS) {
			network.addArc(source, at, node.supply, -1, 0);
		}
		if (node.demand !== undefined && node.demand > EPS) {
			network.addArc(at, sink, node.demand, -1, 0);
		}
	}

	const totalFlow = maximiseFlow(network, source, sink);
	if (totalFlow > EPS) {
		spreadEvenly(network, totalSupply);
	}

	const edgeFlow = new Map<string, number>();
	for (let i = 0; i < usableEdges.length; i++) {
		edgeFlow.set(usableEdges[i].id, clean(network.edgeFlow[i]));
	}
	for (const edge of edges) {
		if (!edgeFlow.has(edge.id)) {
			edgeFlow.set(edge.id, 0);
		}
	}

	const surplus = new Map<string, number>();
	const shortfall = new Map<string, number>();
	const potentialInflow = new Map<string, number>();
	const potentialOutflow = new Map<string, number>();
	for (const node of nodes) {
		const at = index.get(node.id)!;
		if (node.supply !== undefined && node.supply > EPS) {
			const arc = network.adjacency[source].find(a => a.to === at && !a.isUndo)!;
			surplus.set(node.id, clean(arc.residual));
			potentialOutflow.set(node.id, clean(
				node.supply - arc.residual + withArcUncapped(network, arc, () => maximiseFlow(network, source, sink)),
			));
		}
		if (node.demand !== undefined && node.demand > EPS) {
			const arc = network.adjacency[at].find(a => a.to === sink && !a.isUndo)!;
			shortfall.set(node.id, clean(arc.residual));
			potentialInflow.set(node.id, clean(
				node.demand - arc.residual + withArcUncapped(network, arc, () => maximiseFlow(network, source, sink)),
			));
		}
	}

	return {
		edgeFlow, surplus, shortfall, totalFlow: clean(totalFlow),
		potentialInflow, potentialOutflow,
	};
}

/**
 * Pretend one producer or consumer has no limit of its own, run `body`, then put the
 * network back exactly as it was. Used to ask "how much could this end manage if it
 * were the only thing that changed" without disturbing the answer already worked out.
 */
function withArcUncapped(network: Network, arc: Arc, body: () => number): number {
	const savedResidual = arc.residual;
	network.beginRecording();
	try {
		arc.residual = Infinity;
		return body();
	} finally {
		network.rollback();
		arc.residual = savedResidual;
	}
}

function clean(value: number): number {
	const rounded = Math.round(value * 1e6) / 1e6;
	return Object.is(rounded, -0) ? 0 : rounded;
}

/** Dinic's algorithm: move as much as possible from source to sink. */
function maximiseFlow(network: Network, source: number, sink: number): number {
	const count = network.adjacency.length;
	const level = new Array<number>(count);
	const next = new Array<number>(count);
	let total = 0;

	const buildLevels = (): boolean => {
		level.fill(-1);
		level[source] = 0;
		const queue = [source];
		for (let head = 0; head < queue.length; head++) {
			const at = queue[head];
			for (const arc of network.adjacency[at]) {
				if (arc.residual > EPS && level[arc.to] < 0) {
					level[arc.to] = level[at] + 1;
					queue.push(arc.to);
				}
			}
		}
		return level[sink] >= 0;
	};

	const augment = (at: number, limit: number): number => {
		if (at === sink) {
			return limit;
		}
		for (; next[at] < network.adjacency[at].length; next[at]++) {
			const arc = network.adjacency[at][next[at]];
			if (arc.residual <= EPS || level[arc.to] !== level[at] + 1) {
				continue;
			}
			const moved = augment(arc.to, Math.min(limit, arc.residual));
			if (moved > EPS) {
				network.push(at, arc, moved);
				return moved;
			}
		}
		level[at] = -1;
		return 0;
	};

	while (buildLevels()) {
		next.fill(0);
		let moved = augment(source, Infinity);
		while (moved > EPS) {
			total += moved;
			moved = augment(source, Infinity);
		}
	}
	return total;
}

/**
 * Rearrange the flow, without changing how much is moved in total, until no
 * redistribution would make the sum of squared belt rates any smaller.
 *
 * Each round looks for a loop in the residual network whose rates could be nudged
 * round to reduce that sum, and nudges it by exactly the amount that helps most.
 */
function spreadEvenly(network: Network, scale: number): void {
	const count = network.adjacency.length;
	const tolerance = Math.max(scale, 1) * 1e-9;
	const maxRounds = 4 * count * count + 200;

	for (let round = 0; round < maxRounds; round++) {
		const cycle = findImprovingCycle(network, tolerance);
		if (!cycle) {
			return;
		}

		let slope = 0;
		let curvature = 0;
		let headroom = Infinity;
		for (const { from, arc } of cycle) {
			slope += gradient(network, arc);
			if (arc.edge >= 0) {
				curvature += 1;
			}
			headroom = Math.min(headroom, arc.residual);
		}
		if (slope >= -tolerance || curvature === 0) {
			return;
		}

		const best = -slope / (2 * curvature);
		const step = Math.min(best, headroom);
		if (!(step > tolerance)) {
			return;
		}
		for (const { from, arc } of cycle) {
			network.push(from, arc, step);
		}
	}
}

/**
 * Bellman-Ford over the residual network looking for a loop whose total gradient
 * is negative - meaning flow moved around it lowers the sum of squares.
 */
function findImprovingCycle(network: Network, tolerance: number): { from: number; arc: Arc }[] | null {
	const count = network.adjacency.length;
	const distance = new Array<number>(count).fill(0);
	const fromNode = new Array<number>(count).fill(-1);
	const viaArc = new Array<Arc | null>(count).fill(null);
	let touched = -1;

	for (let pass = 0; pass < count; pass++) {
		touched = -1;
		for (let at = 0; at < count; at++) {
			for (const arc of network.adjacency[at]) {
				if (arc.residual <= tolerance) {
					continue;
				}
				const candidate = distance[at] + gradient(network, arc);
				if (candidate < distance[arc.to] - tolerance) {
					distance[arc.to] = candidate;
					fromNode[arc.to] = at;
					viaArc[arc.to] = arc;
					touched = arc.to;
				}
			}
		}
		if (touched < 0) {
			return null;
		}
	}

	// `touched` sits on or downstream of a negative loop; walk back into it.
	let at = touched;
	for (let i = 0; i < count; i++) {
		at = fromNode[at];
		if (at < 0) {
			return null;
		}
	}

	const cycle: { from: number; arc: Arc }[] = [];
	let walk = at;
	do {
		const previous = fromNode[walk];
		const arc = viaArc[walk];
		if (previous < 0 || !arc) {
			return null;
		}
		cycle.push({ from: previous, arc });
		walk = previous;
	} while (walk !== at && cycle.length <= count);

	return cycle.length > 0 ? cycle.reverse() : null;
}
