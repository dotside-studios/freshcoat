import { describe, expect, test } from "vitest";
import { fixtures } from "../fixtures";
import {
	isPrintedCard,
	printGuideMetrics,
	printGuidesFor,
} from "../src/bleed";
import { safeAreaHints, templateHints } from "../src/hints";
import type { Element, Template } from "../src/types";

function card(extra: Partial<Template> = {}, elements: Element[] = []): Template {
	return {
		format_version: "1.6",
		id: "t",
		name: "T",
		width: 1012,
		height: 638,
		fields: { type: "object", properties: {} },
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

const rect = (id: string, x: number, y: number, w: number, h: number) =>
	({
		id,
		type: "rect",
		pos: { x, y },
		size: { width: w, height: h },
		properties: { fill: "#0000ff" },
	}) as Element;

describe("print guides", () => {
	test("scale with the template's long side", () => {
		const m = printGuideMetrics({ width: 1012, height: 638 });
		expect(m.corner).toBeCloseTo(37.6, 1);
		expect(m.safe).toBeCloseTo(35.47, 1);
		expect(printGuideMetrics({ width: 638, height: 1012 })).toEqual(m);
	});

	test("give a CR80 card the printer's safe area unless it sets its own", () => {
		const printed = card({ product: "card_cr80" });
		expect(isPrintedCard(printed)).toBe(true);
		expect(printGuidesFor(printed).safe?.left).toBeCloseTo(35.47, 1);
		expect(printGuidesFor({ ...printed, safeArea: 10 }).safe?.left).toBe(10);
		expect(printGuidesFor(card()).safe).toBeNull();
		expect(printGuidesFor(card()).corner).toBe(0);
	});
});

describe("templateHints", () => {
	test("a clean template has none", () => {
		expect(templateHints(fixtures.minimalCard)).toEqual([]);
	});

	test("lists layers inside the template's safe area with their data", () => {
		const t = card({ safeArea: 40 }, [
			rect("near", 10, 100, 100, 50),
			rect("clear", 100, 100, 100, 50),
			rect("bleed", -10, -10, 1032, 658),
		]);
		expect(templateHints(t)).toEqual([
			{
				kind: "safe_area",
				side: 0,
				sideName: "front",
				index: 0,
				id: "near",
				edges: ["left"],
				safe: { top: 40, right: 40, bottom: 40, left: 40 },
			},
		]);
	});

	test("checks a CR80 card without a safe area against the printer's", () => {
		const t = card({ product: "card_cr80" }, [rect("near", 10, 100, 100, 50)]);
		const hints = safeAreaHints(t);
		expect(hints.map((h) => [h.id, h.edges])).toEqual([["near", ["left"]]]);
		expect(safeAreaHints(card({}, [rect("near", 10, 100, 100, 50)]))).toEqual([]);
	});

	test("reports variant issues as they are", () => {
		const t = card({
			variants: [
				{
					id: "v",
					label: "V",
					overrides: [
						{ side: "front", elements: [{ id: "gone", properties: {} }] },
					],
				},
			],
		} as never);
		const hints = templateHints(t);
		expect(hints.map((h) => h.kind)).toEqual(["variant"]);
	});

	test("reports a format newer than read and one declared too low", () => {
		expect(templateHints(card({ format_version: "1.99" }))).toEqual([
			{ kind: "format_newer", declared: "1.99" },
		]);
		const low = templateHints(card({ format_version: "1.0" }));
		expect(low).toEqual([
			{ kind: "format_low", declared: "1.0", needed: expect.any(String) },
		]);
	});
});
