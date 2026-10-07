import { dirname } from "node:path";
import {
	loadCanvasKit,
	testFontBytes,
	testFontPath,
} from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test } from "vitest";
import { decodePixels } from "../src/decode";
import { createFrame, createImage, createRect, createText } from "../src/node";
import { fileLoader } from "../src/platform/file-loader";
import { createRenderer } from "../src/renderer";
import type { FontRequest } from "../src/types";

// biome-ignore lint/suspicious/noExplicitAny: CanvasKit instance
let ck: any;
beforeAll(async () => {
	ck = await loadCanvasKit();
});

const rect = (color: string, size = 8) =>
	createRect({
		pos: { x: 0, y: 0 },
		size: { width: size, height: size },
		fills: [{ kind: "solid", color }],
	});

const image = (src: string) =>
	createFrame({
		pos: { x: 0, y: 0 },
		size: { width: 8, height: 8 },
		children: [
			createImage({
				pos: { x: 0, y: 0 },
				size: { width: 8, height: 8 },
				src,
				fit: "fill",
			}),
		],
	});

const text = (family: string) =>
	createText({
		pos: { x: 0, y: 0 },
		size: { width: 120, height: 40 },
		text: "Hello",
		font: { family, weight: 400, style: "normal", size: 20, lineHeight: 1.2 },
		color: "#000000",
	});

const firstPixel = (data: Uint8Array) => [...data.subarray(0, 4)];

describe("createRenderer", () => {
	test("renders PNG bytes by default", async () => {
		const renderer = await createRenderer({ ck });
		const frame = await renderer.render(rect("#ff0000"), { width: 8, height: 8 });
		expect(frame.format).toBe("png");
		expect(firstPixel(frame.bytes)).toEqual([0x89, 0x50, 0x4e, 0x47]);
		expect([frame.width, frame.height, frame.scale]).toEqual([8, 8, 1]);
		renderer.dispose();
	});

	test("returns pixels, and sizes the result by scale or export setting", async () => {
		const renderer = await createRenderer({ ck });
		const scaled = await renderer.render(rect("#00ff00"), {
			width: 8,
			height: 8,
			scale: 2,
			output: { pixels: true },
		});
		expect([scaled.pixels.width, scaled.width, scaled.scale]).toEqual([16, 16, 2]);
		expect(firstPixel(scaled.pixels.data)).toEqual([0, 255, 0, 255]);
		const wide = await renderer.render(rect("#00ff00"), {
			width: 8,
			height: 8,
			export: { constraint: { kind: "width", value: 32 } },
		});
		expect([wide.width, wide.height]).toEqual([32, 32]);
		renderer.dispose();
	});

	test("refuses the canvas output without a surface factory", async () => {
		const renderer = await createRenderer({ ck });
		await expect(
			renderer.render(rect("#000000"), {
				width: 8,
				height: 8,
				output: { canvas: true },
			}),
		).rejects.toThrow(/surface factory/);
		renderer.dispose();
	});

	test("decodes a per-call image again when its bytes change", async () => {
		const renderer = await createRenderer({ ck });
		const red = (await renderer.render(rect("#ff0000"), { width: 8, height: 8 })).bytes;
		const blue = (await renderer.render(rect("#0000ff"), { width: 8, height: 8 })).bytes;
		const at = async (bytes: Uint8Array) => {
			const frame = await renderer.render(image("logo.png"), {
				width: 8,
				height: 8,
				images: new Map([["logo.png", bytes]]),
				output: { pixels: true },
			});
			return firstPixel(frame.pixels.data);
		};
		expect(await at(red)).toEqual([255, 0, 0, 255]);
		expect(await at(blue)).toEqual([0, 0, 255, 255]);
		expect(await at(red)).toEqual([255, 0, 0, 255]);
		renderer.dispose();
	});

	test("runs overlapping renders one after another", async () => {
		const renderer = await createRenderer({ ck });
		const colors = ["#ff0000", "#00ff00", "#0000ff", "#ffffff"];
		const frames = await Promise.all(
			colors.map((c) =>
				renderer.render(rect(c), { width: 8, height: 8, output: { pixels: true } }),
			),
		);
		expect(frames.map((f) => firstPixel(f.pixels.data))).toEqual([
			[255, 0, 0, 255],
			[0, 255, 0, 255],
			[0, 0, 255, 255],
			[255, 255, 255, 255],
		]);
		renderer.dispose();
	});

	test("shapes text with fonts given by path through the loader", async () => {
		const renderer = await createRenderer({
			ck,
			load: fileLoader({ root: dirname(testFontPath("Geist-Regular.ttf")) }),
			fonts: { Geist: ["Geist-Regular.ttf"] },
		});
		expect([...renderer.fonts.keys()]).toEqual(["Geist"]);
		const frame = await renderer.render(text("Geist"), { width: 120, height: 40 });
		expect(frame.warnings).toEqual([]);
		const decoded = decodePixels(ck, frame.bytes);
		expect(decoded?.data.some((v, i) => i % 4 === 3 && v > 0)).toBe(true);
		renderer.dispose();
	});

	test("loads described fonts once, reloads a re-pointed family and reports failures", async () => {
		const files: Record<string, Uint8Array> = {
			"a.ttf": testFontBytes("Geist-Regular.ttf"),
			"b.ttf": testFontBytes("VendSans-Variable-latin.woff2"),
		};
		const reads: string[] = [];
		const renderer = await createRenderer({
			ck,
			load: async (src) => {
				reads.push(src);
				const bytes = files[src];
				if (!bytes) throw new Error(`no ${src}`);
				return bytes;
			},
		});
		const local = (family: string, src: string): FontRequest => ({
			family,
			descriptor: {
				kind: "local",
				family,
				files: [{ src, weight: 400, style: "normal" }],
			},
		});
		expect(await renderer.loadFonts([local("Body", "a.ttf")])).toEqual({ failed: [] });
		await renderer.loadFonts([local("Body", "a.ttf"), { family: "ByName" }]);
		expect(reads).toEqual(["a.ttf"]);
		await renderer.loadFonts([local("Body", "b.ttf")]);
		expect(renderer.fonts.get("Body")?.[0]).toBe(files["b.ttf"]);
		const report = await renderer.loadFonts([local("Missing", "c.ttf")]);
		expect(report.failed.map((f) => f.family)).toEqual(["Missing"]);
		expect(renderer.fonts.has("Missing")).toBe(false);
		renderer.dispose();
	});

	test("prepare and compile share the renderer's text engine", async () => {
		const renderer = await createRenderer({
			ck,
			fonts: { Geist: [testFontBytes("Geist-Regular.ttf")] },
		});
		const prepared = renderer.prepare(text("Geist"));
		const commands = renderer.compile(prepared, { width: 120, height: 40, prepared: true });
		expect(commands[0]).toMatchObject({ op: "createCanvas", width: 120, height: 40 });
		const frame = await renderer.paint(commands, { output: { pixels: true } });
		expect(frame.pixels.width).toBe(120);
		renderer.dispose();
	});

	test("refuses work after dispose", async () => {
		const renderer = await createRenderer({ ck });
		renderer.dispose();
		expect(() => renderer.render(rect("#000000"), { width: 8, height: 8 })).toThrow(
			/disposed/,
		);
	});
});
