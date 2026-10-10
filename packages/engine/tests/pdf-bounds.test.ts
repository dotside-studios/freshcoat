// A layer painted over the area drawableBounds gives it matches the same layer
// painted over the whole page, and nothing lies outside that area.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test } from "vitest";
import {
	drawableBounds,
	makeBin,
	paintScene,
	shapeTextLines,
} from "../src/canvaskit";
import { createSharedFontProvider } from "../src/font-collection";
import {
	createFrame,
	createGroup,
	createImage,
	createMask,
	createPath,
	createRect,
	createText,
	type Node,
} from "../src/node";
import { createRenderer, type Renderer } from "../src/renderer";
import type { Command, DrawCommand, DrawTextCommand } from "../src/types";
import { createHeadlessEnv } from "./helpers/headless";

const W = 240;
const H = 200;

// biome-ignore lint/suspicious/noExplicitAny: CanvasKit instance
let ck: any;
let renderer: Renderer;
const fonts = new Map([
	["Geist", [testFontBytes("Geist-Regular.ttf")]],
	["Vend", [testFontBytes("VendSans-Variable-latin.woff2")]],
]);
const geist = new Map([["Geist", fonts.get("Geist") as Uint8Array[]]]);
const stripes = new Uint8Array(
	readFileSync(join(__dirname, "fixtures/pdf/stripes.jpg")),
);
beforeAll(async () => {
	ck = await loadCanvasKit();
	renderer = await createRenderer({ ck, fonts: Object.fromEntries(fonts) });
});

const solid = (color: string) => [{ kind: "solid" as const, color }];
const box = (x: number, y: number, width: number, height: number) => ({
	pos: { x, y },
	size: { width, height },
});
const shadow = (dx: number, dy: number, blur: number, spread = 0) => ({
	color: "#000000aa",
	dx,
	dy,
	blur,
	spread,
});
const text = (value: string, size: number, x: number, y: number) =>
	createText({
		...box(x, y, 120, size * 1.3),
		text: value,
		font: { family: "Geist", weight: 400, style: "normal", size, lineHeight: 1.2 },
		color: "#1d3557",
	});

const vend = (
	value: string,
	size: number,
	x: number,
	y: number,
	weight: number,
	style: "normal" | "italic",
) =>
	createText({
		...box(x, y, 160, size * 1.3),
		text: value,
		font: { family: "Vend", weight, style, size, lineHeight: 1.2 },
		color: "#1d3557",
	});

const scenes: Record<
	string,
	{ nodes: Node[]; tolerance?: number; variable?: boolean }
