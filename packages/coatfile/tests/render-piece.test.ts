// Rendering one slice piece: the box grown by its bleed, cut from the whole
// side's composite, and masked to the outline grown by that bleed.
import { createRenderer, decodePixels } from "@freshcoat-js/engine";
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test } from "vitest";
import { renderTemplate } from "../src/render";
import type { Element, Template } from "../src/types";

let ck: any;
beforeAll(async () => {
	ck = await loadCanvasKit();
});

const rect = (
	id: string,
	fill: string,
	x: number,
	y: number,
	width: number,
	height: number,
	extra: Record<string, unknown> = {},
	rest: Record<string, unknown> = {},
): Element =>
	({
		id,
		type: "rect",
		pos: { x, y },
		size: { width, height },
		properties: { fill, ...extra },
		...rest,
	}) as Element;

// 80 by 40 trim with 4 of bleed: red left half, blue right half, both running
// to the trim edges, then the elements the tests add.
function card(elements: Element[], extra: Partial<Template> = {}): Template {
	return {
		format_version: "1.7",
		version: "1.0.0",
		id: "t",
		name: "T",
		product: "test",
		width: 80,
		height: 40,
		bleed: 4,
		fields: { type: "object", properties: {} },
		template_data: [
			{
				name: "front",
				background: {
					id: "bg",
					type: "rect",
					pos: { x: 0, y: 0 },
					size: { width: 80, height: 40 },
					properties: { fill: "#ffffff" },
				},
				elements: [
					rect("red", "#ff0000", 0, 0, 40, 40),
					rect("blue", "#0000ff", 40, 0, 40, 40),
					...elements,
				],
			},
		],
		...extra,
	} as Template;
}

const sliceOver = (
	slice: Record<string, unknown>,
	x = 40,
	y = 0,
	width = 40,
	height = 40,
	props: Record<string, unknown> = {},
	rest: Record<string, unknown> = {},
) => rect("right", "#00000000", x, y, width, height, { slice, ...props }, rest);

async function piece(
	template: Template,
	name: string,
	options: Record<string, unknown> = {},
	values: Record<string, unknown> = {},
) {
	const [frame] = await renderTemplate(
		await createRenderer({ ck, cache: false }),
		template,
		values,
		{ piece: name, ...options } as never,
	);
	if (!frame) throw new Error("no frame");
	const d = decodePixels(ck, frame.bytes);
	if (!d) throw new Error("decode failed");
	const at = (x: number, y: number) =>
		Array.from(d.data.slice((y * d.width + x) * 4, (y * d.width + x) * 4 + 4));
	return { frame, width: d.width, height: d.height, at };
}

const RED = [255, 0, 0, 255];
const BLUE = [0, 0, 255, 255];
const CLEAR = [0, 0, 0, 0];

