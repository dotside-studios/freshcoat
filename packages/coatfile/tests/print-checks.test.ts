import { createRenderer } from "@freshcoat-js/engine";
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { describe, expect, test } from "vitest";
import { fixtures } from "../fixtures";
import { templateHints } from "../src/hints";
import {
	describePrintIssue,
	isLightFace,
	isRichBlack,
	type PrintHint,
	printCheckWarnings,
	printHints,
	unitsToPt,
} from "../src/print-checks";
import { describeWarning, renderTemplate } from "../src/render";
import type { Element, Template } from "../src/types";
import { compileToCommands } from "./helpers/compile-commands";

function card(extra: Partial<Template> = {}, elements: Element[] = []): Template {
	return {
		format_version: "1.6",
		id: "t",
		name: "T",
		width: 1012,
		height: 638,
		fields: {
			type: "object",
			properties: { name: { type: "string", default: "Ada" } },
		},
		template_data: [
			{
				name: "front",
				background: { id: "bg", type: "rect", properties: { fill: "#fff" } },
				elements,
			},
		],
		...extra,
	} as Template;
}

const text = (
	id: string,
	size: number,
	extra: Record<string, unknown> = {},
	font: Record<string, unknown> = {},
) =>
	({
		id,
		type: "text",
		pos: { x: 100, y: 100 },
		size: { width: 800, height: 200 },
		properties: {
			value: "Hello",
			font: { family: "Inter", size, ...font },
			color: "#000000",
			...extra,
		},
	}) as Element;

const box = (
	id: string,
	x: number,
	y: number,
	w: number,
	h: number,
	properties: Record<string, unknown> = { fill: "#0000ff" },
	type = "rect",
) =>
	({
		id,
		type,
		pos: { x, y },
		size: { width: w, height: h },
		properties,
	}) as Element;

const codes = (hints: PrintHint[]) =>
	hints.map((h) => `${h.id}:${h.issue.code}`).sort();

describe("print check helpers", () => {
	test("convert design units to points at the DPI", () => {
		expect(unitsToPt(300, 300)).toBe(72);
		expect(unitsToPt(25, 300)).toBe(6);
	});

	test("tell a light face by weight or family name", () => {
		expect(isLightFace("Inter", 300)).toBe(true);
		expect(isLightFace("Inter", 400)).toBe(false);
		expect(isLightFace("Inter", undefined)).toBe(false);
		expect(isLightFace("Roboto Thin", 400)).toBe(true);
		expect(isLightFace("Lato Light", undefined)).toBe(true);
		expect(isLightFace("Highlight Sans", 400)).toBe(false);
	});

	test("call a dark mixed colour rich black, but not pure black or grey", () => {
		expect(isRichBlack("#101828")).toBe(true);
		expect(isRichBlack("rgb(20, 10, 40)")).toBe(true);
		expect(isRichBlack("#000000")).toBe(false);
		expect(isRichBlack("#222222")).toBe(false);
		expect(isRichBlack("#1a1a1a")).toBe(false);
		expect(isRichBlack("#0f766e")).toBe(false);
		expect(isRichBlack("#10182800")).toBe(false);
		expect(isRichBlack("{{ink}}")).toBe(false);
	});
});

