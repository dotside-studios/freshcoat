import { describe, expect, test } from "bun:test";
import { fixtures } from "../fixtures";
import { isPrintedCard, printGuideMetrics, printGuidesFor } from "../src/bleed";
import { imageDpiHints, safeAreaHints, templateHints } from "../src/hints";
import { effectiveImageDpi } from "../src/image-dpi";
import type { Element, Template } from "../src/types";

function card(
	extra: Partial<Template> = {},
	elements: Element[] = [],
): Template {
	return {
		format_version: "1.6",
		id: "t",
		name: "T",
		width: 1012,
		height: 638,
		fields: { type: "object", properties: {} },
		template_data: [
			{
				name: "front",
				background: { id: "bg", type: "rect", properties: { fill: "#fff" } },
				elements,
			},
		],
		...extra,
	} as Template;
}

const rect = (id: string, x: number, y: number, w: number, h: number) =>
	({
		id,
		type: "rect",
		pos: { x, y },
		size: { width: w, height: h },
		properties: { fill: "#0000ff" },
	}) as Element;

describe("print guides", () => {
	test("scale with the template's long side", () => {
		const m = printGuideMetrics({ width: 1012, height: 638 });
		expect(m.corner).toBeCloseTo(37.6, 1);
		expect(m.safe).toBeCloseTo(35.47, 1);
		expect(printGuideMetrics({ width: 638, height: 1012 })).toEqual(m);
	});

	test("give a CR80 card the printer's safe area unless it sets its own", () => {
		const printed = card({ product: "card_cr80" });
		expect(isPrintedCard(printed)).toBe(true);
		expect(printGuidesFor(printed).safe?.left).toBeCloseTo(35.47, 1);
		expect(printGuidesFor({ ...printed, safeArea: 10 }).safe?.left).toBe(10);
		expect(printGuidesFor(card()).safe).toBeNull();
		expect(printGuidesFor(card()).corner).toBe(0);
	});
});

describe("templateHints", () => {
	test("a clean template has none", () => {
		expect(templateHints(fixtures.minimalCard)).toEqual([]);
	});

	test("lists layers inside the template's safe area with their data", () => {
		const t = card({ safeArea: 40 }, [
			rect("near", 10, 100, 100, 50),
			rect("clear", 100, 100, 100, 50),
			rect("bleed", -10, -10, 1032, 658),
		]);
		expect(templateHints(t)).toEqual([
			{
				kind: "safe_area",
				side: 0,
				sideName: "front",
				index: 0,
				id: "near",
				edges: ["left"],
				safe: { top: 40, right: 40, bottom: 40, left: 40 },
			},
		]);
	});

	test("checks a CR80 card without a safe area against the printer's", () => {
		const t = card({ product: "card_cr80" }, [rect("near", 10, 100, 100, 50)]);
		const hints = safeAreaHints(t);
		expect(hints.map((h) => [h.id, h.edges])).toEqual([["near", ["left"]]]);
		expect(safeAreaHints(card({}, [rect("near", 10, 100, 100, 50)]))).toEqual(
			[],
		);
	});

	test("lists an open path set as a slice piece, not a cut line or a closed one", () => {
		const vector = (id: string, d: string, slice: object, extra = {}) =>
			({
				id,
				type: "vector",
				pos: { x: 0, y: 0 },
				size: { width: 40, height: 30 },
				properties: { d, slice, ...extra },
			}) as Element;
		const t = card({ format_version: "1.7" }, [
			vector("fold", "M0 1 L40 1", { output: "none", edge: "score" }),
			vector("loop", "M0 0 L9 0 L9 9 Z", {}),
			vector("bad", "M0 1 L40 1", {}),
			vector("worse", "M0 0 L9 0 L9 9 Z M20 0 L30 0", { output: "piece" }),
			vector(
				"live",
				"M0 1 L40 1",
				{},
				{ boolean: { op: "union", operands: [] } },
			),
		]);
		expect(templateHints(t)).toEqual([
			{ kind: "slice_open_piece", side: 0, sideName: "front", id: "bad" },
			{ kind: "slice_open_piece", side: 0, sideName: "front", id: "worse" },
		]);
	});

	test("reports variant issues as they are", () => {
		const t = card({
			variants: [
				{
					id: "v",
					label: "V",
					overrides: [
						{ side: "front", elements: [{ id: "gone", properties: {} }] },
					],
				},
			],
		} as never);
		const hints = templateHints(t);
		expect(hints.map((h) => h.kind)).toEqual(["variant"]);
	});

	test("reports a format newer than read and one declared too low", () => {
		expect(templateHints(card({ format_version: "1.99" }))).toEqual([
			{ kind: "format_newer", declared: "1.99" },
		]);
		const low = templateHints(card({ format_version: "1.0" }));
		expect(low).toEqual([
			{ kind: "format_low", declared: "1.0", needed: expect.any(String) },
		]);
	});
});