describe("render a slice piece", () => {
	test("is the box grown by the bleed, at any scale", async () => {
		const t = card([
			sliceOver({
				name: "right",
				bleed: { top: 2, right: 3, bottom: 4, left: 5 },
			}),
		]);
		const one = await piece(t, "right");
		expect([one.width, one.height]).toEqual([48, 46]);
		expect(one.frame.piece).toEqual({ x: 5, y: 2, width: 40, height: 40 });
		expect(one.frame.trim).toBeUndefined();
		const two = await piece(t, "right", {
			exports: [{ constraint: { kind: "scale", value: 2 } }],
		});
		expect([two.width, two.height]).toEqual([96, 92]);
		expect(two.frame.piece).toEqual({ x: 10, y: 4, width: 80, height: 80 });
	});

	test("refuses an open path, which is a cut line and not a piece", async () => {
		const t = card([
			{
				id: "fold",
				type: "vector",
				pos: { x: 0, y: 10 },
				size: { width: 40, height: 10 },
				properties: { d: "M0 5 L40 5", slice: { edge: "score" } },
			} as Element,
		]);
		await expect(piece(t, "fold")).rejects.toThrow(
			'slice "fold" is an open path, which is a cut line and not a piece',
		);
	});

	test("finds a slice by id as well as by name", async () => {
		const t = card([sliceOver({ name: "panel" })]);
		expect((await piece(t, "right")).width).toBe(40);
		expect((await piece(t, "panel")).width).toBe(40);
	});

	test("shows only what lies in the box, with content above the shape", async () => {
		const t = card([
			sliceOver({ name: "right" }),
			rect("dot", "#00ff00", 50, 10, 10, 10),
		]);
		const p = await piece(t, "right");
		expect(p.at(1, 1)).toEqual(BLUE);
		expect(p.at(38, 38)).toEqual(BLUE);
		expect(p.at(15, 15)).toEqual([0, 255, 0, 255]);
	});

	test("the slice shape paints as normal", async () => {
		const t = card([
			rect("right", "#ffff00", 40, 0, 40, 40, { slice: { name: "right" } }),
		]);
		expect((await piece(t, "right")).at(10, 10)).toEqual([255, 255, 0, 255]);
	});

	test("a rounded slice is transparent at its corners", async () => {
		const t = card([
			sliceOver({ name: "right" }, 40, 0, 40, 40, { cornerRadius: 16 }),
		]);
		const p = await piece(t, "right");
		expect(p.at(0, 0)).toEqual(CLEAR);
		expect(p.at(39, 39)).toEqual(CLEAR);
		expect(p.at(20, 20)).toEqual(BLUE);
	});

	test("a rotated slice is transparent outside its outline", async () => {
		const t = card([
			sliceOver({ name: "right" }, 50, 5, 20, 30, {}, { rotation: 45 }),
		]);
		const p = await piece(t, "right");
		expect(p.width).toBeGreaterThan(30);
		expect(p.at(0, 0)).toEqual(CLEAR);
		expect(p.at(Math.floor(p.width / 2), Math.floor(p.height / 2))).toEqual(
			BLUE,
		);
	});

	test("the bleed band takes in the art around the shape", async () => {
		const t = card([
			sliceOver({ name: "right", bleed: 6 }, 20, 10, 40, 20, {
				cornerRadius: 8,
			}),
		]);
		const p = await piece(t, "right");
		expect([p.width, p.height]).toEqual([52, 32]);
		expect(p.at(8, 16)).toEqual(RED);
		expect(p.at(40, 16)).toEqual(BLUE);
		expect(p.at(20, 3)).toEqual(RED);
	});

	test("art that runs to the trim runs into the bleed", async () => {
		const t = card([sliceOver({ name: "right", bleed: 4 })]);
		const p = await piece(t, "right");
		expect([p.width, p.height]).toEqual([48, 48]);
		expect(p.at(40, 0)).toEqual(BLUE);
		expect(p.at(47, 47)).toEqual(BLUE);
		expect(p.at(5, 2)).toEqual(BLUE);
	});

	test("follows the variant and the values", async () => {
		const t = card(
			[
				{
					...sliceOver({ name: "right" }, 40, 0, 40, 40),
					visibleWhen: { field: "on" },
				} as Element,
			],
			{
				fields: {
					type: "object",
					properties: { on: { type: "string", format: "boolean" } },
				},
				variants: [
					{
						id: "left",
						label: "Left",
						overrides: [
							{
								name: "front",
								elements: [
									{ id: "right", properties: {}, pos: { x: 0, y: 0 } },
								],
							},
						],
					},
				],
			},
		);
		await expect(piece(t, "right")).rejects.toThrow(/no slice "right"/);
		expect((await piece(t, "right", {}, { on: "true" })).at(5, 5)).toEqual(
			BLUE,
		);
		expect(
			(await piece(t, "right", { variantId: "left" }, { on: "true" })).at(5, 5),
		).toEqual(RED);
	});

	test("an unknown slice throws, a cut line can still be named", async () => {
		const t = card([sliceOver({ name: "cut", output: "none" })]);
		await expect(piece(t, "nope")).rejects.toThrow(/no slice "nope"/);
		expect((await piece(t, "cut")).width).toBe(40);
	});

	test("a full-side render does not change with slice modifiers present", async () => {
		const run = async (template: Template, bleed: boolean) =>
			(
				await renderTemplate(
					await createRenderer({ ck, cache: false }),
					template,
					{},
					{ bleed },
				)
			)[0]?.bytes;
		const shape = (slice?: Record<string, unknown>) =>
			card([
				rect("shape", "#ffff00", 40, 0, 40, 40, {
					cornerRadius: 8,
					...(slice ? { slice } : {}),
				}),
			]);
		for (const bleed of [false, true])
			expect(await run(shape({ name: "s", bleed: 6 }), bleed)).toEqual(
				await run(shape(), bleed),
			);
	});
});
