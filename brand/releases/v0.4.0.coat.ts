// The v0.4.0 banner: interference rings. Each centre casts concentric
// circles, and one live `exclude` operation over all of them leaves the moiré
// where their rings cross. The engine rebuilds it at render time from the
// circles alone; the cached path is left empty.

import type { Element } from "../../packages/coatfile/src/types";
import { defineTemplate } from "../../packages/coatfile/src/define";
import { banner, ellipse, HEIGHT, random, rect, WIDTH } from "./art";

const VERSION = "0.4.0";
const rng = random(`freshcoat v${VERSION}`);

// The mark's colours, on a near-black ground.
const GROUND = "#0a0f1c";
const COLOURS = ["#019dda", "#2eaa8f", "#7bb353", "#f1b82b", "#f78e21", "#e75234", "#cc3b56", "#9f3d8c", "#5368b6", "#2883c9"];

const hue = (t: number) => {
	const at = (((t % 1) + 1) % 1) * COLOURS.length;
	const i = Math.floor(at);
	const [a, b] = [COLOURS[i], COLOURS[(i + 1) % COLOURS.length]].map((hex) =>
		[1, 3, 5].map((k) => Number.parseInt(hex.slice(k, k + 2), 16)),
	);
	return `#${a.map((v, n) => Math.round(v + (b[n] - v) * (at - i)).toString(16).padStart(2, "0")).join("")}`;
};

const STEP = 34;
const REACH = 820;

const centres: [number, number][] = [
	[rng.range(0.08, 0.2) * WIDTH, rng.range(0.2, 0.8) * HEIGHT],
	[rng.range(0.45, 0.55) * WIDTH, rng.range(1.3, 1.8) * HEIGHT],
	[rng.range(0.8, 0.92) * WIDTH, rng.range(0.2, 0.8) * HEIGHT],
];

const rings = (offset: number) =>
	centres.flatMap(([cx, cy]) =>
		Array.from({ length: Math.floor(REACH / STEP) }, (_, i) => {
			const r = STEP * (i + 1) + offset;
			return ellipse(cx - r, cy - r, r * 2, r * 2);
		}),
	);

// Soft colour under the rings, one blurred glow per centre and one between each pair.
const glows: Element[] = centres.flatMap(([cx, cy], i) => {
	const at = (x: number, y: number, r: number, t: number) =>
		ellipse(x - r, y - r * 0.7, r * 2, r * 1.4, {
			blur: 90,
			opacity: 0.85,
			properties: { fill: hue(t) },
		} as Partial<Element>);
	const glow = at(cx, Math.min(Math.max(cy, 0), HEIGHT), rng.range(170, 230), 0.08 + i * 0.3);
	const next = centres[i + 1];
	if (!next) return [glow];
	return [glow, at((cx + next[0]) / 2, rng.range(0.2, 0.8) * HEIGHT, rng.range(120, 170), 0.23 + i * 0.3)];
});

const field: Element = {
	id: "rings",
	type: "vector",
	pos: { x: 0, y: 0 },
	size: { width: WIDTH, height: HEIGHT },
	opacity: 0.28,
	blendMode: "overlay",
	properties: {
		d: "",
		fill: "#ffffff",
		boolean: { op: "exclude", operands: rings(0) as never },
	},
};

// A frame clips the circles that reach past the strip.
const art: Element[] = [
	{
		id: "interference",
		type: "frame",
		pos: { x: 0, y: 0 },
		size: { width: WIDTH, height: HEIGHT },
		properties: {
			clipsContent: true,
			children: [...glows, field],
		},
	} as Element,
	rect(0, 0, WIDTH, HEIGHT, {
		id: "grain",
		opacity: 0.06,
		blendMode: "overlay",
		properties: { fill: { kind: "pattern", pattern: "noise", scale: 1.4, seed: 4, colors: ["#000000", "#ffffff"] } },
	} as Partial<Element>),
];

export default defineTemplate(
	banner({
		version: VERSION,
		description: "The v0.4.0 release banner: interference rings from one live exclude operation.",
		background: GROUND,
		tone: "dark",
		art,
	}),
);
