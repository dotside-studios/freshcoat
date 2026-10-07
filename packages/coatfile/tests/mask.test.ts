// The mask element: a shape (or any element) whose coverage decides how much of
// the content shows. Positions are relative to the mask element, like a frame's.
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { createRenderer, decodePixels } from "@freshcoat-js/engine";
import { beforeAll, describe, expect, test } from "vitest";
import { compile } from "../src/compile";
import { renderTemplate } from "../src/render";
import type { Element, MaskElement, Template } from "../src/types";
import { validate } from "../src/validate";

const rect = (
	id: string,
	fill: string,
	pos = { x: 0, y: 0 },
	size = { width: 40, height: 40 },
	extra: Record<string, unknown> = {},
): Element =>
	({ id, type: "rect", pos, size, properties: { fill, ...extra } }) as Element;

function withMask(
	mask: Element,
	opts: Partial<MaskElement["properties"]> = {},
	visibleWhen?: MaskElement["visibleWhen"],
): Template {
	const el: MaskElement = {
		id: "masked",
		type: "mask",
		pos: { x: 20, y: 20 },
		size: { width: 40, height: 40 },
		...(visibleWhen ? { visibleWhen } : {}),
		properties: {
			mask,
			children: [
				rect("content", "#ff0000"),
				{
					...rect(
						"gated",
						"#0000ff",
						{ x: 0, y: 0 },
						{ width: 10, height: 10 },
					),
					visibleWhen: { field: "show" },
				} as Element,
			],
			...opts,
		},
	};
	return {
		format_version: "1.0",
		version: "1.0.0",
		id: "t",
		name: "T",
		product: "test",
		width: 80,
		height: 80,
		fields: {
			type: "object",
			properties: { show: { type: "string", format: "boolean" } },
		},
		template_data: [
			{
				name: "front",
				background: {
					id: "bg",
					type: "rect",
					properties: { fill: "#ffffff" },
				},
				elements: [el],
			},
		],
	};
}

const circle = {
	id: "shape",
	type: "vector",
	pos: { x: 0, y: 0 },
	size: { width: 40, height: 40 },
	properties: {
		d: "M0 20 A20 20 0 1 0 40 20 A20 20 0 1 0 0 20 Z",
		fill: "#000000",
	},
} as Element;

let ck: any;
beforeAll(async () => {
	ck = await loadCanvasKit();
});

async function pixels(tpl: Template, values: Record<string, unknown> = {}) {
	const [frame] = (await renderTemplate(
		await createRenderer({ ck, cache: false }),
		tpl,
		values,
		{ width: 80, height: 80 },
	));
	const d = decodePixels(ck, frame.bytes);
	if (!d) throw new Error("decode failed");
	return (x: number, y: number) =>
		Array.from(d.data.slice((y * d.width + x) * 4, (y * d.width + x) * 4 + 3));
}

describe("mask element", () => {
	test("validates, and lowers to a freshcoat mask node", () => {
		const tpl = withMask(circle, { channel: "luminance", invert: true });
		expect(validate(tpl).ok).toBe(true);
		const node = compile(tpl, {}, { width: 80, height: 80 }).frames[0].root
			.children[1];
		expect(node).toMatchObject({
			kind: "mask",
			id: "masked",
			channel: "luminance",
			invert: true,
			mask: { kind: "path" },
			children: [{ kind: "rect", id: "content" }],
		});
	});

	test("a path mask shows content inside the shape only", async () => {
		const at = await pixels(withMask(circle));
		expect(at(40, 40)).toEqual([255, 0, 0]); // centre of the circle
		expect(at(22, 22)).toEqual([255, 255, 255]); // box corner, outside it
		expect(at(10, 10)).toEqual([255, 255, 255]); // outside the element
	});

	test("invert shows content outside the shape instead", async () => {
		const at = await pixels(withMask(circle, { invert: true }));
		expect(at(40, 40)).toEqual([255, 255, 255]);
		expect(at(22, 22)).toEqual([255, 0, 0]);
	});

	test("a rect mask takes the fast clip and is placed relative to the element", async () => {
		const at = await pixels(
			withMask(
				rect("shape", "#000", { x: 10, y: 10 }, { width: 20, height: 20 }),
			),
		);
		expect(at(35, 35)).toEqual([255, 0, 0]);
		expect(at(25, 25)).toEqual([255, 255, 255]);
	});

	test("hidden content inside a mask is pruned", async () => {
		const shape = rect("shape", "#000");
		expect((await pixels(withMask(shape)))(25, 25)).toEqual([255, 0, 0]);
		expect((await pixels(withMask(shape), { show: "true" }))(25, 25)).toEqual([
			0, 0, 255,
		]);
	});

	test("a variant override reaches an element inside a mask", () => {
		const tpl = withMask(rect("shape", "#000"));
		tpl.variants = [
			{
				id: "blue",
				label: "Blue",
				overrides: [
					{
						name: "front",
						elements: [{ id: "content", properties: { fill: "#00ff00" } }],
					},
				],
			},
		];
		const node = compile(tpl, {}, { width: 80, height: 80, variantId: "blue" })
			.frames[0].root.children[1];
		expect(node).toMatchObject({
			children: [{ fills: [{ kind: "solid", color: "#00ff00" }] }],
		});
	});
});
