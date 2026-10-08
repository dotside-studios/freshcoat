import type {
	Element,
	FontDescriptor,
	Template,
	Variant,
	VariantElementDelta,
} from "@freshcoat-js/coatfile";
import { FORMAT_VERSION, resizeTemplate } from "@freshcoat-js/coatfile";
import { daviWordmark } from "./davi-wordmark";

// The Davi card as Davi's production card templates draw it (the Vista design
// for the landscape card, Editorial and Monolith for the portrait variants):
// Playfair Display for the name, Roboto for everything else, a solid variant
// colour, and a 64 px margin.

const SERIF = "Playfair Display";
const SANS = "Roboto";
const MARGIN = 64;

const FONTS: FontDescriptor[] = [
	{
		kind: "google",
		family: SERIF,
		url: "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&display=swap",
	},
	{
		kind: "google",
		family: SANS,
		url: "https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap",
	},
];

const VARIANTS = [
	{ id: "cobalt", label: "Cobalt", color: "#1d4ed8" },
	{ id: "sage", label: "Sage", color: "#3f6f4a" },
	{ id: "plum", label: "Plum", color: "#5b2a55" },
] as const;

const INK = "#fafafa";
const SOFT = "#ffffffd1";
const MUTED = "#ffffffa3";

/** The contactless mark beside "Tap to connect": three arcs, 24 units. */
const TAP_ARCS =
	"M7 8.5C8.4 10.9 8.4 13.1 7 15.5M11.5 5.5C14.2 9.8 14.2 14.2 11.5 18.5M16 2.5C20 8.8 20 15.2 16 21.5";

type Box = { x: number; y: number; width: number; height: number };
type Pin = Element["constraints"];

function text(
	id: string,
	box: Box,
	value: string,
	font: {
		family: string;
		size: number;
		weight: number;
		letterSpacing?: number;
		lineHeight?: number;
	},
	color: string,
	extra: Record<string, unknown> = {},
	constraints?: Pin,
): Element {
	const properties: Record<string, unknown> = {
		value,
		font,
		color,
		align: "left",
		fit: "shrink",
		maxLines: 1,
		...extra,
	};
	for (const k of Object.keys(properties))
		if (properties[k] === undefined) delete properties[k];
	return {
		id,
		type: "text",
		pos: { x: box.x, y: box.y },
		size: { width: box.width, height: box.height },
		...(constraints ? { constraints } : {}),
		properties,
	} as Element;
}

function tapLine(x: number, y: number, constraints: Pin): Element[] {
	return [
		{
			id: "tap_icon",
			type: "vector",
			pos: { x, y },
			size: { width: 24, height: 24 },
			constraints,
			properties: {
				d: TAP_ARCS,
				stroke: { color: SOFT, width: 2, cap: "round", join: "round" },
			},
		},
		text(
			"tap_footer",
			{ x: x + 34, y, width: 260, height: 24 },
			"TAP TO CONNECT",
			{ family: SANS, size: 16, weight: 500, letterSpacing: 2 },
			SOFT,
			{ verticalAlign: "middle", fit: undefined },
			constraints,
		),
	];
}

function wordmark(id: string, x: number, y: number, width: number, pin: Pin) {
	const mark = daviWordmark(width);
	return {
		id,
		type: "vector",
		pos: { x, y },
		size: { width: mark.width, height: mark.height },
		constraints: pin,
		properties: { d: mark.d, fill: INK },
	} satisfies Element;
}

function qrTile(x: number, y: number, side: number, pin: Pin): Element {
	const pad = Math.round(side / 12);
	return {
		id: "qr_tile",
		type: "frame",
		pos: { x, y },
		size: { width: side, height: side },
		constraints: pin,
		properties: {
			fill: INK,
			cornerRadius: 20,
			children: [
				{
					id: "back_qr",
					type: "qr_code",
					pos: { x: pad, y: pad },
					size: { width: side - pad * 2, height: side - pad * 2 },
					properties: {
						value: "{{card_url}}",
						errorCorrection: "M",
						foreground: "#0a0a0a",
						background: INK,
						margin: 0,
					},
				},
			],
		},
	};
}

