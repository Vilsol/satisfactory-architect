import { satisfactoryDatabase } from "$lib/satisfactoryDatabase";
import type { GraphEdge } from "./GraphEdge.svelte";
import type { GraphNodeType, GraphNode } from "./GraphNode.svelte";
import { resourceJointNodeRadius, splitterMergerNodeRadius } from "./constants";

const draggableTypes: GraphNodeType[] = ["production", "splitter", "merger", "text-note"];
const selectableTypes: GraphNodeType[] = ["production", "splitter", "merger", "text-note"];
const deletableTypes: GraphNodeType[] = ["production", "splitter", "merger", "text-note"];
const attachableTypes: GraphNodeType[] = ["resource-joint", "splitter", "merger"];
const rotatableEdgeNodes: GraphNodeType[] = ["splitter", "merger"];

const nodeRadius: Partial<Record<GraphNodeType, number>> = {
	"resource-joint": resourceJointNodeRadius,
	"splitter": splitterMergerNodeRadius,
	"merger": splitterMergerNodeRadius,
};

export function isNodeDraggable(node: GraphNode): boolean {
	return draggableTypes.includes(node.properties.type);
}

export function isNodeSelectable(node: GraphNode): boolean {
	return selectableTypes.includes(node.properties.type);
}

export function isNodeDeletable(node: GraphNode): boolean {
	if (node.properties.type === "resource-joint" && node.properties.locked) {
		return false;
	}
	return deletableTypes.includes(node.properties.type);
}

export function isNodeAttachable(node: GraphNode): boolean {
	return attachableTypes.includes(node.properties.type);
}

export function isResourceNodeSplittable(node: GraphNode): boolean {
	if (node.properties.type === "resource-joint" && node.properties.locked) {
		return true;
	}
	return false;
}

export function canUseInvertedEdgeControlPoint(node: GraphNode): boolean {
	if (node.properties.type !== "resource-joint") {
		return false;
	}
	return !node.properties.locked;
}

export function userCanChangeOrientationVector(node: GraphNode, edge: GraphEdge): boolean {
	if (edge.properties.displayType === "straight") {
		return false;
	}
	return rotatableEdgeNodes.includes(node.properties.type);
}

export function getNodeRadius(node: GraphNode): number {
	const radius = nodeRadius[node.properties.type];
	return radius ?? 0;
}

/** A name a person would recognise, for listing nodes in a search. */
export function nodeDisplayName(node: GraphNode): string {
	const props = node.properties;
	switch (props.type) {
		case "text-note":
			return props.content.split("\n")[0].slice(0, 60) || "Note";
		case "splitter":
			return `Splitter (${satisfactoryDatabase.parts[props.resourceClassName]?.displayName ?? props.resourceClassName})`;
		case "merger":
			return `Merger (${satisfactoryDatabase.parts[props.resourceClassName]?.displayName ?? props.resourceClassName})`;
		case "resource-joint":
			return satisfactoryDatabase.parts[props.resourceClassName]?.displayName ?? props.resourceClassName;
		case "production": {
			const details = props.details;
			switch (details.type) {
				case "recipe":
					return satisfactoryDatabase.recipes[details.recipeClassName]?.recipeDisplayName ?? details.recipeClassName;
				case "extraction":
					return `${satisfactoryDatabase.parts[details.partClassName]?.displayName ?? details.partClassName} (${satisfactoryDatabase.buildings[details.buildingClassName]?.displayName ?? "Extractor"})`;
				case "factory-input":
					return `Input: ${satisfactoryDatabase.parts[details.partClassName]?.displayName ?? details.partClassName}`;
				case "factory-output":
					return `Output: ${satisfactoryDatabase.parts[details.partClassName]?.displayName ?? details.partClassName}`;
				case "power-production":
					return satisfactoryDatabase.powerProducers[details.powerBuildingClassName]
						? `${satisfactoryDatabase.buildings[details.powerBuildingClassName]?.displayName ?? details.powerBuildingClassName}`
						: details.powerBuildingClassName;
				case "factory-reference":
					return "Factory reference";
				default:
					return "Building";
			}
		}
		default:
			return "Node";
	}
}
