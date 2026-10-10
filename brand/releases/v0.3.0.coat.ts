// The v0.3.0 banner. Word: lighten.
//
// An engraving: ruled lines that start heavy, almost solid, and thin to
// hairlines across the strip, swelling over a slow field, as 0.3 took weight
// off every paint, list and export.

import type { Element } from "../../packages/coatfile/src/types";
import { defineTemplate } from "../../packages/coatfile/src/define";
import { banner, HEIGHT, random, WIDTH } from "./art";

const VERSION = "0.3.0";
const rng = random(`freshcoat v${VERSION}`);

const PAPER = "#f4ead8";
const INK = "#c8432a";

const CX = WIDTH / 2;
const CY = HEIGHT / 2;
const PITCH = 8;
const STEP = 4;
const PANEL = { w: 640, h: 124 };

const waves = Array.from({ length: 3 }, () => ({
	fx: rng.range(0.002, 0.006),
	fy: rng.range(0.01, 0.03),
	phase: rng.range(0, Math.PI * 2),
}));

const smooth = (t: number) => t * t * (3 - 2 * t);
const weight = (x: number, y: number) => {
	const fade = 1 - smooth(Math.min(1, Math.max(0, x / WIDTH)));
	const field = waves.reduce((sum, w) => sum + Math.sin(x * w.fx + y * w.fy + w.phase), 0) / waves.length;
	return Math.max(0.35, (PITCH - 0.8) * fade * (0.6 + 0.55 * field));
};
const drift = (x: number) => Math.sin(x * 0.004 + waves[0].phase) * 6;

// How far either side of the centre the panel reaches on a line at `y`.
const panelReach = (y: number) => {
	const dy = Math.abs(y - CY);
	if (dy >= PANEL.h / 2) return 0;
	return (PANEL.w - PANEL.h) / 2 + Math.sqrt((PANEL.h / 2) ** 2 - dy ** 2);
};

const r = (n: number) => Math.round(n * 10) / 10;

// One engraved line from `from` to `to`: its top edge out, its bottom edge back.
const stroke = (base: number, from: number, to: number) => {
	const xs: number[] = [];
	for (let x = from; x < to; x += STEP) xs.push(x);
	xs.push(to);
	const at = (x: number) => [x, base + drift(x), weight(x, base)] as const;
	const top = xs.map((x) => {
		const [, y, t] = at(x);
		return `${r(x)} ${r(y - t / 2)}`;
	});
	const bottom = xs.map((x) => {
		const [, y, t] = at(x);
		return `${r(x)} ${r(y + t / 2)}`;
	});
	return `M${top.join("L")}L${bottom.reverse().join("L")}Z`;
};

let d = "";
for (let base = PITCH / 2; base < HEIGHT; base += PITCH) {
	const reach = panelReach(base);
	if (reach === 0) d += stroke(base, -STEP, WIDTH + STEP);
	else d += stroke(base, -STEP, CX - reach) + stroke(base, CX + reach, WIDTH + STEP);
}

const art: Element[] = [
	{
		id: "engraving",
		type: "vector",
		pos: { x: 0, y: 0 },
		size: { width: WIDTH, height: HEIGHT },
		properties: { d, fill: INK },
	} as Element,
];

export default defineTemplate(
	banner({
		version: VERSION,
		description: "The v0.3.0 release banner: lighten, as an engraving.",
		background: PAPER,
		tone: "light",
		shade: false,
		art,
	}),
);
