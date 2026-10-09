import { createRenderer, decodePixels, type GroupNode, type Node } from "@freshcoat-js/engine";
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { describe, expect, test } from "vitest";
import {
	bleedMm,
	bleedSize,
	cardSizeMm,
	extendIntoBleed,
	templateBleed,
	templateSafeArea,
} from "../src/bleed";
import { compile } from "../src/compile";
import { renderTemplate } from "../src/render";
import type { Element, Template } from "../src/types";
import { validate } from "../src/validate";

function card(extra: Partial<Template> = {}, elements: Element[] = []) {
	return {
		format_version: "1.5",
		id: "t",
		name: "T",
		width: 100,
		height: 60,
		fields: { type: "object", properties: {} },
		template_data: [
			{
				name: "front",
				background: {
					id: "bg",
					type: "rect",
					properties: { fill: "#ff0000" },
				},
				elements,
			},
		],
		...extra,
	} as Template;
}

const rect = (
	id: string,
	x: number,
	y: number,
	width: number,
	height: number,
	extra: Record<string, unknown> = {},
): Element =>
	({
		id,
		type: "rect",
		pos: { x, y },
		size: { width, height },
		properties: { fill: "#0000ff", ...extra },
	}) as Element;

const codes = (input: unknown) => {
	const r = validate(input);
	return r.ok ? [] : r.errors.map((e) => [e.path, e.code]);
};

describe("bleed and safeArea schema", () => {
	test("accepts one number or each side", () => {
		expect(codes(card({ bleed: 4, safeArea: 6 }))).toEqual([]);
		expect(
			codes(
				card({
					bleed: { top: 1, right: 2, bottom: 3, left: 4 },
					safeArea: { top: 5, right: 0, bottom: 5, left: 0 },
				}),
			),
		).toEqual([]);
	});

	test("refuses a negative inset", () => {
		expect(codes(card({ bleed: -1 }))).toEqual([["/bleed", "invalid_inset"]]);
		expect(
			codes(card({ safeArea: { top: 1, right: -2, bottom: 0, left: 0 } })),
		).toEqual([["/safeArea/right", "invalid_inset"]]);
	});

	test("refuses a partial per-side inset", () => {
		expect(codes(card({ bleed: { top: 1 } as never }))).not.toEqual([]);
	});

	test("refuses a safe area that leaves no room inside the trim", () => {
		expect(codes(card({ safeArea: 30 }))).toEqual([
			["/safeArea", "safe_area_exceeds_trim"],
		]);
		expect(
			codes(card({ safeArea: { top: 0, right: 60, bottom: 0, left: 40 } })),
		).toEqual([["/safeArea", "safe_area_exceeds_trim"]]);
		expect(codes(card({ safeArea: 29 }))).toEqual([]);
	});

	test("a bleed may be wider than the safe area allows", () => {
		expect(codes(card({ bleed: 80 }))).toEqual([]);
	});

	test("resolves to sides", () => {
		expect(templateBleed(card())).toEqual({
			top: 0,
			right: 0,
			bottom: 0,
			left: 0,
		});
		expect(templateSafeArea(card({ safeArea: 3 }))).toEqual({
			top: 3,
			right: 3,
			bottom: 3,
			left: 3,
		});
		expect(
			bleedSize(card({ bleed: { top: 1, right: 2, bottom: 3, left: 4 } })),
		).toEqual({ width: 106, height: 64 });
	});
});

describe("extendIntoBleed", () => {
	const trim = { width: 100, height: 60 };
	const bleed = { top: 2, right: 3, bottom: 4, left: 5 };

	test("grows a layer on each side it runs to", () => {
		const [full, corner, inside] = extendIntoBleed(
			[
				rect("full", 0, 0, 100, 60),
				rect("corner", 50, 30, 50, 30),
				rect("in", 10, 10, 20, 20),
			],
			trim,
			bleed,
		);
		expect([full?.pos, full?.size]).toEqual([
			{ x: -5, y: -2 },
			{ width: 108, height: 66 },
		]);
		expect([corner?.pos, corner?.size]).toEqual([
			{ x: 50, y: 30 },
			{ width: 53, height: 34 },
		]);
		expect([inside?.pos, inside?.size]).toEqual([
			{ x: 10, y: 10 },
			{ width: 20, height: 20 },
		]);
	});

	test("leaves stroked, rotated, text and overhanging layers alone", () => {
		const text = {
			id: "text",
			type: "text",
			pos: { x: 0, y: 0 },
			size: { width: 100, height: 20 },
			properties: {
				spans: [{ text: "Hi" }],
				font: { family: "Inter", size: 12 },
				color: "#000",
			},
		} as unknown as Element;
		const input = [
			rect("stroked", 0, 0, 100, 60, { stroke: { color: "#000", width: 1 } }),
			{ ...rect("rotated", 0, 0, 100, 60), rotation: 90 },
			text,
			rect("over", -10, -10, 120, 80),
		];
		expect(extendIntoBleed(input, trim, bleed)).toEqual(input);
	});

	test("a frame's children keep their place on the card", () => {
		const frame = {
			id: "frame",
			type: "frame",
			pos: { x: 0, y: 0 },
			size: { width: 100, height: 30 },
			properties: { fill: "#fff", children: [rect("child", 10, 10, 5, 5)] },
		} as Element;
		const [grown] = extendIntoBleed([frame], trim, bleed);
		expect(grown?.pos).toEqual({ x: -5, y: -2 });
		expect(grown?.size).toEqual({ width: 108, height: 32 });
		if (grown?.type !== "frame") throw new Error("not a frame");
		expect(grown.properties.children[0]?.pos).toEqual({ x: 15, y: 12 });
	});

	test("no bleed returns the same array", () => {
		const input = [rect("full", 0, 0, 100, 60)];
		expect(
			extendIntoBleed(input, trim, { top: 0, right: 0, bottom: 0, left: 0 }),
		).toBe(input);
	});
});