function pngHeader(width: number, height: number): string {
	const b = new Uint8Array(33);
	b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
	b.set([0x49, 0x48, 0x44, 0x52], 12);
	const v = new DataView(b.buffer);
	v.setUint32(16, width);
	v.setUint32(20, height);
	b.set([8, 2, 0, 0, 0], 24);
	return Buffer.from(b).toString("base64");
}

const image = (
	id: string,
	src: string,
	w: number,
	h: number,
	props: Record<string, unknown> = {},
) =>
	({
		id,
		type: "image",
		pos: { x: 0, y: 0 },
		size: { width: w, height: h },
		properties: { src, fit: "fill", ...props },
	}) as Element;

describe("effectiveImageDpi", () => {
	test("is source pixels over the inches they cover", () => {
		const dpi = effectiveImageDpi(
			{ width: 600, height: 400 },
			{ width: 900, height: 600 },
			300,
			{ fit: "fill" },
		);
		expect(dpi).toBeCloseTo(200);
	});

	test("takes the axis with fewer pixels to the inch", () => {
		expect(
			effectiveImageDpi(
				{ width: 600, height: 1200 },
				{ width: 900, height: 600 },
				300,
				{ fit: "fill" },
			),
		).toBeCloseTo(200);
	});

	test("counts only the source a crop or a cover keeps", () => {
		const placed = { width: 300, height: 300 };
		const pixels = { width: 1200, height: 600 };
		expect(
			effectiveImageDpi(pixels, placed, 300, { fit: "cover" }),
		).toBeCloseTo(600);
		expect(
			effectiveImageDpi(pixels, placed, 300, { fit: "contain" }),
		).toBeCloseTo(1200);
		expect(
			effectiveImageDpi(pixels, placed, 300, {
				fit: "fill",
				crop: { x: 0, y: 0, width: 0.25, height: 0.5 },
			}),
		).toBeCloseTo(300);
	});

	test("draws a tile one pixel to the unit", () => {
		expect(
			effectiveImageDpi(
				{ width: 10, height: 10 },
				{ width: 900, height: 600 },
				300,
				{ fit: "tile" },
			),
		).toBe(300);
	});
});

describe("imageDpiHints", () => {
	const sha = "a".repeat(64);
	const withAsset = (elements: Element[]) =>
		card(
			{
				assets: [
					{
						sha256: sha,
						base64: pngHeader(600, 400),
						contentType: "image/png",
					},
				],
			},
			elements,
		);

	test("flags a 600 px image placed 3 in wide at 300 DPI as about 200", () => {
		const t = withAsset([image("photo", `asset:${sha}`, 900, 600)]);
		expect(templateHints(t)).toEqual([
			{
				kind: "image_dpi",
				side: 0,
				sideName: "front",
				id: "photo",
				src: `asset:${sha}`,
				dpi: 200,
				min: 300,
			},
		]);
	});

	test("follows the export DPI and the threshold", () => {
		const t = withAsset([image("photo", `asset:${sha}`, 900, 600)]);
		expect(imageDpiHints(t, { min: 150 })).toEqual([]);
		expect(imageDpiHints(t, { dpi: 600 })).toEqual([]);
		expect(imageDpiHints(t, { min: 0 })).toEqual([]);
		expect(imageDpiHints(t, { dpi: 150 })[0]?.dpi).toBe(100);
	});

	test("reads data URIs, nested layers and sizes the caller gives", () => {
		const t = card({}, [
			{
				id: "group",
				type: "frame",
				pos: { x: 0, y: 0 },
				size: { width: 1012, height: 638 },
				properties: {
					children: [
						image(
							"inline",
							`data:image/png;base64,${pngHeader(100, 100)}`,
							300,
							300,
						),
						image("file", "photo.jpg", 300, 300),
						image("unknown", "other.jpg", 300, 300),
					],
				},
			} as Element,
		]);
		const hints = imageDpiHints(t, {
			pixelSize: (src) =>
				src === "photo.jpg" ? { width: 200, height: 200 } : undefined,
		});
		expect(hints.map((h) => [h.id, h.dpi])).toEqual([
			["inline", 100],
			["file", 200],
		]);
	});

	test("leaves images bound to a field to the render", () => {
		const t = card({}, [image("photo", "{{photo}}", 900, 600)]);
		expect(
			imageDpiHints(t, { pixelSize: () => ({ width: 1, height: 1 }) }),
		).toEqual([]);
	});
});
