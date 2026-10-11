// The v0.4.0 banner. Word: interfere.
//
// Interference rings printed in two tones of cobalt. Each centre casts
// concentric circles, and one live `exclude` operation over all of them leaves
// the moiré where their rings cross. A `subtract` around it cuts a rounded
// panel for the lockup. The engine rebuilds both at render time from the
// circles alone; the cached paths are left empty.

import type { Element } from "../../packages/coatfile/src/types";
import { defineTemplate } from "../../packages/coatfile/src/define";
import { banner, ellipse, HEIGHT, random, rect, WIDTH } from "./art";

const VERSION = "0.4.0";
const rng = random(`freshcoat v${VERSION}`);

const GROUND = "#2f4fc4";
const INK = "#5f7fe8";

const STEP = 34;
const REACH = 820;

const centres: [number, number][] = [
	[rng.range(0.08, 0.2) * WIDTH, rng.range(0.2, 0.8) * HEIGHT],
	[rng.range(0.45, 0.55) * WIDTH, rng.range(1.3, 1.8) * HEIGHT],
	[rng.range(0.8, 0.92) * WIDTH, rng.range(0.2, 0.8) * HEIGHT],
];

const rings = centres.flatMap(([cx, cy]) =>
	Array.from({ length: Math.floor(REACH / STEP) }, (_, i) => {
		const r = STEP * (i + 1);
		return ellipse(cx - r, cy - r, r * 2, r * 2);
	}),
);

const PANEL_W = 600;
const PANEL_H = 120;

const field: Element = {
	id: "rings",
	type: "vector",
	pos: { x: 0, y: 0 },
	size: { width: WIDTH, height: HEIGHT },
	properties: {
		d: "",
		fill: INK,
		boolean: {
			op: "subtract",
			operands: [
				{
					id: "interference",
					type: "vector",
					pos: { x: 0, y: 0 },
					size: { width: WIDTH, height: HEIGHT },
					properties: { d: "", boolean: { op: "exclude", operands: rings as never } },
				},
				rect((WIDTH - PANEL_W) / 2, (HEIGHT - PANEL_H) / 2, PANEL_W, PANEL_H, {
					properties: { cornerRadius: PANEL_H / 2 },
				} as Partial<Element>),
			] as never,
		},
	},
} as Element;

// A frame clips the circles that reach past the strip.
const art: Element[] = [
	{
		id: "print",
		type: "frame",
		pos: { x: 0, y: 0 },
		size: { width: WIDTH, height: HEIGHT },
		properties: { clipsContent: true, children: [field] },
	} as Element,
];

export default defineTemplate(
	banner({
		version: VERSION,
		description: "The v0.4.0 release banner: interference rings printed in cobalt.",
		background: GROUND,
		tone: "dark",
		shade: false,
		art,
	}),
);
