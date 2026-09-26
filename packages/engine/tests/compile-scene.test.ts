// Phase 1 of the Node IR: compileScene lowers a Node tree to the flat Command IR
// the painter already walks. Two checks:
//   1. STRUCTURAL — a hand-built geometric tree deep-equals the exact Command[]
//      we expect (asset collection + per-kind lowering), no pixels involved.
//   2. SMOKE — that Command[] actually paints: headless CanvasKit → PNG bytes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import CanvasKitInit from "canvaskit-wasm";
import { describe, expect, test } from "vitest";
import { createHeadlessEnv } from "../src/headless";
import type { MeasureText } from "../src/index";
import {
	approxEngine,
	autoLayout,
	compileScene,
	createBitmap,
	createEllipse,
	createFrame,
	createGroup,
	createImage,
	createPath,
	createRect,
	createText,
} from "../src/index";
import type { BakedTextLayout, Command } from "../src/types";

const CK_BIN = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	"node_modules",
	"canvaskit-wasm",
	"bin",
);
const FONT = fileURLToPath(
	new URL("./fonts/Geist-Regular.ttf", import.meta.url),
);

describe("compileScene structural lowering", () => {
	test("a geometric tree lowers to the exact Command[]", () => {
		const scene = createFrame({
			pos: { x: 0, y: 0 },
			size: { width: 100, height: 60 },
			clip: true,
			cornerRadius: 8,
			background: createRect({
				pos: { x: 0, y: 0 },
				size: { width: 100, height: 60 },
				fills: [{ kind: "solid", color: "#ffffff" }],
			}),
			children: [
				createEllipse({
					pos: { x: 10, y: 10 },
					size: { width: 40, height: 40 },
					fills: [{ kind: "solid", color: "#ff0000" }],
				}),
				createPath({
					pos: { x: 50, y: 10 },
					size: { width: 40, height: 40 },
					d: "M 0 0 L 40 40 Z",
					stroke: { color: "#000000", width: 2 },
				}),
			],
		});

		const commands = compileScene(scene, { width: 100, height: 60 });

		const expected: Command[] = [
			{ op: "createCanvas", width: 100, height: 60 },
			{
				pos: { x: 0, y: 0 },
				size: { width: 100, height: 60 },
				rotation: undefined,
				opacity: undefined,
				blendMode: undefined,
				shadow: undefined,
				blur: undefined,
				op: "drawGroup",
				clip: { kind: "rounded-rect", radius: 8 },
				children: [
					{
						pos: { x: 0, y: 0 },
						size: { width: 100, height: 60 },
						rotation: undefined,
						opacity: undefined,
						blendMode: undefined,
						shadow: undefined,
						blur: undefined,
						op: "drawRect",
						fills: [{ kind: "solid", color: "#ffffff" }],
						stroke: undefined,
						cornerRadius: undefined,
						cornerSmoothing: undefined,
					},
					{
						pos: { x: 10, y: 10 },
						size: { width: 40, height: 40 },
						rotation: undefined,
						opacity: undefined,
						blendMode: undefined,
						shadow: undefined,
						blur: undefined,
						op: "drawPath",
						d: "M 0 20 A 20 20 0 1 0 40 20 A 20 20 0 1 0 0 20 Z",
						fills: [{ kind: "solid", color: "#ff0000" }],
						stroke: undefined,
					},
					{
						pos: { x: 50, y: 10 },
						size: { width: 40, height: 40 },
						rotation: undefined,
						opacity: undefined,
						blendMode: undefined,
						shadow: undefined,
						blur: undefined,
						op: "drawPath",
						d: "M 0 0 L 40 40 Z",
						fills: undefined,
						stroke: { color: "#000000", width: 2 },
					},
				],
			},
		];

		expect(commands).toEqual(expected);
	});

	test("asset collection emits loadImages + loadFonts before the draw", () => {
		const layout: BakedTextLayout = {
			font: {
				family: "Geist",
				weight: 400,
				style: "normal",
				size: 16,
				lineHeight: 20,
			},
			lines: [],
			totalHeight: 0,
			shrinkApplied: false,
		};
		const scene = createFrame({
			pos: { x: 0, y: 0 },
			size: { width: 200, height: 100 },
			children: [
				createImage({
					pos: { x: 0, y: 0 },
					size: { width: 50, height: 50 },
					src: "https://example.com/a.png",
					fit: "cover",
				}),
				createText({
					pos: { x: 60, y: 0 },
					size: { width: 100, height: 20 },
					font: layout.font,
					layout,
				}),
			],
		});

		const commands = compileScene(scene, { width: 200, height: 100 });

		expect(commands[0]).toEqual({
			op: "createCanvas",
			width: 200,
			height: 100,
		});
		// setup ops (loadFonts / loadImages) precede the single drawGroup
		const setup = commands.slice(1, -1);
		expect(setup).toContainEqual({
			op: "loadFonts",
			requests: [{ family: "Geist" }],
		});
		expect(setup).toContainEqual({
			op: "loadImages",
			srcs: ["https://example.com/a.png"],
		});
		expect(commands[commands.length - 1]).toMatchObject({ op: "drawGroup" });
	});

	// `fonts` and `images` override independently: a caller that declares extra
	// font families (e.g. fallback faces the tree never names) must still get its
	// image srcs collected from the walk, or every drawImage misses the painter's
	// image map and paints the placeholder glyph instead.
	test("overriding only `fonts` still collects images from the walk", () => {
		const scene = createGroup(
			[
				createImage({
					pos: { x: 0, y: 0 },
					size: { width: 50, height: 50 },
					src: "https://example.com/a.png",
					fit: "cover",
				}),
			],
			{ pos: { x: 0, y: 0 }, size: { width: 200, height: 100 } },
		);

		const commands = compileScene(scene, {
			width: 200,
			height: 100,
			fonts: [{ family: "Noto Color Emoji" }],
		});

		expect(commands).toContainEqual({
			op: "loadFonts",
			requests: [{ family: "Noto Color Emoji" }],
		});
		expect(commands).toContainEqual({
			op: "loadImages",
			srcs: ["https://example.com/a.png"],
		});
	});

	test("overriding only `images` still collects font families from the walk", () => {
		const layout: BakedTextLayout = {
			font: {
				family: "Geist",
				weight: 400,
				style: "normal",
				size: 16,
				lineHeight: 20,
			},
			lines: [],
			totalHeight: 0,
			shrinkApplied: false,
		};
		const scene = createGroup(
			[
				createText({
					pos: { x: 0, y: 0 },
					size: { width: 100, height: 20 },
					font: layout.font,
					layout,
				}),
			],
			{ pos: { x: 0, y: 0 }, size: { width: 200, height: 100 } },
		);

		const commands = compileScene(scene, {
			width: 200,
			height: 100,
			images: ["https://example.com/override.png"],
		});

		expect(commands).toContainEqual({
			op: "loadFonts",
			requests: [{ family: "Geist" }],
		});
		expect(commands).toContainEqual({
			op: "loadImages",
			srcs: ["https://example.com/override.png"],
		});
	});

	test("fit:clip emits an outset rect clip on the drawText command", () => {
		const scene = createText({
			pos: { x: 0, y: 0 },
			size: { width: 100, height: 20 },
			text: "hi",
			fit: "clip",
			font: {
				family: "Stub",
				weight: 400,
				style: "normal",
				size: 16,
				lineHeight: 1.2,
			},
		});
		const commands = compileScene(scene, {
			width: 100,
			height: 20,
			textEngine: approxEngine,
		});
		const draw = commands[commands.length - 1];
		if (draw.op !== "drawText") throw new Error("expected drawText");
		expect(draw.clip?.kind).toBe("rect");
		if (draw.clip?.kind !== "rect") throw new Error("expected rect clip");
		expect(draw.clip.outset).toBeDefined();
		expect(draw.clip.outset?.top).toBeGreaterThanOrEqual(0);
		expect(draw.clip.outset?.bottom).toBeGreaterThanOrEqual(0);
	});

	test("unbaked text with no textEngine throws", () => {
		const scene = createText({
			pos: { x: 0, y: 0 },
			size: { width: 100, height: 20 },
			text: "hi",
			font: {
				family: "Geist",
				weight: 400,
				style: "normal",
				size: 16,
				lineHeight: 20,
			},
		});
		expect(() => compileScene(scene, { width: 100, height: 20 })).toThrow(
			/textEngine/,
		);
	});

	test("with a textEngine, unbaked text is baked at compile", () => {
		const scene = createText({
			pos: { x: 10, y: 5 },
			size: { width: 200, height: 24 },
			text: "hello",
			color: "#222",
			align: "left",
			font: {
				family: "Stub",
				weight: 400,
				style: "normal",
				size: 16,
				lineHeight: 1.25,
			},
		});
		const commands = compileScene(scene, {
			width: 200,
			height: 24,
			textEngine: approxEngine,
		});
		const draw = commands[commands.length - 1];
		if (draw.op !== "drawText") throw new Error("expected drawText");
		expect(draw.color).toBe("#222");
		expect(draw.layout.lines.length).toBeGreaterThanOrEqual(1);
		expect(draw.layout.lines[0].spans[0].text).toBe("hello");
		// baseline sits below the line top
		expect(draw.layout.lines[0].baseline).toBeGreaterThan(
			draw.layout.lines[0].y,
		);
	});

	test("with a measure, compileScene resolves layout before lowering", () => {
		const measure: MeasureText = () => ({ width: 0, height: 0 });
		const scene = autoLayout(
			createGroup(
				[
					createRect({ size: { width: 20, height: 20 } }),
					createRect({ size: { width: 30, height: 20 } }),
				],
				{ pos: { x: 0, y: 0 }, size: { width: 200, height: 40 } },
			),
			{ direction: "row", gap: 10, padding: 5 },
		);

		const commands = compileScene(scene, { width: 200, height: 40, measure });
		const group = commands[commands.length - 1];
		if (group.op !== "drawGroup") throw new Error("expected drawGroup");
		// Children were placed absolutely by the flex pass: 5, then 5+20+10=35.
		expect(group.children[0].pos).toEqual({ x: 5, y: 5 });
		expect(group.children[1].pos).toEqual({ x: 35, y: 5 });
	});

	test("bitmap lowers to a drawBitmap command", () => {
		const pixels = new Uint8Array(2 * 2 * 4).fill(255);
		const scene = createBitmap({
			pos: { x: 1, y: 2 },
			size: { width: 20, height: 20 },
			pixels,
			pixelWidth: 2,
			pixelHeight: 2,
		});
		const commands = compileScene(scene, { width: 20, height: 20 });
		const draw = commands[commands.length - 1];
		if (draw.op !== "drawBitmap") throw new Error("expected drawBitmap");
		expect(draw.pixelWidth).toBe(2);
		expect(draw.pixelHeight).toBe(2);
		expect(draw.pixels).toBe(pixels);
		expect(draw.pos).toEqual({ x: 1, y: 2 });
	});
});

