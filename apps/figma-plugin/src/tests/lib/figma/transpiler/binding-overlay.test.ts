import { describe, expect, it, vi } from "vitest";
import {
	type ProductRegistryEntry,
	transpile,
} from "~/lib/figma/transpiler/index";
import type { FigmaContainerNode, FigmaNode } from "~/lib/figma/types";

const PRODUCT: ProductRegistryEntry = {
	sku: "card_cr80",
	displayName: "CR80 Card",
	width: 1017,
	height: 639,
	frames: [
		{ name: "front", label: "Front", required: true },
		{ name: "back", label: "Back", required: true },
	],
};
const META = { id: "t", name: "T", version: "1.0.0", formatVersion: "1.0" };

function textChild(id: string, name: string, characters: string): FigmaNode {
	return {
		id,
		name,
		type: "TEXT",
		visible: true,
		opacity: 1,
		blendMode: "NORMAL",
		absoluteBoundingBox: { x: 40, y: 40, width: 400, height: 64 },
		relativeTransform: [
			[1, 0, 40],
			[0, 1, 40],
		],
		characters,
		style: {
			fontFamily: "Inter",
			fontSize: 32,
			fontWeight: 400,
			textAlignHorizontal: "LEFT",
			textAlignVertical: "TOP",
			textAutoResize: "NONE",
		},
		fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
	};
}

function rectChild(id: string, name: string): FigmaNode {
	return {
		id,
		name,
		type: "RECTANGLE",
		visible: true,
		opacity: 1,
		blendMode: "NORMAL",
		absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 120 },
		relativeTransform: [
			[1, 0, 0],
			[0, 1, 0],
		],
		fills: [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5, a: 1 } }],
	};
}

function front(): FigmaContainerNode {
	return {
		id: "1:1",
		name: "front",
		type: "FRAME",
		visible: true,
		opacity: 1,
		blendMode: "NORMAL",
		absoluteBoundingBox: { x: 0, y: 0, width: 1017, height: 639 },
		fills: [],
		children: [
			textChild("1:2", "color:{{brand}}", "Member"),
			rectChild("1:3", "color:{{bg}}"),
			textChild("1:4", "text:{{headline}}", "Hello World"),
		],
	};
}

function back(): FigmaContainerNode {
	return {
		id: "1:10",
		name: "back",
		type: "FRAME",
		visible: true,
		opacity: 1,
		blendMode: "NORMAL",
		absoluteBoundingBox: { x: 0, y: 0, width: 1017, height: 639 },
		fills: [],
		children: [],
	};
}

type Element = {
	type: string;
	properties: Record<string, unknown>;
};
type Template = {
	fields: { properties: Record<string, unknown>; required: string[] };
	template_data: Array<{ name: string; elements: Element[] }>;
};

async function run(): Promise<Template> {
	const fetchNodeTree = vi.fn(async (_k: string, id: string) =>
		id === "1:1" ? front() : back(),
	);
	const result = await transpile({
		product: PRODUCT,
		picks: {
			front: {
				fileKey: "FK",
				nodeId: "1:1",
				nodeName: "F",
				width: 1017,
				height: 639,
			},
			back: {
				fileKey: "FK",
				nodeId: "1:10",
				nodeName: "B",
				width: 1017,
				height: 639,
			},
		},
		metadata: META,
		fetchNodeTree,
		renderImage: vi.fn(),
	});
	return result.template as Template;
}

describe("binding overlay (transpile)", () => {
	it("color: on a text node templates its color and registers a color field", async () => {
		const t = await run();
		const els = t.template_data[0].elements;
		const colored = els.find((e) => e.properties.color === "{{brand}}");
		expect(colored?.type).toBe("text");
		// The visible sample text is preserved (only color is dynamic).
		expect(colored?.properties.value).toBe("Member");
		expect(t.fields.properties.brand).toMatchObject({
			type: "string",
			format: "color",
			title: "Brand",
		});
	});

	it("color: on a shape templates its fill", async () => {
		const t = await run();
		const els = t.template_data[0].elements;
		const rect = els.find(
			(e) => e.type === "rect" && e.properties.fill === "{{bg}}",
		);
		expect(rect).toBeTruthy();
		expect(t.fields.properties.bg).toMatchObject({ format: "color" });
	});

	it("text: marker templates the value and seeds default from the sample", async () => {
		const t = await run();
		const els = t.template_data[0].elements;
		const headline = els.find((e) => e.properties.value === "{{headline}}");
		expect(headline?.type).toBe("text");
		expect(t.fields.properties.headline).toMatchObject({
			type: "string",
			title: "Headline",
			default: "Hello World",
		});
	});

	it("all three fields are required", async () => {
		const t = await run();
		expect(t.fields.required).toEqual(
			expect.arrayContaining(["brand", "bg", "headline"]),
		);
	});
});

