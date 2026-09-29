import { describe, expect, test } from "vitest";
import { compile } from "../src/compile";
import type { Node, Template, TextNode, TextProperties } from "../src/types";
import { validate } from "../src/validate";

function template(props: Partial<TextProperties>): Template {
	return {
		format_version: "1.0",
		version: "1.0.0",
		id: "text-layout",
		name: "Text layout",
		product: "card_cr80",
		fields: { type: "object", properties: {} },
		width: 300,
		height: 200,
		template_data: [
			{
				name: "front",
				background: {
					id: "bg",
					type: "rect",
					pos: { x: 0, y: 0 },
					size: { width: 300, height: 200 },
					properties: { fill: "#fff" },
				},
				elements: [
					{
						id: "copy",
						type: "text",
						pos: { x: 10, y: 10 },
						size: { width: 200, height: 100 },
						properties: {
							value: "Hello there",
							font: { family: "Inter", size: 20 },
							...props,
						},
					},
				],
			},
		],
	};
}

function textNode(props: Partial<TextProperties>): TextNode {
	const tpl = template(props);
	expect(validate(tpl)).toMatchObject({ ok: true });
	const compiled = compile(tpl, {}, { width: 300, height: 200 });
	const children = (compiled.frames[0].root as { children: Node[] }).children;
	return children.find((c) => c.kind === "text") as TextNode;
}

describe("text layout properties", () => {
	test("justify and the last line's alignment reach the node", () => {
		const node = textNode({ align: "justify", alignLast: "center" });
		expect(node.align).toBe("justify");
		expect(node.alignLast).toBe("center");
		expect(textNode({ align: "justify" }).alignLast).toBeUndefined();
	});

	test("direction reaches the node, and aligns to its start by default", () => {
		const rtl = textNode({ value: "שלום", direction: "rtl" });
		expect(rtl.direction).toBe("rtl");
		expect(rtl.align).toBe("start");
		expect(textNode({ direction: "auto", align: "end" }).align).toBe("end");
		const plain = textNode({});
		expect(plain.direction).toBeUndefined();
		expect(plain.align).toBe("left");
	});

	test("font features reach the node and its spans", () => {
		const node = textNode({
			font: { family: "Inter", size: 20, features: { tnum: 1, liga: 0 } },
			value: undefined,
			spans: [{ text: "10" }, { text: "11", font: { features: { tnum: 0 } } }],
		});
		expect(node.font.features).toEqual({ tnum: 1, liga: 0 });
		expect(node.spans?.[1].font?.features).toEqual({ tnum: 0 });
	});

	test("a feature tag is four characters and its value a whole number", () => {
		const bad = (features: Record<string, number>) =>
			validate(template({ font: { family: "Inter", size: 20, features } })).ok;
		expect(bad({ tnum: 1.5 })).toBe(false);
		expect(bad({ tabular: 1 })).toBe(false);
		expect(bad({ ss01: 1 })).toBe(true);
	});

	test("paragraph spacing reaches the node, scaled with the render", () => {
		expect(textNode({ paragraphSpacing: 12 }).paragraphSpacing).toBe(12);
		expect(textNode({}).paragraphSpacing).toBeUndefined();
		const tpl = template({ paragraphSpacing: 12 });
		const compiled = compile(tpl, {}, { width: 600, height: 400 });
		const children = (compiled.frames[0].root as { children: Node[] }).children;
		const node = children.find((c) => c.kind === "text") as TextNode;
		expect(node.paragraphSpacing).toBe(24);
		expect(validate(template({ paragraphSpacing: -1 })).ok).toBe(false);
	});
});
