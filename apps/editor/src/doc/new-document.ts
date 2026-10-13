import type { FontDescriptor, Template } from "@freshcoat-js/coatfile";
import { FORMAT_VERSION } from "@freshcoat-js/coatfile";

export type Preset = {
	id: string;
	name: string;
	width: number;
	height: number;
	sides: string[];
	bleed?: number;
	safeArea?: number;
};

export const PRESETS: Preset[] = [
	{
		id: "card-cr80",
		name: "Card CR80",
		width: 1012,
		height: 638,
		sides: ["front", "back"],
	},
	{
		id: "a4-landscape",
		name: "A4 landscape",
		width: 842,
		height: 595,
		sides: ["page"],
	},
	{ id: "square", name: "Square", width: 1080, height: 1080, sides: ["page"] },
	{
		id: "portrait-poster",
		name: "Portrait poster",
		width: 1080,
		height: 1350,
		sides: ["page"],
	},
	{ id: "badge", name: "Badge", width: 638, height: 1012, sides: ["front"] },
	{
		id: "business-card",
		name: "Business card US",
		width: 1050,
		height: 600,
		sides: ["front", "back"],
		bleed: 38,
		safeArea: 38,
	},
	{
		id: "business-card-eu",
		name: "Business card EU",
		width: 1004,
		height: 650,
		sides: ["front", "back"],
		bleed: 35,
		safeArea: 35,
	},
	{
		id: "postcard",
		name: "Postcard 4×6 in",
		width: 1800,
		height: 1200,
		sides: ["front", "back"],
		bleed: 38,
		safeArea: 38,
	},
	{
		id: "postcard-a6",
		name: "Postcard A6",
		width: 1748,
		height: 1240,
		sides: ["front", "back"],
		bleed: 35,
		safeArea: 35,
	},
	{
		id: "shipping-label",
		name: "Shipping label 4×6 in",
		width: 1200,
		height: 1800,
		sides: ["front"],
		safeArea: 38,
	},
];

/** The id a new blank template starts with. A template that still has it
 *  was never named, and saving it asks for a name first. */
export const UNNAMED_ID = "untitled";

export function isUnnamed(t: Pick<Template, "id">): boolean {
	return t.id === UNNAMED_ID;
}

/** An empty document: white sides, no fields, `font` (Vend Sans, from
 *  `loadVendSans`) embedded so it renders offline and stays portable. */
export function newDocument(
	preset: Pick<Preset, "width" | "height"> & Partial<Preset>,
	font: FontDescriptor,
): Template {
	const sides = preset.sides?.length ? preset.sides : ["front"];
	return {
		format_version: FORMAT_VERSION,
		id: UNNAMED_ID,
		name: "Untitled",
		width: Math.round(preset.width),
		height: Math.round(preset.height),
		...(preset.bleed ? { bleed: preset.bleed } : {}),
		...(preset.safeArea ? { safeArea: preset.safeArea } : {}),
		fields: { type: "object", properties: {} },
		fonts: [font],
		template_data: sides.map((name) => ({
			name,
			background: {
				id: "background",
				type: "rect",
				properties: { fill: "#ffffff" },
			},
			elements: [],
		})),
	};
}