/** A soft light from the top-right corner, drawn over any variant colour. */
function sheen(id: string, w: number, h: number): Element {
	return {
		id,
		type: "rect",
		pos: { x: 0, y: 0 },
		size: { width: w, height: h },
		constraints: { horizontal: "stretch", vertical: "stretch" },
		properties: {
			fill: [
				{
					kind: "radial",
					center: [1, 0],
					radius: 1,
					stops: [
						{ offset: 0, color: "#ffffff29" },
						{ offset: 1, color: "#ffffff00" },
					],
				},
				{
					kind: "linear",
					angle: 90,
					stops: [
						{ offset: 0.5, color: "#00000000" },
						{ offset: 1, color: "#0000001f" },
					],
				},
			],
		},
	};
}

function scanCaption(x: number, y: number, width: number, pin: Pin): Element {
	return text(
		"scan_caption",
		{ x, y, width, height: 20 },
		"SCAN TO CONNECT",
		{ family: SANS, size: 13, weight: 500, letterSpacing: 2 },
		MUTED,
		{ align: "center", verticalAlign: "middle", fit: undefined },
		pin,
	);
}

function background(id: string, color: string) {
	return { id, type: "rect" as const, properties: { fill: color } };
}

function landscape(w: number, h: number): Template["template_data"] {
	const right = w - MARGIN;
	const bottom = h - MARGIN;
	const inner = w - MARGIN * 2;
	const mark = daviWordmark(196);
	return [
		{
			name: "front",
			background: background("front_bg", VARIANTS[0].color),
			elements: [
				sheen("front_sheen", w, h),
				text(
					"name_text",
					{ x: MARGIN, y: 72, width: inner, height: 84 },
					"{{name}}",
					{ family: SERIF, size: 64, weight: 700, lineHeight: 1.1 },
					INK,
					{ verticalAlign: "top" },
					{ horizontal: "stretch" },
				),
				{
					id: "rule",
					type: "rect",
					pos: { x: MARGIN, y: 180 },
					size: { width: 56, height: 3 },
					properties: { fill: MUTED },
				},
				text(
					"position_text",
					{ x: MARGIN, y: 206, width: inner, height: 32 },
					"{{position}}",
					{ family: SANS, size: 22, weight: 500, letterSpacing: 1 },
					SOFT,
					{},
					{ horizontal: "stretch" },
				),
				text(
					"organization_text",
					{ x: MARGIN, y: 242, width: inner, height: 32 },
					"{{organization}}",
					{ family: SANS, size: 22, weight: 400 },
					MUTED,
					{},
					{ horizontal: "stretch" },
				),
				...tapLine(MARGIN, bottom - 24, { vertical: "end" }),
				wordmark(
					"davi_wordmark",
					right - mark.width,
					bottom - mark.height,
					mark.width,
					{ horizontal: "end", vertical: "end" },
				),
			],
		},
		{
			name: "back",
			background: background("back_bg", VARIANTS[0].color),
			elements: [
				sheen("back_sheen", w, h),
				text(
					"back_name",
					{ x: MARGIN, y: MARGIN, width: 560, height: 48 },
					"{{name}}",
					{ family: SERIF, size: 36, weight: 700 },
					INK,
					{ verticalAlign: "top" },
				),
				text(
					"back_position",
					{ x: MARGIN, y: 124, width: 560, height: 28 },
					"{{position}}",
					{ family: SANS, size: 18, weight: 500, letterSpacing: 1 },
					SOFT,
				),
				text(
					"back_organization",
					{ x: MARGIN, y: 156, width: 560, height: 28 },
					"{{organization}}",
					{ family: SANS, size: 18, weight: 400 },
					MUTED,
				),
				qrTile(right - 240, MARGIN, 240, { horizontal: "end" }),
				scanCaption(right - 240, MARGIN + 256, 240, { horizontal: "end" }),
				text(
					"back_footer",
					{ x: MARGIN, y: bottom - 24, width: 560, height: 24 },
					"MADE WITH LOVE BY DAVI SOCIAL",
					{ family: SANS, size: 16, weight: 500, letterSpacing: 1.5 },
					MUTED,
					{ verticalAlign: "middle", fit: undefined },
					{ vertical: "end" },
				),
			],
		},
	];
}

