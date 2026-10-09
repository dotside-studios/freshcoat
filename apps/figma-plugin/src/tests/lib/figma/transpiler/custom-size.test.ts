import { compile, validate } from "@freshcoat-js/coatfile";
import { describe, expect, it, vi } from "vitest";
import { type TranspileInput, transpile } from "~/lib/figma/transpiler/index";
import type { FigmaContainerNode } from "~/lib/figma/types";
import { CUSTOM_PRODUCT_SKU, makeCustomProduct } from "~/main/product";

// The custom export path: no catalog product, no fixed print size. These sizes
// are deliberately ones no card product would ever declare — A4 at 300 DPI.
const A4_PORTRAIT: [number, number] = [2480, 3508];

function frameNode(
	id: string,
	width: number,
	height: number,
): FigmaContainerNode {
	return {
		id,
		name: id,
		type: "FRAME",
		visible: true,
		opacity: 1,
		blendMode: "NORMAL",
		absoluteBoundingBox: { x: 0, y: 0, width, height },
		children: [],
		fills: [],
	};
}

const META = {
	id: "completion-cert",
	name: "Completion Certificate",
	version: "1.0.0",
	formatVersion: "1.0",
};

/** One custom export: N frames, each its own measured size. */
function makeInput(
	sizes: Record<string, [number, number]>,
	seed: [number, number],
): TranspileInput {
	const names = Object.keys(sizes);
	const product = makeCustomProduct(names[0], seed[0], seed[1]);
	// makeCustomProduct declares a single slot; a multi-frame custom export
	// extends it, which is what the "all sides share a canvas" rule guards.
	product.frames = names.map((name) => ({ name, label: name, required: true }));
	return {
		product,
		sizeMode: "from-design",
		picks: Object.fromEntries(
			names.map((name) => [
				name,
				{
					fileKey: "FK",
					nodeId: name,
					nodeName: name,
					width: sizes[name][0],
					height: sizes[name][1],
				},
			]),
		),
		metadata: META,
		fetchNodeTree: async (_fileKey, nodeId) =>
			frameNode(nodeId, sizes[nodeId][0], sizes[nodeId][1]),
		renderImage: vi.fn(),
	};
}

describe("transpile (custom sizing)", () => {
	it("emits the design's own dims, not the product's", async () => {
		// Seed dims deliberately wrong — from-design mode must ignore them.
		const out = await transpile(
			makeInput({ certificate: A4_PORTRAIT }, [1012, 638]),
		);
		const t = out.template as { width: number; height: number };
		expect(t.width).toBe(2480);
		expect(t.height).toBe(3508);
	});

	it("carries the placeholder product sku", async () => {
		const out = await transpile(
			makeInput({ certificate: A4_PORTRAIT }, A4_PORTRAIT),
		);
		expect((out.template as { product: string }).product).toBe(
			CUSTOM_PRODUCT_SKU,
		);
	});

	it("rounds sub-pixel frame bounds", async () => {
		const out = await transpile(
			makeInput({ certificate: [2479.6, 3508.2] }, A4_PORTRAIT),
		);
		const t = out.template as { width: number; height: number };
		expect(t.width).toBe(2480);
		expect(t.height).toBe(3508);
	});

	it("emits a single template_data frame named after the picked node", async () => {
		const out = await transpile(
			makeInput({ certificate: A4_PORTRAIT }, A4_PORTRAIT),
		);
		const t = out.template as { template_data: Array<{ name: string }> };
		expect(t.template_data).toHaveLength(1);
		expect(t.template_data[0].name).toBe("certificate");
	});

	it("produces a template that validates and compiles at its native size", async () => {
		const out = await transpile(
			makeInput({ certificate: A4_PORTRAIT }, A4_PORTRAIT),
		);
		const v = validate(out.template);
		expect(v.ok).toBe(true);
		if (!v.ok) return;
		const compiled = compile(v.value, {}, { width: 2480, height: 3508 });
		expect(compiled.width).toBe(2480);
		expect(compiled.frames).toHaveLength(1);
	});

	it("rejects sides that disagree on the canvas", async () => {
		await expect(
			transpile(
				makeInput({ front: A4_PORTRAIT, back: [2480, 3000] }, A4_PORTRAIT),
			),
		).rejects.toThrow(/size_mismatch/i);
	});

	it("accepts multiple sides on the same canvas", async () => {
		const out = await transpile(
			makeInput({ front: A4_PORTRAIT, back: A4_PORTRAIT }, A4_PORTRAIT),
		);
		const t = out.template as {
			width: number;
			template_data: Array<{ name: string }>;
		};
		expect(t.width).toBe(2480);
		expect(t.template_data.map((f) => f.name)).toEqual(["front", "back"]);
	});
});
