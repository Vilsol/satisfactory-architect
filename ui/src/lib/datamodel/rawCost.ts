/**
 * What a recipe really costs: the whole chain beneath it, taken down to ore.
 *
 * Walking the tree would not do. The recipe data is full of loops - packaging turns
 * every fluid into a two-step cycle, Encased Uranium Cell hands back some of the
 * sulfuric acid it takes, and Dark Matter Residue is a byproduct of six things made
 * out of Dark Matter Residue. A walk either spins forever on those or gives up on
 * exactly the chains nobody can do in their head.
 *
 * So the whole thing is written down at once and solved. One unknown per recipe -
 * how many machines of it - and one equation per item saying that what is made of it
 * equals what is used of it, except for the thing being costed, where the difference
 * is what was asked for. Raw ore gets no equation, and how much of it the answer eats
 * is the number we are after.
 *
 * Loops stop being a special case that way: they are off-diagonal terms.
 */

import { satisfactoryDatabase } from "$lib/satisfactoryDatabase";
import type { SFRecipe } from "$lib/satisfactoryDatabaseTypes";
import { solveLinearSystem } from "./linearSolve";
import { nodePower } from "./nodePower";

export interface FlowPart {
	itemClass: string;
	perMinute: number;
}

export interface FlowRecipe {
	/** Tells this run of the recipe apart from any other. */
	key: string;
	/** The item this run was brought in to make. */
	makes: string;
	inputs: FlowPart[];
	outputs: FlowPart[];
}

export interface FlowRequest {
	recipes: FlowRecipe[];
	/** Items that get no equation - ore, and anything the game gives no recipe for. */
	terminals: ReadonlySet<string>;
	target: FlowPart;
	creditByproducts: boolean;
}

export type FlowResult =
	| {
		ok: true;
		/** Machines of each recipe, by key. */
		runs: Map<string, number>;
		/** What the whole thing makes of each item, less what it uses. */
		net: Map<string, number>;
		/** Items whose own recipe turned out not to be needed, covered by byproducts. */
		dropped: string[];
	}
	| { ok: false; reason: "unsolvable" };

function amountOf(parts: FlowPart[], itemClass: string): number {
	let total = 0;
	for (const part of parts) {
		if (part.itemClass === itemClass) {
			total += part.perMinute;
		}
	}
	return total;
}

/**
 * How much of `itemClass` a recipe counts as supplying.
 *
 * This is the whole of the byproduct toggle. Credited, everything that comes out of
 * the machine offsets demand for it. Uncredited, only the thing the recipe was picked
 * for counts, and the rest is left to show up as spare.
 */
function suppliedBy(recipe: FlowRecipe, itemClass: string, creditByproducts: boolean): number {
	if (creditByproducts || recipe.makes === itemClass) {
		return amountOf(recipe.outputs, itemClass);
	}
	return 0;
}

export function solveRecipeFlows(request: FlowRequest): FlowResult {
	const { terminals, target, creditByproducts } = request;
	const scale = Math.max(Math.abs(target.perMinute), 1);
	const tolerance = scale * 1e-9;

	let active = request.recipes.filter(recipe => !terminals.has(recipe.makes));
	const dropped: string[] = [];

	// Dropping a recipe can leave another one unwanted in turn, so this goes round
	// until nothing is left running backwards. One pass per recipe at the very worst.
	for (let attempt = 0; attempt <= request.recipes.length; attempt++) {
		const items = active.map(recipe => recipe.makes);
		const matrix = items.map(item => active.map(recipe =>
			suppliedBy(recipe, item, creditByproducts) - amountOf(recipe.inputs, item)));
		const wanted = items.map(item => item === target.itemClass ? target.perMinute : 0);

		const solved = solveLinearSystem(matrix, wanted);
		if (!solved.ok) {
			return { ok: false, reason: "unsolvable" };
		}

		let worst = -1;
		for (let i = 0; i < solved.x.length; i++) {
			if (solved.x[i] < -tolerance && (worst < 0 || solved.x[i] < solved.x[worst])) {
				worst = i;
			}
		}
		if (worst >= 0) {
			// Running a recipe backwards is not a thing. It means byproducts already
			// cover this item, so it does not need making; drop it and its equation
			// together, which keeps the system square, and let it come out spare.
			dropped.push(active[worst].makes);
			active = active.filter((_, i) => i !== worst);
			continue;
		}

		const runs = new Map<string, number>();
		active.forEach((recipe, i) => runs.set(recipe.key, solved.x[i]));

		// What is actually made and used, byproducts and all, whatever the toggle says.
		const net = new Map<string, number>();
		for (const recipe of request.recipes) {
			const machines = runs.get(recipe.key) ?? 0;
			if (machines === 0) {
				continue;
			}
			for (const output of recipe.outputs) {
				net.set(output.itemClass, (net.get(output.itemClass) ?? 0) + output.perMinute * machines);
			}
			for (const input of recipe.inputs) {
				net.set(input.itemClass, (net.get(input.itemClass) ?? 0) - input.perMinute * machines);
			}
		}
		return { ok: true, runs, net, dropped };
	}

	return { ok: false, reason: "unsolvable" };
}