function portrait(w: number, h: number): Template["template_data"] {
	const bottom = h - MARGIN;
	const inner = w - MARGIN * 2;
	const mark = daviWordmark(176);
	const qr = 320;
	return [
		{
			name: "front",
			background: background("front_bg", VARIANTS[0].color),
			elements: [
				sheen("front_sheen", w, h),
				wordmark("davi_wordmark", MARGIN, MARGIN, mark.width, {}),
				text(
					"name_text",
					{ x: MARGIN, y: 628, width: inner, height: 150 },
					"{{name}}",
					{ family: SERIF, size: 64, weight: 700, lineHeight: 1.1 },
					INK,
					{ verticalAlign: "bottom", maxLines: 2 },
					{ horizontal: "stretch", vertical: "end" },
				),
				{
					id: "rule",
					type: "rect",
					pos: { x: MARGIN, y: 800 },
					size: { width: 56, height: 3 },
					constraints: { vertical: "end" },
					properties: { fill: MUTED },
				},
				text(
					"position_text",
					{ x: MARGIN, y: 824, width: inner, height: 32 },
					"{{position}}",
					{ family: SANS, size: 22, weight: 500, letterSpacing: 1 },
					SOFT,
					{},
					{ horizontal: "stretch", vertical: "end" },
				),
				text(
					"organization_text",
					{ x: MARGIN, y: 860, width: inner, height: 32 },
					"{{organization}}",
					{ family: SANS, size: 22, weight: 400 },
					MUTED,
					{},
					{ horizontal: "stretch", vertical: "end" },
				),
				...tapLine(MARGIN, bottom - 24, { vertical: "end" }),
			],
		},
		{
			name: "back",
			background: background("back_bg", VARIANTS[0].color),
			elements: [
				sheen("back_sheen", w, h),
				text(
					"back_name",
					{ x: MARGIN, y: MARGIN, width: inner, height: 48 },
					"{{name}}",
					{ family: SERIF, size: 36, weight: 700 },
					INK,
					{ verticalAlign: "top" },
					{ horizontal: "stretch" },
				),
				text(
					"back_position",
					{ x: MARGIN, y: 124, width: inner, height: 28 },
					"{{position}}",
					{ family: SANS, size: 18, weight: 500, letterSpacing: 1 },
					SOFT,
					{},
					{ horizontal: "stretch" },
				),
				text(
					"back_organization",
					{ x: MARGIN, y: 156, width: inner, height: 28 },
					"{{organization}}",
					{ family: SANS, size: 18, weight: 400 },
					MUTED,
					{},
					{ horizontal: "stretch" },
				),
				qrTile((w - qr) / 2, (h - qr) / 2, qr, {
					horizontal: "center",
					vertical: "center",
				}),
				scanCaption((w - qr) / 2, (h + qr) / 2 + 20, qr, {
					horizontal: "center",
					vertical: "center",
				}),
				text(
					"back_footer",
					{ x: MARGIN, y: bottom - 24, width: inner, height: 24 },
					"MADE WITH LOVE BY DAVI SOCIAL",
					{ family: SANS, size: 16, weight: 500, letterSpacing: 1.5 },
					MUTED,
					{ verticalAlign: "middle", fit: undefined },
					{ horizontal: "stretch", vertical: "end" },
				),
			],
		},
	];
}

