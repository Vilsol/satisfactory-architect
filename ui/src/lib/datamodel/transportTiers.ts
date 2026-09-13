/**
 * Which belt or pipe a given rate needs.
 *
 * The game files this project reads do not describe belts or pipes, so the tiers
 * below are written down by hand. They are the Satisfactory 1.0 figures, in items
 * per minute for belts and cubic metres per minute for pipes.
 */

export interface TransportTier {
	/** Shown on the belt, e.g. "Mk.3". */
	name: string;
	/** Most it can carry per minute. */
	capacity: number;
}

export const BELT_TIERS: readonly TransportTier[] = [
	{ name: "Mk.1", capacity: 60 },
	{ name: "Mk.2", capacity: 120 },
	{ name: "Mk.3", capacity: 270 },
	{ name: "Mk.4", capacity: 480 },
	{ name: "Mk.5", capacity: 780 },
	{ name: "Mk.6", capacity: 1200 },
];

export const PIPE_TIERS: readonly TransportTier[] = [
	{ name: "Mk.1", capacity: 300 },
	{ name: "Mk.2", capacity: 600 },
];

/**
 * Everything that travels in a pipe rather than on a belt. Kept by hand because the
 * extracted game data gives fluids no marking of their own - they are scattered
 * across the same categories as solid parts.
 */
const FLUIDS: ReadonlySet<string> = new Set([
	"Desc_AluminaSolution_C",   // Alumina Solution
	"Desc_DarkEnergy_C",        // Dark Matter Residue
	"Desc_DissolvedSilica_C",   // Dissolved Silica
	"Desc_HeavyOilResidue_C",   // Heavy Oil Residue
	"Desc_IonizedFuel_C",       // Ionized Fuel
	"Desc_LiquidBiofuel_C",     // Liquid Biofuel
	"Desc_LiquidFuel_C",        // Fuel
	"Desc_LiquidOil_C",         // Crude Oil
	"Desc_LiquidTurboFuel_C",   // Turbofuel
	"Desc_NitricAcid_C",        // Nitric Acid
	"Desc_NitrogenGas_C",       // Nitrogen Gas
	"Desc_QuantumEnergy_C",     // Excited Photonic Matter
	"Desc_RocketFuel_C",        // Rocket Fuel
	"Desc_SulfuricAcid_C",      // Sulfuric Acid
	"Desc_Water_C",             // Water
]);

export function isFluid(itemClass: string): boolean {
	return FLUIDS.has(itemClass);
}

function tiersFor(itemClass: string): readonly TransportTier[] {
	return isFluid(itemClass) ? PIPE_TIERS : BELT_TIERS;
}

export interface TransportNeed {
	/** Cheapest tier that copes, or the best there is when even that is not enough. */
	tier: TransportTier;
	/** True when the rate is beyond anything the game can carry on one line. */
	exceedsEverything: boolean;
	/** True for pipes, so the label can say so. */
	isFluid: boolean;
}

/**
 * The cheapest belt or pipe that carries this rate. Returns null when nothing is
 * moving, since there is nothing to advise about.
 */
export function transportNeededFor(itemClass: string, ratePerMinute: number): TransportNeed | null {
	if (!(ratePerMinute > 0)) {
		return null;
	}
	const tiers = tiersFor(itemClass);
	const fluid = isFluid(itemClass);
	for (const tier of tiers) {
		// Rates come out of a solver, so allow a hair of floating point slack.
		if (ratePerMinute <= tier.capacity + 1e-6) {
			return { tier, exceedsEverything: false, isFluid: fluid };
		}
	}
	return { tier: tiers[tiers.length - 1], exceedsEverything: true, isFluid: fluid };
}
