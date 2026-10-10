// Shared pieces for the release banners: a seeded random source, shapes and
// the strip every banner is drawn in, with the logo and version centred over
// the release's own art. A banner is a template module,
// so the CLI of the release it announces renders it.

import { readFileSync } from "node:fs";
import type { Element, Fill, Template } from "../../packages/coatfile/src/types";
import { scalePathData } from "../../packages/engine/src/path-data";

// A 5:1 strip, wide and thin like a film frame.
export const WIDTH = 1600;
export const HEIGHT = 320;
// The stops of the mark's angular gradient.
const MARK = [
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

const markFill: Fill = {
	kind: "angular",
	rotation: 0,
	stops: [...MARK, MARK[0]].map((color, i) => ({ offset: i / MARK.length, color })),
};

const logoSvg = readFileSync(new URL("../freshcoat-logo.svg", import.meta.url), "utf8");
const pick = (re: RegExp) => {
	const match = logoSvg.match(re);
	if (!match?.[1]) throw new Error(`brand/freshcoat-logo.svg is missing ${re}`);
	return match[1];
};
const markPath = pick(/<clipPath id="fc-logo"><path d="([^"]+)"/);
const wordPath = pick(/<path fill="#000" d="([^"]+)"/);

/** The Freshcoat logo drawn as vectors, `height` tall, with the wordmark in `color`. */
export function logo(height: number, color: string): Element {
	const s = height / 120;
	const size = { width: round(668 * s), height };
	return {
		id: "logo",
		type: "frame",
		size,
		properties: {
			children: [
				{
					id: "logo-mark",
					type: "vector",
					pos: { x: 0, y: 0 },
					size: { width: round(138 * s), height },
					properties: { d: scalePathData(markPath, s), fill: markFill },
				},
				{
					id: "logo-wordmark",
					type: "vector",
					pos: { x: 0, y: 0 },
					size,
					properties: { d: scalePathData(wordPath, s), fill: color },
				},
			],
		},
	} as Element;
}

// Google's stylesheet hands a client that is not a browser one static
// instance, so the variable file comes from the google/fonts repository.
const ROBOTO_FLEX = {
	kind: "local",
	family: "Roboto Flex",
	files: [
		{
			weight: 400,
			src: "https://raw.githubusercontent.com/google/fonts/main/ofl/robotoflex/RobotoFlex%5BGRAD,XOPQ,XTRA,YOPQ,YTAS,YTDE,YTFI,YTLC,YTUC,opsz,slnt,wdth,wght%5D.ttf",
		},
	],
} as const;

/** Whether the art behind the lockup is mostly dark or light. The lockup is
 *  drawn in white over a dark shade on dark art, and in black over a light
 *  shade on light art. */
export type Tone = "dark" | "light";

/** The logo and the version, centred, over a shade that keeps them readable
 *  on any art. The same in every banner but for its tone. */
function lockup(version: string, tone: Tone): Element[] {
	const ink = tone === "dark" ? "#ffffff" : "#000000";
	const shade = tone === "dark" ? "#000000" : "#ffffff";
	return [
		rect(0, 0, WIDTH, HEIGHT, {
			id: "shade",
			properties: {
				fill: {
					kind: "radial",
					center: [0.5, 0.5],
					radius: 0.26,
					radiusY: 0.12,
					stops: [
						{ offset: 0, color: `${shade}b3` },
						{ offset: 0.55, color: `${shade}80` },
						{ offset: 1, color: `${shade}00` },
					],
				},
			},
		} as Partial<Element>),
		{
			id: "lockup",
			type: "frame",
			pos: { x: 0, y: 0 },
			size: { width: WIDTH, height: HEIGHT },
			properties: {
				layout: { direction: "row", gap: 28, primaryAlign: "center", crossAlign: "center" },
				children: [
					logo(58, ink),
					rect(0, 0, 2, 52, { id: "divider", properties: { fill: `${ink}59` } } as Partial<Element>),
					{
						id: "version",
						type: "text",
						size: { width: 200, height: 58 },
						layoutChild: { width: "hug" },
						properties: {
							value: version,
							font: { family: "Roboto Flex", size: 54, lineHeight: 1, variations: { wght: 300, wdth: 100, opsz: 72 } },
							color: ink,
							verticalAlign: "middle",
						},
					},
				],
			},
		} as Element,
	];
}

export type BannerOptions = {
	version: string;
	description: string;
	/** The release's own art, drawn behind the lockup. */
	art: Element[];
	/** The ground under the art. */
	background: Fill | Fill[];
	tone: Tone;
	fonts?: Template["fonts"];
};

/** The template for a release banner: a strip with the release's art behind
 *  the logo and version, one frame named after the release. */
export function banner(o: BannerOptions): Template {
	return {
		format_version: "1.6",
		version: "1.0.0",
		id: `freshcoat-release-v${o.version}`,
		name: `Freshcoat v${o.version} release banner`,
		description: o.description,
		width: WIDTH,
		height: HEIGHT,
		fonts: [ROBOTO_FLEX, ...(o.fonts ?? [])],
		fields: { type: "object", properties: {}, required: [] },
		template_data: [
			{
				name: `v${o.version}`,
				background: {
					id: "background",
					type: "rect",
					pos: { x: 0, y: 0 },
					size: { width: WIDTH, height: HEIGHT },
					properties: { fill: o.background },
				},
				elements: [...o.art, ...lockup(o.version, o.tone)],
			},
		],
	} as Template;
}
