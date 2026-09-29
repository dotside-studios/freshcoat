import {
	compile,
	FORMAT_VERSION,
	type TemplateWarning,
	validate,
} from "@freshcoat-js/coatfile";
import { describe, expect, it, vi } from "vitest";
import {
	combineGuides,
	guideKind,
	readSlotGuides,
	toInsets,
} from "~/lib/figma/transpiler/guides";
import {
	type ProductRegistryEntry,
	type TranspileInput,
	transpile,
} from "~/lib/figma/transpiler/index";
import type { FigmaContainerNode, FigmaNode } from "~/lib/figma/types";
import { collectRasterTargets } from "~/main/raster-targets";

const CR80: ProductRegistryEntry = {
	sku: "card_cr80",
	displayName: "CR80 Card",
	width: 1013,
	height: 638,
	frames: [
		{ name: "front", label: "Front", required: true },
		{ name: "back", label: "Back", required: true },
	],
};

function rect(
	id: string,
	name: string,
	box: { x: number; y: number; width: number; height: number },
	extra: Partial<FigmaNode> = {},
): FigmaNode {
	return {
		id,
		name,
		type: "RECTANGLE",
		visible: true,
		opacity: 1,
		blendMode: "NORMAL",
		absoluteBoundingBox: box,
		width: box.width,
		height: box.height,
		relativeTransform: [
			[1, 0, box.x],
			[0, 1, box.y],
		],
		absoluteTransform: [
			[1, 0, box.x],
			[0, 1, box.y],
		],
		fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
		...extra,
	} as FigmaNode;
}

function slotFrame(
	id: string,
	children: FigmaNode[],
	box = { x: 0, y: 0, width: 1013, height: 638 },
): FigmaContainerNode {
	return {
		id,
		name: id,
		type: "FRAME",
		visible: true,
		opacity: 1,
		blendMode: "NORMAL",
		clipsContent: false,
		absoluteBoundingBox: box,
		fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
		children,
	};
}

const bleedGuide = (id: string, extra: Partial<FigmaNode> = {}) =>
	rect(
		id,
		"guide:bleed",
		{ x: -35, y: -35, width: 1083, height: 708 },
		{ fills: [], ...extra },
	);
const safeGuide = (id: string) =>
	rect(id, "guide:safe-area", { x: 35, y: 35, width: 943, height: 568 });

function input(front: FigmaContainerNode, back: FigmaContainerNode) {
	const trees: Record<string, FigmaContainerNode> = { front, back };
	return {
		product: CR80,
		picks: Object.fromEntries(
			Object.keys(trees).map((name) => [
				name,
				{
					fileKey: "FK",
					nodeId: name,
					nodeName: name,
					width: 1013,
					height: 638,
				},
			]),
		),
		metadata: {
			id: "t",
			name: "T",
			version: "1.0.0",
			formatVersion: FORMAT_VERSION,
		},
		fetchNodeTree: async (_fk: string, nodeId: string) => trees[nodeId],
		renderImage: vi.fn(),
	} satisfies TranspileInput;
}

type Out = {
	bleed?: unknown;
	safeArea?: unknown;
	template_data: Array<{
		elements: Array<{ id: string; pos: { x: number; y: number } }>;
	}>;
};

describe("guideKind", () => {
	it("reads the two guide names, loosely spelled", () => {
		expect(guideKind("guide:bleed")).toBe("bleed");
		expect(guideKind(" Guide: Safe-Area ")).toBe("safe-area");
		expect(guideKind("bleed")).toBeUndefined();
		expect(guideKind("guide:margin")).toBeUndefined();
		expect(guideKind("text:{{bleed}}")).toBeUndefined();
	});
});

describe("readSlotGuides", () => {
	it("measures the bleed past the frame and the safe area inside it, per side", () => {
		const frame = slotFrame(
			"front",
			[
				rect("g1", "guide:bleed", { x: 90, y: 95, width: 130, height: 115 }),
				rect("g2", "guide:safe-area", {
					x: 110,
					y: 104,
					width: 85,
					height: 90,
				}),
			],
			{ x: 100, y: 100, width: 100, height: 100 },
		);
		const warnings: TemplateWarning[] = [];
		expect(readSlotGuides(frame, "front", 2, warnings)).toEqual({
			bleed: { top: 10, right: 40, bottom: 20, left: 20 },
			safeArea: { top: 8, right: 10, bottom: 12, left: 20 },
		});
		expect(warnings).toEqual([]);
	});

	it("warns about a guide that measures nothing, and a second guide", () => {
		const frame = slotFrame("front", [
			rect("g1", "guide:bleed", { x: 0, y: 0, width: 1013, height: 638 }),
			bleedGuide("g2"),
			bleedGuide("g3"),
		]);
		const warnings: TemplateWarning[] = [];
		expect(readSlotGuides(frame, "front", 1, warnings)).toEqual({
			bleed: { top: 35, right: 35, bottom: 35, left: 35 },
		});
		expect(warnings.map((w) => [w.code, w.nodeId])).toEqual([
			["guide_empty", "g1"],
			["guide_duplicate", "g3"],
		]);
	});
});

