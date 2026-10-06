import { decodePixels, type GroupNode } from "@freshcoat-js/engine";
import { createHeadlessEnv } from "@freshcoat-js/engine/headless";
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test } from "vitest";
import { compile } from "../src/compile";
import type { EncodedPaintedFrame } from "../src/render";
import { render } from "../src/render";
import type {
	Command,
	DrawCommand,
	DrawRectCommand,
	Element,
	FrameElement,
	Layout,
	LayoutChild,
	Template,
} from "../src/types";
import { validate } from "../src/validate";
import { compileToCommands } from "./helpers/compile-commands";

const cell = (
	id: string,
	fill: string,
	layoutChild?: LayoutChild,
	size = { width: 10, height: 10 },
): Element =>
	({
		id,
		type: "rect",
		size,
		...(layoutChild ? { layoutChild } : {}),
		properties: { fill },
	}) as Element;

const FILL: LayoutChild = { width: "fill", height: "fill" };

function gridTemplate(layout: Layout, children: Element[]): Template {
	const frame: FrameElement = {
		id: "grid",
		type: "frame",
		pos: { x: 0, y: 0 },
		size: { width: 120, height: 60 },
		properties: { layout, children },
	};
	return {
		format_version: "1.5",
		id: "t",
		name: "T",
		width: 120,
		height: 60,
		fields: { type: "object", properties: {} },
		template_data: [
			{
				name: "front",
				background: {
					id: "bg",
					type: "rect",
					properties: { fill: "#ffffff" },
				},
				elements: [frame],
			},
		],
	};
}

function rects(commands: Command[]): Record<string, DrawRectCommand> {
	const out: Record<string, DrawRectCommand> = {};
	const walk = (list: Command[]) => {
		for (const c of list) {
			if (!("op" in c)) continue;
			const d = c as DrawCommand;
			if (d.op === "drawRect" && d.id) out[d.id] = d;
			if (d.op === "drawGroup") walk(d.children);
		}
	};
	walk(commands);
	return out;
}

const boxes = (tpl: Template, width = 120, height = 60) =>
	rects(compileToCommands(tpl, {}, { width, height })[0].commands);

