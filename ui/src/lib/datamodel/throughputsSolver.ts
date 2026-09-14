/**
 * Builds the flow problem for a page and hands it to the solver.
 *
 * Every belt carries exactly one item type and every joint is typed, so the page
 * is not one big tangled problem - it is a handful of small independent ones, one
 * per item type. Buildings link the item types together, but only through how big
 * they are and how hard they are being run, both fixed numbers by the time we get here.
 */

import { satisfactoryDatabase } from "$lib/satisfactoryDatabase";
import { outputFactor, portFactor } from "./overclocking";
import type { SFPowerFuel, SFRecipe } from "$lib/satisfactoryDatabaseTypes";
import { solveFlow, type FlowEdgeSpec, type FlowNodeSpec } from "./flowSolver";
import type { GraphNode, GraphNodeResourceJointProperties } from "./GraphNode.svelte";
import type { GraphPage } from "./GraphPage.svelte";
import type { Id } from "./IdGen.svelte";

export interface PageFlows {
	/** How much travels along each belt. */
	edgeFlow: Map<Id, number>;
	/** Made but not shipped, per output joint. */
	surplus: Map<Id, number>;
	/** Wanted but not received, per input joint. */
	shortfall: Map<Id, number>;
	/** Rates worked out for joints whose building is set to size itself automatically. */
	autoRates: Map<Id, number>;
	/**
	 * Per joint: the rate that would balance it against the other side of its belts.
	 * For an input joint that is everything upstream could give it; for an output
	 * joint, everything downstream would take.
	 */
	balanceTarget: Map<Id, number>;
}

interface Port {
	jointId: Id;
	itemClass: string;
	supply?: number;
	demand?: number;
	/** Set when the owning building sizes itself to whatever it is given. */
	autoOwner?: Id;
}

/** Collect every joint that produces or consumes, plus every splitter and merger. */
function collectPorts(page: GraphPage): { ports: Port[]; passThrough: Map<Id, string> } {
	const ports: Port[] = [];
	const passThrough = new Map<Id, string>();

	for (const node of page.nodes.values()) {
		const props = node.properties;

		if (props.type === "splitter" || props.type === "merger") {
			passThrough.set(node.id, props.resourceClassName);
			continue;
		}
		if (props.type !== "production") {
			continue;
		}

		const details = props.details;
		const auto = props.autoMultiplier ? node.id : undefined;

		const jointOf = (id: Id) =>
			page.nodes.get(id) as GraphNode<GraphNodeResourceJointProperties> | undefined;

		if (details.type === "recipe" || details.type === "power-production") {
			let recipe: SFRecipe | SFPowerFuel | undefined;
			if (details.type === "recipe") {
				recipe = satisfactoryDatabase.recipes[details.recipeClassName];
			} else {
				recipe = satisfactoryDatabase.powerProducers[details.powerBuildingClassName]
					?.fuels[details.fuelClassName];
			}
			if (!recipe) continue;
			for (const info of props.resourceJoints) {
				const joint = jointOf(info.id);
				if (!joint) continue;
				const parts = joint.properties.jointType === "input" ? recipe.inputs : recipe.outputs;
				const part = parts.find(p => p.itemClass === joint.properties.resourceClassName);
				if (!part) continue;
				const rate = part.amountPerMinute * props.multiplier
					* portFactor(props, joint.properties.jointType);
				ports.push(makePort(joint, info.type, rate, auto));
			}
		} else if (details.type === "extraction") {
			const building = satisfactoryDatabase.extractionBuildings[details.buildingClassName];
			if (!building) continue;
			const joint = jointOf(props.resourceJoints[0]?.id);
			if (!joint) continue;
			const rate = building.baseProductionRate * (details.purityModifier ?? 1) * props.multiplier
				* outputFactor(props);
			ports.push(makePort(joint, "output", rate, auto));
		} else if (details.type === "factory-input" || details.type === "factory-output") {
			const joint = jointOf(props.resourceJoints[0]?.id);
			if (!joint) continue;
			const type = details.type === "factory-input" ? "output" : "input";
			ports.push(makePort(joint, type, props.multiplier, auto));
		} else if (details.type === "factory-reference") {
			const extPage = page.context.appState.pages.find(p => p.id === details.factoryId);
			if (!extPage) continue;
			for (const info of props.resourceJoints) {
				const joint = jointOf(info.id);
				if (!joint) continue;
				const extId = details.jointsToExternalNodes[joint.id];
				if (!extId) continue;
				const extNode = extPage.nodes.get(extId);
				if (!extNode || extNode.properties.type !== "production") continue;
				ports.push(makePort(joint, info.type, extNode.properties.multiplier, auto));
			}
		}
	}

	return { ports, passThrough };
}

