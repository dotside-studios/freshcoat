// The planner: classification, the PrintOptimizeOptions → Adjust mapping (proven
// against the canonical color formulas), the sync tree walk, and the async
// per-image analyzeScene driven by an injected sampler (no canvas in for-print).
import {
	createBitmap,
	createGroup,
	createImage,
	createRect,
	createText,
	type Node,
} from "freshcoat";
import { describe, expect, test } from "vitest";
import { analyzePixels } from "../src/analyze";
import {
	analyzeScene,
	classifyIntent,
	planScene,
	printAdjust,
} from "../src/plan";
import { NO_PROCESSING, YMCKO_PRESET } from "../src/presets";
import type { PixelData, PrintOptimizeOptions } from "../src/types";

const FONT = {
	family: "X",
	weight: 400 as const,
	style: "normal" as const,
	size: 12,
	lineHeight: 1.2,
};
const imageNode = (src = "a.png"): Node =>
	createImage({
		pos: { x: 0, y: 0 },
		size: { width: 10, height: 10 },
		src,
		fit: "cover",
	});
const textNode = (): Node =>
	createText({
		pos: { x: 0, y: 0 },
		size: { width: 10, height: 10 },
		text: "hi",
		font: FONT,
	});
const rectNode = (): Node =>
	createRect({
		pos: { x: 0, y: 0 },
		size: { width: 10, height: 10 },
		fills: [{ kind: "solid", color: "#f00" }],
	});
const qrNode = (): Node =>
	createBitmap({
		pos: { x: 0, y: 0 },
		size: { width: 10, height: 10 },
		pixels: new Uint8Array(4),
		pixelWidth: 1,
		pixelHeight: 1,
	});

describe("classifyIntent", () => {
	test("maps node kinds to print intent", () => {
		expect(classifyIntent(imageNode())).toBe("photo");
		expect(classifyIntent(textNode())).toBe("text");
		expect(classifyIntent(qrNode())).toBe("code");
		expect(classifyIntent(rectNode())).toBe("graphic");
		expect(classifyIntent(createGroup([]))).toBe("container");
	});
});

// ── printAdjust ↔ canonical color formulas ──
// Reference implementations of the classic per-channel/color steps in 0–255 space.
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
const refGamma = (i: number, gamma: number) => clamp(255 * (i / 255) ** gamma);
const refDarkness = (v: number, a: number) => {
	const overlay = v < 128 ? 0 : 2 * v - 255;
	return clamp(v * (1 - a) + overlay * a);
};
const applyMatrix = (m: number[], [r, g, b]: RGB): RGB => {
	const ch = (o: number) =>
		clamp(
			m[o] * r + m[o + 1] * g + m[o + 2] * b + m[o + 3] * 255 + m[o + 4] * 255,
		);
	return [ch(0), ch(5), ch(10)];
};
const maxDiff = (a: RGB, b: RGB) =>
	Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
const SAMPLES: RGB[] = [
	[0, 0, 0],
	[255, 255, 255],
	[204, 51, 51],
	[10, 200, 90],
	[128, 128, 128],
	[240, 180, 60],
];

