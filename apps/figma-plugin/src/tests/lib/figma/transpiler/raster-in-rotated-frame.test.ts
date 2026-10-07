import { describe, expect, it } from "vitest";
import {
	type ProductRegistryEntry,
	transpile,
} from "~/lib/figma/transpiler/index";
import type { FigmaContainerNode } from "~/lib/figma/types";

// A rotated frame with two children: a rect that draws first, and a layer that
// has to be rasterized (unsupported blend mode) drawing on top of it. Every
// number below is chosen so the answer is checkable by hand — see the
// assertions for the arithmetic.
//
//   slot 400×300, upright
//     panel  100×200 in its own space, rotated −90° → 200×100 at (50, 60)
//       under  RECTANGLE, native
//       over   RECTANGLE with a background blur → flattened, rendering at
//              (100, 80) 40×20 in world
const PRODUCT: ProductRegistryEntry = {
	sku: "test",
	displayName: "Test",
	width: 400,
	height: 300,
	frames: [{ name: "front", label: "Front", required: true }],
};

function buildTree(): FigmaContainerNode {
	return {
		id: "1:1",
		name: "front",
		type: "FRAME",
		visible: true,
		opacity: 1,
		blendMode: "NORMAL",
		absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 },
		absoluteTransform: [
			[1, 0, 0],
			[0, 1, 0],
		],
		fills: [],
		children: [
			{
				id: "1:2",
				name: "panel",
				type: "FRAME",
				visible: true,
				opacity: 1,
				blendMode: "PASS_THROUGH",
				width: 100,
				height: 200,
				absoluteBoundingBox: { x: 50, y: 60, width: 200, height: 100 },
				relativeTransform: [
					[0, 1, 50],
					[-1, 0, 160],
				],
				absoluteTransform: [
					[0, 1, 50],
					[-1, 0, 160],
				],
				fills: [],
				children: [
					{
						id: "1:3",
						name: "under",
						type: "RECTANGLE",
						visible: true,
						opacity: 1,
						blendMode: "NORMAL",
						width: 100,
						height: 200,
						absoluteBoundingBox: { x: 50, y: 60, width: 200, height: 100 },
						relativeTransform: [
							[1, 0, 0],
							[0, 1, 0],
						],
						absoluteTransform: [
							[0, 1, 50],
							[-1, 0, 160],
						],
						fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
					},
					{
						id: "1:4",
						name: "over",
						type: "RECTANGLE",
						visible: true,
						opacity: 1,
						blendMode: "NORMAL",
						effects: [
							{
								type: "LAYER_BLUR",
								blurType: "PROGRESSIVE",
								visible: true,
								radius: 4,
							},
						],
						width: 20,
						height: 40,
						absoluteBoundingBox: { x: 100, y: 80, width: 40, height: 20 },
						absoluteRenderBounds: { x: 100, y: 80, width: 40, height: 20 },
						relativeTransform: [
							[1, 0, 20],
							[0, 1, 60],
						],
						absoluteTransform: [
							[0, 1, 110],
							[-1, 0, 140],
						],
						fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 1, a: 1 } }],
					},
				],
			},
		],
	} as unknown as FigmaContainerNode;
}

async function run() {
	const out = await transpile({
		product: PRODUCT,
		sizeMode: "from-design",
		picks: {
			front: {
				fileKey: "f",
				nodeId: "1:1",
				nodeName: "front",
				width: 400,
				height: 300,
			},
		},
		metadata: { id: "t", name: "T", version: "1.0.0", formatVersion: "1.0" },
		fetchNodeTree: async () => buildTree(),
		renderImage: async () => ({
			blob: new Blob([new Uint8Array([1, 2, 3])]),
			sha256: "deadbeef",
			width: 40,
			height: 20,
		}),
	});
	type El = {
		id: string;
		pos: { x: number; y: number };
		size: { width: number; height: number };
		rotation?: number;
		properties: { children?: El[] };
	};
	const template = out.template as { template_data: Array<{ elements: El[] }> };
	const panel = template.template_data[0].elements[0];
	return { out, panel, children: panel.properties.children ?? [] };
}

describe("a rasterized layer inside a rotated frame", () => {
	it("stays a child of that frame, in the z-order its node had", async () => {
		const { children } = await run();
		// Hoisting the raster to the card instead would put it FIRST — the frame
		// element is only pushed once its whole subtree has been walked — burying
		// it under every sibling the frame draws.
		expect(children.map((c) => c.id)).toEqual(["under", "flatten_1_4"]);
	});

	it("carries the inverse of the frame's rotation", async () => {
		const { panel, children } = await run();
		expect(panel.rotation).toBe(-90);
		// The PNG's pixels are already world-upright (Figma baked the rotation in),
		// so the element has to undo what the painter will apply to the group.
		expect(children[1].rotation).toBe(90);
	});

	it("lands on the node's rendered bounds once the frame's rotation is applied", async () => {
		const { panel, children } = await run();
		const raster = children[1];
		expect(raster.size).toEqual({ width: 40, height: 20 });

		// Compose by hand: the raster's centre in the panel's box, then the
		// panel's own rotation about its centre.
		const centre = {
			x: panel.pos.x + raster.pos.x + raster.size.width / 2,
			y: panel.pos.y + raster.pos.y + raster.size.height / 2,
		};
		const panelCentre = {
			x: panel.pos.x + panel.size.width / 2,
			y: panel.pos.y + panel.size.height / 2,
		};
		// rotate(−90°): (x, y) → (y, −x) around the panel centre
		const world = {
			x: panelCentre.x + (centre.y - panelCentre.y),
			y: panelCentre.y - (centre.x - panelCentre.x),
		};
		// The raster is upright in world, so its box is centre ∓ half its size.
		expect(world.x - raster.size.width / 2).toBe(100);
		expect(world.y - raster.size.height / 2).toBe(80);
	});
});
