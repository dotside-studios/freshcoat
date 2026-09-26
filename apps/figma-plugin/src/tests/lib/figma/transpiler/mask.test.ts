import { validate } from "@freshcoat/coatfile";
import { describe, expect, it } from "vitest";
import {
	type ProductRegistryEntry,
	transpile,
} from "~/lib/figma/transpiler/index";
import type { FigmaContainerNode, FigmaNode } from "~/lib/figma/types";
import { readBaseFields } from "~/main/read-scene-graph";

const PRODUCT: ProductRegistryEntry = {
	sku: "card_cr80",
	displayName: "CR80 Card",
	width: 1013,
	height: 638,
	frames: [{ name: "front", label: "Front", required: true }],
};

const base = { visible: true, opacity: 1, blendMode: "NORMAL" } as const;
const red = [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }];

const rect = (
	id: string,
	name: string,
	box: { x: number; y: number; width: number; height: number },
	extra: Record<string, unknown> = {},
): FigmaNode =>
	({
		...base,
		id,
		name,
		type: "RECTANGLE",
		absoluteBoundingBox: box,
		fills: red,
		...extra,
	}) as unknown as FigmaNode;

const ellipse = (extra: Record<string, unknown> = {}): FigmaNode =>
	({
		...base,
		id: "e",
		name: "Circle",
		type: "ELLIPSE",
		absoluteBoundingBox: { x: 100, y: 100, width: 50, height: 50 },
		fills: red,
		fillGeometry: [
			{
				path: "M0 25 A25 25 0 1 0 50 25 A25 25 0 1 0 0 25 Z",
				windingRule: "NONZERO",
			},
		],
		isMask: true,
		...extra,
	}) as unknown as FigmaNode;

async function run(children: FigmaNode[]) {
	const front: FigmaContainerNode = {
		...base,
		id: "front",
		name: "front",
		type: "FRAME",
		absoluteBoundingBox: { x: 0, y: 0, width: 1013, height: 638 },
		fills: [],
		children,
	};
	const out = await transpile({
		product: PRODUCT,
		picks: {
			front: {
				fileKey: "FK",
				nodeId: "front",
				nodeName: "Front",
				width: 1013,
				height: 638,
			},
		},
		metadata: { id: "t", name: "T", version: "1.0.0", formatVersion: "1.0" },
		fetchNodeTree: async () => front,
		renderImage: async () => ({
			blob: new Blob([new Uint8Array([1])]),
			sha256: "abc",
			width: 50,
			height: 50,
		}),
	});
	const template = out.template as unknown as {
		template_data: Array<{ elements: Array<Record<string, unknown>> }>;
	};
	return { template, elements: template.template_data[0].elements };
}

describe("transpile (Figma masks)", () => {
	const group = (children: FigmaNode[]): FigmaNode =>
		({
			...base,
			id: "g",
			name: "Mask group",
			type: "GROUP",
			absoluteBoundingBox: { x: 80, y: 80, width: 100, height: 100 },
			children,
		}) as unknown as FigmaNode;

	it("masks the layers above the mask layer, placed relative to its box", async () => {
		const { template, elements } = await run([
			group([
				rect("below", "below", { x: 80, y: 80, width: 10, height: 10 }),
				ellipse(),
				rect("photo", "photo", { x: 90, y: 90, width: 80, height: 80 }),
			]),
		]);
		expect(elements.map((e) => [e.id, e.type])).toEqual([
			["below", "rect"],
			["Circle_mask", "mask"],
		]);
		const mask = elements[1] as {
			pos: unknown;
			size: unknown;
			properties: {
				mask: Record<string, unknown>;
				children: Array<Record<string, unknown>>;
				channel?: string;
			};
		};
		expect(mask.pos).toEqual({ x: 100, y: 100 });
		expect(mask.size).toEqual({ width: 50, height: 50 });
		expect(mask.properties.mask).toMatchObject({
			type: "vector",
			pos: { x: 0, y: 0 },
		});
		expect(mask.properties.children).toMatchObject([
			{ id: "photo", pos: { x: -10, y: -10 } },
		]);
		expect(mask.properties.channel).toBeUndefined();
		expect(validate(template).ok).toBe(true);
	});

	it("a luminance mask keeps its channel", async () => {
		const { elements } = await run([
			ellipse({ maskType: "LUMINANCE" }),
			rect("photo", "photo", { x: 90, y: 90, width: 80, height: 80 }),
		]);
		expect(elements[0]).toMatchObject({
			type: "mask",
			properties: { channel: "luminance" },
		});
	});

	it("a mask shape that has to be rasterized becomes the bitmap", async () => {
		const { elements } = await run([
			ellipse({
				effects: [{ type: "BACKGROUND_BLUR", visible: true, radius: 4 }],
			}),
			rect("photo", "photo", { x: 90, y: 90, width: 80, height: 80 }),
		]);
		const mask = elements[0] as {
			properties: { mask: Record<string, unknown> };
		};
		expect(mask.properties.mask).toMatchObject({ type: "image" });
		expect(Array.isArray(mask.properties.mask)).toBe(false);
	});

	it("a later mask layer starts a new run", async () => {
		const { elements } = await run([
			ellipse(),
			rect("a", "a", { x: 100, y: 100, width: 10, height: 10 }),
			ellipse({ id: "e2", name: "Second" }),
			rect("b", "b", { x: 100, y: 100, width: 10, height: 10 }),
		]);
		expect(
			elements.map((e) => [
				e.id,
				(e.properties as { children: Array<{ id: string }> }).children.map(
					(c) => c.id,
				),
			]),
		).toEqual([
			["Circle_mask", ["a"]],
			["Second_mask", ["b"]],
		]);
	});

	it("a hidden mask layer masks nothing", async () => {
		const { elements } = await run([
			ellipse({ visible: false }),
			rect("photo", "photo", { x: 90, y: 90, width: 80, height: 80 }),
		]);
		expect(elements.map((e) => e.type)).toEqual(["rect"]);
	});
});

describe("readBaseFields (masks)", () => {
	it("reads isMask and a known maskType, and nothing for an ordinary layer", () => {
		const node = {
			id: "1",
			name: "m",
			isMask: true,
			maskType: "LUMINANCE",
		} as never;
		expect(readBaseFields(node)).toMatchObject({
			isMask: true,
			maskType: "LUMINANCE",
		});
		const plain = readBaseFields({ id: "2", name: "p" } as never);
		expect("isMask" in plain).toBe(false);
	});
});
