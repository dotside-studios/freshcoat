// Phase 4: the unified mask node. Lowering picks the implementation by what the
// mask IS — a single opaque shape → a drawGroup with a clipPath (fast), anything
// else → a drawMasked offscreen-coverage command (general). Both render.
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { describe, expect, test } from "vitest";
import { createHeadlessEnv } from "../src/headless";
import type { MeasureText } from "../src/index";
import {
	autoLayout,
	compileScene,
	createEllipse,
	createGroup,
	createImage,
	createMask,
	createRect,
	resolveLayout,
} from "../src/index";
import type { GroupNode, MaskNode } from "../src/node";

const solid = (color: string) => [{ kind: "solid" as const, color }];
const measure: MeasureText = () => ({ width: 0, height: 0 });

describe("mask lowering — fast path (shape → clipPath)", () => {
	test("ellipse mask → drawGroup with an ellipse clip at the mask box", () => {
		const scene = createMask(
			createEllipse({
				pos: { x: 5, y: 5 },
				size: { width: 40, height: 40 },
				fills: solid("#fff"),
			}),
			[
				createRect({
					pos: { x: 0, y: 0 },
					size: { width: 50, height: 50 },
					fills: solid("#f00"),
				}),
			],
		);
		const draw = compileScene(scene, { width: 50, height: 50 }).at(-1);
		if (draw?.op !== "drawGroup") throw new Error("expected drawGroup");
		expect(draw.clip).toEqual({ kind: "ellipse" });
		expect(draw.pos).toEqual({ x: 5, y: 5 }); // mask shape's box
		expect(draw.size).toEqual({ width: 40, height: 40 });
		expect(draw.children[0].op).toBe("drawRect");
	});

	test("rounded rect mask → rounded-rect clip; squircle when smoothed", () => {
		const rounded = compileScene(
			createMask(
				createRect({
					size: { width: 20, height: 20 },
					cornerRadius: 6,
					fills: solid("#fff"),
				}),
				[createRect({ size: { width: 20, height: 20 }, fills: solid("#f00") })],
			),
			{ width: 20, height: 20 },
		).at(-1);
		if (rounded?.op !== "drawGroup") throw new Error("expected drawGroup");
		expect(rounded.clip).toEqual({ kind: "rounded-rect", radius: 6 });

		const squircle = compileScene(
			createMask(
				createRect({
					size: { width: 20, height: 20 },
					cornerRadius: 6,
					cornerSmoothing: 0.6,
					fills: solid("#fff"),
				}),
				[createRect({ size: { width: 20, height: 20 }, fills: solid("#f00") })],
			),
			{ width: 20, height: 20 },
		).at(-1);
		if (squircle?.op !== "drawGroup") throw new Error("expected drawGroup");
		expect(squircle.clip).toEqual({ kind: "squircle", radius: 6 });
	});
});

