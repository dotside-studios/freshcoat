// A runtime that owns its decoded images lends them to paint through
// loadImage: paint draws them and leaves freeing them to the runtime.
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { describe, expect, test } from "vitest";
import { createHeadlessEnv } from "../src/headless";
import { compileScene, createImage } from "../src/index";

// biome-ignore lint/suspicious/noExplicitAny: CanvasKit is untyped here
let ck: any;
async function initCk() {
	if (!ck)
		ck = await loadCanvasKit();
	return ck;
}

function solidImage(k: typeof ck, rgba: [number, number, number, number]) {
	const pixels = new Uint8Array(4 * 4 * 4);
	for (let i = 0; i < pixels.length; i += 4) pixels.set(rgba, i);
	return k.MakeImage(
		{
			width: 4,
			height: 4,
			alphaType: k.AlphaType.Unpremul,
			colorType: k.ColorType.RGBA_8888,
			colorSpace: k.ColorSpace.SRGB,
		},
		pixels,
		16,
	);
}

async function centre(k: typeof ck, png: Uint8Array) {
	const img = k.MakeImageFromEncoded(png);
	const px = img.readPixels(10, 10, {
		width: 1,
		height: 1,
		colorType: k.ColorType.RGBA_8888,
		alphaType: k.AlphaType.Unpremul,
		colorSpace: k.ColorSpace.SRGB,
	}) as Uint8Array;
	img.delete();
	return [...px];
}

describe("PaintRuntime.loadImage", () => {
	test("paints a lent image and does not free it", async () => {
		const k = await initCk();
		const red = solidImage(k, [255, 0, 0, 255]);
		const asked: string[] = [];
		const env = createHeadlessEnv({
			loadImage: async (src) => {
				asked.push(src);
				return red;
			},
		});
		const scene = createImage({
			pos: { x: 0, y: 0 },
			size: { width: 20, height: 20 },
			src: "ws:red",
			fit: "cover",
		});
		const commands = compileScene(scene, { width: 20, height: 20 });
		for (let n = 0; n < 2; n++) {
			const result = (await env.paint(commands, k)) as {
				bytes: Uint8Array;
				warnings: unknown[];
			};
			expect(result.warnings).toEqual([]);
			expect(await centre(k, result.bytes)).toEqual([255, 0, 0, 255]);
		}
		expect(asked).toEqual(["ws:red", "ws:red"]);
		// still alive: a freed image has no width
		expect(red.width()).toBe(4);
		red.delete();
	});

	test("null from loadImage is a load failure", async () => {
		const k = await initCk();
		const env = createHeadlessEnv({ loadImage: async () => null });
		const scene = createImage({
			pos: { x: 0, y: 0 },
			size: { width: 20, height: 20 },
			src: "ws:gone",
			fit: "cover",
		});
		const result = (await env.paint(
			compileScene(scene, { width: 20, height: 20 }),
			k,
		)) as { warnings: { kind: string; src?: string }[] };
		expect(result.warnings).toEqual([
			{ kind: "image_load_failed", src: "ws:gone", error: "decode failed" },
		]);
	});
});
