// Adjust: (1) the builder math is a faithful encoding of the classic per-pixel
// color-correction steps (saturation matrix, contrast matrix, gamma LUT), proven
// in pure JS against reference formulas. What the field DOES once painted is the
// conformance corpus's subject, not this file's.
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { describe, expect, test } from "vitest";
import {
	applyAdjustColor,
	buildAdjust,
	composeAdjust,
	contrastMatrix,
	gammaLut,
	identityLut3d,
	saturationMatrix,
} from "../src/adjust";
import { renderSceneToPng } from "../src/headless";
import { createFrame, createRect } from "../src/node";

// ── reference formulas (the canonical per-pixel color steps, in 0–255 space) ──
// These mirror the well-known dye-sub color-correction steps; the builder must
// encode the same transforms.
const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
type RGB = [number, number, number];

const refSaturation = ([r, g, b]: RGB, s: number): RGB => {
	const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
	return [
		clamp(gray + s * (r - gray)),
		clamp(gray + s * (g - gray)),
		clamp(gray + s * (b - gray)),
	];
};
const refContrast = ([r, g, b]: RGB, c: number): RGB => [
	clamp((r - 128) * c + 128),
	clamp((g - 128) * c + 128),
	clamp((b - 128) * c + 128),
];
const refGamma = ([r, g, b]: RGB, gamma: number): RGB => {
	const lut = (i: number) => clamp(255 * (i / 255) ** gamma);
	return [lut(r), lut(g), lut(b)];
};

// Apply a 4×5 color matrix (bias column normalized [0,1]) to an opaque pixel, the
// way Skia's ColorFilter.MakeMatrix does, but in 0–255 space with a final round.
const applyMatrix = (m: number[], [r, g, b]: RGB): RGB => {
	const ch = (o: number) =>
		clamp(
			m[o] * r + m[o + 1] * g + m[o + 2] * b + m[o + 3] * 255 + m[o + 4] * 255,
		);
	return [ch(0), ch(5), ch(10)];
};

const SAMPLES: RGB[] = [
	[0, 0, 0],
	[255, 255, 255],
	[204, 51, 51],
	[10, 200, 90],
	[128, 64, 200],
	[200, 200, 200],
	[17, 17, 17],
	[240, 180, 60],
];

const maxChannelDiff = (a: RGB, b: RGB) =>
	Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

describe("adjust builder ↔ reference color steps", () => {
	test("saturation matrix reproduces the saturation step exactly", () => {
		const m = saturationMatrix(1.3);
		for (const px of SAMPLES) {
			expect(maxChannelDiff(applyMatrix(m, px), refSaturation(px, 1.3))).toBe(
				0,
			);
		}
	});

	test("contrast matrix reproduces the contrast step exactly", () => {
		const m = contrastMatrix(1.2);
		for (const px of SAMPLES) {
			expect(maxChannelDiff(applyMatrix(m, px), refContrast(px, 1.2))).toBe(0);
		}
	});

	test("gamma LUT reproduces the gamma step exactly", () => {
		const lut = gammaLut(0.85);
		for (const px of SAMPLES) {
			const got: RGB = [lut.r[px[0]], lut.g[px[1]], lut.b[px[2]]];
			expect(maxChannelDiff(got, refGamma(px, 0.85))).toBe(0);
		}
	});

	test("identity 3D LUT lays out RGB corners in r-fast order", () => {
		const cube = identityLut3d(3);
		expect(cube.data.slice(0, 3)).toEqual(new Uint8Array([0, 0, 0]));
		const white = ((2 * 3 + 2) * 3 + 2) * 3;
		expect(cube.data.slice(white, white + 3)).toEqual(
			new Uint8Array([255, 255, 255]),
		);
	});

	test("folded saturation→contrast matches the sequential steps within rounding", () => {
		// buildAdjust composes both into ONE matrix (rounds once); the sequential
		// reference rounds between steps. They agree to within a couple of LSB — the
		// only divergence is that intermediate rounding.
		const { colorMatrix } = buildAdjust({ saturation: 1.3, contrast: 1.2 });
		expect(colorMatrix).toBeDefined();
		for (const px of SAMPLES) {
			const folded = applyMatrix(colorMatrix as number[], px);
			const sequential = refContrast(refSaturation(px, 1.3), 1.2);
			expect(maxChannelDiff(folded, sequential)).toBeLessThanOrEqual(2);
		}
	});

	test("identity knobs produce an empty (no-op) adjust", () => {
		expect(buildAdjust({})).toEqual({});
		expect(
			buildAdjust({ saturation: 1, contrast: 1, gamma: 1, sharpen: 0 }),
		).toEqual({});
	});
});
// ── what stays here rather than in the conformance corpus ────────────────────
// Every "does the adjusted layer land on the right pixels" test moved to
// ../conformance: those are backend semantics, and the corpus states them as
// derived values against one scene instead of as a relation between two renders.
// The reference-formula half above is compile-side and needs no painter.
//
// This one is neither. It asserts that equal LUTs share a texture within a
// paint, which is an efficiency property of THIS painter; a second backend is
// free to upload twice and still be correct, so it is not conformance.
describe("CanvasKit painter internals", () => {
	test("reuses equal LUT textures across adjusted layers in one paint", async () => {
		const ck: any = await loadCanvasKit();
		let uploads = 0;
		const makeImage = ck.MakeImage.bind(ck);
		ck.MakeImage = (...args: unknown[]) => {
			uploads++;
			return makeImage(...args);
		};
		const gray = (x: number) =>
			createRect({
				pos: { x, y: 0 },
				size: { width: 20, height: 20 },
				fills: [{ kind: "solid", color: "#808080" }],
				adjust: buildAdjust({ gamma: 2 }),
			});
		const scene = createFrame({
			pos: { x: 0, y: 0 },
			size: { width: 40, height: 20 },
			children: [gray(0), gray(20)],
		});
		await renderSceneToPng(scene, { width: 40, height: 20, ck });
		expect(uploads).toBe(1);
	});
});