const WIDE = { width: 1012, height: 638 };
const TALL = { width: 638, height: 1012 };

function byId(elements: Element[], out = new Map<string, Element>()) {
	for (const el of elements) {
		out.set(el.id, el);
		if (el.type === "frame") byId(el.properties.children, out);
		if (el.type === "mask")
			byId([el.properties.mask, ...el.properties.children], out);
	}
	return out;
}

const same = (a: unknown, b: unknown) =>
	JSON.stringify(a) === JSON.stringify(b);

/** What turns the landscape card, laid out at portrait size, into the
 *  portrait design: each layer's own box and the properties it sets apart. */
function portraitDeltas(base: Template): Map<string, VariantElementDelta[]> {
	const laid = resizeTemplate(base, TALL.width, TALL.height);
	const want = portrait(TALL.width, TALL.height);
	const out = new Map<string, VariantElementDelta[]>();
	for (const frame of want) {
		const from = byId(
			laid.template_data.find((f) => f.name === frame.name)?.elements ?? [],
		);
		const deltas: VariantElementDelta[] = [];
		for (const el of byId(frame.elements).values()) {
			const was = from.get(el.id);
			if (!was) throw new Error(`portrait layer ${el.id} is not on the card`);
			const own = el.properties as Record<string, unknown>;
			const old = was.properties as Record<string, unknown>;
			const properties: Record<string, unknown> = {};
			for (const k of Object.keys(own))
				if (k !== "children" && k !== "mask" && !same(own[k], old[k]))
					properties[k] = own[k];
			const d: VariantElementDelta = {
				id: el.id,
				properties,
				...(same(el.pos, was.pos) ? {} : { pos: el.pos }),
				...(same(el.size, was.size) ? {} : { size: el.size }),
			};
			if (d.pos || d.size || Object.keys(properties).length > 0) deltas.push(d);
		}
		out.set(frame.name, deltas);
	}
	return out;
}

/** The Davi card, landscape at 1012 x 638, with each colour in landscape and
 *  in portrait at 638 x 1012. */
export function daviCard(): Template {
	const base: Template = {
		format_version: FORMAT_VERSION,
		id: "davi-card",
		name: "Davi card",
		description:
			"A CR80 Davi card: the holder's name and role on the front, and a QR of their card link on the back.",
		version: "2.0.0",
		product: "card_cr80",
		width: WIDE.width,
		height: WIDE.height,
		fonts: FONTS,
		fields: {
			type: "object",
			properties: {
				name: {
					type: "string",
					title: "Full name",
					default: "Juan Dela Cruz",
					maxLength: 48,
				},
				position: {
					type: "string",
					title: "Position",
					default: "",
					maxLength: 48,
				},
				organization: {
					type: "string",
					title: "Organization",
					default: "",
					maxLength: 48,
				},
				card_url: {
					type: "string",
					title: "Card link",
					format: "url",
					default: "https://davi.social/c/XXXXXXXX",
					readOnly: true,
					"x-source": "system",
				},
			},
			required: ["name"],
		},
		template_data: landscape(WIDE.width, WIDE.height),
	};
	const tall = portraitDeltas(base);
	const colour = (
		v: (typeof VARIANTS)[number],
		portrait: boolean,
	): Variant => ({
		id: portrait ? `${v.id}-portrait` : v.id,
		label: portrait ? `${v.label}, portrait` : v.label,
		swatch: v.color,
		...(portrait ? { size: TALL } : {}),
		overrides: (["front", "back"] as const).map((side) => ({
			name: side,
			background: background(`${side}_bg`, v.color),
			...(portrait ? { elements: tall.get(side) ?? [] } : {}),
		})),
	});
	return {
		...base,
		variants: [
			...VARIANTS.map((v) => colour(v, false)),
			...VARIANTS.map((v) => colour(v, true)),
		],
	};
}