describe("compileScene render smoke", () => {
	test("a compiled geometric scene paints to PNG bytes", async () => {
		const bytes = new Uint8Array(readFileSync(FONT));
		const ck = await (CanvasKitInit as (o: unknown) => Promise<unknown>)({
			locateFile: (f: string) => join(CK_BIN, f),
		});

		const scene = createFrame({
			pos: { x: 0, y: 0 },
			size: { width: 80, height: 48 },
			clip: true,
			cornerRadius: 6,
			background: createRect({
				pos: { x: 0, y: 0 },
				size: { width: 80, height: 48 },
				fills: [{ kind: "solid", color: "#101828" }],
			}),
			children: [
				createEllipse({
					pos: { x: 8, y: 8 },
					size: { width: 32, height: 32 },
					fills: [{ kind: "solid", color: "#f97316" }],
				}),
			],
		});
		const commands = compileScene(scene, { width: 80, height: 48 });

		const env = createHeadlessEnv({ fonts: new Map([["Geist", [bytes]]]) });
		const result = await env.paint(commands, ck as any);

		const png = (result as { bytes: Uint8Array }).bytes;
		// PNG magic bytes: \x89 P N G
		expect([png[0], png[1], png[2], png[3]]).toEqual([137, 80, 78, 71]);
	});

	test("a bitmap node paints through CanvasKit (drawBitmap path)", async () => {
		const ck = await (CanvasKitInit as (o: unknown) => Promise<unknown>)({
			locateFile: (f: string) => join(CK_BIN, f),
		});
		// 2×2 checker: opaque red / transparent.
		const px = new Uint8Array([
			255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 255,
		]);
		const scene = createBitmap({
			pos: { x: 0, y: 0 },
			size: { width: 40, height: 40 },
			pixels: px,
			pixelWidth: 2,
			pixelHeight: 2,
		});
		const commands = compileScene(scene, { width: 40, height: 40 });
		const env = createHeadlessEnv();
		const result = await env.paint(commands, ck as any);
		const png = (result as { bytes: Uint8Array }).bytes;
		expect([png[0], png[1], png[2], png[3]]).toEqual([137, 80, 78, 71]);
	});
});
