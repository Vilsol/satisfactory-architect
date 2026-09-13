export const latestAppVersion = 3;
export const dataModelVersion = 1;

export const gridSize = 50;

export const resourceJointNodeRadius = 16;
export const splitterMergerNodeRadius = 16;

export const productionNodeIconSize = 55;
export const productionNodeVerticalPadding = 0;
export const productionNodeHorizontalPadding = resourceJointNodeRadius + 2;

export const edgeArrowLength = 11;

export class NodePriorities {
	static readonly RECIPE = 0;
	static readonly RESOURCE_JOINT = 1;
	static readonly OTHER = 0;
	static readonly TOP_LEVEL = 999;
}

export class StorageKeys {
	static readonly darkTheme = "dark-theme";
	static readonly appState = "app-state";
	static readonly appVersion = "app-version";
}

export const saveDataType = "app-state";
export const clipboardDataType = "factory-data";


export type ChangelogEntry = string | {
	text: string;
	items?: ChangelogEntry[];
};

export const changelog: Record<number, ChangelogEntry[]> = {
	3: [
		{
			text: "Rates are worked out properly now",
			items: [
				"Splitters and mergers no longer split evenly into belts that cannot take it - what each branch gets depends on what is actually downstream",
				"The answer no longer depends on the order things were built in",
				"Every joint shows what it is short of, or what it is making and cannot ship",
				"Where two ends of a belt disagree, you can scale either side to match the other",
			],
		},
		{
			text: "Notes can be formatted",
			items: [
				"Bold, italic, underline, strikethrough, colour, size and lists",
				"Select some text in a note to bring up the formatting bar",
				"Notes written before this keep reading the way they always did",
			],
		},
		{
			text: "Buildings can be rotated",
			items: [
				"R turns the selection a quarter turn, Shift+R the other way",
				"Inputs and outputs move to the sides they would be on, and the belts re-route themselves",
			],
		},
		{
			text: "Settings",
			items: [
				"A settings page in the top left menu, with the theme, what is shown on the canvas, and what new belts and buildings start out as",
			],
		},
		{
			text: "Working with other people",
			items: [
				"Pick your own name and colour",
				"You can see what everyone else has selected",
			],
		},
		{
			text: "Smaller things",
			items: [
				"Each belt says which belt or pipe tier it needs, and stands out when nothing can carry that much",
				"A summary of the page: what it makes, what it needs, and how much power it draws",
				"Ctrl+F finds a node by name",
				"Dragging a new building out of a joint sizes it to match what that joint is carrying",
			],
		},
	],
	2: [
		{
			text: "Multi User Collaboration",
			items: [
				"Work together with your friends on one save file in real-time",
				"To get started, click the new \"Multi-User Collaboration\" button in the top left dropdown menu",
				"If you encounter any issues, please report them",
				"If you want to host your own server, visit the GitHub repository for more information",
			],
		},
		{
			text: "Pages",
			items: [
				"Pages can now be reordered",
				"You can also change their icon",
			]
		},
		{
			text: "More view moving options",
			items: [
				"CTRL + left-click",
				"\"Drag View\" tool in left sidebar"
			]
		},
	],
	1: ["Initial release"],
};