describe("grid layout", () => {
	test("compiles to an engine grid, scaled with the design", () => {
		const tpl = gridTemplate(
			{
				type: "grid",
				columns: [20, "1fr", "auto"],
				rows: [30],
				gap: [4, 6],
				padding: { left: 2 },
			},
			[cell("a", "#f00", { column: [1, 2], row: 1 })],
		);
		expect(validate(tpl).ok).toBe(true);
		const frame = compile(tpl, {}, { width: 240, height: 120 }).frames[0].root
			.children[1] as GroupNode;
		expect(frame.layout).toEqual({
			type: "grid",
			columns: [40, "1fr", "auto"],
			rows: [60],
			gap: [8, 12],
			padding: [0, 0, 0, 4],
		});
		expect(frame.children[0].layoutChild).toMatchObject({
			column: [1, 2],
			row: 1,
		});
	});

	test("fr tracks share the space, and children fill their cells", () => {
		const r = boxes(
			gridTemplate({ type: "grid", columns: ["1fr", "2fr"], gap: 0 }, [
				cell("a", "#f00", FILL),
				cell("b", "#00f", FILL),
			]),
		);
		expect(r.a).toMatchObject({
			pos: { x: 0, y: 0 },
			size: { width: 40, height: 10 },
		});
		expect(r.b).toMatchObject({ pos: { x: 40, y: 0 } });
		expect(r.b.size.width).toBe(80);
	});

	test("children flow row by row, spans cover several tracks", () => {
		const r = boxes(
			gridTemplate(
				{ type: "grid", columns: [40, 40, 40], rows: [30, 30] },
				[
					cell("wide", "#f00", { column: [1, 2], height: "fill" }),
					cell("c", "#0f0"),
					cell("d", "#00f"),
				],
			),
		);
		expect(r.wide.pos).toEqual({ x: 0, y: 0 });
		expect(r.wide.size).toEqual({ width: 10, height: 30 });
		expect(r.c.pos).toEqual({ x: 80, y: 0 });
		expect(r.d.pos).toEqual({ x: 0, y: 30 });
	});

	test("a child without fill or hug keeps its own size", () => {
		const r = boxes(
			gridTemplate({ type: "grid", columns: ["1fr", "1fr"] }, [
				cell("fixed", "#f00", undefined, { width: 12, height: 8 }),
				cell("filled", "#00f", { width: "fill" }, { width: 12, height: 8 }),
			]),
		);
		expect(r.fixed.size).toEqual({ width: 12, height: 8 });
		expect(r.filled.size).toEqual({ width: 60, height: 8 });
	});

	test("validation rejects bad tracks and out-of-range spans", () => {
		const codes = (tpl: Template) => {
			const v = validate(tpl);
			return v.ok ? [] : v.errors.map((e) => e.code);
		};
		expect(
			codes(
				gridTemplate({ type: "grid", columns: ["1fr", 20] }, [
					cell("a", "#f00", { column: [2, 3] }),
				]),
			),
		).toContain("grid_span_out_of_range");
		expect(
			codes(
				gridTemplate({ type: "grid", columns: ["1fr", 20] }, [
					cell("a", "#f00", { row: [3, 2] }),
				]),
			),
		).toContain("grid_span_reversed");
		expect(
			codes(
				gridTemplate({ type: "grid", columns: ["1fr", 20] }, [
					cell("a", "#f00", { row: [3, 9] }),
				]),
			),
		).toEqual([]);
		for (const columns of [[], ["1px"], ["fr"], [-4], ["auto", "1 fr"]])
			expect(
				codes(
					gridTemplate({ type: "grid", columns } as unknown as Layout, []),
				),
			).toContain("invalid_shape");
		expect(
			codes(
				gridTemplate({ type: "grid", columns: [".5fr", "1.25fr", "auto"] }, []),
			),
		).toEqual([]);
	});

	test("a span out of range in a nested grid is reported at its path", () => {
		const tpl = gridTemplate({ direction: "row" }, [
			{
				id: "inner",
				type: "frame",
				size: { width: 40, height: 40 },
				properties: {
					layout: { type: "grid", columns: [20] },
					children: [cell("x", "#000", { column: 2 })],
				},
			} as FrameElement,
		]);
		const v = validate(tpl);
		expect(v.ok).toBe(false);
		if (!v.ok)
			expect(v.errors[0]).toMatchObject({
				code: "grid_span_out_of_range",
				path: "/template_data/0/elements/0/properties/children/0/properties/children/0/layoutChild/column",
			});
	});
});

describe("grid layout paint", () => {
	// biome-ignore lint/suspicious/noExplicitAny: CanvasKit is untyped here
	let ck: any;
	beforeAll(async () => {
		ck = await loadCanvasKit();
	});

	test("paints each child in its cell", async () => {
		const tpl = gridTemplate(
			{ type: "grid", columns: ["1fr", "2fr"], rows: ["1fr", "1fr"], gap: 0 },
			[
				cell("a", "#ff0000", FILL),
				cell("b", "#0000ff", FILL),
				cell("c", "#00ff00", { ...FILL, column: [1, 2] }),
			],
		);
		const [frame] = (await render(
			tpl,
			{},
			{ width: 120, height: 60 },
			{ ck, env: createHeadlessEnv() },
		)) as EncodedPaintedFrame[];
		const d = decodePixels(ck, frame.bytes);
		if (!d) throw new Error("decode failed");
		const at = (x: number, y: number) =>
			Array.from(d.data.slice((y * d.width + x) * 4, (y * d.width + x) * 4 + 3));
		expect(at(20, 15)).toEqual([255, 0, 0]);
		expect(at(80, 15)).toEqual([0, 0, 255]);
		expect(at(20, 45)).toEqual([0, 255, 0]);
		expect(at(100, 45)).toEqual([0, 255, 0]);
	});
});
