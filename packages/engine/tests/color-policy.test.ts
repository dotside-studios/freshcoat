import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { describe, expect, test } from "vitest";
import { brightnessMatrix, buildAdjust } from "../src/adjust";
import { imageInfo, resolvePrecision } from "../src/color-policy";
import { compileScene } from "../src/compile-scene";
import { decodePixels } from "../src/decode";
import { renderSceneToPng } from "./helpers/headless";
import { createFrame, createRect, type Node } from "../src/node";
import { validateCommands } from "../src/validate-commands";

const W = 256;
const H = 4;

async function ckInit(): Promise<any> {
	return (await loadCanvasKit()) as unknown;
}

const ramp = () =>
	createRect({
		pos: { x: 0, y: 0 },
		size: { width: W, height: H },
		fills: [
			{
				kind: "linear",
				from: { x: 0, y: 0.5 },
				to: { x: 1, y: 0.5 },
				stops: [
					{ offset: 0, color: "#000000" },
					{ offset: 1, color: "#ffffff" },
				],
			},
		],
	});

// Darken to a quarter and brighten back, `depth` times over, each step its own
// layer: in 8 bits every round trip keeps a quarter of the levels.
function darkenBrighten(node: Node, depth: number): Node {
	let out = node;
	for (let i = 0; i < depth; i++) {
		const box = { pos: { x: 0, y: 0 }, size: { width: W, height: H } };
		const dark = createFrame({
			...box,
			children: [out],
			adjust: { colorMatrix: brightnessMatrix(0.25) },
		});
		out = createFrame({
			...box,
			children: [dark],
			adjust: { colorMatrix: brightnessMatrix(4) },
		});
	}
	return out;
}

const levels = (ck: any, png: Uint8Array) => {
	const d = decodePixels(ck, png);
	if (!d) throw new Error("decode failed");
	const row = 1;
	const seen = new Set<number>();
	for (let x = 0; x < d.width; x++) seen.add(d.data[(row * d.width + x) * 4]);
	return seen.size;
};

const pngChunks = (bytes: Uint8Array) => {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const types: string[] = [];
	for (let at = 8; at < bytes.length; ) {
		const length = view.getUint32(at);
		types.push(String.fromCharCode(...bytes.subarray(at + 4, at + 8)));
		at += 12 + length;
	}
	return types;
};

describe("color policy", () => {
	test("every buffer role is sRGB, and only layers follow the precision", async () => {
		const ck = await ckInit();
		for (const precision of ["u8", "f16"] as const) {
			const layer = imageInfo(ck, "layer", 1, 1, precision);
			expect(layer.colorSpace).toBe(ck.ColorSpace.SRGB);
			expect(layer.alphaType).toBe(ck.AlphaType.Premul);
			expect(layer.colorType).toBe(
				precision === "f16" ? ck.ColorType.RGBA_F16 : ck.ColorType.RGBA_8888,
			);
			for (const role of ["output", "pixels", "opaque"] as const) {
				const info = imageInfo(ck, role, 1, 1, precision);
				expect(info.colorType).toBe(ck.ColorType.RGBA_8888);
				expect(info.colorSpace).toBe(ck.ColorSpace.SRGB);
			}
		}
		expect(imageInfo(ck, "float", 1, 1).colorType).toBe(ck.ColorType.RGBA_F32);
	});

	test("precision is opt-in and rides on createCanvas only when set", () => {
		expect(resolvePrecision(undefined)).toBe("u8");
		expect(resolvePrecision("bogus")).toBe("u8");
		expect(resolvePrecision("f16")).toBe("f16");
		const at = (precision?: "u8" | "f16") =>
			compileScene(ramp(), { width: W, height: H, precision })[0];
		expect(at()).toEqual({ op: "createCanvas", width: W, height: H });
		expect(at("u8")).toEqual(at());
		expect(at("f16")).toEqual({
			op: "createCanvas",
			width: W,
			height: H,
			precision: "f16",
		});
	});

	test("an unknown precision is a validation error", () => {
		const issues = validateCommands([
			{ op: "createCanvas", width: 1, height: 1, precision: "f32" as never },
		]);
		expect(issues.map((i) => i.code)).toContain("bad_precision");
	});

	test("f16 keeps the levels a repeated adjust chain bands away in 8 bits", async () => {
		const ck = await ckInit();
		const scene = darkenBrighten(ramp(), 2);
		const u8 = await renderSceneToPng(scene, { width: W, height: H, ck });
		const f16 = await renderSceneToPng(scene, {
			width: W,
			height: H,
			ck,
			precision: "f16",
		});
		const reference = levels(
			ck,
			(await renderSceneToPng(ramp(), { width: W, height: H, ck })).bytes,
		);
		const banded = levels(ck, u8.bytes);
		const smooth = levels(ck, f16.bytes);
		expect(banded).toBeLessThanOrEqual(reference / 4 + 1);
		expect(smooth).toBeGreaterThan(reference * 0.9);
	});

	test("f16 with supersample and a shader adjust still lands at output size", async () => {
		const ck = await ckInit();
		const scene = createFrame({
			pos: { x: 0, y: 0 },
			size: { width: W, height: H },
			children: [ramp()],
			adjust: buildAdjust({ brightness: 1.1, sharpen: 0.5 }),
			blur: 1,
		});
		const out = await renderSceneToPng(darkenBrighten(scene, 1), {
			width: W,
			height: H,
			ck,
			precision: "f16",
			supersample: 2,
		});
		const d = decodePixels(ck, out.bytes);
		expect([d?.width, d?.height]).toEqual([W, H]);
		expect(out.warnings).toEqual([]);
	});

	test("the default precision leaves output unchanged", async () => {
		const ck = await ckInit();
		const scene = darkenBrighten(ramp(), 1);
		const a = await renderSceneToPng(scene, { width: W, height: H, ck });
		const b = await renderSceneToPng(scene, {
			width: W,
			height: H,
			ck,
			precision: "u8",
		});
		expect(b.bytes).toEqual(a.bytes);
	});

	test("PNG output is 8-bit RGB(A) and untagged, which reads as sRGB", async () => {
		const ck = await ckInit();
		for (const precision of ["u8", "f16"] as const) {
			const out = await renderSceneToPng(ramp(), {
				width: W,
				height: H,
				ck,
				precision,
			});
			expect(out.format).toBe("png");
			const chunks = pngChunks(out.bytes);
			for (const tag of ["sRGB", "iCCP", "gAMA", "cHRM"])
				expect(chunks).not.toContain(tag);
			expect(out.bytes[24]).toBe(8);
		}
	});

	test("JPEG output carries Skia's sRGB ICC profile when the build has the encoder", async () => {
		const ck = await ckInit();
		const out = await renderSceneToPng(ramp(), {
			width: W,
			height: H,
			ck,
			encode: { format: "jpeg" },
		});
		if (out.format !== "jpeg") {
			expect(out.format).toBe("png");
			return;
		}
		const text = new TextDecoder("latin1").decode(out.bytes);
		expect(text).toContain("ICC_PROFILE");
	});
});