describe("mask lowering — slow path (offscreen coverage)", () => {
	test("image mask → drawMasked carrying mask + children", () => {
		const scene = createMask(
			createImage({
				size: { width: 40, height: 40 },
				src: "mask.png",
				fit: "cover",
			}),
			[createRect({ size: { width: 40, height: 40 }, fills: solid("#f00") })],
			{ channel: "luminance", invert: true },
		);
		const draw = compileScene(scene, { width: 40, height: 40 }).at(-1);
		if (draw?.op !== "drawMasked") throw new Error("expected drawMasked");
		expect(draw.mask.op).toBe("drawImage");
		expect(draw.children[0].op).toBe("drawRect");
		expect(draw.channel).toBe("luminance");
		expect(draw.invert).toBe(true);
	});

	// The fast-path predicate reads the MASK, so a plain shape qualified however
	// the mask NODE was configured, and a clipPath carries neither flag: invert
	// rendered as a normal clip, and an opaque black mask under `luminance` kept
	// the content a zero-luminance mask must drop.
	test("invert disqualifies the fast path even for a plain shape", () => {
		const scene = createMask(
			createRect({ size: { width: 40, height: 40 }, fills: solid("#000") }),
			[createRect({ size: { width: 40, height: 40 }, fills: solid("#f00") })],
			{ invert: true },
		);
		const draw = compileScene(scene, { width: 40, height: 40 }).at(-1);
		if (draw?.op !== "drawMasked")
			throw new Error("expected drawMasked, not a clip");
		expect(draw.invert).toBe(true);
	});

	test("luminance disqualifies it too: an opaque shape's coverage is its colour", () => {
		const scene = createMask(
			createRect({ size: { width: 40, height: 40 }, fills: solid("#000") }),
			[createRect({ size: { width: 40, height: 40 }, fills: solid("#f00") })],
			{ channel: "luminance" },
		);
		const draw = compileScene(scene, { width: 40, height: 40 }).at(-1);
		if (draw?.op !== "drawMasked")
			throw new Error("expected drawMasked, not a clip");
		expect(draw.channel).toBe("luminance");
	});

	test("a gradient-filled shape is not a fast clip (partial alpha) → drawMasked", () => {
		const scene = createMask(
			createRect({
				size: { width: 40, height: 40 },
				fills: [
					{
						kind: "linear",
						stops: [
							{ offset: 0, color: "#fff" },
							{ offset: 1, color: "#000" },
						],
						from: { x: 0, y: 0 },
						to: { x: 1, y: 0 },
					},
				],
			}),
			[createRect({ size: { width: 40, height: 40 }, fills: solid("#00f") })],
		);
		expect(compileScene(scene, { width: 40, height: 40 }).at(-1)?.op).toBe(
			"drawMasked",
		);
	});

	test("transform effects on the mask fall back to the slow path", () => {
		const scene = createMask(
			createEllipse({
				size: { width: 40, height: 40 },
				fills: solid("#fff"),
				opacity: 0.5,
			}),
			[createRect({ size: { width: 40, height: 40 }, fills: solid("#f00") })],
		);
		expect(compileScene(scene, { width: 40, height: 40 }).at(-1)?.op).toBe(
			"drawMasked",
		);
	});

	test("a group mask → drawMasked", () => {
		const scene = createMask(
			createGroup([
				createRect({ size: { width: 40, height: 40 }, fills: solid("#fff") }),
			]),
			[createRect({ size: { width: 40, height: 40 }, fills: solid("#f00") })],
		);
		expect(compileScene(scene, { width: 40, height: 40 }).at(-1)?.op).toBe(
			"drawMasked",
		);
	});
});

describe("mask resolveLayout", () => {
	test("folds the mask node's pos into its mask + children (absolute)", () => {
		const node: MaskNode = {
			kind: "mask",
			pos: { x: 50, y: 50 },
			size: { width: 40, height: 40 },
			mask: createEllipse({
				pos: { x: 0, y: 0 },
				size: { width: 40, height: 40 },
				fills: solid("#fff"),
			}),
			children: [
				createRect({
					pos: { x: 10, y: 10 },
					size: { width: 20, height: 20 },
					fills: solid("#f00"),
				}),
			],
		};
		const out = resolveLayout(node, { measure }) as MaskNode;
		expect(out.mask.pos).toEqual({ x: 50, y: 50 });
		expect(out.children[0].pos).toEqual({ x: 60, y: 60 });
	});

	test("a mask placed by a flex parent resolves absolutely", () => {
		const mask: MaskNode = {
			kind: "mask",
			mask: createEllipse({
				pos: { x: 0, y: 0 },
				size: { width: 20, height: 20 },
				fills: solid("#fff"),
			}),
			children: [
				createRect({
					pos: { x: 0, y: 0 },
					size: { width: 20, height: 20 },
					fills: solid("#f00"),
				}),
			],
			layoutChild: { width: 20, height: 20 },
		};
		const parent = autoLayout(
			createGroup([createRect({ size: { width: 20, height: 20 } }), mask], {
				pos: { x: 100, y: 100 },
				size: { width: 200, height: 40 },
			}),
			{ direction: "row", gap: 10 },
		);
		const out = resolveLayout(parent, { measure }) as GroupNode;
		const placed = out.children[1] as MaskNode;
		expect(placed.pos).toEqual({ x: 130, y: 100 }); // 100 + 20 + 10
		expect(placed.children[0].pos).toEqual({ x: 130, y: 100 });
	});
});

