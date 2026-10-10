// The v0.4.0 banner. Each motif stands for what the release adds:
//
// - a grid of live boolean operations, operands on the left turning into
//   their combined shapes on the right;
// - a pen-tool curve with its anchors and handles, for vector point editing;
// - the command that renders this file, set along that curve, for the CLI
//   and template modules;
// - "0.4" across the axes of a variable font, which the engine now bounds and
//   preloads for PDF export.

import type { Element } from "../../packages/coatfile/src/types";
import { defineTemplate } from "../../packages/coatfile/src/define";
import { banner, ellipse, HEIGHT, hue, id, INK, logo, random, rect, smoothPath, WIDTH } from "./art";

const VERSION = "0.4.0";
const rng = random(`freshcoat v${VERSION}`);

const OPS = ["union", "subtract", "intersect", "exclude"] as const;

const COLS = 8;
const ROWS = 5;
const CELL = 78;
const GAP = 14;
const GRID_X = WIDTH - 64 - COLS * CELL - (COLS - 1) * GAP;
const GRID_Y = (HEIGHT - ROWS * CELL - (ROWS - 1) * GAP) / 2;
// Columns before this show their operands as outlines.
const LIVE_FROM = 3;

function operands(): Element[] {
	const shape = () => {
		const w = rng.range(0.45, 0.8) * CELL;
		const h = rng() < 0.5 ? w : rng.range(0.45, 0.8) * CELL;
		const x = rng.range(0, CELL - w);
		const y = rng.range(0, CELL - h);
		return rng() < 0.55
			? ellipse(x, y, w, h)
			: rect(x, y, w, h, {
					rotation: rng.pick([0, 0, 15, 30, 45]),
					properties: { cornerRadius: rng.pick([0, 6, 14]) },
				} as Partial<Element>);
	};
	return Array.from({ length: rng() < 0.3 ? 3 : 2 }, shape);
}

const grid: Element[] = [];
for (let row = 0; row < ROWS; row++) {
	for (let col = 0; col < COLS; col++) {
		const x = GRID_X + col * (CELL + GAP);
		const y = GRID_Y + row * (CELL + GAP);
		const op = rng.pick(OPS);
		const shapes = operands();
		const t = 0.05 + (col / COLS) * 0.55 + (row / ROWS) * 0.25;
		if (col < LIVE_FROM) {
			const strength = 0.25 + (col / LIVE_FROM) * 0.5;
			grid.push({
				id: id("operands"),
				type: "frame",
				pos: { x, y },
				size: { width: CELL, height: CELL },
				opacity: strength,
				properties: {
					children: shapes.map((s) => ({
						...s,
						properties: {
							...s.properties,
							stroke: { color: hue(t), width: 1.5, dash: col === 0 ? [3, 4] : undefined },
						},
					})) as Element[],
				},
			} as Element);
			continue;
		}
		grid.push({
			id: id(op),
			type: "vector",
			pos: { x, y },
			size: { width: CELL, height: CELL },
			blendMode: "screen",
			properties: {
				d: "",
				fill: {
					kind: "linear",
					angle: rng.range(20, 160),
					stops: [
						{ offset: 0, color: hue(t) },
						{ offset: 1, color: hue(t + 0.12) },
					],
				},
				boolean: { op, operands: shapes as never },
			},
		} as Element);
	}
}

// A ring cut by a turned bar: a nested boolean behind everything else.
const ringSize = 560;
const halo: Element = {
	id: "halo",
	type: "vector",
	pos: { x: WIDTH - ringSize * 0.62, y: HEIGHT - ringSize * 0.56 },
	size: { width: ringSize, height: ringSize },
	opacity: 0.16,
	properties: {
		d: "",
		fill: {
			kind: "angular",
			rotation: -90,
			stops: Array.from({ length: 11 }, (_, i) => ({ offset: i / 10, color: hue(i / 10) })),
		},
		boolean: {
			op: "subtract",
			operands: [
				{
					id: "halo-ring",
					type: "vector",
					pos: { x: 0, y: 0 },
					size: { width: ringSize, height: ringSize },
					properties: {
						d: "",
						boolean: {
							op: "subtract",
							operands: [ellipse(0, 0, ringSize, ringSize), ellipse(130, 130, ringSize - 260, ringSize - 260)],
						},
					},
				},
				rect(ringSize / 2 - 30, -60, 60, ringSize + 120, { rotation: -35 } as Partial<Element>),
			] as never,
		},
	},
} as Element;

// The pen-tool curve from the bottom left to the top right.
const points: [number, number][] = [
	[-40, 520],
	[220, rng.range(470, 520)],
	[470, rng.range(560, 600)],
	[760, rng.range(400, 450)],
	[1010, rng.range(110, 160)],
	[1320, rng.range(40, 80)],
];
const curve = smoothPath(points);
const lift = smoothPath(points.map(([x, y]) => [x, y - 10]));