describe("printHints", () => {
	test("each check fires on the preflight fixture", () => {
		const hints = printHints(fixtures.printPreflightCard);
		expect(codes(hints)).toEqual([
			"band:short_of_bleed",
			"fine_print:small_text",
			"name:rich_black_text",
			"rule:hairline_stroke",
			"thin_label:small_text",
		]);
		const at = (id: string) => hints.find((h) => h.id === id)?.issue;
		expect(at("fine_print")).toEqual({
			code: "small_text",
			sizePt: 4.8,
			minPt: 6,
			light: false,
		});
		expect(at("thin_label")).toMatchObject({ minPt: 7, light: true });
		expect(at("rule")).toEqual({
			code: "hairline_stroke",
			widthPt: 0.12,
			minPt: 0.25,
		});
		expect(at("name")).toMatchObject({ color: "#101828", maxPt: 12 });
		expect(at("band")).toEqual({
			code: "short_of_bleed",
			edges: ["left", "top", "right"],
		});
		expect(hints.find((h) => h.id === "rule")).toMatchObject({
			kind: "print",
			side: 0,
			sideName: "front",
			path: [3],
		});
	});

	test("a clean template has none", () => {
		expect(printHints(fixtures.minimalCard)).toEqual([]);
		expect(printHints(fixtures.fullFeatureCard)).toEqual([]);
		expect(
			printHints(
				card({ bleed: 24 }, [
					text("title", 60, { color: "#000000" }),
					box("full", 0, 0, 1012, 638),
					box("past", -24, -24, 1060, 100, {
						fill: "#000",
						stroke: { color: "#000", width: 4 },
					}),
				]),
			),
		).toEqual([]);
	});

	test("take their thresholds and DPI from the options", () => {
		const t = card({}, [text("t", 30)]);
		expect(printHints(t)).toEqual([]);
		expect(codes(printHints(t, { minTextPt: 8 }))).toEqual(["t:small_text"]);
		expect(codes(printHints(t, { dpi: 600 }))).toEqual(["t:small_text"]);
	});

	test("read the thinnest side of a stroke with a width per side", () => {
		const sided = (width: Record<string, number>) =>
			card({ format_version: "1.7" }, [
				box("edge", 100, 100, 200, 100, {
					fill: "#fff",
					stroke: { color: "#000", width },
				}),
			]);
		expect(printHints(sided({ top: 4, bottom: 0.5 }))[0]?.issue).toEqual({
			code: "hairline_stroke",
			widthPt: 0.12,
			minPt: 0.25,
		});
		expect(printHints(sided({ top: 4, left: 0, bottom: 2 }))).toEqual([]);
	});

	test("read spans, nested layers and text strokes, and skip hidden ones", () => {
		const frame = {
			id: "group",
			type: "frame",
			pos: { x: 0, y: 0 },
			size: { width: 500, height: 500 },
			properties: {
				children: [
					text("spans", 40, {
						spans: [{ text: "big" }, { text: "tiny", font: { size: 10 } }],
					}),
					text("outlined", 40, {
						stroke: { color: "#000", width: 0.5 },
					}),
					{ ...text("gone", 5), hidden: true },
				],
			},
		} as Element;
		const hints = printHints(card({}, [frame]));
		expect(codes(hints)).toEqual([
			"outlined:hairline_stroke",
			"spans:small_text",
		]);
		expect(hints.find((h) => h.id === "spans")?.path).toEqual([0, 0]);
	});

	test("leave a field-bound colour to the render", () => {
		const t = card({}, [text("ink", 30, { color: "{{name}}" })]);
		expect(printHints(t)).toEqual([]);
		const gradient = card({}, [
			text("g", 30, {
				fill: {
					kind: "linear",
					stops: [
						{ offset: 0, color: "#101828" },
						{ offset: 1, color: "#281810" },
					],
				},
			}),
		]);
		expect(printHints(gradient)).toEqual([]);
	});

	test("short of bleed needs a bleed and an edge at the trim", () => {
		const stroked = {
			fill: "#000",
			stroke: { color: "#000", width: 4 },
		};
		const near = [box("edge", 0, 300, 400, 100, stroked)];
		expect(printHints(card({}, near))).toEqual([]);
		expect(codes(printHints(card({ bleed: 24 }, near)))).toEqual([
			"edge:short_of_bleed",
		]);
		expect(
			printHints(
				card({ bleed: 24 }, [box("inside", 40, 300, 400, 100, stroked)]),
			),
		).toEqual([]);
		const partial = printHints(
			card({ bleed: 24 }, [
				box("partial", -10, 300, 400, 100, { src: "a.png", fit: "cover" }, "image"),
			]),
		);
		expect(partial[0]?.issue).toEqual({ code: "short_of_bleed", edges: ["left"] });
		expect(
			printHints(
				card({ bleed: { top: 0, right: 0, bottom: 0, left: 24 } }, [
					box("grown", 0, 0, 400, 638, { fill: "#000" }),
				]),
			),
		).toEqual([]);
		const rotated = printHints(
			card({ bleed: 24 }, [
				{ ...box("turned", -50, 269, 300, 100), rotation: 90 },
			]),
		);
		expect(rotated).toEqual([]);
		const vector = {
			...box("v", 0, 0, 10, 10),
			type: "vector",
			properties: { d: "M0 0H10V10Z" },
		} as Element;
		expect(printHints(card({ bleed: 24 }, [vector]))).toEqual([]);
	});

	test("are part of templateHints", () => {
		const hints = templateHints(fixtures.printPreflightCard);
		expect(hints.filter((h) => h.kind === "print")).toHaveLength(5);
		expect(
			templateHints(fixtures.printPreflightCard, {}, { minTextPt: 1, minLightTextPt: 1 })
				.filter((h) => h.kind === "print" && h.issue.code === "small_text"),
		).toEqual([]);
	});

	test("take the image check's DPI unless they set their own", () => {
		const t = card({}, [text("t", 30)]);
		expect(templateHints(t, { dpi: 600 }).map((h) => h.kind)).toEqual(["print"]);
		expect(templateHints(t, { dpi: 600 }, { dpi: 300 })).toEqual([]);
	});

	test("describe each issue in words", () => {
		for (const h of printHints(fixtures.printPreflightCard))
			expect(describePrintIssue(h.issue)).toMatch(/\w/);
		expect(
			describePrintIssue({ code: "short_of_bleed", edges: ["left", "top"] }),
		).toContain("left and top");
	});
});

