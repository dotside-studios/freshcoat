// validateCommands: IR well-formedness, independent of any backend. The two
// halves that matter are that it flags a malformed scene with a usable path, and
// that it stays silent on the scenes compileScene actually emits.
import { readFileSync } from "node:fs";
import { loadCanvasKit, testFontPath } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test } from "vitest";
import {
	buildAdjust,
	compileScene,
	createBitmap,
	createFrame,
	createGroup,
	createParagraphEngine,
	createRect,
	createText,
	validateCommands,
} from "../src/index";
import type { Command, DrawRectCommand } from "../src/types";

const FONT = testFontPath("Geist-Regular.ttf");
const FAMILY = "ValidateFont";

let ck: any;
let fonts: Map<string, Uint8Array[]>;

beforeAll(async () => {
	fonts = new Map([[FAMILY, [new Uint8Array(readFileSync(FONT))]]]);
	ck = await loadCanvasKit();
});

const box = (x: number, y: number, w: number, h: number) => ({
	pos: { x, y },
	size: { width: w, height: h },
});
const codes = (commands: Command[]) =>
	validateCommands(commands).map((i) => i.code);

const canvas = (): Command => ({ op: "createCanvas", width: 100, height: 100 });
const rect = (extra: Partial<DrawRectCommand> = {}): Command =>
	({
		op: "drawRect",
		pos: { x: 0, y: 0 },
		size: { width: 10, height: 10 },
		...extra,
	}) as Command;

describe("setup", () => {
	test("requires exactly one createCanvas, first", () => {
		expect(codes([rect()])).toContain("missing_create_canvas");
		expect(codes([canvas(), canvas()])).toContain("duplicate_create_canvas");
		expect(codes([rect(), canvas()])).toContain("create_canvas_not_first");
	});

	test("rejects a non-positive canvas and a sub-1 supersample", () => {
		expect(codes([{ op: "createCanvas", width: 0, height: 100 }])).toContain(
			"bad_canvas_size",
		);
		expect(
			codes([{ op: "createCanvas", width: 10, height: 10, supersample: 0.5 }]),
		).toContain("bad_supersample");
	});
});

describe("the checks a backend would otherwise diverge on", () => {
	// Skia reads past a short buffer; an SVG emitter cannot. A check only one
	// performs is a divergence nobody can attribute.
	test("bitmap buffer length must match its dimensions", () => {
		const short = createBitmap({
			...box(0, 0, 10, 10),
			pixels: new Uint8Array(4 * 4 * 4 - 1),
			pixelWidth: 4,
			pixelHeight: 4,
		});
		const issues = validateCommands([
			canvas(),
			{
				op: "drawBitmap",
				...box(0, 0, 10, 10),
				pixels: short.pixels,
				pixelWidth: 4,
				pixelHeight: 4,
			},
		]);
		expect(issues.map((i) => i.code)).toContain("bitmap_buffer_mismatch");
		expect(issues[0].message).toContain("63");
	});

	test("colorMatrix must be 4x5 and LUTs 256 entries", () => {
		expect(
			codes([canvas(), rect({ adjust: { colorMatrix: [1, 0, 0] } })]),
		).toContain("bad_color_matrix");
		expect(
			codes([
				canvas(),
				rect({
					adjust: {
						lut: {
							r: new Uint8Array(256),
							g: new Uint8Array(128),
							b: new Uint8Array(256),
						},
					},
				}),
			]),
		).toContain("bad_lut");
	});

	test("a finish curve needs 256 entries per channel", () => {
		const finish = {
			op: "finishFrame" as const,
			finish: {
				curve: {
					r: new Uint8Array(256),
					g: new Uint8Array(256),
					b: new Uint8Array(10),
				},
			},
		};
		expect(codes([canvas(), finish])).toContain("bad_lut");
	});

	test("lut3d data must be size^3 RGB triplets", () => {
		expect(
			codes([
				canvas(),
				rect({ adjust: { lut3d: { size: 4, data: new Uint8Array(10) } } }),
			]),
		).toContain("bad_lut3d");
	});

	// An unsorted stop list is a different gradient in each backend rather than
	// an error in any of them.
	test("gradient stops must be sorted and within 0..1", () => {
		const unsorted = codes([
			canvas(),
			rect({
				fills: [
					{
						kind: "linear",
						from: { x: 0, y: 0 },
						to: { x: 1, y: 0 },
						stops: [
							{ offset: 0, color: "#000" },
							{ offset: 0.8, color: "#888" },
							{ offset: 0.3, color: "#fff" },
						],
					},
				],
			}),
		]);
		expect(unsorted).toContain("unsorted_stops");
		expect(
			codes([
				canvas(),
				rect({
					fills: [
						{
							kind: "linear",
							from: { x: 0, y: 0 },
							to: { x: 1, y: 0 },
							stops: [{ offset: 1.5, color: "#000" }],
						},
					],
				}),
			]),
		).toContain("bad_stop_offset");
	});

	test("flags an unknown clip kind and a degenerate polygon", () => {
		expect(
			codes([canvas(), rect({ clip: { kind: "hexagon" } as never })]),
		).toContain("unknown_clip_kind");
		expect(
			codes([canvas(), rect({ clip: { kind: "polygon", sides: 2 } })]),
		).toContain("bad_polygon");
	});

	test("flags negative clip smoothing", () => {
		const clip = { kind: "rounded-rect" as const, radius: 4 };
		expect(
			codes([canvas(), rect({ clip: { ...clip, smoothing: -1 } })]),
		).toContain("bad_corner_smoothing");
		expect(
			codes([canvas(), rect({ clip: { ...clip, smoothing: 0.6 } })]),
		).not.toContain("bad_corner_smoothing");
	});

	test("flags a zero viewBox, which would divide by zero on scale", () => {
		expect(
			codes([
				canvas(),
				{
					op: "drawPath",
					...box(0, 0, 10, 10),
					d: "M0 0 L1 1",
					viewBox: { width: 0, height: 10 },
				},
			]),
		).toContain("bad_viewbox");
	});
});

