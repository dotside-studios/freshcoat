import type { FigmaContainerNode } from "~/lib/figma/types";
import type {
	CardsMessage,
	FieldOverviewItem,
	PluginSettings,
	SelectionDetail,
} from "~/shared/protocol";

// The recorded side of the conversation: what main would say about one design
// in each state the panel is reviewed in. Messages are shaped exactly as
// `src/shared/protocol.ts` declares them, so a protocol change that breaks the
// UI breaks the harness build too.

const solid = (r: number, g: number, b: number) => [
	{ type: "SOLID" as const, color: { r, g, b, a: 1 } },
];

function box(x: number, y: number, width: number, height: number) {
	return {
		absoluteBoundingBox: { x, y, width, height },
		relativeTransform: [
			[1, 0, x],
			[0, 1, y],
		] as [[number, number, number], [number, number, number]],
		width,
		height,
	};
}

const base = { visible: true, opacity: 1, blendMode: "NORMAL" as const };

function text(id: string, name: string, characters: string, y: number) {
	return {
		id,
		name,
		type: "TEXT",
		...base,
		...box(256, y, 600, 56),
		characters,
		style: {
			fontFamily: "Inter",
			fontSize: 40,
			fontWeight: 600,
			italic: false,
			textAlignHorizontal: "LEFT",
			textAlignVertical: "TOP",
			textAutoResize: "NONE",
			lineHeightPercentFontSize: 120,
		},
		fills: solid(1, 1, 1),
	};
}

/** A member card: dynamic avatar, name and number, a QR, two decorations the
 *  transpiler has to rasterize, and a hidden QR. The last three are what the
 *  result's warnings are about. */
export const MEMBER_CARD = {
	id: "10:1",
	name: "Member card",
	type: "FRAME",
	...base,
	...box(0, 0, 1017, 639),
	fills: solid(0.13, 0.25, 0.63),
	fieldMeta: {
		ink: {
			id: "ink",
			format: "color",
			title: "Ink",
			required: false,
			source: "user",
			default: "#1f4fd1",
		},
	},
	children: [
		{
			id: "10:2",
			name: "image:{{avatar}}",
			type: "RECTANGLE",
			...base,
			...box(64, 64, 160, 160),
			fills: solid(0.9, 0.9, 0.95),
			cornerRadius: 80,
		},
		{
			...text("10:3", "{{display_name}}", "{{display_name}}", 96),
			// The name's color is a field too: the binding the Layer tab shows
			// for this text, as main stores it in plugin data.
			binding: {
				bind: { text: "{{display_name}}", textColor: "{{ink}}" },
			},
		},
		text("10:4", "Member number", "No. {{member_id}}", 168),
		{
			id: "10:5",
			name: "qr:{{profile_url}}",
			type: "RECTANGLE",
			...base,
			...box(793, 415, 160, 160),
			fills: solid(0, 0, 0),
		},
		{
			id: "10:6",
			name: "qr:{{backup_url}}",
			type: "RECTANGLE",
			...base,
			visible: false,
			...box(600, 415, 160, 160),
			fills: solid(0, 0, 0),
		},
		{
			id: "10:7",
			name: "Sparkle",
			type: "VECTOR",
			...base,
			...box(880, 40, 96, 96),
			fills: solid(1, 0.8, 0.2),
			effects: [
				{
					type: "DROP_SHADOW",
					visible: true,
					color: { r: 0, g: 0, b: 0, a: 0.3 },
					offset: { x: 0, y: 4 },
					radius: 8,
				},
			],
		},
		{
			id: "10:8",
			name: "Glow",
			type: "VECTOR",
			...base,
			...box(40, 480, 120, 120),
			fills: solid(1, 1, 1),
			effects: [{ type: "LAYER_BLUR", visible: true, radius: 24 }],
		},
	],
} as unknown as FigmaContainerNode;

/** The member card with a barcode whose literal value is no EAN-13, which
 *  stops the export until the author accepts a placeholder. */
export const MEMBER_CARD_BAD_BARCODE = {
	...MEMBER_CARD,
	children: [
		...(MEMBER_CARD.children ?? []),
		{
			id: "10:10",
			name: "barcode:ean13:12345",
			type: "RECTANGLE",
			...base,
			...box(256, 480, 320, 96),
			fills: solid(0, 0, 0),
		},
	],
} as unknown as FigmaContainerNode;

/** Rasters main pre-exports, by node id. "Glow" answers with Figma's 1×1
 *  empty pixel and "Sparkle" is left out, so the export warns about both. */