describe("printAdjust ↔ color formulas", () => {
	test("colorMatrix reproduces saturation→contrast within rounding", () => {
		const o: PrintOptimizeOptions = {
			saturation: 1.3,
			contrast: 1.2,
			gamma: 1,
			sharpness: 0,
			darkness: 0,
		};
		const { colorMatrix } = printAdjust(o);
		expect(colorMatrix).toBeDefined();
		for (const px of SAMPLES) {
			const ref = refContrast(refSaturation(px, 1.3), 1.2);
			expect(
				maxDiff(applyMatrix(colorMatrix as number[], px), ref),
			).toBeLessThanOrEqual(2);
		}
	});

	test("lut reproduces gamma→darkness exactly (per channel, staged rounds)", () => {
		const o: PrintOptimizeOptions = {
			saturation: 1,
			contrast: 1,
			gamma: 0.85,
			sharpness: 0,
			darkness: 0.25,
		};
		const { lut } = printAdjust(o);
		expect(lut).toBeDefined();
		for (let i = 0; i < 256; i += 17) {
			const ref = refDarkness(refGamma(i, 0.85), 0.25);
			expect((lut as { r: Uint8Array }).r[i]).toBe(ref);
		}
	});

	test("sharpness maps to sharpen; identity options give an empty adjust", () => {
		expect(
			printAdjust({
				saturation: 1,
				contrast: 1,
				gamma: 1,
				sharpness: 0.4,
				darkness: 0,
			}).sharpen,
		).toBe(0.4);
		expect(
			printAdjust({
				saturation: 1,
				contrast: 1,
				gamma: 1,
				sharpness: 0,
				darkness: 0,
			}),
		).toEqual({});
	});

	test("a boosting matrix asks for hue-preserving gamut mapping", () => {
		expect(
			printAdjust({
				saturation: 1.3,
				contrast: 1.2,
				gamma: 1,
				sharpness: 0,
				darkness: 0,
			}).gamut,
		).toBe("preserve-hue");
		// Nothing can leave the range without a matrix, so the mode stays off.
		expect(
			printAdjust({
				saturation: 1,
				contrast: 1,
				gamma: 0.9,
				sharpness: 0,
				darkness: 0,
			}).gamut,
		).toBeUndefined();
	});
});

describe("planScene (sync)", () => {
	test("corrects photos, leaves text/QR/graphics pristine", () => {
		const tree = createGroup([imageNode(), textNode(), qrNode(), rectNode()]);
		const planned = planScene(tree) as typeof tree;
		const [img, txt, qr, rect] = planned.children;
		expect(img.adjust).toBeDefined();
		expect(txt.adjust).toBeUndefined();
		expect(qr.adjust).toBeUndefined();
		expect(rect.adjust).toBeUndefined();
	});

	test("photo adjust matches printAdjust(YMCKO)", () => {
		const planned = planScene(createGroup([imageNode()])) as ReturnType<
			typeof createGroup
		>;
		expect(planned.children[0].adjust).toEqual(printAdjust(YMCKO_PRESET));
	});

	test("policy can correct graphics and opt photos out", () => {
		const tree = createGroup([imageNode(), rectNode()]);
		const planned = planScene(tree, {
			photo: null,
			graphic: YMCKO_PRESET,
		}) as typeof tree;
		expect(planned.children[0].adjust).toBeUndefined();
		expect(planned.children[1].adjust).toBeDefined();
	});

	test("intent resolver lets a raster logo follow the graphic policy", () => {
		const logo = imageNode("brand-logo.png");
		const tree = createGroup([logo]);
		const planned = planScene(tree, {
			intentFor: (node) =>
				node.kind === "image" && node.src === "brand-logo.png"
					? "graphic"
					: undefined,
			graphic: NO_PROCESSING,
		});
		expect(planned.children[0].adjust).toBeUndefined();
	});

	test("does not mutate the input tree", () => {
		const tree = createGroup([imageNode()]);
		planScene(tree);
		expect((tree.children[0] as Node).adjust).toBeUndefined();
	});

	test("recurses into masks without adjusting the container", () => {
		const masked = {
			kind: "mask" as const,
			pos: { x: 0, y: 0 },
			size: { width: 10, height: 10 },
			mask: rectNode(),
			children: [imageNode()],
		};
		const planned = planScene(masked) as typeof masked;
		expect(planned.adjust).toBeUndefined();
		expect(planned.children[0].adjust).toBeDefined();
	});
});

// ── analyzeScene (async, injected sampler — no canvas) ──
// A synthetic bright, low-saturation buffer (drives a distinct recommendation).
function brightBuffer(): PixelData {
	const w = 8;
	const h = 8;
	const data = new Uint8ClampedArray(w * h * 4);
	for (let i = 0; i < data.length; i += 4) {
		data[i] = 220;
		data[i + 1] = 215;
		data[i + 2] = 225;
		data[i + 3] = 255;
	}
	return { data, width: w, height: h };
}