describe("printCheckWarnings", () => {
	const commandsOf = (t: Template, values: Record<string, unknown> = {}) =>
		compileToCommands(t, values, { width: t.width, height: t.height })[0]
			?.commands ?? [];

	test("check text with its field values", () => {
		const t = card({}, [text("ink", 30, { color: "{{name}}" })]);
		expect(printCheckWarnings(commandsOf(t, { name: "#000000" }))).toEqual([]);
		expect(printCheckWarnings(commandsOf(t, { name: "#101828" }))).toEqual([
			{
				kind: "print_check",
				layer: "ink",
				issue: {
					code: "rich_black_text",
					color: "#101828",
					sizePt: 7.2,
					maxPt: 12,
				},
			},
		]);
	});

	test("check text at the size fit shrinks it to", () => {
		const t = card({}, [
			{
				...text("fit", 40, { value: "{{name}}", fit: "shrink" }),
				size: { width: 200, height: 60 },
			} as Element,
		]);
		expect(printCheckWarnings(commandsOf(t, { name: "Ada" }))).toEqual([]);
		const long = printCheckWarnings(
			commandsOf(t, { name: "A much longer name than the box can hold at size" }),
		);
		expect(long.map((w) => w.issue.code)).toEqual(["small_text"]);
	});

	test("read a rect's thinnest drawn side", () => {
		const rect = {
			op: "drawRect",
			id: "box",
			pos: { x: 0, y: 0 },
			size: { width: 10, height: 10 },
			stroke: {
				color: "#000",
				width: 4,
				sides: { top: 4, right: 0, bottom: 0.5, left: 4 },
			},
		};
		expect(printCheckWarnings([rect])[0]?.issue).toEqual({
			code: "hairline_stroke",
			widthPt: 0.12,
			minPt: 0.25,
		});
	});

	test("scale a stroke by its path's viewBox", () => {
		const path = (width: number) => ({
			op: "drawPath",
			id: "icon",
			pos: { x: 0, y: 0 },
			size: { width: 10, height: 10 },
			d: "M0 0L100 100",
			viewBox: { width: 100, height: 100 },
			stroke: { color: "#000", width },
		});
		expect(printCheckWarnings([path(20)])).toEqual([]);
		expect(printCheckWarnings([path(5)])).toEqual([
			{
				kind: "print_check",
				layer: "icon",
				issue: { code: "hairline_stroke", widthPt: 0.12, minPt: 0.25 },
			},
		]);
	});

	test("report each layer and check once, at its worst", () => {
		const t = card({}, [
			text("mixed", 40, {
				spans: [
					{ text: "a ", font: { size: 20 } },
					{ text: "b", font: { size: 10 } },
				],
			}),
		]);
		const warnings = printCheckWarnings(commandsOf(t));
		expect(warnings).toHaveLength(1);
		expect(warnings[0]?.issue).toMatchObject({ code: "small_text", sizePt: 2.4 });
	});

	test("come out of a render as warnings when asked for", async () => {
		const ck = await loadCanvasKit();
		const renderer = await createRenderer({ ck: ck as never, cache: false });
		const t = card({}, [text("fine", 20)]);
		const quiet = await renderTemplate(renderer, t, {});
		expect(quiet[0]?.warnings.filter((w) => w.kind === "print_check")).toEqual([]);
		const [frame] = await renderTemplate(renderer, t, {}, { printChecks: {} });
		const checks = frame?.warnings.filter((w) => w.kind === "print_check") ?? [];
		expect(checks).toHaveLength(1);
		expect(describeWarning(checks[0] as never)).toBe(
			"Text is 4.8 pt at print size, below 6 pt: fine",
		);
	});
});
