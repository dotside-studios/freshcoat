// encodePng: a valid PNG of exactly the pixels handed in, smaller than what the
// backend's own encoder produces. Round-tripped through CanvasKit's decoder —
// which is both the correctness check and the proof that the filter and CRC
// arithmetic is right, since a wrong byte anywhere fails to decode or decodes
// to different pixels.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import CanvasKitInit from "canvaskit-wasm";
import { describe, expect, test } from "vitest";
import { decodePixels } from "../src/decode";
import { renderSceneToPng } from "../src/headless";
import { createFrame, createRect, createText } from "../src/node";
import { encodePng } from "../src/png";
import type { EncodedPaintResult } from "../src/types";

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

async function ckInit(): Promise<any> {
	return (await (CanvasKitInit as (o: unknown) => Promise<unknown>)({
		locateFile: (f: string) => join(CK_BIN, f),
	})) as unknown;
}

// A gradient (where filtering hurts) with flat colour and text over it (where it
// can help) — one frame that exercises both candidate paths.
const scene = (alpha: string) =>
	createFrame({
		pos: { x: 0, y: 0 },
		size: { width: 240, height: 160 },
		background: createRect({
			pos: { x: 0, y: 0 },
			size: { width: 240, height: 160 },
			fills: [
				{
					kind: "linear",
					stops: [
						{ offset: 0, color: "#bffced" },
						{ offset: 1, color: `#44955b${alpha}` },
					],
					from: { x: 0, y: 0 },
					to: { x: 1, y: 1 },
				},
			],
		}),
		children: [
			createRect({
				pos: { x: 20, y: 20 },
				size: { width: 200, height: 40 },
				fills: [{ kind: "solid", color: "#1d4ed8" }],
			}),
			createText({
				pos: { x: 20, y: 80 },
				size: { width: 200, height: 60 },
				text: "The quick brown fox jumps over the lazy dog",
				font: {
					family: "Geist",
					weight: 400,
					style: "normal",
					size: 13,
					lineHeight: 1.4,
				},
				color: "#101828",
			}),
		],
	});

// The backend's own PNG writer, on the same pixels — the baseline this encoder
// exists to beat. (The headless env now encodes through ./png, so a rendered
// PNG is no longer a Skia one.)
const skiaEncode = (ck: any, px: Uint8Array, width: number, height: number) => {
	const img = ck.MakeImage(
		{
			width,
			height,
			colorType: ck.ColorType.RGBA_8888,
			alphaType: ck.AlphaType.Unpremul,
			colorSpace: ck.ColorSpace.SRGB,
		},
		px,
		width * 4,
	);
	try {
		return img.encodeToBytes() as Uint8Array;
	} finally {
		img.delete();
	}
};

const render = async (ck: any, alpha = "") =>
	(await renderSceneToPng(scene(alpha), {
		width: 240,
		height: 160,
		ck,
		fonts: new Map([["Geist", [new Uint8Array(readFileSync(FONT))]]]),
	})) as EncodedPaintResult;

describe("encodePng", () => {
	test("round-trips the exact pixels, and beats the backend's encoder", async () => {
		const ck = await ckInit();
		const source = decodePixels(ck, (await render(ck)).bytes);
		if (!source) throw new Error("decode failed");

		const px = new Uint8Array(source.data);
		const mine = await encodePng(px, source.width, source.height);
		const round = decodePixels(ck, mine);
		if (!round) throw new Error("re-encoded png did not decode");

		expect([round.width, round.height]).toEqual([source.width, source.height]);
		expect(Array.from(round.data)).toEqual(Array.from(source.data));
		expect(mine.length).toBeLessThan(
			skiaEncode(ck, px, source.width, source.height).length,
		);
	});

	test("keeps alpha when the frame has any, and drops it when it has none", async () => {
		const ck = await ckInit();
		const opaque = decodePixels(ck, (await render(ck)).bytes);
		// "80" = half-alpha on the gradient's end stop.
		const translucent = decodePixels(ck, (await render(ck, "80")).bytes);
		if (!opaque || !translucent) throw new Error("decode failed");

		const colourType = (png: Uint8Array) => png[25]; // IHDR byte 9
		expect(
			colourType(
				await encodePng(
					new Uint8Array(opaque.data),
					opaque.width,
					opaque.height,
				),
			),
		).toBe(2); // RGB — the alpha channel said nothing
		const kept = await encodePng(
			new Uint8Array(translucent.data),
			translucent.width,
			translucent.height,
		);
		expect(colourType(kept)).toBe(6); // RGBA
		// …and the transparency survives the round trip.
		const back = decodePixels(ck, kept);
		if (!back) throw new Error("decode failed");
		expect(Array.from(back.data)).toEqual(Array.from(translucent.data));
	});

	test("best effort is never worse, and still exact", async () => {
		const ck = await ckInit();
		const source = decodePixels(ck, (await render(ck)).bytes);
		if (!source) throw new Error("decode failed");
		const px = new Uint8Array(source.data);
		const fast = await encodePng(px, source.width, source.height);
		const best = await encodePng(px, source.width, source.height, {
			effort: "best",
		});
		const round = decodePixels(ck, best);
		if (!round) throw new Error("decode failed");
		expect(Array.from(round.data)).toEqual(Array.from(source.data));
		// "best" searches a superset of "fast"'s candidates.
		expect(best.length).toBeLessThanOrEqual(fast.length);
	});

	test("rejects a buffer that cannot hold the frame", async () => {
		await expect(encodePng(new Uint8Array(4), 2, 2)).rejects.toThrow(
			/expected 16 bytes/,
		);
	});
});
