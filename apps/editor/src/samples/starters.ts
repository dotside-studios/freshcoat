import type { ExportPreset } from "@freshcoat-js/workspace";
import { DEFAULT_SHEET_LAYOUT } from "@freshcoat-js/workspace";
import type { Sample } from "./index";

/** A sample meant to be made your own: listed first, opened by `?starter=`. */
export type Starter = Sample & {
	/** the export preset it opens with, over a new preset's defaults */
	preset?: Partial<ExportPreset>;
};

/** A Davi card goes to a card printer, so its preset prints through for-print. */
const CARD_PRINTER: Partial<ExportPreset> = {
	name: "Card printer",
	print: { enabled: true },
};

export const STARTERS: Starter[] = [
	{
		id: "davi-card",
		name: "Davi card",
		description: "CR80 landscape, front and back, card link QR, three colors",
		width: 1012,
		height: 638,
		swatch: "#1d4ed8",
		load: () => import("./davi-card").then((m) => m.daviCard("landscape")),
		preset: CARD_PRINTER,
	},
	{
		id: "davi-card-portrait",
		name: "Davi card, portrait",
		description: "The same card standing up",
		width: 638,
		height: 1012,
		swatch: "#5b2a55",
		load: () => import("./davi-card").then((m) => m.daviCard("portrait")),
		preset: CARD_PRINTER,
	},
	{
		id: "photo-watermark",
		name: "Photo watermark",
		description: "A mark pinned to the corner of any photo's size",
		width: 1600,
		height: 1200,
		swatch: "#1f2328",
		load: () => import("./photo-watermark").then((m) => m.photoWatermark()),
		preset: {
			name: "Watermarked photos",
			fileName: "{{file_name}}",
			size: { kind: "image", field: "photo" },
			format: "jpeg-zip",
			quality: 90,
		},
	},
	{
		id: "event-badge",
		name: "Event badge",
		description:
			"4 × 3 in, name, company and role, a Code 128 of the ticket, Speaker and Staff variants",
		width: 1200,
		height: 900,
		swatch: "#0f766e",
		load: () => import("./event-badge").then((m) => m.eventBadge()),
		preset: {
			name: "Badges on A4",
			format: "pdf",
			layout: { ...DEFAULT_SHEET_LAYOUT, paper: "a4", orientation: "auto" },
		},
	},
];

export function findStarter(id: string): Starter | undefined {
	return STARTERS.find((s) => s.id === id);
}