describe("compile with bleed", () => {
	const bled = card({ bleed: { top: 2, right: 3, bottom: 4, left: 5 } }, [
		rect("full", 0, 0, 100, 60),
		rect("dot", 10, 10, 5, 5),
	]);

	test("without the option the scene is the trim alone", () => {
		const plain = card({}, bled.template_data[0]?.elements);
		expect(compile(bled, {}, { width: 200, height: 120 })).toEqual(
			compile(plain, {}, { width: 200, height: 120 }),
		);
	});

	test("the option does nothing on a template without bleed", () => {
		const plain = card({}, bled.template_data[0]?.elements);
		expect(
			compile(plain, {}, { width: 200, height: 120, bleed: true }),
		).toEqual(compile(plain, {}, { width: 200, height: 120 }));
	});

	test("grows the scene and places the trim inside it", () => {
		const out = compile(bled, {}, { width: 200, height: 120, bleed: true });
		expect([out.width, out.height]).toEqual([216, 132]);
		expect(out.trim).toEqual({ x: 10, y: 4, width: 200, height: 120 });
		const root = out.frames[0]?.root as GroupNode;
		expect(root.size).toEqual({ width: 216, height: 132 });
		const [bg, full, dot] = root.children as Node[];
		expect([bg?.pos, bg?.size]).toEqual([
			{ x: 0, y: 0 },
			{ width: 216, height: 132 },
		]);
		expect([full?.pos, full?.size]).toEqual([
			{ x: 0, y: 0 },
			{ width: 216, height: 132 },
		]);
		expect([dot?.pos, dot?.size]).toEqual([
			{ x: 30, y: 24 },
			{ width: 10, height: 10 },
		]);
	});

	test("follows a resize", () => {
		const out = compile(
			card({ bleed: 10 }),
			{},
			{
				width: 400,
				height: 400,
				resize: { width: 60, height: 60 },
				bleed: true,
			},
		);
		expect([out.width, out.height]).toEqual([
			400 + (20 * 400) / 60,
			400 + (20 * 400) / 60,
		]);
	});
});

describe("render with bleed", () => {
	test("paints the bleed and reports where the trim is", async () => {
		const ck = await loadCanvasKit();
		const template = card({ bleed: 5 }, [rect("dot", 0, 0, 10, 10)]);
		const run = async (bleed?: boolean) =>
			renderTemplate(
				await createRenderer({ ck, cache: false }),
				template,
				{},
				{
					width: 100,
					height: 60,
					bleed,
					exports: [{ constraint: { kind: "scale", value: 2 } }],
				},
			);

		const [trimOnly] = await run();
		expect([trimOnly?.width, trimOnly?.height, trimOnly?.trim]).toEqual([
			200,
			120,
			undefined,
		]);

		const [withBleed] = await run(true);
		if (!withBleed) throw new Error("no result");
		expect([withBleed.width, withBleed.height]).toEqual([220, 140]);
		expect(withBleed.trim).toEqual({ x: 10, y: 10, width: 200, height: 120 });
		const px = decodePixels(ck, withBleed.bytes);
		if (!px) throw new Error("decode failed");
		const at = (x: number, y: number) => [
			...px.data.subarray((y * px.width + x) * 4, (y * px.width + x) * 4 + 3),
		];
		// The dot ran to the top-left edge, so it fills that corner of the bleed.
		expect(at(1, 1)).toEqual([0, 0, 255]);
		expect(at(215, 135)).toEqual([255, 0, 0]);
	});
});

describe("print size in millimetres", () => {
	test("is the pixels at the DPI in millimetres", () => {
		const card = cardSizeMm(1200, 900, 300);
		expect(card.widthMm).toBeCloseTo(101.6, 9);
		expect(card.heightMm).toBeCloseTo(76.2, 9);
		const bleed = bleedMm({ top: 30, right: 60, bottom: 30, left: 0 }, 300);
		expect(bleed.top).toBeCloseTo(2.54, 9);
		expect(bleed.right).toBeCloseTo(5.08, 9);
		expect(bleed.left).toBe(0);
	});
});
