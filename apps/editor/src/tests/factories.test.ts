import type { Template } from "@freshcoat/coatfile";
import { validate } from "@freshcoat/coatfile";
import { describe, expect, test } from "vitest";
import {
	barcodeBoxFor,
	createElement,
	defaultRect,
	type ElementKind,
	ellipsePath,
	isEllipseVector,
} from "../doc/factories";
import { newDocument, PRESETS } from "../doc/new-document";
import { insertElements, unwrap } from "../doc/ops";
import { frozenDoc } from "./doc-fixture";

const KINDS: ElementKind[] = [
	"rect",
	"ellipse",
	"text",
	"image",
	"qr",
	"barcode",
	"frame",
];

describe("createElement", () => {
	for (const kind of KINDS) {
		test(`${kind} validates once inserted`, () => {
			const t = frozenDoc();
			const el = createElement(
				kind,
				{ x: 10, y: 20, width: 30, height: 40 },
				t,
				0,
				{
					src: "https://example.com/a.png",
				},
			);
			expect(el.pos).toEqual({ x: 10, y: 20 });
			expect(el.size).toEqual({ width: 30, height: 40 });
			const r = unwrap(insertElements(t, { side: 0 }, 99, [el]));
			const v = validate(r.template);
			expect(v.ok ? [] : v.errors).toEqual([]);
			const empty = newDocument(PRESETS[0]);
			const fresh = unwrap(
				insertElements(empty, { side: 1 }, 0, [
					createElement(kind, { x: 0, y: 0, width: 5, height: 5 }, empty, 1),
				]),
			);
			expect(validate(fresh.template).ok).toBe(true);
		});
	}

	test("defaults", () => {
		const t = frozenDoc();
		const box = { x: 0, y: 0, width: 10, height: 10 };
		expect(createElement("rect", box, t, 0)).toMatchObject({
			id: "rect",
			type: "rect",
			properties: { fill: "#d9d9d9" },
		});
		expect(createElement("text", box, t, 0)).toMatchObject({
			type: "text",
			properties: {
				value: "Text",
				font: { family: "Inter", size: 32, weight: 400 },
				color: "#111111",
			},
		});
		const noFonts: Template = { ...t, fonts: undefined };
		expect(createElement("text", box, noFonts, 0)).toMatchObject({
			properties: { font: { family: "Vend Sans" } },
		});
		expect(createElement("image", box, t, 0, { src: "asset:x" })).toMatchObject(
			{
				type: "image",
				properties: { src: "asset:x", fit: "cover" },
			},
		);
		expect(createElement("qr", box, t, 0)).toMatchObject({
			id: "qr",
			type: "qr_code",
			properties: { value: "https://example.com", errorCorrection: "M" },
		});
		expect(createElement("barcode", box, t, 0)).toMatchObject({
			id: "barcode",
			type: "barcode",
			properties: { value: "FRESHCOAT", symbology: "code128" },
		});
		expect(createElement("frame", box, t, 0)).toMatchObject({
			id: "frame",
			properties: { fill: "#ffffff", children: [] },
		});
		expect(createElement("ellipse", box, t, 0)).toMatchObject({
			id: "ellipse",
			type: "vector",
			properties: { d: ellipsePath(10, 10), fill: "#d9d9d9" },
		});
	});

	test("ids are unique on the side", () => {
		const t = frozenDoc();
		const one = createElement(
			"rect",
			{ x: 0, y: 0, width: 1, height: 1 },
			t,
			0,
		);
		const t2 = unwrap(insertElements(t, { side: 0 }, 0, [one])).template;
		expect(
			createElement("rect", { x: 0, y: 0, width: 1, height: 1 }, t2, 0).id,
		).toBe("rect-2");
		expect(
			createElement("rect", { x: 0, y: 0, width: 1, height: 1 }, t2, 1).id,
		).toBe("rect");
	});

	test("the minimum size is 1×1", () => {
		const el = createElement(
			"rect",
			{ x: 0, y: 0, width: 0, height: -4 },
			frozenDoc(),
			0,
		);
		expect(el.size).toEqual({ width: 1, height: 1 });
	});
});

describe("defaultRect", () => {
	test("a click places a centred default box", () => {
		const t = { width: 1000, height: 600 };
		expect(defaultRect("rect", { x: 500, y: 300 }, t)).toEqual({
			x: 425,
			y: 225,
			width: 150,
			height: 150,
		});
		expect(
			defaultRect("rect", { x: 0, y: 0 }, { width: 2000, height: 2000 }).width,
		).toBe(200);
		expect(defaultRect("text", { x: 500, y: 300 }, t)).toEqual({
			x: 380,
			y: 276,
			width: 240,
			height: 48,
		});
	});
});

