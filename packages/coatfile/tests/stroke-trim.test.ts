import { createRenderer, decodePixels } from "@freshcoat-js/engine";
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { describe, expect, test } from "vitest";
import { parseTrimValue, resolveStrokeTrim } from "../src/stroke-trim";
import type {
	Command,
	DrawCommand,
	DrawPathCommand,
	DrawRectCommand,
	Element,
	Template,
} from "../src/types";
import { validate } from "../src/validate";
import { compileToCommands } from "./helpers/compile-commands";

const SIZE = 100;
const ELLIPSE = "M0 40A40 40 0 1 0 80 40A40 40 0 1 0 0 40Z";

function card(element: Element): Template {
	return {
		format_version: "1.6",
		version: "1.0.0",
		id: "t",
		name: "T",
		product: "test",
		width: SIZE,
		height: SIZE,
		fields: {
			type: "object",
			properties: { progress: { type: "string", default: "0" } },
		},
		template_data: [
			{
				name: "front",
				background: {
					id: "bg",
					type: "rect",
					pos: { x: 0, y: 0 },
					size: { width: SIZE, height: SIZE },
					properties: { fill: "#ffffff" },
				},
				elements: [element],
			},
		],
	} as Template;
}

const ring = (stroke: Record<string, unknown>): Element =>
	({
		id: "ring",
		type: "vector",
		pos: { x: 10, y: 10 },
		size: { width: 80, height: 80 },
		properties: { d: ELLIPSE, stroke: { color: "#000000", width: 8, ...stroke } },
	}) as Element;

function draws(t: Template, values: Record<string, unknown>): DrawCommand[] {
	const cmds = compileToCommands(t, values, { width: SIZE, height: SIZE })[0]!
		.commands;
	return cmds.filter((c: Command): c is DrawCommand => "op" in c);
}

describe("parseTrimValue", () => {
	test("reads numbers and percentages", () => {
		expect(parseTrimValue(0.4)).toBe(0.4);
		expect(parseTrimValue("0.4")).toBe(0.4);
		expect(parseTrimValue(" 40% ")).toBe(0.4);
		expect(parseTrimValue("-.25")).toBe(-0.25);
	});

	test("leaves anything else unset", () => {
		expect(parseTrimValue("")).toBeUndefined();
		expect(parseTrimValue("half")).toBeUndefined();
		expect(parseTrimValue("{{progress}}")).toBeUndefined();
		expect(parseTrimValue(Number.NaN)).toBeUndefined();
		expect(parseTrimValue(undefined)).toBeUndefined();
	});

	test("resolveStrokeTrim substitutes and clamps", () => {
		expect(
			resolveStrokeTrim(
				{ trimStart: "{{a}}", trimEnd: "{{b}}", trimOffset: "{{c}}" },
				{ a: -1, b: "150%", c: "1.25" },
			),
		).toEqual({ trimStart: 0, trimEnd: 1, trimOffset: 1.25 });
		expect(resolveStrokeTrim({ trimEnd: "{{missing}}" })).toEqual({});
	});
});

describe("stroke trim schema", () => {
	test("accepts numbers in [0, 1] and field tokens", () => {
		expect(validate(card(ring({ trimEnd: 0.5, trimOffset: 2 }))).ok).toBe(true);
		expect(validate(card(ring({ trimEnd: "{{progress}}" }))).ok).toBe(true);
		expect(validate(card(ring({ trimEnd: 1.5 }))).ok).toBe(false);
		expect(validate(card(ring({ trimStart: -0.1 }))).ok).toBe(false);
	});
});

describe("data-bound trim", () => {
	test("a field drives trimEnd", () => {
		const t = card(ring({ trimEnd: "{{progress}}" }));
		const at = (progress: string) =>
			(draws(t, { progress }).find((c) => c.op === "drawPath") as DrawPathCommand)
				.stroke;
		expect(at("0.25")?.trimEnd).toBe(0.25);
		expect(at("60%")?.trimEnd).toBe(0.6);
		expect(at("")).not.toHaveProperty("trimEnd");
	});

	test("a trimmed rect keeps its trim and an untrimmed one adds no keys", () => {
		const rect = (stroke: Record<string, unknown>) =>
			({
				id: "r",
				type: "rect",
				pos: { x: 10, y: 10 },
				size: { width: 80, height: 40 },
				properties: { stroke: { color: "#000", width: 2, ...stroke } },
			}) as Element;
		const strokeOf = (el: Element, values = {}) =>
			(draws(card(el), values).find((c) => c.id === "r") as DrawRectCommand)
				.stroke;
		expect(strokeOf(rect({ trimStart: 0.1, trimEnd: "{{progress}}" }), { progress: 0.9 })).toMatchObject({
			trimStart: 0.1,
			trimEnd: 0.9,
		});
		expect(Object.keys(strokeOf(rect({})) ?? {})).not.toContain("trimEnd");
	});

	test("an ellipse vector trims clockwise from its top", () => {
		const path = (stroke: Record<string, unknown>) =>
			draws(card(ring(stroke)), { progress: "0.25" }).find(
				(c) => c.op === "drawPath",
			) as DrawPathCommand;
		expect(path({ trimEnd: "{{progress}}" }).strokeD).toBe(
			"M 40 0 A 40 40 0 1 1 40 80 A 40 40 0 1 1 40 0 Z",
		);
		expect(path({})).not.toHaveProperty("strokeD");
		expect(path({ trimEnd: "{{progress}}%" }).strokeD).toBeDefined();
	});

	test("paints the bound quarter of the ring", async () => {
		const ck = await loadCanvasKit();
		const renderer = await createRenderer({ ck });
		const t = card(ring({ trimEnd: "{{progress}}" }));
		const commands = compileToCommands(t, { progress: "25%" }, {
			width: SIZE,
			height: SIZE,
		})[0]!.commands;
		const { bytes } = await renderer.paint(commands);
		const pixels = decodePixels(ck, bytes);
		if (!pixels) throw new Error("decode failed");
		const ink = (x: number, y: number) =>
			(pixels.data[(y * pixels.width + x) * 4] as number) < 64;
		expect(ink(78, 21)).toBe(true);
		expect(ink(21, 78)).toBe(false);
		expect(ink(78, 78)).toBe(false);
		expect(ink(21, 21)).toBe(false);
		renderer.dispose();
	});
});