describe("paths point at the offending field", () => {
	test("names the nested child and carries its id", () => {
		const issues = validateCommands([
			canvas(),
			{
				op: "drawGroup",
				...box(0, 0, 50, 50),
				children: [
					rect({ id: "inner", opacity: 4 } as Partial<DrawRectCommand>),
				],
			} as Command,
		]);
		expect(issues).toHaveLength(1);
		expect(issues[0].path).toBe("commands[1].children[0].opacity");
		expect(issues[0].id).toBe("inner");
	});
});

// The half that keeps it honest: a real compile must produce no issues, or the
// checker is wrong rather than the scenes.
describe("no false positives on real compiles", () => {
	test("a scene using most of the IR validates clean", () => {
		const textEngine = createParagraphEngine(ck, fonts);
		try {
			const pixels = new Uint8Array(4 * 4 * 4);
			const scene = createFrame({
				...box(0, 0, 300, 200),
				background: createRect({
					...box(0, 0, 300, 200),
					fills: [{ kind: "solid", color: "#fff" }],
				}),
				clip: true,
				cornerRadius: 12,
				children: [
					createRect({
						...box(10, 10, 120, 80),
						fills: [
							{
								kind: "linear",
								from: { x: 0, y: 0 },
								to: { x: 1, y: 1 },
								stops: [
									{ offset: 0, color: "#000" },
									{ offset: 1, color: "#fff" },
								],
							},
						],
						stroke: { color: "#333", width: 2, dash: [4, 2], cap: "round" },
						cornerRadius: [4, 8, 4, 8],
						shadow: { color: "#0008", dx: 2, dy: 2, blur: 6, spread: 1 },
						adjust: buildAdjust({ saturation: 1.2, gamma: 0.9 }),
					}),
					createBitmap({
						...box(150, 10, 60, 60),
						pixels,
						pixelWidth: 4,
						pixelHeight: 4,
					}),
					createGroup(
						[
							createText({
								...box(0, 0, 280, 60),
								text: "Validates clean",
								font: {
									family: FAMILY,
									weight: 400,
									style: "normal",
									size: 16,
									lineHeight: 20,
								},
								color: "#111",
							}),
						],
						{ ...box(10, 110, 280, 60), opacity: 0.9, blendMode: "multiply" },
					),
				],
			});
			const commands = compileScene(scene, {
				width: 300,
				height: 200,
				textEngine,
				finish: {
					whiteClamp: 248,
					blackExtract: 30,
					dither: { amount: 2, seed: 0, mode: "monochrome" },
				},
				scale: 2,
			});
			expect(validateCommands(commands)).toEqual([]);
		} finally {
			textEngine.dispose();
		}
	});
});