describe("ellipses", () => {
	test("ellipsePath is two arcs spanning the box", () => {
		expect(ellipsePath(200, 100)).toBe(
			"M0 50A100 50 0 1 0 200 50A100 50 0 1 0 0 50Z",
		);
		expect(ellipsePath(1 / 3, 1)).toBe(
			"M0 0.5A0.167 0.5 0 1 0 0.333 0.5A0.167 0.5 0 1 0 0 0.5Z",
		);
	});

	test("isEllipseVector matches its own size only", () => {
		const t = frozenDoc();
		const e = createElement(
			"ellipse",
			{ x: 0, y: 0, width: 80, height: 40 },
			t,
			0,
		);
		expect(isEllipseVector(e)).toBe(true);
		expect(isEllipseVector({ ...e, size: { width: 81, height: 40 } })).toBe(
			false,
		);
		expect(isEllipseVector({ ...e, size: undefined })).toBe(false);
		expect(
			isEllipseVector({
				...e,
				properties: { d: "M 0,20 A 40,20 0 1 0 80,20 A 40 20 0 1 0 0 20 z" },
			} as never),
		).toBe(true);
		expect(
			isEllipseVector({ ...e, properties: { d: "M0 0L80 40Z" } } as never),
		).toBe(false);
		expect(
			isEllipseVector(
				createElement("rect", { x: 0, y: 0, width: 80, height: 40 }, t, 0),
			),
		).toBe(false);
	});
});

describe("barcode boxes", () => {
	test("a click places a 360 × 120 Code 128, shrunk to fit a small artboard", () => {
		expect(
			defaultRect("barcode", { x: 500, y: 300 }, { width: 1000, height: 600 }),
		).toEqual({ x: 320, y: 240, width: 360, height: 120 });
		expect(
			defaultRect("barcode", { x: 100, y: 100 }, { width: 300, height: 200 }),
		).toEqual({ x: -20, y: 60, width: 240, height: 80 });
	});

	test("Data Matrix and Aztec square the box about its centre", () => {
		const box = { pos: { x: 10, y: 20 }, size: { width: 360, height: 120 } };
		expect(barcodeBoxFor(box, "code128", "datamatrix")).toEqual({
			pos: { x: 130, y: 20 },
			size: { width: 120, height: 120 },
		});
		expect(barcodeBoxFor(box, "pdf417", "aztec")?.size).toEqual({
			width: 120,
			height: 120,
		});
		const tall = { pos: { x: 0, y: 0 }, size: { width: 100, height: 300 } };
		expect(barcodeBoxFor(tall, "code128", "aztec")).toEqual({
			pos: { x: 0, y: 100 },
			size: { width: 100, height: 100 },
		});
	});

	test("leaving a square code for a 1D one restores a bar proportion about the centre", () => {
		const square = {
			pos: { x: 130, y: 20 },
			size: { width: 120, height: 120 },
		};
		for (const to of ["code128", "ean13", "upca", "code39", "itf14"] as const)
			expect(barcodeBoxFor(square, "datamatrix", to)).toEqual({
				pos: { x: 130, y: 60 },
				size: { width: 120, height: 40 },
			});
		expect(barcodeBoxFor(square, "aztec", "code128")?.size).toEqual({
			width: 120,
			height: 40,
		});
	});

	test("1D codes, PDF417 and a box already the right shape keep their box", () => {
		const box = { pos: { x: 0, y: 0 }, size: { width: 360, height: 120 } };
		for (const s of ["code128", "ean13", "itf14", "pdf417"] as const)
			expect(barcodeBoxFor(box, "code39", s)).toBeNull();
		const square = { pos: { x: 0, y: 0 }, size: { width: 50, height: 50 } };
		expect(barcodeBoxFor(square, "code128", "datamatrix")).toBeNull();
		expect(barcodeBoxFor(square, "aztec", "datamatrix")).toBeNull();
		// PDF417 is 2D and stretches, so it keeps whatever box it is given.
		expect(barcodeBoxFor(square, "datamatrix", "pdf417")).toBeNull();
		expect(barcodeBoxFor(box, "datamatrix", "code128")).toBeNull();
	});
});