describe("composeAdjust", () => {
	const samples: [number, number, number][] = [
		[0, 0, 0],
		[1, 1, 1],
		[0.8, 0.2, 0.1],
		[0.3, 0.6, 0.9],
		[0.5, 0.5, 0.2],
	];

	test("an empty side leaves the other unchanged", () => {
		const a = buildAdjust({ saturation: 1.3, gamma: 0.8 });
		expect(composeAdjust(a, {})).toEqual(a);
		expect(composeAdjust(undefined, a)).toEqual(a);
		expect(composeAdjust({}, undefined)).toEqual({});
	});

	test("looks like the first adjustment and then the second", () => {
		const first = buildAdjust({ saturation: 0.4, contrast: 1.2, gamma: 1.4 });
		const second = {
			...buildAdjust({ saturation: 1.5, brightness: 1.1, gamma: 0.8 }),
			gamut: "preserve-hue" as const,
		};
		const both = composeAdjust(first, second);
		expect(both.colorMatrix).toEqual(first.colorMatrix);
		expect(both.lut).toBe(first.lut);
		expect(both.lut3d?.size).toBe(33);
		for (const c of samples) {
			const want = applyAdjustColor(second, applyAdjustColor(first, c));
			const got = applyAdjustColor(both, c);
			got.forEach((v, i) => expect(Math.abs(v - want[i])).toBeLessThan(0.03));
		}
	});

	test("equal settings return the same tables across calls", () => {
		const compile = () =>
			composeAdjust(
				buildAdjust({ contrast: 1.2, gamma: 1.4 }),
				buildAdjust({ saturation: 1.5, gamma: 0.8 }),
			);
		const a = compile();
		const b = compile();
		expect(b.lut).toBe(a.lut);
		expect(b.lut3d).toBe(a.lut3d);
		expect(gammaLut(2.2)).toBe(gammaLut(2.2));
		const other = composeAdjust(
			buildAdjust({ contrast: 1.2, gamma: 1.4 }),
			buildAdjust({ saturation: 1.6, gamma: 0.8 }),
		);
		expect(other.lut3d?.data).not.toBe(a.lut3d?.data);
	});

	test("keeps the stronger sharpen and a lone sharpen passes through", () => {
		expect(
			composeAdjust({ sharpen: 0.3 }, buildAdjust({ saturation: 1.2 })),
		).toEqual({ ...buildAdjust({ saturation: 1.2 }), sharpen: 0.3 });
		expect(
			composeAdjust(
				buildAdjust({ contrast: 1.1, sharpen: 0.2 }),
				{ sharpen: 0.5 },
			),
		).toEqual({ ...buildAdjust({ contrast: 1.1 }), sharpen: 0.5 });
	});
});
