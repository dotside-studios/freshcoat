// The v0.5.0 banner. Word: overprint.
//
// Flat slabs in cyan, magenta, yellow and a deep ink, each with its own corner
// radii and smoothing, laid in small clusters of two or three and multiplied,
// so every overlap prints a new colour. Magenta is screened like a second
// plate; the other inks are stamped, with paper speckling through. The paper
// has a little tooth, and no slab touches the lockup. 0.5 is about what
// happens when ink meets paper.
//
// Drawn with per-corner `cornerRadius` and `cornerSmoothing` on rects,
// `grain` and `halftone` effects, and `multiply` inside an isolated frame.

import type { Element } from "../../packages/coatfile/src/types";
import { defineTemplate } from "../../packages/coatfile/src/define";
import { banner, HEIGHT, random, WIDTH } from "./art";

const VERSION = "0.5.0";
const rng = random(`freshcoat v${VERSION}`);

const PAPER = "#f4efe4";
const INKS = ["#00a3e0", "#e6007e", "#ffd600", "#2b2f77"];

// The lockup's box with a margin; no slab may touch it.
const KEEP = { x: WIDTH / 2 - 330, y: HEIGHT / 2 - 70, w: 660, h: 140 };

type Pt = [number, number];

// Corners of a w×h box at (x, y) turned `deg` about its centre.
function corners(x: number, y: number, w: number, h: number, deg: number): Pt[] {
	const cx = x + w / 2;
	const cy = y + h / 2;
	const a = (deg * Math.PI) / 180;
	const c = Math.cos(a);
	const s = Math.sin(a);
	return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(
		([px, py]) => [cx + px * c - py * s, cy + px * s + py * c] as Pt,
	);
}

// Separating axis test between two convex quads.
function overlaps(a: Pt[], b: Pt[]): boolean {
	for (const poly of [a, b])
		for (let i = 0; i < 4; i++) {
			const [x1, y1] = poly[i];
			const [x2, y2] = poly[(i + 1) % 4];
			const nx = y2 - y1;
			const ny = x1 - x2;
			const project = (p: Pt[]) => p.map(([x, y]) => x * nx + y * ny);
			const pa = project(a);
			const pb = project(b);
			if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
		}
	return true;
}

const keep = corners(KEEP.x, KEEP.y, KEEP.w, KEEP.h, 0);
const placed: Pt[][] = [];
const slabs: Element[] = [];
const CLUSTERS = 14;
let turn = 0;

// A cluster is two or three slabs in different inks laid half over each other,
// so each one prints its own mix. Clusters keep apart from each other and from
// the lockup, and may run off the strip.
for (let tries = 0, made = 0; made < CLUSTERS && tries < 20000; tries++) {
	const ax = rng.range(-30, WIDTH + 30);
	const ay = rng.range(-40, HEIGHT + 40);
	const count = rng() < 0.35 ? 3 : 2;
	const base = rng.range(90, 170);
	const parts = Array.from({ length: count }, (_, k) => {
		const w = base * rng.range(0.8, 1.25);
		const h = base * rng.range(0.7, 1.1);
		const a = rng.range(0, Math.PI * 2);
		const off = k === 0 ? 0 : base * rng.range(0.35, 0.6);
		const cx = ax + Math.cos(a) * off;
		const cy = ay + Math.sin(a) * off;
		const deg = rng.range(-40, 40);
		return { x: cx - w / 2, y: cy - h / 2, w, h, deg, quad: corners(cx - w / 2, cy - h / 2, w, h, deg) };
	});
	if (parts.some((q) => overlaps(q.quad, keep) || placed.some((o) => overlaps(q.quad, o)))) continue;
	made++;
	// Three process inks in turn, with the deep ink sometimes taking a place.
	const inks = [0, 1, 2].map((k) => INKS[(turn + k) % 3]);
	if (rng() < 0.3) inks[Math.floor(rng() * count)] = INKS[3];
	// Cyan turns up on both sides, though not evenly.
	if (!inks.slice(0, count).includes(INKS[0]) && rng() < (ax > WIDTH / 2 ? 0.55 : 0.3))
		inks[Math.floor(rng() * count)] = INKS[0];
	turn++;
	parts.forEach((q, k) => {
		placed.push(q.quad);
		const r = () => Math.round(rng.range(0, Math.min(q.w, q.h) / 2));
		const ink = inks[k];
		slabs.push({
			id: `slab-${slabs.length}`,
			type: "rect",
			pos: { x: q.x, y: q.y },
			size: { width: q.w, height: q.h },
			rotation: q.deg,
			blendMode: "multiply",
			opacity: ink === INKS[3] ? 0.85 : 1,
			// Magenta prints as a screen at its own 75° angle, like a second
			// plate; a mid grey under it leaves open dots rather than a solid
			// mesh. The other inks get a screened grain that lets the paper
			// speckle through, like ink pressed unevenly from a stamp.
			effects:
				ink === INKS[1]
					? [{ type: "halftone", cellSize: 8, angle: 75, color: INKS[1] }]
					: [{ type: "grain", amount: 0.38, size: 2, blendMode: "screen", seed: slabs.length }],
			properties: { fill: ink === INKS[1] ? "#6e6e6e" : ink, cornerRadius: [r(), r(), r(), r()], cornerSmoothing: 0.6 },
		} as Element);
	});
}

// Paper tooth: a faint multiplied grain over the ground, under the ink.
const paper: Element = {
	id: "paper",
	type: "rect",
	pos: { x: 0, y: 0 },
	size: { width: WIDTH, height: HEIGHT },
	effects: [{ type: "grain", amount: 0.06, size: 1, blendMode: "multiply", seed: 500 }],
	properties: { fill: PAPER },
} as Element;

const art: Element[] = [
	paper,
	{
		id: "print",
		type: "frame",
		pos: { x: 0, y: 0 },
		size: { width: WIDTH, height: HEIGHT },
		properties: { clipsContent: true, isolate: true, children: slabs },
	} as Element,
];

export default defineTemplate(
	banner({
		version: VERSION,
		description: "The v0.5.0 release banner: overprinted slabs scattered around the lockup.",
		background: PAPER,
		tone: "light",
		shade: false,
		art,
	}),
);
