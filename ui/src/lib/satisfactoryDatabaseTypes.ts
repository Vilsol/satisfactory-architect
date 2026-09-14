export interface SFRecipePart {
	itemClass: string;
	amountPerMinute: number;
}

export interface SFVariablePowerConsumption {
	max: number;
	average: number;
}

export interface SFRecipe {
	className: string;
	recipeDisplayName: string;
	inputs: SFRecipePart[];
	outputs: SFRecipePart[];
	producedIn: string;
	category: string;
	priority: number;
	customPowerConsumption?: SFVariablePowerConsumption;
}

export interface SFPart {
	className: string;
	displayName: string;
	icon: string;
	category: string;
	energy: number;
}

export interface SFExtractionBuilding {
	buildingClassName: string;
	baseProductionRate: number;
	supportsPurity: boolean;
	outputs: string[];
}

export interface SFPowerFuel {
	inputs: SFRecipePart[];
	outputs: SFRecipePart[];
}
export interface SFPowerProducer {
	buildingClassName: string;
	fuels: Record<string, SFPowerFuel>;
}

export interface SFBuilding {
	className: string;
	displayName: string;
	icon: string;
	powerConsumption: number;
	powerProduction: number;
}

export interface SFIcon {
	name: string;
	resolutions: number[];
}

export interface SatisfactoryDatabase {
	recipes: Record<string, SFRecipe>;
	parts: Record<string, SFPart>;
	extractionBuildings: Record<string, SFExtractionBuilding>;
	powerProducers: Record<string, SFPowerProducer>;
	buildings: Record<string, SFBuilding>;
	categories: Record<string, string>;
	icons: Record<string, SFIcon>;
}

/**
 * How a building's power draw responds to being run faster or slower, and what
 * somersloops do to it. Kept in its own table because the main database is generated
 * from the game files together with the icons, and the icons are not in the repo.
 */
export interface SFBuildingPower {
	/** Clock speed is raised to this before multiplying the base draw. */
	powerExponent: number;
	/** Somersloops the building takes, or 0 if it takes none. */
	sloopSlots: number;
	/** Extra output one somersloop gives, as a fraction of the base rate. */
	sloopBoostPerSlot: number;
	/** The boost factor is raised to this before multiplying the draw. */
	sloopPowerExponent: number;
}
