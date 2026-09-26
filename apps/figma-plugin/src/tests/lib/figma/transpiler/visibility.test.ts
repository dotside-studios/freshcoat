import { describe, expect, it } from "vitest";
import { parseVisibilityMarker } from "~/lib/figma/binding";
import {
	type ProductRegistryEntry,
	transpile,
} from "~/lib/figma/transpiler/index";
import type { FigmaContainerNode, FigmaNode } from "~/lib/figma/types";

describe("parseVisibilityMarker", () => {
	it("reads the three forms", () => {
		expect(parseVisibilityMarker("if:{{show_badge}}")).toEqual({
			field: "show_badge",
		});
		expect(parseVisibilityMarker("if: !{{ title }}")).toEqual({
			field: "title",
			not: true,
		});
		expect(parseVisibilityMarker("if:{{tier}}=gold")).toEqual({
			field: "tier",
			equals: "gold",
		});
		expect(parseVisibilityMarker('if:{{tier}}="Gold member"')).toEqual({
			field: "tier",
			equals: "Gold member",
		});
	});

	it("is not fooled by other names", () => {
		expect(parseVisibilityMarker("text:{{title}}")).toBeNull();
		expect(parseVisibilityMarker("if:title")).toBeNull();
		expect(parseVisibilityMarker("Gift if:{{x}}")).toBeNull();
	});
});

const PRODUCT: ProductRegistryEntry = {
	sku: "card_cr80",
	displayName: "CR80 Card",
	width: 1013,
	height: 638,
	frames: [{ name: "front", label: "Front", required: true }],
};

const base = {
	visible: true,
	opacity: 1,
	blendMode: "NORMAL",
} as const;

const rect = (id: string, name: string, x: number): FigmaNode =>
	({
		...base,
		id,
		name,
		type: "RECTANGLE",
		absoluteBoundingBox: { x, y: 10, width: 50, height: 50 },
		fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
	}) as unknown as FigmaNode;

const text = (id: string, name: string, characters: string): FigmaNode =>
	({
		...base,
		id,
		name,
		type: "TEXT",
		absoluteBoundingBox: { x: 10, y: 100, width: 200, height: 40 },
		characters,
		style: {
			fontFamily: "Arial",
			fontSize: 24,
			fontWeight: 400,
			textAlignHorizontal: "LEFT",
			textAlignVertical: "TOP",
			textAutoResize: "NONE",
			lineHeightPercentFontSize: 120,
		},
		fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
	}) as unknown as FigmaNode;

const group = (name: string, children: FigmaNode[]): FigmaNode =>
	({
		...base,
		id: "g",
		name,
		type: "GROUP",
		absoluteBoundingBox: { x: 10, y: 10, width: 200, height: 50 },
		children,
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
	return out.template as {
		fields: {
			properties: Record<string, Record<string, unknown>>;
			required: string[];
		};
		template_data: Array<{ elements: Array<Record<string, unknown>> }>;
	};
}

describe("transpile (if: layers)", () => {
	it("puts a group's condition on every element it flattens into", async () => {
		const t = await run([
			group("if:{{show_badge}}", [rect("r1", "a", 10), rect("r2", "b", 100)]),
			rect("r3", "always", 300),
		]);
		const els = t.template_data[0].elements;
		expect(els.map((e) => e.visibleWhen)).toEqual([
			{ field: "show_badge" },
			{ field: "show_badge" },
			undefined,
		]);
		expect(t.fields.properties.show_badge).toMatchObject({
			type: "string",
			format: "boolean",
		});
		expect(t.fields.required).not.toContain("show_badge");
	});

	it("hides a text layer while the field it renders is blank", async () => {
		const t = await run([text("t1", "if:{{title}}", "{{title}}")]);
		const [el] = t.template_data[0].elements;
		expect(el.visibleWhen).toEqual({ field: "title" });
		expect(t.fields.properties.title.format).toBeUndefined();
	});

	it("stacks nested conditions", async () => {
		const t = await run([
			group("if:{{show_badge}}", [
				group("if:!{{title}}", [rect("r1", "placeholder", 10)]),
			]),
		]);
		expect(t.template_data[0].elements[0].visibleWhen).toEqual([
			{ field: "title", not: true },
			{ field: "show_badge" },
		]);
	});
});
