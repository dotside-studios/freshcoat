import { join } from "node:path";
import { fileURLToPath } from "node:url";
import CanvasKitInit from "canvaskit-wasm";
import { describe, expect, test } from "vitest";
import { createHeadlessEnv } from "../src/headless";
import {
	compileScene,
	createImage,
	fitRect,
	type ImageNode,
	validateCommands,
} from "../src/index";

const CK_BIN = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	"node_modules",
	"canvaskit-wasm",
	"bin",
);

// biome-ignore lint/suspicious/noExplicitAny: CanvasKit is untyped here
let ck: any;
async function initCk() {
	if (!ck)
		ck = await (CanvasKitInit as (o: unknown) => Promise<unknown>)({
			locateFile: (f: string) => join(CK_BIN, f),
		});
	return ck;
}

const BANDS: [number, number, number][] = [
	[255, 0, 0],
	[0, 255, 0],
	[0, 0, 255],
	[255, 255, 255],
];

// 40×10: four 10px vertical bands, red, green, blue, white.
function bandsImage(k: typeof ck) {
	const w = 40;
	const h = 10;
	const pixels = new Uint8Array(w * h * 4);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++)
			pixels.set([...BANDS[Math.floor(x / 10)], 255], (y * w + x) * 4);
	return k.MakeImage(
		{
			width: w,
			height: h,
			alphaType: k.AlphaType.Unpremul,
			colorType: k.ColorType.RGBA_8888,
			colorSpace: k.ColorSpace.SRGB,
		},
		pixels,
		w * 4,
	);
}

async function paint(
	node: Partial<ImageNode>,
	size: { width: number; height: number },
	at: [number, number][],
) {
	const k = await initCk();
	const img = bandsImage(k);
	const env = createHeadlessEnv({ loadImage: async () => img });
	const scene = createImage({
		pos: { x: 0, y: 0 },
		size,
		src: "bands",
		fit: "cover",
		...node,
	});
	const result = (await env.paint(compileScene(scene, size), k)) as {
		bytes: Uint8Array;
	};
	const out = k.MakeImageFromEncoded(result.bytes);
	const colors = at.map(([x, y]) => [
		...(out.readPixels(x, y, {
			width: 1,
			height: 1,
			colorType: k.ColorType.RGBA_8888,
			alphaType: k.AlphaType.Unpremul,
			colorSpace: k.ColorSpace.SRGB,
		}) as Uint8Array),
	]);
	out.delete();
	img.delete();
	return colors;
}

function expectNear(actual: number[], rgb: [number, number, number]) {
	rgb.forEach((v, i) => expect(Math.abs(actual[i] - v)).toBeLessThan(12));
}

describe("fitRect focus and crop", () => {
	test("cover keeps the focal point centred, held inside the source", () => {
		const wide = (x: number) =>
			fitRect(200, 100, 0, 0, 100, 100, "cover", { focus: { x, y: 0.5 } }).sx;
		expect(wide(0.3)).toBe(10);
		expect(wide(0)).toBe(0);
		expect(wide(1)).toBe(100);
		const tall = fitRect(100, 200, 0, 0, 100, 100, "cover", {
			focus: { x: 0.5, y: 0.9 },
		});
		expect(tall.sy).toBe(100);
	});

	test("an unset focus is the centre crop", () => {
		expect(fitRect(200, 100, 0, 0, 100, 100, "cover", {})).toEqual(
			fitRect(200, 100, 0, 0, 100, 100, "cover"),
		);
	});

	test("crop narrows the source before fitting", () => {
		const crop = { x: 0.5, y: 0.25, width: 0.5, height: 0.5 };
		expect(fitRect(200, 100, 0, 0, 50, 25, "fill", { crop })).toMatchObject({
			sx: 100,
			sy: 25,
			sw: 100,
			sh: 50,
		});
		expect(fitRect(200, 100, 0, 0, 50, 50, "cover", { crop })).toMatchObject({
			sx: 125,
			sy: 25,
			sw: 50,
			sh: 50,
		});
		expect(
			fitRect(200, 100, 0, 0, 50, 50, "cover", {
				crop,
				focus: { x: 0, y: 0.5 },
			}),
		).toMatchObject({ sx: 100, sw: 50 });
		expect(
			fitRect(200, 100, 0, 0, 100, 100, "contain", { crop }),
		).toMatchObject({
			sx: 100,
			sw: 100,
			dy: 25,
			dh: 50,
		});
	});

	test("a crop outside the source is clamped, an empty one ignored", () => {
		const clamped = fitRect(200, 100, 0, 0, 10, 10, "fill", {
			crop: { x: 0.8, y: 0, width: 0.5, height: 1 },
		});
		expect(clamped.sx).toBe(160);
		expect(clamped.sw).toBeCloseTo(40);
		expect(
			fitRect(200, 100, 0, 0, 10, 10, "fill", {
				crop: { x: 0, y: 0, width: 0, height: 1 },
			}),
		).toMatchObject({ sx: 0, sw: 200 });
	});
});

describe("image focus and crop paint", () => {
	test("focus picks the band a square cover shows", async () => {
		const size = { width: 10, height: 10 };
		const centre = async (x: number) =>
			(await paint({ focus: { x, y: 0.5 } }, size, [[5, 5]]))[0];
		expectNear(await centre(0), BANDS[0]);
		expectNear(await centre(1), BANDS[3]);
		expectNear(await centre(0.375), BANDS[1]);
	});

	test("crop draws only the chosen region", async () => {
		const [left, right] = await paint(
			{ fit: "fill", crop: { x: 0.5, y: 0, width: 0.5, height: 1 } },
			{ width: 20, height: 10 },
			[
				[4, 5],
				[15, 5],
			],
		);
		expectNear(left, BANDS[2]);
		expectNear(right, BANDS[3]);
	});

	test("focus and crop survive lowering and a bad crop is reported", () => {
		const commands = compileScene(
			createImage({
				pos: { x: 0, y: 0 },
				size: { width: 10, height: 10 },
				src: "bands",
				fit: "cover",
				focus: { x: 0.2, y: 0.8 },
				crop: { x: 0.5, y: 0, width: 0.8, height: 1 },
			}),
			{ width: 10, height: 10 },
		);
		const draw = commands.find((c) => c.op === "drawImage");
		expect(draw).toMatchObject({
			focus: { x: 0.2, y: 0.8 },
			crop: { x: 0.5, y: 0, width: 0.8, height: 1 },
		});
		expect(validateCommands(commands).map((i) => i.code)).toContain(
			"bad_image_crop",
		);
	});
});