/** Items that come out of the ground rather than out of a machine. */
export const rawItems: ReadonlySet<string> = new Set(
	Object.values(satisfactoryDatabase.extractionBuildings).flatMap(building => building.outputs));

const packagerBuilding = "Build_Packager_C";

/**
 * Whether a recipe counts as a way of making something, rather than a way of making
 * something else that happens to throw this off as well. The game lists the real
 * product first, which matters: Encased Uranium Cell hands back sulfuric acid, and
 * taking that as a way to make sulfuric acid would have one recipe standing in for
 * two items at once - two unknowns for one machine, which has no single answer.
 *
 * Byproducts still count towards supply when they are credited. They just do not get
 * to be the reason a recipe is brought in.
 */
function producesPrimarily(recipe: SFRecipe, itemClass: string): boolean {
	return recipe.outputs[0]?.itemClass === itemClass;
}

function isAlternate(recipe: SFRecipe): boolean {
	return recipe.className.startsWith("Recipe_Alternate_") || recipe.recipeDisplayName.startsWith("Alternate");
}

/**
 * Packaging and unpackaging are how things get moved about, never how they get made,
 * and taking them as production turns every fluid into a loop. They stay available if
 * something genuinely needs a packaged item, just at the back of the queue.
 */
function tierOf(recipe: SFRecipe): number {
	return (recipe.producedIn === packagerBuilding ? 2 : 0) + (isAlternate(recipe) ? 1 : 0);
}

/**
 * Which recipe to assume for an item nobody has chosen one for: an ordinary recipe
 * over an alternate, a real recipe over a packaging one, and after that whatever the
 * game lists first, so the answer is the same every time it is asked for.
 */
export function chooseRecipeFor(itemClass: string, preferred?: Record<string, string>): SFRecipe | undefined {
	const chosen = preferred?.[itemClass];
	if (chosen) {
		const recipe = satisfactoryDatabase.recipes[chosen];
		if (recipe && producesPrimarily(recipe, itemClass)) {
			return recipe;
		}
	}
	let best: SFRecipe | undefined;
	let bestRank: [number, number, string] | undefined;
	for (const recipe of Object.values(satisfactoryDatabase.recipes)) {
		if (!producesPrimarily(recipe, itemClass)) {
			continue;
		}
		const rank: [number, number, string] = [tierOf(recipe), recipe.priority, recipe.className];
		if (!bestRank ||
			rank[0] < bestRank[0] ||
			(rank[0] === bestRank[0] && rank[1] < bestRank[1]) ||
			(rank[0] === bestRank[0] && rank[1] === bestRank[1] && rank[2] < bestRank[2])) {
			best = recipe;
			bestRank = rank;
		}
	}
	return best;
}

export interface CostedItem {
	itemClass: string;
	displayName: string;
	perMinute: number;
}

export interface ChainStep {
	recipeClassName: string;
	displayName: string;
	itemClass: string;
	buildingClassName: string;
	buildingDisplayName: string;
	machines: number;
	power: number;
}

export interface RawCostOptions {
	/** The recipe being costed. */
	recipeClassName: string;
	/** Which of its outputs is being costed. */
	itemClass: string;
	/** Per minute of that output. One by default. */
	rate?: number;
	creditByproducts: boolean;
	/** Which recipe to assume for an item, where the default is not wanted. */
	preferred?: Record<string, string>;
}