> = {
	"shadowed rounded rect": {
		nodes: [
			createRect({
				...box(60, 60, 80, 50),
				cornerRadius: 12,
				fills: solid("#ff5a36"),
				shadow: shadow(6, 8, 14, 3),
			}),
		],
	},
	"stroked rect": {
		nodes: [
			createRect({
				...box(60, 60, 80, 50),
				fills: solid("#ff5a36"),
				stroke: { color: "#111111", width: 9, align: "outside", join: "miter" },
			}),
		],
	},
	"rotated rect with two shadows": {
		nodes: [
			createRect({
				...box(80, 70, 90, 40),
				fills: solid("#3a86ff"),
				rotation: 33,
				shadow: [shadow(4, 4, 10), shadow(-10, 6, 4, 2)],
			}),
		],
		tolerance: 1,
	},
	"shadowed text": {
		nodes: [{ ...text("Fresh coat", 28, 40, 80), shadow: shadow(5, 5, 8) } as Node],
	},
	"viewBox path with shadow and stroke": {
		nodes: [
			createPath({
				...box(70, 50, 100, 80),
				d: "M-20 120 L50 -20 L120 120 Z",
				viewBox: { x: -20, y: -20, width: 140, height: 140 },
				fills: solid("#ef476f"),
				stroke: { color: "#000000", width: 6, join: "miter" },
				shadow: shadow(8, 6, 12),
			}),
		],
	},
	"blurred group": {
		nodes: [
			createGroup(
				[
					createRect({ ...box(70, 70, 50, 50), fills: solid("#219ebc") }),
					createRect({ ...box(100, 90, 50, 50), fills: solid("#ffb703") }),
				],
				{ blur: 9 },
			),
		],
	},
	"nested rotated group": {
		nodes: [
			createGroup(
				[
					createGroup(
						[
							createRect({
								...box(90, 80, 60, 30),
								fills: solid("#8338ec"),
								shadow: shadow(3, 5, 6),
							}),
						],
						{ rotation: 20 },
					),
				],
				{ rotation: 25 },
			),
		],
		tolerance: 1,
	},
	"text with large font overflow": {
		nodes: [text("Wg", 90, 30, 40)],
	},
	"variable font text": {
		nodes: [vend("Wag jy", 40, 20, 70, 400, "normal")],
		variable: true,
	},
	"heavy variable font text": {
		nodes: [vend("Wag jy", 40, 20, 70, 900, "normal")],
		variable: true,
	},
	"heavy italic variable font text": {
		nodes: [vend("Wag jy", 40, 20, 70, 900, "italic")],
		variable: true,
	},
	"variable font text with shadow and decoration": {
		nodes: [
			{
				...vend("Wag jy", 40, 20, 70, 700, "italic"),
				font: {
					family: "Vend",
					weight: 700,
					style: "italic",
					size: 40,
					lineHeight: 1.2,
					decoration: "underline",
				},
				shadow: shadow(5, 5, 8),
			} as Node,
		],
		variable: true,
	},
	"masked group": {
		nodes: [
			createMask(createRect({ ...box(70, 60, 60, 60), fills: solid("#ffffff") }), [
				createRect({ ...box(50, 50, 120, 90), fills: solid("#2a9d8f") }),
			]),
		],
	},
	"image with stroke": {
		nodes: [
			createImage({
				...box(60, 50, 90, 70),
				src: "a.jpg",
				fit: "cover",
				stroke: { color: "#d00000", width: 7, align: "outside", join: "miter" },
			}),
		],
		tolerance: 1,
	},
};

// Every drawable in `commands`, the children and masks of groups included.
function flatten(commands: Command[]): DrawCommand[] {
	const out: DrawCommand[] = [];
	const walk = (cmd: DrawCommand) => {
		out.push(cmd);
		if (cmd.op === "drawGroup" || cmd.op === "drawMasked")
			for (const child of cmd.children) walk(child);
		if (cmd.op === "drawMasked") walk(cmd.mask);
	};
	for (const cmd of commands)
		if (
			cmd.op !== "createCanvas" &&
			cmd.op !== "loadFonts" &&
			cmd.op !== "loadImages" &&
			cmd.op !== "finishFrame"
		)
			walk(cmd);
	return out;
}

async function pixels(
	layers: Command[],
	setup: Command[],
	scale: number,
	area?: { x: number; y: number; width: number; height: number },
) {
	const rt = createHeadlessEnv({ fonts, images: new Map([["a.jpg", stripes]]) });
	const out = await paintScene(
		ck,
		[
			{
				op: "createCanvas",
				width: area ? area.width / scale : W,
				height: area ? area.height / scale : H,
				scale,
			},
			...setup,
			...layers,
		],
		rt,
		{ origin: area },
	);
	try {
		const px = out.readPixels?.();
		if (!px) throw new Error("no pixels");
		return px;
	} finally {
		out.dispose();
	}
}

describe("shapeTextLines", () => {
	test("frees each paragraph and keeps the runs it returns", () => {
		const shared = createSharedFontProvider(ck, geist);
		(shared.provider as { __families?: string[] }).__families = ["Geist"];
		const bin = makeBin();
		const made = ck.ParagraphBuilder.MakeFromFontCollection;
		const built: Array<{ deleted: boolean }> = [];
		ck.ParagraphBuilder.MakeFromFontCollection = (...args: unknown[]) => {
			const builder = made.apply(ck.ParagraphBuilder, args);
			const build = builder.build.bind(builder);
			builder.build = () => {
				const para = build();
				const del = para.delete.bind(para);
				const entry = { deleted: false };
				para.delete = () => {
					entry.deleted = true;
					del();
				};
				built.push(entry);
				return para;
			};
			return builder;
		};
		try {
			const commands = renderer.compile(
				createFrame({
					...box(0, 0, W, H),
					children: [text("Hello there", 20, 10, 10)],
				}),
				{ width: W, height: H },
			);
			const cmd = flatten(commands).find(
				(c) => c.op === "drawText",
			) as DrawTextCommand;
			const lines = shapeTextLines(ck, shared.provider, bin, cmd);
			expect(lines[0]?.runs[0]?.glyphs.length).toBeGreaterThan(0);
			expect(built.length).toBeGreaterThan(0);
			expect(built.every((p) => p.deleted)).toBe(true);
		} finally {
			ck.ParagraphBuilder.MakeFromFontCollection = made;
			bin.free();
			shared.release();
		}
	});
});