describe("mask render smoke", () => {
	let ck: any;
	async function initCk() {
		if (!ck)
			ck = await loadCanvasKit();
		return ck;
	}
	async function paint(scene: Parameters<typeof compileScene>[0]) {
		const k = await initCk();
		const commands = compileScene(scene, { width: 40, height: 40 });
		const result = await createHeadlessEnv().paint(commands, k);
		return (result as { bytes: Uint8Array }).bytes;
	}

	test("fast path (ellipse clip) paints to PNG", async () => {
		const png = await paint(
			createMask(
				createEllipse({
					size: { width: 40, height: 40 },
					fills: solid("#fff"),
				}),
				[
					createRect({
						size: { width: 40, height: 40 },
						fills: solid("#f97316"),
					}),
				],
			),
		);
		expect([png[0], png[1], png[2], png[3]]).toEqual([137, 80, 78, 71]);
	});

	test("slow path (offscreen coverage) paints to PNG", async () => {
		const png = await paint(
			createMask(
				createRect({
					size: { width: 40, height: 40 },
					fills: [
						{
							kind: "linear",
							stops: [
								{ offset: 0, color: "#fff" },
								{ offset: 1, color: "#000" },
							],
							from: { x: 0, y: 0 },
							to: { x: 1, y: 0 },
						},
					],
				}),
				[
					createRect({
						size: { width: 40, height: 40 },
						fills: solid("#00b4d8"),
					}),
				],
			),
		);
		expect([png[0], png[1], png[2], png[3]]).toEqual([137, 80, 78, 71]);
	});
});

describe("luminance mask coverage", () => {
	let ck: any;
	async function pixel(maskColor: string, invert: boolean) {
		if (!ck) ck = await loadCanvasKit();
		const scene = createMask(
			createRect({ size: { width: 20, height: 20 }, fills: solid(maskColor) }),
			[
				createRect({
					size: { width: 20, height: 20 },
					fills: solid("#ff0000"),
				}),
			],
			{ channel: "luminance", invert },
		);
		const commands = compileScene(scene, { width: 20, height: 20 });
		const result = (await createHeadlessEnv().paint(commands, ck)) as {
			bytes: Uint8Array;
			warnings: unknown[];
		};
		const img = ck.MakeImageFromEncoded(result.bytes);
		const px = img.readPixels(10, 10, {
			width: 1,
			height: 1,
			colorType: ck.ColorType.RGBA_8888,
			alphaType: ck.AlphaType.Unpremul,
			colorSpace: ck.ColorSpace.SRGB,
		}) as Uint8Array;
		img.delete();
		return { px: Array.from(px), warnings: result.warnings };
	}

	test.each([
		{ mask: "#ffffff80", invert: false, alpha: 128 },
		{ mask: "#ffffff", invert: false, alpha: 255 },
		{ mask: "#000000", invert: false, alpha: 0 },
		{ mask: "#808080", invert: false, alpha: 128 },
		{ mask: "#ffffff80", invert: true, alpha: 127 },
		{ mask: "#ffffff", invert: true, alpha: 0 },
		{ mask: "#000000", invert: true, alpha: 255 },
		{ mask: "#808080", invert: true, alpha: 127 },
	])("mask $mask, invert $invert → alpha $alpha", async ({
		mask,
		invert,
		alpha,
	}) => {
		const { px, warnings } = await pixel(mask, invert);
		expect(Math.abs(px[3] - alpha)).toBeLessThanOrEqual(2);
		if (px[3] > 0) expect(px.slice(0, 3)).toEqual([255, 0, 0]);
		expect(warnings).toEqual([]);
	});
});
