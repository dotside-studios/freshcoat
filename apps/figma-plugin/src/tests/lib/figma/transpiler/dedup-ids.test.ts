import { describe, expect, it, vi } from "vitest";
import {
	type ProductRegistryEntry,
	transpile,
} from "~/lib/figma/transpiler/index";
import type { FigmaContainerNode } from "~/lib/figma/types";

// Figma defaults every vector/rect/frame to a type-name ("Vector", "Rectangle")
// and the transpiler slugs the node name into the element id — so a frame with
// several same-named nodes used to emit duplicate element ids, which
// coatfile's `validate` rejects (and the canvas preview swallows).

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

const rectNode = (id: string): FigmaContainerNode["children"][number] => ({
	...base,
	id,
	name: "Box", // same name for every rect → same slugged id
	type: "RECTANGLE" as const,
	absoluteBoundingBox: { x: 64, y: 64, width: 100, height: 100 },
	fills: [],
});

describe("transpile (duplicate element ids)", () => {
	it("makes element ids unique within a frame", async () => {
		const frame: FigmaContainerNode = {
			...base,
			id: "f:1",
			name: "Front",
			type: "FRAME",
			absoluteBoundingBox: { x: 0, y: 0, width: 1017, height: 639 },
			children: [rectNode("r:1"), rectNode("r:2"), rectNode("r:3")],
			fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
		};
		const fetchNodeTree = vi.fn(async () => frame);

		const result = await transpile({
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
			fetchNodeTree,
			renderImage: vi.fn(),
		});

		const tmpl = result.template as {
			template_data: Array<{ elements: Array<{ id: string }> }>;
		};
		const ids = tmpl.template_data[0].elements.map((e) => e.id);
		expect(ids).toEqual(["Box", "Box_2", "Box_3"]);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
