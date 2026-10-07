import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { bakeText, resolveDirection } from "../src/bake-text";
import { createText, type TextNode } from "../src/node";
import { createParagraphEngine } from "../src/paragraph-layout";
import { makeRuntime, paintCanvasKit } from "../src/runtime";
import { compileScene } from "../src/compile-scene";
import type { ResolvedFont } from "../src/types";

const base: ResolvedFont = {
	family: "Hebrew",
	weight: 400,
	style: "normal",
	size: 20,
	lineHeight: 1.2,
};
const SHALOM = "שלום עולם";

// biome-ignore lint/suspicious/noExplicitAny: CanvasKit instance
let ck: any;
let engine: ReturnType<typeof createParagraphEngine>;
let fonts: Map<string, Uint8Array[]>;

beforeAll(async () => {
	ck = await loadCanvasKit();
	fonts = new Map([
		["Hebrew", [testFontBytes("NotoSansHebrew-Regular.ttf")]],
		["Geist", [testFontBytes("Geist-Regular.ttf")]],
	]);
	engine = createParagraphEngine(ck, fonts);
});
afterAll(() => engine?.dispose());

const node = (p: Partial<TextNode>) =>
	createText({
		pos: { x: 10, y: 0 },
		size: { width: 300, height: 200 },
		font: base,
		color: "#000000",
		...p,
	});

const right = (s: { x: number; width: number }) => s.x + s.width;

describe("text direction", () => {
	test("auto takes the first strong character", () => {
		expect(resolveDirection(SHALOM)).toBe("rtl");
		expect(resolveDirection("مرحبا hello")).toBe("rtl");
		expect(resolveDirection("123 hello שלום")).toBe("ltr");
		expect(resolveDirection("12 - שלום")).toBe("rtl");
		expect(resolveDirection("123")).toBe("ltr");
	});

	test("start and end follow the direction", () => {
		const bake = (p: Partial<TextNode>) =>
			bakeText(node({ text: SHALOM, ...p }), { textEngine: engine }).lines[0];
		const rtlStart = bake({ direction: "rtl", align: "start" });
		expect(rtlStart.direction).toBe("rtl");
		expect(right(rtlStart.spans[0])).toBeCloseTo(310, 5);
		expect(bake({ direction: "rtl", align: "end" }).spans[0].x).toBe(10);
		expect(bake({ direction: "ltr", align: "start" }).spans[0].x).toBe(10);
		expect(
			bake({ direction: "ltr", align: "start" }).direction,
		).toBeUndefined();
		expect(
			right(bake({ direction: "auto", align: "start" }).spans[0]),
		).toBeCloseTo(310, 5);
		// left and right stay physical under either direction.
		expect(bake({ direction: "rtl", align: "left" }).spans[0].x).toBe(10);
	});

	test("orders styled runs right to left", () => {
		const line = bakeText(
			node({
				direction: "rtl",
				align: "start",
				spans: [{ text: "שלום " }, { text: "עולם", font: { weight: 700 } }],
			}),
			{ textEngine: engine },
		).lines[0];
		const [first, second] = line.spans;
		expect(first.x).toBeGreaterThan(second.x);
		expect(right(first)).toBeCloseTo(310, 0);
	});

	test("wraps in reading order and justifies to both edges", () => {
		const layout = bakeText(
			node({
				size: { width: 120, height: 200 },
				direction: "rtl",
				align: "justify",
				text: "שלום עולם שלום עולם שלום עולם",
			}),
			{ textEngine: engine },
		);
		expect(layout.lines.length).toBeGreaterThan(1);
		expect(layout.lines[0].text.startsWith("שלום")).toBe(true);
		expect(layout.lines[0].spans[0].width).toBe(120);
		const last = layout.lines.at(-1)!.spans[0];
		expect(right(last)).toBeCloseTo(130, 5);
	});

	test("the painter orders the line's runs by its direction", async () => {
		const painter = paintCanvasKit(ck);
		const rt = makeRuntime(
			{
				resolveFont: (req) => {
					const family = typeof req === "string" ? req : req.family;
					const bytes = fonts.get(family);
					return bytes ? { kind: "bytes", bytes } : { kind: "none" };
				},
				loadBytes: async () => new Uint8Array(),
			},
			"encode",
			undefined,
			painter,
		);
		// The widest unbroken ink run along the H's crossbar row, from the first
		// inked column: H's crossbar in "Hl!", the bare "!" stem in "!Hl".
		const firstRun = async (direction: TextNode["direction"]) => {
			const scene = createText({
				pos: { x: 0, y: 0 },
				size: { width: 200, height: 40 },
				font: { ...base, family: "Geist", size: 32 },
				color: "#000000",
				text: "Hl!",
				direction,
				align: "left",
			});
			const commands = compileScene(scene, {
				width: 200,
				height: 40,
				textEngine: engine,
			});
			const out = await painter(commands, rt);
			const px = out.readPixels?.();
			out.dispose();
			if (!px) throw new Error("no pixels");
			const inked = (x: number, y: number) =>
				px.data[(y * px.width + x) * 4 + 3] > 128;
			let best = 0;
			for (let y = 0; y < px.height; y++) {
				let x = 0;
				while (x < px.width && !inked(x, y)) x++;
				let run = 0;
				while (x + run < px.width && inked(x + run, y)) run++;
				best = Math.max(best, run);
			}
			return best;
		};
		expect(await firstRun("ltr")).toBeGreaterThan(12);
		expect(await firstRun("rtl")).toBeLessThan(6);
	});
});