const pen: Element[] = [
	{
		id: "pen-curve",
		type: "vector",
		pos: { x: 0, y: 0 },
		size: { width: WIDTH, height: HEIGHT },
		properties: { d: curve.d, stroke: { color: "#ffffffb3", width: 1.5, cap: "round" } },
	} as Element,
	...curve.segments.slice(1, -1).flatMap((s, i) => {
		const handle = (from: [number, number], to: [number, number]): Element[] => [
			{
				id: id("handle"),
				type: "vector",
				pos: { x: 0, y: 0 },
				size: { width: WIDTH, height: HEIGHT },
				properties: {
					d: `M${from[0]} ${from[1]}L${to[0]} ${to[1]}`,
					stroke: { color: "#ffffff66", width: 1 },
				},
			} as Element,
			ellipse(to[0] - 3.5, to[1] - 3.5, 7, 7, { properties: { fill: INK, stroke: { color: "#ffffffcc", width: 1.25 } } } as Partial<Element>),
		];
		const anchor = s.from;
		const before = curve.segments[i].c2;
		return [
			...handle(anchor, before),
			...handle(anchor, s.c1),
			rect(anchor[0] - 5, anchor[1] - 5, 10, 10, {
				properties: { fill: "#ffffff", stroke: { color: INK, width: 1.5 } },
			} as Partial<Element>),
		];
	}),
];

const command: Element = {
	id: "command",
	type: "text",
	pos: { x: 0, y: 0 },
	size: { width: WIDTH, height: HEIGHT },
	shadow: { color: INK, dx: 0, dy: 0, blur: 6, spread: 2 },
	properties: {
		value: `$ freshcoat render brand/releases/v${VERSION}.coat.ts --out brand/releases/png --jobs 4   ·   live booleans   ·   vector PDF   ·   worker threads   ·   --data people.csv --sheets a4 --duplex long`,
		font: { family: "JetBrains Mono", size: 13, weight: 500, letterSpacing: 0.4 },
		color: "#e9eef7",
		path: { d: lift.d, startOffset: 70 },
	},
} as Element;

// Each character of "0.4" sits elsewhere on the width and weight axes.
const AXES = [
	{ wght: 1000, wdth: 151 },
	{ wght: 600, wdth: 100 },
	{ wght: 300, wdth: 50 },
];
const version: Element = {
	id: "version",
	type: "text",
	pos: { x: 64, y: 150 },
	size: { width: 520, height: 230 },
	properties: {
		spans: [..."0.4"].map((text, i) => ({
			text,
			font: { variations: { ...AXES[i], opsz: 144 } },
		})),
		font: { family: "Roboto Flex", size: 230, lineHeight: 1, letterSpacing: -6 },
		fill: {
			kind: "linear",
			angle: 20,
			stops: [
				{ offset: 0, color: hue(0.02) },
				{ offset: 0.5, color: hue(0.32) },
				{ offset: 1, color: hue(0.52) },
			],
		},
		align: "left",
		verticalAlign: "top",
	},
} as Element;

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
const tagline: Element = {
	id: "tagline",
	type: "text",
	pos: { x: 68, y: 388 },
	size: { width: 520, height: 40 },
	properties: {
		spans: [..."One renderer, from the command line"].map((text, i, all) => ({
			text,
			font: { variations: { wght: WEIGHTS[Math.round((i / (all.length - 1)) * (WEIGHTS.length - 1))] } },
		})),
		font: { family: "Roboto Flex", size: 26, letterSpacing: -0.2 },
		color: "#f4f6fb",
		align: "left",
	},
} as Element;

const footer: Element = {
	id: "footer",
	type: "text",
	pos: { x: 68, y: 432 },
	size: { width: 480, height: 24 },
	properties: {
		value: `v${VERSION} · drawn and rendered by freshcoat itself`,
		font: { family: "JetBrains Mono", size: 13, weight: 400 },
		color: "#8b97ad",
		align: "left",
	},
} as Element;

const grain: Element = rect(0, 0, WIDTH, HEIGHT, {
	id: "grain",
	opacity: 0.05,
	blendMode: "overlay",
	properties: { fill: { kind: "pattern", pattern: "noise", scale: 1.4, seed: 4, colors: ["#000000", "#ffffff"] } },
} as Partial<Element>);

export default defineTemplate(
	banner({
		version: VERSION,
		description: "The v0.4.0 release banner: live booleans, the pen tool, the CLI and variable fonts.",
		fonts: [
			// Google's stylesheet hands a client that is not a browser one static
			// instance, so the variable file comes from the google/fonts repository.
			{
				kind: "local",
				family: "Roboto Flex",
				files: [
					{
						weight: 400,
						src: "https://raw.githubusercontent.com/google/fonts/main/ofl/robotoflex/RobotoFlex%5BGRAD,XOPQ,XTRA,YOPQ,YTAS,YTDE,YTFI,YTLC,YTUC,opsz,slnt,wdth,wght%5D.ttf",
					},
				],
			},
			{
				kind: "google",
				family: "JetBrains Mono",
				url: "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap",
			},
		],
		background: [
			INK,
			{
				kind: "radial",
				center: [0.78, 0.5],
				radius: 0.7,
				stops: [
					{ offset: 0, color: "#16304a" },
					{ offset: 1, color: "#0a0f1c00" },
				],
			},
		] as never,
		elements: [halo, ...grid, ...pen, command, ...logo(68, 72, 34, "#ffffff"), version, tagline, footer, grain],
	}),
);
