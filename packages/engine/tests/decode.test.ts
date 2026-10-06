// decodePixels: encoded image bytes → raw RGBA via CanvasKit.
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { describe, expect, test } from "vitest";
import { decodePixels, sampleImageNode } from "../src/decode";
import { createImage } from "../src/node";

function encodeSolidPng(
	ck: any,
	w: number,
	h: number,
	rgba: [number, number, number, number],
): Uint8Array {
	const surface = ck.MakeSurface(w, h);
	const canvas = surface.getCanvas();
	canvas.clear(ck.Color(...rgba));
	const img = surface.makeImageSnapshot();
	const bytes = img.encodeToBytes() as Uint8Array;
	img.delete();
	surface.delete();
	return bytes;
}

describe("decodePixels", () => {
	test("decodes to unpremultiplied RGBA of the right shape and color", async () => {
		const ck = await loadCanvasKit();
		const png = encodeSolidPng(ck, 6, 4, [200, 50, 50, 255]);
		const decoded = decodePixels(ck, png);
		expect(decoded).not.toBeNull();
		const { data, width, height } = decoded!;
		expect(width).toBe(6);
		expect(height).toBe(4);
		expect(data.length).toBe(6 * 4 * 4);
		expect([data[0], data[1], data[2], data[3]]).toEqual([200, 50, 50, 255]);
		// Buffer is owned (a copy), not a live view.
		expect(data).toBeInstanceOf(Uint8Array);
	});

	test("maxDim downscales the longest side, preserving color", async () => {
		const ck = await loadCanvasKit();
		const png = encodeSolidPng(ck, 400, 200, [30, 160, 210, 255]);
		const decoded = decodePixels(ck, png, { maxDim: 100 });
		expect(decoded).not.toBeNull();
		const { width, height, data } = decoded!;
		expect(Math.max(width, height)).toBe(100); // 400 → 100
		expect(width).toBe(100);
		expect(height).toBe(50); // aspect preserved
		// A solid fill survives the cubic downscale (center pixel ≈ source color).
		const o = (25 * width + 50) * 4;
		expect(data[o]).toBeGreaterThan(20);
		expect(data[o]).toBeLessThan(40);
		expect(data[o + 2]).toBeGreaterThan(200);
	});

	test("maxDim larger than the image is a no-op", async () => {
		const ck = await loadCanvasKit();
		const png = encodeSolidPng(ck, 6, 4, [10, 20, 30, 255]);
		const decoded = decodePixels(ck, png, { maxDim: 100 });
		expect(decoded!.width).toBe(6);
		expect(decoded!.height).toBe(4);
	});

	test("returns null for undecodable bytes", async () => {
		const ck = await loadCanvasKit();
		expect(decodePixels(ck, new Uint8Array([1, 2, 3, 4]))).toBeNull();
	});

	test("samples an image node at its rendered box rather than source dimensions", async () => {
		const ck = await loadCanvasKit();
		const png = encodeSolidPng(ck, 400, 200, [30, 160, 210, 255]);
		const node = createImage({
			pos: { x: 0, y: 0 },
			size: { width: 80, height: 40 },
			src: "photo.png",
			fit: "cover",
		});
		const sampled = await sampleImageNode(
			ck,
			node,
			async (src) => {
				expect(src).toBe("photo.png");
				return png;
			},
			{ maxDim: 20 },
		);
		expect(sampled).not.toBeNull();
		expect(sampled).toMatchObject({ width: 20, height: 10 });
		expect([sampled!.data[0], sampled!.data[1], sampled!.data[2]]).toEqual([
			30, 160, 210,
		]);
	});
});
