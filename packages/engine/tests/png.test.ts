// encodePng: a valid PNG of exactly the pixels handed in, smaller than what the
// backend's own encoder produces. Round-tripped through CanvasKit's decoder —
// which is both the correctness check and the proof that the filter and CRC
// arithmetic is right, since a wrong byte anywhere fails to decode or decodes
// to different pixels.
import { readFileSync } from "node:fs";
import { loadCanvasKit, testFontPath } from "@freshcoat-js/test-utils";
import { describe, expect, test } from "vitest";
import { decodePixels } from "../src/decode";
import { renderSceneToPng } from "../src/headless";
import { createFrame, createRect, createText } from "../src/node";
import { encodePng } from "../src/png";
import type { EncodedPaintResult } from "../src/types";

const FONT = testFontPath("Geist-Regular.ttf");

async function ckInit(): Promise<any> {
	return (await loadCanvasKit()) as unknown;
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

// One write, as ./png does: deflate output depends on how the input is chunked.
async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
	const cs = new CompressionStream("deflate");
	const writer = cs.writable.getWriter();
	const written = writer
		.write(bytes as unknown as Parameters<typeof writer.write>[0])
		.then(() => writer.close());
	const out = new Uint8Array(await new Response(cs.readable).arrayBuffer());
	await written;
	return out;
}

// The fast path as it was written before rows were built straight from RGBA:
// an RGB copy, then filter type 0 rows of each layout, the smaller deflate kept.
async function referenceIdat(px: Uint8Array, width: number, height: number) {
	const rows = (bytes: Uint8Array, channels: number) => {
		const stride = width * channels;
		const out = new Uint8Array((stride + 1) * height);
		for (let y = 0; y < height; y++)
			out.set(
				bytes.subarray(y * stride, (y + 1) * stride),
				y * (stride + 1) + 1,
			);
		return out;
	};
	const candidates = [{ channels: 4, idat: await deflate(rows(px, 4)) }];
	if (px.every((v, i) => i % 4 !== 3 || v === 255)) {
		const rgb = new Uint8Array(width * height * 3);
		for (let i = 0; i < width * height; i++)
			rgb.set(px.subarray(i * 4, i * 4 + 3), i * 3);
		candidates.push({ channels: 3, idat: await deflate(rows(rgb, 3)) });
	}
	return candidates.reduce((a, b) => (b.idat.length < a.idat.length ? b : a));
}

function idatOf(png: Uint8Array): Uint8Array {
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
	for (let at = 8; at < png.length; ) {
		const length = view.getUint32(at);
		const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
		if (type === "IDAT") return png.subarray(at + 8, at + 8 + length);
		at += 12 + length;
	}
	throw new Error("no IDAT");
}

describe("encodePng", () => {
	test("the fast path writes what the previous encoder wrote", async () => {
		const ck = await ckInit();
		for (const alpha of ["", "80"]) {
			const source = decodePixels(ck, (await render(ck, alpha)).bytes);
			if (!source) throw new Error("decode failed");
			const { width, height } = source;
			const png = await encodePng(source.data, width, height);
			const ref = await referenceIdat(source.data, width, height);
			expect(png[25]).toBe(ref.channels === 4 ? 6 : 2);
			expect(idatOf(png)).toEqual(ref.idat);
		}
		const flat = new Uint8Array(5 * 3 * 4).fill(255);
		const ref = await referenceIdat(flat, 5, 3);
		expect(idatOf(await encodePng(flat, 5, 3))).toEqual(ref.idat);
	});

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
