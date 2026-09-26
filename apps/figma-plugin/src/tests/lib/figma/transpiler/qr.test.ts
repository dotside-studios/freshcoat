import { describe, expect, it } from "vitest";
import { parseQrLayerName, transpileQr } from "~/lib/figma/transpiler/qr";
import type { FigmaRectangleNode } from "~/lib/figma/types";

const FRAME = { x: 0, y: 0, width: 1000, height: 600 };

const baseQr = (name: string): FigmaRectangleNode => ({
	id: "1:5",
	name,
	type: "RECTANGLE",
	visible: true,
	opacity: 1,
	blendMode: "NORMAL",
	absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
	fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
});

describe("parseQrLayerName", () => {
	it("parses bare value", () => {
		expect(parseQrLayerName("qr:hello")).toEqual({
			value: "hello",
			options: {},
		});
	});

	it("parses templated value", () => {
		expect(parseQrLayerName("qr:{{link}}")).toEqual({
			value: "{{link}}",
			options: {},
		});
	});

	it("parses options after first ;", () => {
		expect(
			parseQrLayerName("qr:{{link}};ec=H;fg=#000;bg=transparent;margin=4"),
		).toEqual({
			value: "{{link}}",
			options: { ec: "H", fg: "#000", bg: "transparent", margin: "4" },
		});
	});

	it("returns null on non-qr names", () => {
		expect(parseQrLayerName("plain rect")).toBeNull();
	});
});

describe("transpileQr", () => {
	// Field registration is covered centrally (binding.test / harvest.test); these
	// assert the rendered QR element only.
	it("emits a static QR element", () => {
		const el = transpileQr(baseQr("qr:https://davi.social"), {
			frame: FRAME,
			scale: 1,
		});
		expect(el).toEqual({
			id: el.id,
			type: "qr_code",
			pos: { x: 0, y: 0 },
			size: { width: 100, height: 100 },
			properties: {
				value: "https://davi.social",
				foreground: "#ffffff",
				background: "transparent",
			},
		});
	});

	it("draws the modules in the placeholder layer's own colour", () => {
		// Without this the QR is always coatfile's black, so a white QR drawn
		// for a dark card exports invisible — and a colorway that recolours only
		// the QR emits no override, since neither side has a foreground to differ
		// on.
		const node = baseQr("qr:{{link}}");
		node.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }];
		expect(
			transpileQr(node, { frame: FRAME, scale: 1 }).properties,
		).toMatchObject({ foreground: "#000000" });
	});

	it("leaves the foreground alone when the layer has no single solid paint", () => {
		const node = baseQr("qr:{{link}}");
		node.fills = [];
		expect(
			transpileQr(node, { frame: FRAME, scale: 1 }).properties.foreground,
		).toBeUndefined();
	});

	it("applies parsed options", () => {
		const el = transpileQr(
			baseQr("qr:{{link}};ec=H;fg=#000;bg=transparent;margin=4"),
			{ frame: FRAME, scale: 1 },
		);
		expect(el.properties).toMatchObject({
			value: "{{link}}",
			errorCorrection: "H",
			// `fg=` is the author overriding the layer's own white paint.
			foreground: "#000",
			background: "transparent",
			margin: 4,
		});
	});
});