function makePort(
	joint: GraphNode<GraphNodeResourceJointProperties>,
	type: "input" | "output",
	rate: number,
	autoOwner: Id | undefined,
): Port {
	const port: Port = {
		jointId: joint.id,
		itemClass: joint.properties.resourceClassName,
		autoOwner,
	};
	if (type === "output") {
		port.supply = rate;
	} else {
		port.demand = rate;
	}
	return port;
}

export function solvePageFlows(page: GraphPage): PageFlows {
	const { ports, passThrough } = collectPorts(page);

	const itemOf = new Map<Id, string>();
	for (const port of ports) itemOf.set(port.jointId, port.itemClass);
	for (const [id, item] of passThrough) itemOf.set(id, item);

	// An automatically sized building has no rate of its own yet - it takes whatever
	// the rest of the page turns out to need. Give it plenty of room and make its
	// belts the least attractive, so real producers and consumers are served first.
	const headroomFor = new Map<string, number>();
	for (const port of ports) {
		if (port.autoOwner) continue;
		const item = port.itemClass;
		headroomFor.set(item, (headroomFor.get(item) ?? 0) + (port.supply ?? 0) + (port.demand ?? 0));
	}

	const nodesByItem = new Map<string, FlowNodeSpec[]>();
	const autoJoints = new Set<Id>();
	for (const port of ports) {
		const list = nodesByItem.get(port.itemClass) ?? [];
		if (port.autoOwner) {
			autoJoints.add(port.jointId);
			const headroom = Math.max(headroomFor.get(port.itemClass) ?? 0, 1) * 2;
			list.push({
				id: port.jointId,
				supply: port.supply !== undefined ? headroom : undefined,
				demand: port.demand !== undefined ? headroom : undefined,
			});
		} else {
			list.push({ id: port.jointId, supply: port.supply, demand: port.demand });
		}
		nodesByItem.set(port.itemClass, list);
	}
	for (const [id, item] of passThrough) {
		const list = nodesByItem.get(item) ?? [];
		list.push({ id });
		nodesByItem.set(item, list);
	}

	const edgesByItem = new Map<string, FlowEdgeSpec[]>();
	for (const edge of page.edges.values()) {
		const item = itemOf.get(edge.startNodeId) ?? itemOf.get(edge.endNodeId);
		if (item === undefined) continue;
		if (itemOf.get(edge.startNodeId) !== undefined && itemOf.get(edge.endNodeId) !== undefined
			&& itemOf.get(edge.startNodeId) !== itemOf.get(edge.endNodeId)) {
			continue; // a belt between two different item types carries nothing
		}
		const list = edgesByItem.get(item) ?? [];
		const touchesAuto = autoJoints.has(edge.startNodeId) || autoJoints.has(edge.endNodeId);
		list.push({
			id: edge.id,
			from: edge.startNodeId,
			to: edge.endNodeId,
			isDrain: edge.properties.isDrainLine || touchesAuto,
		});
		edgesByItem.set(item, list);
	}

	const result: PageFlows = {
		edgeFlow: new Map(),
		surplus: new Map(),
		shortfall: new Map(),
		autoRates: new Map(),
		balanceTarget: new Map(),
	};

	for (const [item, nodes] of nodesByItem) {
		const solved = solveFlow(nodes, edgesByItem.get(item) ?? []);
		for (const [id, flow] of solved.edgeFlow) result.edgeFlow.set(id, flow);
		for (const [id, value] of solved.surplus) {
			if (!autoJoints.has(id)) result.surplus.set(id, value);
		}
		for (const [id, value] of solved.shortfall) {
			if (!autoJoints.has(id)) result.shortfall.set(id, value);
		}
		for (const [id, value] of solved.potentialInflow) result.balanceTarget.set(id, value);
		for (const [id, value] of solved.potentialOutflow) result.balanceTarget.set(id, value);
	}

	// Whatever ended up flowing through an automatically sized building is its rate.
	for (const port of ports) {
		if (!port.autoOwner) continue;
		let total = 0;
		for (const edge of page.edges.values()) {
			if (edge.startNodeId === port.jointId || edge.endNodeId === port.jointId) {
				total += result.edgeFlow.get(edge.id) ?? 0;
			}
		}
		result.autoRates.set(port.autoOwner, total);
		result.surplus.set(port.jointId, 0);
		result.shortfall.set(port.jointId, 0);
	}

	for (const edge of page.edges.values()) {
		if (!result.edgeFlow.has(edge.id)) result.edgeFlow.set(edge.id, 0);
	}
	return result;
}