export const RASTERS: Record<string, "raster" | "empty"> = {
	"10:8": "empty",
};

export const NODES: CardsMessage["nodes"] = [
	{
		id: "10:1",
		name: "Member card",
		width: 1017,
		height: 639,
		canHaveColorways: false,
		colorways: [],
		unmatchedInstances: 0,
	},
	{
		id: "20:1",
		name: "Event badge",
		width: 600,
		height: 900,
		canHaveColorways: true,
		colorways: [
			{ instanceId: "21:1", label: "Ember" },
			{ instanceId: "21:2", label: "Moss" },
		],
		unmatchedInstances: 1,
	},
	{
		id: "30:1",
		name: "Certificate",
		width: 2480,
		height: 3508,
		canHaveColorways: false,
		colorways: [],
		unmatchedInstances: 0,
	},
];

const CARDS: CardsMessage["cards"] = [
	{
		id: "40:1",
		name: "Aurora card",
		sides: [
			{ side: "front", nodeId: "40:2", nodeName: "front" },
			{ side: "back", nodeId: "40:3", nodeName: "back" },
		],
		missingRequired: [],
		colorways: [],
		unmatchedInstances: 0,
		canHaveColorways: false,
	},
];

/** Which preview each node shows, so the thumbnails differ at a glance. */
export const THUMB_FOR: Record<string, "aurora" | "ember" | "moss"> = {
	"10:1": "aurora",
	"20:1": "ember",
	"21:1": "ember",
	"21:2": "moss",
	"30:1": "moss",
	"40:2": "aurora",
	"40:3": "moss",
};

const meta = (
	id: string,
	format: FieldOverviewItem["meta"]["format"],
	title: string,
	required = true,
) => ({ id, format, title, required, source: "user" as const });

export const FIELDS: FieldOverviewItem[] = [
	{
		id: "avatar",
		meta: meta("avatar", "image", "Avatar"),
		slot: "Member card",
		nodeIds: ["10:2"],
		layerNames: ["image:{{avatar}}"],
	},
	{
		id: "display_name",
		meta: meta("display_name", "text", "Display name"),
		slot: "Member card",
		nodeIds: ["10:3"],
		layerNames: ["{{display_name}}"],
	},
	{
		id: "member_id",
		meta: meta("member_id", "text", "Member id"),
		slot: "Member card",
		nodeIds: ["10:4"],
		layerNames: ["Member number"],
	},
	{
		id: "profile_url",
		meta: meta("profile_url", "url", "Profile url"),
		slot: "Member card",
		nodeIds: ["10:5"],
		layerNames: ["qr:{{profile_url}}"],
	},
	{
		id: "ink",
		meta: { ...meta("ink", "color", "Ink", false), default: "#1f4fd1" },
		slot: "Member card",
		nodeIds: ["10:3"],
		layerNames: ["{{display_name}}"],
	},
	{
		id: "guest_name",
		meta: meta("guest_name", "text", "Guest name"),
		slot: "Event badge",
		nodeIds: ["20:4"],
		layerNames: ["{{guest_name}}"],
	},
	{
		id: "tier",
		meta: meta("tier", "text", "Tier", false),
		slot: "Event badge",
		nodeIds: [],
	},
];

/** In a Davi export the slot is the card, and main reads the member card's
 *  design into each of its sides, so the card carries the same fields. */
const CARD_FIELDS: FieldOverviewItem[] = [
	...FIELDS,
	...FIELDS.filter((f) => f.slot === "Member card").map((f) => ({
		...f,
		slot: "Aurora card",
	})),
];

const UNBOUND: SelectionDetail = {
	nodeId: "10:9",
	name: "Badge",
	nodeType: "RECTANGLE",
	capabilities: [
		{ property: "fill", format: "color" },
		{ property: "image", format: "image" },
		{ property: "qr", format: "url" },
		{ property: "barcode", format: "text" },
	],
	bind: {},
	fields: [],
};

const BOUND: SelectionDetail = {
	nodeId: "10:3",
	name: "{{display_name}}",
	nodeType: "TEXT",
	capabilities: [
		{ property: "text", format: "text" },
		{ property: "textColor", format: "color" },
	],
	bind: { text: "{{display_name}}", textColor: "{{ink}}" },
	fields: [
		{
			id: "display_name",
			format: "text",
			meta: meta("display_name", "text", "Display name"),
		},
		{
			id: "ink",
			format: "color",
			meta: { ...meta("ink", "color", "Ink", false), default: "#1f4fd1" },
		},
	],
};

