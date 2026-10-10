// Shared pieces for the release banners: a seeded random source, the brand
// palette, operand shapes and the frame every banner is drawn in. A banner is
// a template module, so the CLI of the release it announces renders it.

import { readFileSync } from "node:fs";
import type { Element, Fill, Template } from "../../packages/coatfile/src/types";
import { scalePathData } from "../../packages/engine/src/path-data";

export const WIDTH = 1280;
export const HEIGHT = 640;
export const INK = "#0a0f1c";

// The stops of the mark's angular gradient.
export const PALETTE = [
	"#019dda",
	"#2eaa8f",
	"#7bb353",
	"#f1b82b",
	"#f78e21",
	"#e75234",
	"#cc3b56",
	"#9f3d8c",
	"#5368b6",
	"#2883c9",
];

/** The palette colour at `t`, wrapping, blended between neighbouring stops. */
export function hue(t: number): string {
	const at = (((t % 1) + 1) % 1) * PALETTE.length;
	const i = Math.floor(at);
	const a = rgb(PALETTE[i]);
	const b = rgb(PALETTE[(i + 1) % PALETTE.length]);
	const k = at - i;
	return `#${a.map((v, n) => Math.round(v + (b[n] - v) * k).toString(16).padStart(2, "0")).join("")}`;
}

const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));

export type Random = {
	(): number;
	range(min: number, max: number): number;
	pick<T>(items: readonly T[]): T;
};

/** A random source seeded by a string, so a banner renders the same every time. */
export function random(seed: string): Random {
	let h = 2166136261;
	for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
	let s = h >>> 0;
	const next = (() => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}) as Random;
	next.range = (min, max) => min + (max - min) * next();
	next.pick = (items) => items[Math.floor(next() * items.length)];
	return next;
}

let ids = 0;
export const id = (name: string) => `${name}-${++ids}`;

const round = (n: number) => Math.round(n * 100) / 100;

export function ellipsePath(w: number, h: number): string {
	const rx = round(w / 2);
	const ry = round(h / 2);
	return `M0 ${ry}A${rx} ${ry} 0 1 0 ${round(w)} ${ry}A${rx} ${ry} 0 1 0 0 ${ry}Z`;
}

/** A cubic path through `points` as Catmull-Rom, with the control points of
 *  each segment, for drawing its handles. */
export function smoothPath(points: [number, number][]) {
	const segments: { from: [number, number]; c1: [number, number]; c2: [number, number]; to: [number, number] }[] = [];
	for (let i = 0; i < points.length - 1; i++) {
		const p0 = points[i - 1] ?? points[i];
		const p1 = points[i];
		const p2 = points[i + 1];
		const p3 = points[i + 2] ?? p2;
		segments.push({
			from: p1,
			c1: [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6],
			c2: [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6],
			to: p2,
		});
	}
	const pt = (p: [number, number]) => `${round(p[0])} ${round(p[1])}`;
	const d = `M${pt(points[0])}${segments.map((s) => `C${pt(s.c1)} ${pt(s.c2)} ${pt(s.to)}`).join("")}`;
	return { d, segments };
}

export function ellipse(x: number, y: number, w: number, h: number, extra: Partial<Element> = {}): Element {
	return {
		id: id("ellipse"),
		type: "vector",
		pos: { x, y },
		size: { width: w, height: h },
		...extra,
		properties: { d: ellipsePath(w, h), ...(extra.properties as object) },
	} as Element;
}

export function rect(x: number, y: number, w: number, h: number, extra: Partial<Element> = {}): Element {
	return {
		id: id("rect"),
		type: "rect",
		pos: { x, y },
		size: { width: w, height: h },
		...extra,
		properties: { ...(extra.properties as object) },
	} as Element;
}

export const angular = (rotation = -90): Fill => ({
	kind: "angular",
	rotation,
	stops: [...PALETTE, PALETTE[0]].map((color, i) => ({ offset: i / PALETTE.length, color })),
});

const logoSvg = readFileSync(new URL("../freshcoat-logo.svg", import.meta.url), "utf8");
const pick = (re: RegExp) => {
	const match = logoSvg.match(re);
	if (!match?.[1]) throw new Error(`brand/freshcoat-logo.svg is missing ${re}`);
	return match[1];
};
const markPath = pick(/<clipPath id="fc-logo"><path d="([^"]+)"/);
const wordPath = pick(/<path fill="#000" d="([^"]+)"/);

/** The Freshcoat logo drawn as vectors, `height` tall, with the wordmark in `color`. */
export function logo(x: number, y: number, height: number, color: string): Element[] {
	const s = height / 120;
	return [
		{
			id: "logo-mark",
			type: "vector",
			pos: { x, y },
			size: { width: round(138 * s), height },
			properties: { d: scalePathData(markPath, s), fill: angular(0) },
		},
		{
			id: "logo-wordmark",
			type: "vector",
			pos: { x, y },
			size: { width: round(668 * s), height },
			properties: { d: scalePathData(wordPath, s), fill: color },
		},
	] as Element[];
}

export type BannerOptions = {
	version: string;
	description: string;
	fonts: Template["fonts"];
	elements: Element[];
	background?: Fill | Fill[];
};

/** The template for a release banner, one frame named after the release. */
export function banner(o: BannerOptions): Template {
	return {
		format_version: "1.6",
		version: "1.0.0",
		id: `freshcoat-release-v${o.version}`,
		name: `Freshcoat v${o.version} release banner`,
		description: o.description,
		width: WIDTH,
		height: HEIGHT,
		fonts: o.fonts,
		fields: { type: "object", properties: {}, required: [] },
		template_data: [
			{
				name: `v${o.version}`,
				background: {
					id: "background",
					type: "rect",
					pos: { x: 0, y: 0 },
					size: { width: WIDTH, height: HEIGHT },
					properties: { fill: o.background ?? INK },
				},
				elements: o.elements,
			},
		],
	} as Template;
}