describe("combineGuides", () => {
	const canvas = { width: 100, height: 60 };
	const even = { top: 3, right: 3, bottom: 3, left: 3 };

	it("writes one number when every side agrees", () => {
		expect(toInsets(even)).toBe(3);
		expect(toInsets({ ...even, left: 4 })).toEqual({ ...even, left: 4 });
	});

	it("takes the larger inset on each side when slots differ", () => {
		const warnings: TemplateWarning[] = [];
		const out = combineGuides(
			[
				{ slot: "front", guides: { bleed: even } },
				{ slot: "back", guides: { bleed: { ...even, top: 5 } } },
			],
			canvas,
			warnings,
		);
		expect(out).toEqual({ bleed: { ...even, top: 5 } });
		expect(warnings.map((w) => w.code)).toEqual(["guide_mismatch"]);
	});

	it("warns when only some slots have a guide", () => {
		const warnings: TemplateWarning[] = [];
		const out = combineGuides(
			[
				{ slot: "front", guides: { bleed: even } },
				{ slot: "back", guides: {} },
			],
			canvas,
			warnings,
		);
		expect(out).toEqual({ bleed: 3 });
		expect(warnings.map((w) => w.code)).toEqual(["guide_mismatch"]);
	});

	it("drops a safe area that leaves no room inside the canvas", () => {
		const warnings: TemplateWarning[] = [];
		const out = combineGuides(
			[
				{
					slot: "front",
					guides: { safeArea: { top: 30, right: 1, bottom: 30, left: 1 } },
				},
			],
			canvas,
			warnings,
		);
		expect(out).toEqual({});
		expect(warnings.map((w) => w.code)).toEqual([
			"guide_safe_area_exceeds_trim",
		]);
	});
});

describe("transpile with print guides", () => {
	it("emits bleed and safe area, keeps artwork in trim coordinates, and drops the guides", async () => {
		const art = rect("a", "art", { x: -35, y: 100, width: 300, height: 200 });
		const out = await transpile(
			input(
				slotFrame("front", [bleedGuide("g1"), safeGuide("g2"), art]),
				slotFrame("back", [bleedGuide("g3"), safeGuide("g4")]),
			),
		);
		const t = out.template as Out;
		expect(t.bleed).toBe(35);
		expect(t.safeArea).toBe(35);
		expect(out.warnings.filter((w) => w.code.startsWith("guide_"))).toEqual([]);
		expect(t.template_data[0].elements.map((e) => [e.id, e.pos])).toEqual([
			["art", { x: -35, y: 100 }],
		]);
		expect(t.template_data[1].elements).toEqual([]);
		expect(out.trace.map((r) => r.nodeId)).toEqual(["a"]);

		const v = validate(out.template);
		expect(v.ok).toBe(true);
		if (!v.ok) return;
		const compiled = compile(
			v.value,
			{},
			{ width: 1013, height: 638, bleed: true },
		);
		expect([compiled.width, compiled.height]).toEqual([1083, 708]);
		expect(compiled.trim).toEqual({ x: 35, y: 35, width: 1013, height: 638 });
	});

	it("reads a hidden guide", async () => {
		const out = await transpile(
			input(
				slotFrame("front", [bleedGuide("g1", { visible: false })]),
				slotFrame("back", [bleedGuide("g2", { visible: false })]),
			),
		);
		expect((out.template as Out).bleed).toBe(35);
		expect(out.report.decisions).toBeUndefined();
	});

	it("leaves a design without guides as it was", async () => {
		const out = await transpile(
			input(slotFrame("front", []), slotFrame("back", [])),
		);
		const t = out.template as Out;
		expect("bleed" in t).toBe(false);
		expect("safeArea" in t).toBe(false);
	});

	it("never rasterizes a guide", () => {
		const blurred = bleedGuide("g1", {
			effects: [{ type: "BACKGROUND_BLUR", visible: true, radius: 4 }],
			fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
		});
		expect(collectRasterTargets(slotFrame("front", [blurred]))).toEqual([]);
	});
});
