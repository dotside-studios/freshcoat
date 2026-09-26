import type { Template } from "@freshcoat/coatfile";

export type Sample = {
	id: string;
	name: string;
	description: string;
	width: number;
	height: number;
	/** A colour for its tile on the welcome screen. */
	swatch?: string;
	load(): Promise<Template>;
};

export const SAMPLES: Sample[] = [
	{
		id: "membership-card",
		name: "Membership card",
		description:
			"CR80, front and back, bound fields, QR and a Midnight variant",
		width: 1012,
		height: 638,
		load: () => import("./membership-card").then((m) => m.membershipCard()),
	},
	{
		id: "certificate",
		name: "Certificate",
		description: "A4 landscape, auto layout, stroke, shadow and a mask",
		width: 842,
		height: 595,
		load: () => import("./certificate").then((m) => m.certificate()),
	},
	{
		id: "minimal",
		name: "Minimal",
		description: "One side, one bound text layer",
		width: 1012,
		height: 638,
		load: () => import("./minimal").then((m) => m.minimal()),
	},
];

export function findSample(id: string): Sample | undefined {
	return SAMPLES.find((s) => s.id === id);
}