const BARCODE: SelectionDetail = {
	nodeId: "10:10",
	name: "barcode:ean13:{{sku}}",
	nodeType: "RECTANGLE",
	capabilities: [
		{ property: "fill", format: "color" },
		{ property: "image", format: "image" },
		{ property: "qr", format: "url" },
		{ property: "barcode", format: "text" },
	],
	bind: { barcode: "{{sku}}" },
	fields: [{ id: "sku", format: "text", meta: meta("sku", "text", "Sku") }],
};

const BOUND_SINGLE: SelectionDetail = {
	nodeId: "10:4",
	name: "Member number",
	nodeType: "TEXT",
	capabilities: [
		{ property: "text", format: "text" },
		{ property: "textColor", format: "color" },
	],
	bind: { text: "No. {{member_id}}" },
	fields: [
		{
			id: "member_id",
			format: "text",
			meta: meta("member_id", "text", "Member id"),
		},
	],
};

export type ReadBehaviour =
	/** Progress, then a document the transpiler turns into a template. */
	| "ok"
	/** Progress, then main's failure message. */
	| "fail"
	/** Progress that never finishes, to hold the bar on screen. */
	| "hang"
	/** A document whose frames are the wrong size for the product. */
	| "wrong-size";

export type HarnessState = {
	title: string;
	settings: Partial<PluginSettings>;
	cards: Omit<CardsMessage, "type">;
	selection: SelectionDetail | null;
	fields: FieldOverviewItem[];
	/** What a detection finds. Defaults to `fields`. */
	harvested?: FieldOverviewItem[];
	read: ReadBehaviour;
	/** The design main reads. Defaults to the member card. */
	scene?: FigmaContainerNode;
};

const page = (
	overrides: Partial<Omit<CardsMessage, "type">> = {},
): Omit<CardsMessage, "type"> => ({
	cards: CARDS,
	nodes: NODES,
	pageName: "Membership",
	selectedCardId: null,
	selectedNodeId: null,
	...overrides,
});

const common = {
	cards: page({ selectedNodeId: "10:1" }),
	selection: null,
	fields: FIELDS,
	read: "ok" as ReadBehaviour,
};

export const STATES: Record<string, HarnessState> = {
	"layer-empty": {
		...common,
		title: "Layer, nothing selected",
		settings: { tab: "layer" },
	},
	"layer-unbound": {
		...common,
		title: "Layer, an unbound rectangle",
		settings: { tab: "layer" },
		selection: UNBOUND,
	},
	"layer-bound": {
		...common,
		title: "Layer, a text bound on two properties",
		settings: { tab: "layer" },
		selection: BOUND,
	},
	"layer-bound-single": {
		...common,
		title: "Layer, a text bound on one property",
		settings: { tab: "layer" },
		selection: BOUND_SINGLE,
	},
	"layer-barcode": {
		...common,
		title: "Layer, a barcode",
		settings: { tab: "layer" },
		selection: BARCODE,
	},
	"fields-empty": {
		...common,
		title: "Fields, none yet",
		settings: { tab: "fields" },
		fields: [],
		harvested: FIELDS,
	},
	fields: {
		...common,
		title: "Fields, grouped by frame",
		settings: { tab: "fields" },
	},
	"export-start": {
		...common,
		title: "Export, nothing picked",
		settings: { tab: "export" },
		cards: page(),
	},
	export: {
		...common,
		title: "Export, everything picked",
		settings: { tab: "export" },
	},
	"export-hang": {
		...common,
		title: "Export, reading",
		settings: { tab: "export" },
		read: "hang",
	},
	"export-fail": {
		...common,
		title: "Export, the read failed",
		settings: { tab: "export" },
		read: "fail",
	},
	"export-blocked": {
		...common,
		title: "Export, stopped by a barcode placeholder",
		settings: { tab: "export" },
		scene: MEMBER_CARD_BAD_BARCODE,
	},
	"export-davi": {
		...common,
		title: "Export, a Davi card with wrong-size sides",
		settings: { tab: "export", daviMode: true, productSku: "card_cr80" },
		cards: page({ selectedCardId: "40:1" }),
		fields: CARD_FIELDS,
		read: "wrong-size",
	},
	settings: {
		...common,
		title: "Settings",
		settings: {
			tab: "settings",
			freshcoatUrl: "https://freshcoat.example",
		},
	},
	"settings-empty": {
		...common,
		title: "Settings, no address",
		settings: { tab: "settings", freshcoatUrl: "" },
	},
};
