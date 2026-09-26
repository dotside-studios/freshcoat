// JPEG encoding. Only CanvasKit's `full` build carries the JPEG encoder (the
// worker pins it for WebP), so the round trip runs on that build and the
// fallback on the default one, which answers in PNG and says so.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import CanvasKitInit from "canvaskit-wasm";
import FullCanvasKitInit from "canvaskit-wasm/bin/full/canvaskit.js";
import { beforeAll, describe, expect, test } from "vitest";
import { renderSceneToPng } from "../src/headless";
import { flattenOverWhite } from "../src/jpeg";
import { createFrame, createRect } from "../src/node";

const CK_BIN = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	"node_modules",
	"canvaskit-wasm",
	"bin",
);

// biome-ignore lint/suspicious/noExplicitAny: CanvasKit instances
let full: any;
// biome-ignore lint/suspicious/noExplicitAny: CanvasKit instances
let base: any;

beforeAll(async () => {
	full = await (FullCanvasKitInit as (o: unknown) => Promise<unknown>)({
		locateFile: (f: string) => join(CK_BIN, "full", f),
	});
	base = await (CanvasKitInit as (o: unknown) => Promise<unknown>)({
		locateFile: (f: string) => join(CK_BIN, f),
	});
});

const W = 64;
const H = 32;

// Left half an opaque red, right half nothing at all.
const scene = () =>
	createFrame({
		pos: { x: 0, y: 0 },
		size: { width: W, height: H },
		children: [
			createRect({
				pos: { x: 0, y: 0 },
				size: { width: W / 2, height: H },
				fills: [{ kind: "solid", color: "#ff0000" }],
			}),
		],
	});

// biome-ignore lint/suspicious/noExplicitAny: CanvasKit instance
function pixelAt(ck: any, bytes: Uint8Array, x: number, y: number) {
	const img = ck.MakeImageFromEncoded(bytes);
	const w = img.width();
	const buf = img.readPixels(0, 0, {
		width: w,
		height: img.height(),
		colorType: ck.ColorType.RGBA_8888,
		alphaType: ck.AlphaType.Unpremul,
		colorSpace: ck.ColorSpace.SRGB,
	}) as Uint8Array;
	const o = (y * w + x) * 4;
	const out = [buf[o], buf[o + 1], buf[o + 2], buf[o + 3]];
	img.delete();
	return out;
}

const render = (ck: unknown, quality?: number) =>
	renderSceneToPng(scene(), {
		width: W,
		height: H,
		ck,
		encode: { format: "jpeg", quality },
	});

describe("jpeg", () => {
	test("encodes a JPEG and says so", async () => {
		const out = await render(full);
		expect(out.format).toBe("jpeg");
		expect([...out.bytes.slice(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
		const img = full.MakeImageFromEncoded(out.bytes);
		expect([img.width(), img.height()]).toEqual([W, H]);
		img.delete();
	});

	test("round-trips the painted colour", async () => {
		const out = await render(full);
		const [r, g, b] = pixelAt(full, out.bytes, 8, 16);
		expect(r).toBeGreaterThan(240);
		expect(g).toBeLessThan(16);
		expect(b).toBeLessThan(16);
	});

	test("flattens transparency to white, not black", async () => {
		const out = await render(full);
		for (const [r, g, b, a] of [
			pixelAt(full, out.bytes, 56, 16),
			pixelAt(full, out.bytes, W - 1, 0),
		]) {
			expect(Math.min(r, g, b)).toBeGreaterThan(245);
			expect(a).toBe(255);
		}
	});

	test("quality trades bytes", async () => {
		const low = await render(full, 20);
		const high = await render(full, 100);
		expect(low.bytes.length).toBeLessThan(high.bytes.length);
	});

	test("a build without the encoder falls back to PNG", async () => {
		const out = await render(base);
		expect(out.format).toBe("png");
		expect([...out.bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
	});
});

describe("flattenOverWhite", () => {
	test("composites unpremultiplied pixels over white", () => {
		const px = new Uint8Array([
			255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 128, 100, 200, 50, 51,
		]);
		expect([...flattenOverWhite(px)]).toEqual([
			255, 0, 0, 255, 255, 255, 255, 255, 127, 127, 127, 255, 224, 244, 214,
			255,
		]);
	});
});