describe("stored field metadata overrides inferred", () => {
	async function runWithMeta(): Promise<Template> {
		const f: FigmaContainerNode = {
			...front(),
			fieldMeta: {
				brand: {
					id: "brand",
					format: "color",
					title: "Brand Color",
					required: false,
					source: "system",
					overridden: true,
				},
			},
		};
		const fetchNodeTree = vi.fn(async (_k: string, id: string) =>
			id === "1:1" ? f : back(),
		);
		const result = await transpile({
			product: PRODUCT,
			picks: {
				front: {
					fileKey: "FK",
					nodeId: "1:1",
					nodeName: "F",
					width: 1017,
					height: 639,
				},
				back: {
					fileKey: "FK",
					nodeId: "1:10",
					nodeName: "B",
					width: 1017,
					height: 639,
				},
			},
			metadata: META,
			fetchNodeTree,
			renderImage: vi.fn(),
		});
		return result.template as Template;
	}

	it("applies the edited title/source and respects required:false", async () => {
		const t = await runWithMeta();
		expect(t.fields.properties.brand).toMatchObject({
			title: "Brand Color",
			format: "color",
			"x-source": "system",
		});
		expect(t.fields.required).not.toContain("brand");
	});
});

describe("image: marker renders dynamic (not rasterized)", () => {
	it("produces a dynamic image element + image field from an image: marker", async () => {
		const imageRect: FigmaNode = {
			id: "1:6",
			name: "image:{{avatar}}",
			type: "RECTANGLE",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x: 0, y: 0, width: 120, height: 120 },
			relativeTransform: [
				[1, 0, 0],
				[0, 1, 0],
			],
			fills: [{ type: "IMAGE", scaleMode: "FILL", imageRef: "ref" }],
		};
		const f: FigmaContainerNode = { ...front(), children: [imageRect] };
		const fetchNodeTree = vi.fn(async (_k: string, id: string) =>
			id === "1:1" ? f : back(),
		);
		const result = await transpile({
			product: PRODUCT,
			picks: {
				front: {
					fileKey: "FK",
					nodeId: "1:1",
					nodeName: "F",
					width: 1017,
					height: 639,
				},
				back: {
					fileKey: "FK",
					nodeId: "1:10",
					nodeName: "B",
					width: 1017,
					height: 639,
				},
			},
			metadata: META,
			fetchNodeTree,
			renderImage: vi.fn(),
		});
		const t = result.template as Template;
		const el = t.template_data[0].elements[0];
		expect(el.type).toBe("image");
		expect(el.properties.src).toBe("{{avatar}}");
		expect(t.fields.properties.avatar).toMatchObject({ format: "image" });
	});
});

describe("non-text layer bound as text is ignored", () => {
	it("leaves the element as a shape and registers no field", async () => {
		const f: FigmaContainerNode = {
			...front(),
			children: [rectChild("1:5", "{{thing}}")],
		};
		const fetchNodeTree = vi.fn(async (_k: string, id: string) =>
			id === "1:1" ? f : back(),
		);
		const result = await transpile({
			product: PRODUCT,
			picks: {
				front: {
					fileKey: "FK",
					nodeId: "1:1",
					nodeName: "F",
					width: 1017,
					height: 639,
				},
				back: {
					fileKey: "FK",
					nodeId: "1:10",
					nodeName: "B",
					width: 1017,
					height: 639,
				},
			},
			metadata: META,
			fetchNodeTree,
			renderImage: vi.fn(),
		});
		const t = result.template as Template;
		const el = t.template_data[0].elements[0];
		expect(el.type).toBe("rect");
		expect(t.fields.properties.thing).toBeUndefined();
	});
});