describe("analyzeScene (sampler)", () => {
	test("analyzes each photo per-image and leaves text alone", async () => {
		const pixels = brightBuffer();
		const sample = async () => pixels;
		const expected = printAdjust(analyzePixels(pixels).recommendation);

		const tree = createGroup([imageNode("photo.png"), textNode()]);
		const planned = (await analyzeScene(sample, tree)) as typeof tree;
		const [img, txt] = planned.children;

		expect(img.adjust).toEqual(expected);
		expect(txt.adjust).toBeUndefined();
	});

	test("the sampler receives the image node (for as-rendered analysis)", async () => {
		const seen: { src: string; fit: string }[] = [];
		const sample = async (node: { src: string; fit: string }) => {
			seen.push({ src: node.src, fit: node.fit });
			return brightBuffer();
		};
		await analyzeScene(sample, createGroup([imageNode("p.png")]));
		expect(seen).toEqual([{ src: "p.png", fit: "cover" }]);
	});

	test("caches by rendered appearance — identical layers sample once", async () => {
		let calls = 0;
		const sample = async () => {
			calls++;
			return brightBuffer();
		};
		const tree = createGroup([imageNode("dup.png"), imageNode("dup.png")]);
		await analyzeScene(sample, tree);
		expect(calls).toBe(1);
	});

	test("same src at different sizes samples separately (different crop)", async () => {
		let calls = 0;
		const sample = async () => {
			calls++;
			return brightBuffer();
		};
		const big = createImage({
			pos: { x: 0, y: 0 },
			size: { width: 40, height: 10 },
			src: "s.png",
			fit: "cover",
		});
		const small = createImage({
			pos: { x: 0, y: 0 },
			size: { width: 10, height: 10 },
			src: "s.png",
			fit: "cover",
		});
		await analyzeScene(sample, createGroup([big, small]));
		expect(calls).toBe(2);
	});

	test("reports each analysis once, even when a layer repeats", async () => {
		const seen: Array<{ src: string; clipped: number }> = [];
		const sample = async () => brightBuffer();
		const tree = createGroup([
			imageNode("dup.png"),
			imageNode("dup.png"),
			textNode(),
		]);
		await analyzeScene(sample, tree, {}, (analysis, node) =>
			seen.push({ src: node.src, clipped: analysis.gamut.clipped }),
		);
		// One sample, one report — the same pixels twice would overstate the share.
		expect(seen).toHaveLength(1);
		expect(seen[0].src).toBe("dup.png");
		expect(seen[0].clipped).toBeGreaterThanOrEqual(0);
	});

	test("no analysis, no report: an explicit photo policy never calls back", async () => {
		const seen: string[] = [];
		await analyzeScene(
			async () => brightBuffer(),
			createGroup([imageNode()]),
			{ photo: null },
			(_a, node) => seen.push(node.src),
		);
		expect(seen).toEqual([]);
	});

	test("explicit photo policy overrides analysis (never samples)", async () => {
		let calls = 0;
		const sample = async () => {
			calls++;
			return brightBuffer();
		};
		const tree = createGroup([imageNode()]);
		const planned = (await analyzeScene(sample, tree, {
			photo: null,
		})) as typeof tree;
		expect(planned.children[0].adjust).toBeUndefined();
		expect(calls).toBe(0);
	});

	test("intent resolver can keep an image out of analysis", async () => {
		let calls = 0;
		const planned = await analyzeScene(
			async () => {
				calls++;
				return brightBuffer();
			},
			createGroup([imageNode("logo.png")]),
			{
				intentFor: (node) =>
					node.kind === "image" && node.src === "logo.png"
						? "graphic"
						: undefined,
				graphic: NO_PROCESSING,
			},
		);
		expect(calls).toBe(0);
		expect(planned.children[0].adjust).toBeUndefined();
	});
});
