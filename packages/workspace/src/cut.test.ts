import type { Template } from "@freshcoat-js/coatfile";
import { describe, expect, it } from "vitest";
import { itemCuts } from "./cut";

const rect = (
	id: string,
	x: number,
	y: number,
	width: number,
	height: number,
	slice: Record<string, unknown>,
	extra: Record<string, unknown> = {},
) => ({
	id,
	type: "rect",
	pos: { x, y },
	size: { width, height },
	properties: { fill: "#ff0000", slice },
	...extra,
});

/** A 400 by 200 sheet with 10 of bleed: a rounded sticker cut through, a
 *  star-ish kiss cut, a score line that makes no piece, one that crosses the
 *  sticker, and a perforated strip that only shows while `strip` is on. */
const sheet: Template = {
	format_version: "1.7",
	id: "sheet",
	name: "Sheet",
	width: 400,
	height: 200,
	bleed: 10,
	fields: {
		type: "object",
		properties: {
			strip: { type: "string", format: "boolean", default: "true" },
		},
	},
	template_data: [
		{
			name: "front",
			background: {
				id: "bg",
				type: "rect",
				pos: { x: 0, y: 0 },
				size: { width: 400, height: 200 },
				properties: { fill: "#ffffff" },
			},
			elements: [
				rect("sticker", 20, 30, 100, 80, {
					name: "sticker",
					edge: "through",
					bleed: 4,
				}),
				rect("star", 200, 20, 60, 60, { name: "star", edge: "kiss" }),
				rect("fold", 30, 50, 40, 2, {
					name: "fold",
					edge: "score",
					output: "none",
				}),
				rect("crease", 100, 60, 60, 2, {
					name: "crease",
					edge: "score",
					output: "none",
				}),
				rect(
					"tear",
					300,
					0,
					4,
					200,
					{ name: "tear", edge: "perforate" },
					{
						visibleWhen: { field: "strip" },
					},
				),
				rect("plain", 320, 100, 50, 50, { name: "plain" }),
			],
		},
		{
			name: "back",
			background: {
				id: "bgb",
				type: "rect",
				pos: { x: 0, y: 0 },
				size: { width: 400, height: 200 },
				properties: { fill: "#ffffff" },
			},
			elements: [],
		},
	],
	variants: [
		{
			id: "bare",
			label: "Bare",
			overrides: [
				{
					name: "front",
					elements: [{ id: "star", properties: {}, hidden: true }],
				},
			],
		},
	],
} as Template;

const side = { values: {}, side: "front" };
const bleed = { top: 10, right: 10, bottom: 10, left: 10 };

describe("itemCuts for a whole side", () => {
	it("lists every slice that has an edge, in slice order, with its kind and name", () => {
		const cuts = itemCuts(sheet, side);
		expect(cuts.width).toBe(400);
		expect(cuts.height).toBe(200);
		expect(cuts.lines.map((l) => [l.kind, l.name])).toEqual([
			["through", "sticker"],
			["kiss", "star"],
			["score", "fold"],
			["score", "crease"],
			["perforate", "tear"],
		]);
	});

	it("keeps the outline in trim coordinates without bleed", () => {
		const [sticker] = itemCuts(sheet, side).lines;
		expect(sticker?.path).toMatch(/^M20 30/);
	});

	it("offsets the outlines by the bleed and grows the item by it", () => {
		const cuts = itemCuts(sheet, side, { bleed });
		expect([cuts.width, cuts.height]).toEqual([420, 220]);
		expect(cuts.lines[0]?.path).toMatch(/^M30 40/);
	});

	it("offsets by each side's own bleed", () => {
		const cuts = itemCuts(sheet, side, {
			bleed: { top: 1, right: 2, bottom: 3, left: 4 },
		});
		expect([cuts.width, cuts.height]).toEqual([406, 204]);
		expect(cuts.lines[0]?.path).toMatch(/^M24 31/);
	});

	it("leaves out slices the values hide", () => {
		const cuts = itemCuts(sheet, { ...side, values: { strip: "false" } });
		expect(cuts.lines.map((l) => l.name)).not.toContain("tear");
	});

	it("follows the variant", () => {
		const cuts = itemCuts(sheet, { ...side, variantId: "bare" });
		expect(cuts.lines.map((l) => l.name)).not.toContain("star");
	});

	it("has no lines on a side without slices", () => {
		expect(itemCuts(sheet, { values: {}, side: "back" }).lines).toEqual([]);
	});

	it("sizes the item by the layout it is resized to", () => {
		const cuts = itemCuts(sheet, side, { resize: { width: 800, height: 400 } });
		expect([cuts.width, cuts.height]).toEqual([800, 400]);
	});
});

describe("itemCuts for a piece", () => {
	const piece = (name: string) => itemCuts(sheet, { ...side, piece: name });

	it("sizes the item by the box and its bleed", () => {
		const cuts = piece("sticker");
		expect([cuts.width, cuts.height]).toEqual([108, 88]);
	});

	it("puts the box at the slice's bleed", () => {
		const [own] = piece("sticker").lines;
		expect(own?.kind).toBe("through");
		expect(own?.name).toBe("sticker");
		expect(own?.path).toMatch(/^M4 4/);
	});

	it("draws no outline for a piece whose edge is none", () => {
		const cuts = piece("plain");
		expect(cuts.lines).toEqual([]);
		expect([cuts.width, cuts.height]).toEqual([50, 50]);
	});

	it("adds output: none lines that lie inside the box, and not ones that cross it", () => {
		const names = piece("sticker").lines.map((l) => l.name);
		expect(names).toEqual(["sticker", "fold"]);
	});

	it("moves the inner lines with the piece", () => {
		const fold = piece("sticker").lines.find((l) => l.name === "fold");
		// fold is at (30, 50); the box is at (20, 30); the bleed is 4
		expect(fold?.path).toMatch(/^M14 24/);
	});

	it("does not add other pieces' own edges", () => {
		expect(piece("star").lines.map((l) => l.name)).toEqual(["star"]);
	});

	it("refuses a slice the side does not have", () => {
		expect(() => piece("nope")).toThrow(/no slice "nope"/);
	});

	it("follows the values", () => {
		expect(() =>
			itemCuts(sheet, {
				values: { strip: "false" },
				side: "front",
				piece: "tear",
			}),
		).toThrow(/no slice "tear"/);
	});
});
