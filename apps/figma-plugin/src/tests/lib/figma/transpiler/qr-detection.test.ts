import { describe, expect, it, vi } from "vitest";
import {
	type ProductRegistryEntry,
	transpile,
} from "~/lib/figma/transpiler/index";
import type { FigmaContainerNode } from "~/lib/figma/types";

const PRODUCT: ProductRegistryEntry = {
	sku: "card_cr80",
	displayName: "CR80 Card",
	width: 1017,
	height: 639,
	frames: [{ name: "front", label: "Front", required: true }],
};

const base = {
	visible: true as const,
	opacity: 1,
	blendMode: "NORMAL" as const,
	effects: [],
};

function run(child: FigmaContainerNode["children"][number]) {
	const frame: FigmaContainerNode = {
		...base,
		id: "f:1",
		name: "Front",
		type: "FRAME",
		absoluteBoundingBox: { x: 0, y: 0, width: 1017, height: 639 },
		children: [child],
		fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
	};
	return transpile({
		product: PRODUCT,
		picks: {
			front: {
				fileKey: "FK",
				nodeId: "f:1",
				nodeName: "Front",
				width: 1017,
				height: 639,
			},
		},
		metadata: { id: "t", name: "T", version: "1.0.0", formatVersion: "1.0" },
		fetchNodeTree: vi.fn(async () => frame),
		renderImage: vi.fn(),
	});
}

describe("transpile (qr: detection is type-agnostic)", () => {
	it("emits a qr_code element + registers the field for a non-rectangle qr: layer", async () => {
		// A drawn QR graphic (VECTOR) named qr:{{link}} — the way a designer
		// would naturally do it. Must still become a generated QR field.
		const vectorQr = {
			...base,
			id: "v:1",
			name: "qr:{{link}}",
			type: "VECTOR" as const,
			absoluteBoundingBox: { x: 100, y: 100, width: 120, height: 120 },
			fillGeometry: [{ path: "M0,0 L10,10 Z" }],
			fills: [],
		};
		const result = await run(vectorQr);
		const els = (
			result.template as {
				template_data: Array<{
					elements: Array<{ type: string; properties: { value?: string } }>;
				}>;
			}
		).template_data[0].elements;
		const qr = els.find((e) => e.type === "qr_code");
		expect(qr).toBeDefined();
		expect(qr?.properties.value).toBe("{{link}}");
		expect(result.fieldsInferred.map((f) => f.id)).toContain("link");
	});

	it("warns (does not silently drop) when a qr: layer is hidden", async () => {
		const hiddenQr = {
			...base,
			id: "r:1",
			name: "qr:test",
			type: "RECTANGLE" as const,
			visible: false,
			absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
			fills: [],
		};
		const result = await run(hiddenQr);
		const warn = result.warnings.find((w) => w.code === "qr_layer_hidden");
		expect(warn).toBeDefined();
		expect(warn?.severity).toBe("warn");
	});
});