export type RawCost =
	| {
		ok: true;
		/** Ore and the like, per minute. */
		raws: CostedItem[];
		/** Things no recipe makes, which have to come from somewhere else. */
		supplied: CostedItem[];
		/** What comes out that nothing downstream wanted. */
		surplus: CostedItem[];
		steps: ChainStep[];
		machineCount: number;
		totalPower: number;
	}
	| { ok: false; reason: "no-recipe" | "unsolvable" };

function named(itemClass: string, perMinute: number): CostedItem {
	return {
		itemClass,
		displayName: satisfactoryDatabase.parts[itemClass]?.displayName ?? itemClass,
		perMinute,
	};
}

function byBiggest(a: CostedItem, b: CostedItem): number {
	return b.perMinute - a.perMinute || a.displayName.localeCompare(b.displayName, "en");
}

export function rawCostOf(options: RawCostOptions): RawCost {
	const top = satisfactoryDatabase.recipes[options.recipeClassName];
	if (!top || !top.outputs.some(output => output.itemClass === options.itemClass)) {
		return { ok: false, reason: "no-recipe" };
	}
	const rate = options.rate ?? 1;

	// One recipe per item, worked out from the thing being costed downwards. The order
	// they go in is the order they are read out in, which follows the chain.
	const chosen = new Map<string, SFRecipe>([[options.itemClass, top]]);
	const unmakeable = new Set<string>();
	const terminals = new Set<string>();

	function need(itemClass: string) {
		if (chosen.has(itemClass) || terminals.has(itemClass)) {
			return;
		}
		if (rawItems.has(itemClass)) {
			terminals.add(itemClass);
			return;
		}
		const recipe = chooseRecipeFor(itemClass, options.preferred);
		if (!recipe) {
			terminals.add(itemClass);
			unmakeable.add(itemClass);
			return;
		}
		chosen.set(itemClass, recipe);
		for (const input of recipe.inputs) {
			need(input.itemClass);
		}
	}
	for (const input of top.inputs) {
		need(input.itemClass);
	}

	// The key carries the item that brought the recipe in, not just the recipe, so
	// nothing collides if the same one is ever reached twice.
	const recipes: FlowRecipe[] = [...chosen].map(([makes, recipe]) => ({
		key: `${recipe.className}#${makes}`,
		makes,
		inputs: recipe.inputs.map(part => ({ itemClass: part.itemClass, perMinute: part.amountPerMinute })),
		outputs: recipe.outputs.map(part => ({ itemClass: part.itemClass, perMinute: part.amountPerMinute })),
	}));

	const flows = solveRecipeFlows({
		recipes,
		terminals,
		target: { itemClass: options.itemClass, perMinute: rate },
		creditByproducts: options.creditByproducts,
	});
	if (!flows.ok) {
		return { ok: false, reason: "unsolvable" };
	}

	const steps: ChainStep[] = [];
	let machineCount = 0;
	let totalPower = 0;
	for (const [makes, recipe] of chosen) {
		const machines = flows.runs.get(`${recipe.className}#${makes}`) ?? 0;
		if (machines <= 0) {
			continue;
		}
		const power = nodePower({
			details: { type: "recipe", recipeClassName: recipe.className },
			multiplier: machines,
		}).consumed;
		machineCount += machines;
		totalPower += power;
		steps.push({
			recipeClassName: recipe.className,
			displayName: recipe.recipeDisplayName,
			itemClass: makes,
			buildingClassName: recipe.producedIn,
			buildingDisplayName: satisfactoryDatabase.buildings[recipe.producedIn]?.displayName ?? recipe.producedIn,
			machines,
			power,
		});
	}

	const tolerance = Math.max(Math.abs(rate), 1) * 1e-9;
	const raws: CostedItem[] = [];
	const supplied: CostedItem[] = [];
	const surplus: CostedItem[] = [];
	for (const [itemClass, value] of flows.net) {
		const spare = value - (itemClass === options.itemClass ? rate : 0);
		if (value < -tolerance) {
			const used = named(itemClass, -value);
			if (rawItems.has(itemClass)) {
				raws.push(used);
			} else if (unmakeable.has(itemClass)) {
				supplied.push(used);
			}
		} else if (spare > tolerance) {
			surplus.push(named(itemClass, spare));
		}
	}

	return {
		ok: true,
		raws: raws.sort(byBiggest),
		supplied: supplied.sort(byBiggest),
		surplus: surplus.sort(byBiggest),
		steps,
		machineCount,
		totalPower,
	};
}
