import { describe, expect, test } from "bun:test";
import type { PathNode, RectNode } from "@freshcoat-js/engine";
import { createRenderer } from "@freshcoat-js/engine";
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { compile } from "../src/compile";
import { minimumFormatVersion } from "../src/format";
import { renderCompiledPdf } from "../src/render";
import type { Template } from "../src/types";
import { validate } from "../src/validate";

const stops = [
	{ offset: 0, color: "#ff0000" },
	{ offset: 1, color: "#0000ff" },
];

function withLayers(...elements: unknown[]): Template {
	return {
		format_version: "1.7",
		id: "s",
		name: "S",
		width: 100,
		height: 60,
		fields: { type: "object", properties: {} },
		template_data: [
			{
				name: "front",
				background: { id: "bg", type: "rect", properties: { fill: "#fff" } },
				elements: elements as never,
			},
		],
	};
}

const rect = (properties: Record<string, unknown>) => ({
	id: "r",
	type: "rect",
	pos: { x: 10, y: 10 },
	size: { width: 80, height: 40 },
	properties,
});

const vector = (properties: Record<string, unknown>) => ({
	id: "v",
	type: "vector",
	pos: { x: 0, y: 0 },
	size: { width: 100, height: 60 },
	properties: { d: "M0 0 L100 60", ...properties },
});

const codes = (t: Template) => {
	const r = validate(t);
	return r.ok ? [] : r.errors.map((e) => [e.code, e.path]);
};

const compiled = (t: Template) => compile(t, {}, { width: 100, height: 60 });

describe("spot validation", () => {
	test("accepts a spot fill and stroke on rects and vectors", () => {
		const white = { spot: "White", tint: 1, alt: "#ffffff", overprint: true };
		expect(
			codes(
				withLayers(
					rect({ fill: "#eee", spot: { fill: white } }),
					vector({
						stroke: { color: "#000", width: 1 },
						spot: { stroke: { spot: "Gold Foil" } },
					}),
				),
			),
		).toEqual([]);
	});

	test("rejects an empty or reserved name, a bad alt and a tint past 1", () => {
		expect(
			codes(
				withLayers(
					rect({ spot: { fill: { spot: " " }, stroke: { spot: "All" } } }),
				),
			),
		).toEqual([
			["invalid_spot", "/template_data/0/elements/0/properties/spot/fill/spot"],
			[
				"invalid_spot",
				"/template_data/0/elements/0/properties/spot/stroke/spot",
			],
		]);
		expect(
			codes(withLayers(rect({ spot: { fill: { spot: "W", alt: "nope" } } }))),
		).toEqual([
			["invalid_spot", "/template_data/0/elements/0/properties/spot/fill/alt"],
		]);
		expect(
			codes(
				withLayers(rect({ spot: { fill: { spot: "W", tint: 2 } } })),
			)[0]?.[0],
		).toBe("invalid_shape");
	});

	test("needs format 1.7", () => {
		const t = withLayers(rect({ spot: { fill: { spot: "White" } } }));
		expect(minimumFormatVersion({ ...t, format_version: "1.0" })).toBe("1.7");
	});
});

describe("spot compile", () => {
	test("a spot fill paints one solid of its alt, defaulting tint and overprint", () => {
		const t = withLayers(
			rect({
				fill: [{ kind: "linear", angle: 0, stops }, "#00ff00"],
				spot: { fill: { spot: "Varnish", alt: "#cccccc" } },
			}),
		);
		const node = compiled(t).frames[0].root.children[1] as RectNode;
		expect(node.fills).toEqual([
			{
				kind: "solid",
				color: "#cccccc",
				spot: { name: "Varnish", tint: 1, overprint: false },
			},
		]);
	});

	test("without an alt, a spot fill keeps the layer's lead colour", () => {
		const t = withLayers(
			rect({
				fill: { kind: "linear", angle: 0, stops },
				spot: { fill: { spot: "White", tint: 0.4, overprint: true } },
			}),
		);
		const node = compiled(t).frames[0].root.children[1] as RectNode;
		expect(node.fills).toEqual([
			{
				kind: "solid",
				color: "#ff0000",
				spot: { name: "White", tint: 0.4, overprint: true },
			},
		]);
	});

	test("a spot stroke drops its gradient and leaves the fill alone", () => {
		const t = withLayers(
			vector({
				fill: "#123456",
				stroke: { color: { kind: "linear", angle: 0, stops }, width: 2 },
				spot: { stroke: { spot: "Foil", alt: "#d4af37" } },
			}),
		);
		const node = compiled(t).frames[0].root.children[1] as PathNode;
		expect(node.fills).toEqual([{ kind: "solid", color: "#123456" }]);
		expect(node.stroke?.gradient).toBeUndefined();
		expect(node.stroke?.color).toBe("#d4af37");
		expect(node.stroke?.spot).toEqual({
			name: "Foil",
			tint: 1,
			overprint: false,
		});
	});
});

describe("spot PDF", () => {
	test("draws the layer in a Separation that overprints", async () => {
		const renderer = await createRenderer({ ck: await loadCanvasKit() });
		const t = withLayers(
			rect({
				fill: "#ffffff",
				spot: { fill: { spot: "White", alt: "#f0f0f0", overprint: true } },
			}),
		);
		const [page] = await renderCompiledPdf(renderer, compiled(t), { dpi: 72 });
		const body = new TextDecoder("latin1").decode(page?.bytes);
		expect(page?.warnings).toEqual([]);
		expect(body).toContain("[/Separation /White /DeviceRGB");
		expect(body).toMatch(/<<\/OP true \/op true \/OPM 1>>/);
	});
});