describe("drawableBounds", () => {
	test("text is bounded while a variable font is in the fallback chain", () => {
		const shared = createSharedFontProvider(ck, fonts);
		(shared.provider as { __families?: string[] }).__families = ["Geist", "Vend"];
		const bin = makeBin();
		try {
			const commands = renderer.compile(
				createFrame({ ...box(0, 0, W, H), children: [text("Hi", 20, 10, 10)] }),
				{ width: W, height: H },
			);
			const layer = flatten(commands).find((c) => c.op === "drawText") as DrawCommand;
			const b = drawableBounds(ck, shared.provider, bin, layer, 1);
			expect(b).not.toBeNull();
			expect((b as number[])[2]).toBeLessThan(W);
		} finally {
			bin.free();
			shared.release();
		}
	});

	for (const scale of [1, 2.5]) {
		for (const [name, scene] of Object.entries(scenes)) {
			test(`${name} at ${scale}x`, async () => {
				const commands = renderer.compile(
					createFrame({ ...box(0, 0, W, H), children: scene.nodes }),
					{ width: W, height: H },
				);
				const setup = commands.filter(
					(c) => c.op === "loadFonts" || c.op === "loadImages",
				);
				const layers = flatten(commands);
				const shared = createSharedFontProvider(
					ck,
					scene.variable
						? new Map([["Vend", fonts.get("Vend") as Uint8Array[]]])
						: geist,
				);
				(shared.provider as { __families?: string[] }).__families =
					scene.variable ? ["Vend"] : ["Geist"];
				const bin = makeBin();
				try {
					let bounded = 0;
					for (const layer of layers) {
						const b = drawableBounds(ck, shared.provider, bin, layer, scale);
						if (!b) continue;
						bounded++;
						const full = await pixels([layer], setup, scale);
						const x = Math.max(Math.floor(b[0]), 0);
						const y = Math.max(Math.floor(b[1]), 0);
						const area = {
							x,
							y,
							width: Math.min(Math.ceil(b[2]), full.width) - x,
							height: Math.min(Math.ceil(b[3]), full.height) - y,
						};
						if (!(area.width > 0 && area.height > 0)) {
							expect(full.data.some((v, i) => i % 4 === 3 && v !== 0)).toBe(false);
							continue;
						}
						const part = await pixels([layer], setup, scale, area);
						expect([part.width, part.height]).toEqual([area.width, area.height]);
						let outside = 0;
						let worst = 0;
						for (let py = 0; py < full.height; py++) {
							for (let px = 0; px < full.width; px++) {
								const i = (py * full.width + px) * 4;
								const inside =
									px >= area.x &&
									px < area.x + area.width &&
									py >= area.y &&
									py < area.y + area.height;
								if (!inside) {
									if (full.data[i + 3] !== 0) outside++;
									continue;
								}
								const j = ((py - area.y) * area.width + (px - area.x)) * 4;
								for (let c = 0; c < 4; c++)
									worst = Math.max(
										worst,
										Math.abs((full.data[i + c] ?? 0) - (part.data[j + c] ?? 0)),
									);
							}
						}
						expect(outside).toBe(0);
						expect(worst).toBeLessThanOrEqual(scene.tolerance ?? 0);
					}
					expect(bounded).toBe(layers.length);
				} finally {
					bin.free();
					shared.release();
				}
			}, 30000);
		}
	}
});
