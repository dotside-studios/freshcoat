import { compile, type Template, validate } from "@freshcoat-js/coatfile";
import { describe, expect, it, vi } from "vitest";
import {
	type ColorwayInput,
	type ProductRegistryEntry,
	type TranspileOutput,
	transpile,
} from "~/lib/figma/transpiler/index";
import {
	hiddenElements,
	traceElementsByNode,
} from "~/lib/figma/transpiler/variant-deltas";
import type { FigmaContainerNode, FigmaNode } from "~/lib/figma/types";

// A colorway instance sits elsewhere on the page than its main component, and
// its layers carry Figma's `I<instance>;<node>` ids. Every tree here is built
// once per side from the same description, so the two differ only where a test
// says they do.

const PRODUCT: ProductRegistryEntry = {
	sku: "card_cr80",
	displayName: "CR80 Card",
	width: 1000,
	height: 600,
	frames: [{ name: "front", label: "Front", required: true }],
};

type Side = { originX: number; idPrefix: string };
const BASE: Side = { originX: 0, idPrefix: "" };
const INSTANCE: Side = { originX: 2000, idPrefix: "I9;" };

type Box = { x: number; y: number; width: number; height: number };

function rect(
	side: Side,
	id: string,
	name: string,
	box: Box,
	extra: Partial<FigmaNode> = {},
): FigmaNode {
	return {
		id: side.idPrefix + id,
		name,
		type: "RECTANGLE",
		visible: true,
		opacity: 1,
		blendMode: "NORMAL",
		absoluteBoundingBox: { ...box, x: box.x + side.originX },
		fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
		...extra,
	} as FigmaNode;
}

function container(
	side: Side,
	type: "FRAME" | "GROUP",
	id: string,
	name: string,
	box: Box,
	children: FigmaNode[],
	extra: Partial<FigmaNode> = {},
): FigmaNode {
	return {
		id: side.idPrefix + id,
		name,
		type,
		visible: true,
		opacity: 1,
		blendMode: type === "GROUP" ? "PASS_THROUGH" : "NORMAL",
		absoluteBoundingBox: { ...box, x: box.x + side.originX },
		fills: [],
		children,
		...extra,
	} as FigmaNode;
}

function card(side: Side, children: FigmaNode[]): FigmaContainerNode {
	return {
		id: `${side.idPrefix}1:1`,
		name: "front",
		type: "FRAME",
		visible: true,
		opacity: 1,
		blendMode: "NORMAL",
		absoluteBoundingBox: { x: side.originX, y: 0, width: 1000, height: 600 },
		fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
		children,
	} as FigmaContainerNode;
}

function run(
	base: FigmaContainerNode,
	colorways: Array<{ label: string; front: FigmaContainerNode }>,
): Promise<TranspileOutput> {
	const variants: ColorwayInput[] = colorways.map((c, i) => ({
		instanceId: `I:${i}`,
		label: c.label,
		perSide: { front: c.front },
	}));
	return transpile({
		product: PRODUCT,
		sizeMode: "from-design",
		picks: {
			front: {
				fileKey: "FK",
				nodeId: "1:1",
				nodeName: "front",
				width: 1000,
				height: 600,
			},
		},
		variants,
		metadata: { id: "t", name: "T", version: "1.0.0", formatVersion: "1.4" },
		fetchNodeTree: vi.fn(async () => base),
		renderImage: vi.fn(),
	});
}

type Delta = { id: string } & Record<string, unknown>;
type Out = {
	variants?: Array<{
		id: string;
		label: string;
		overrides: Array<{ name: string; elements?: Delta[] }>;
	}>;
};

function deltas(out: TranspileOutput, variantId: string): Delta[] {
	const v = (out.template as Out).variants?.find((x) => x.id === variantId);
	return v?.overrides.flatMap((o) => o.elements ?? []) ?? [];
}

const LOGO: Box = { x: 40, y: 40, width: 100, height: 60 };

describe("variant shell deltas", () => {
	it("writes a moved and resized layer as pos and size, with empty properties", async () => {
		const base = card(BASE, [rect(BASE, "1:2", "logo", LOGO)]);
		const moved = card(INSTANCE, [
			rect(INSTANCE, "1:2", "logo", { x: 600, y: 300, width: 200, height: 60 }),
		]);
		const out = await run(base, [{ label: "Moved", front: moved }]);

		expect(deltas(out, "moved")).toEqual([
			{
				id: "logo",
				properties: {},
				pos: { x: 600, y: 300 },
				size: { width: 200, height: 60 },
			},
		]);
		expect(out.warnings.map((w) => w.code)).not.toContain(
			"variant_structure_mismatch",
		);
	});

	it("writes a changed opacity, alongside a properties change", async () => {
		const base = card(BASE, [rect(BASE, "1:2", "logo", LOGO)]);
		const faded = card(INSTANCE, [
			rect(INSTANCE, "1:2", "logo", LOGO, {
				opacity: 0.5,
				fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 1, a: 1 } }],
			} as Partial<FigmaNode>),
		]);
		const out = await run(base, [{ label: "Faded", front: faded }]);

		expect(deltas(out, "faded")).toEqual([
			{ id: "logo", properties: { fill: "#0000ff" }, opacity: 0.5 },
		]);
	});

	it("writes a rotation, and an unrotated base reads as 0", async () => {
		const base = card(BASE, [rect(BASE, "1:2", "logo", LOGO)]);
		const c = Math.cos(Math.PI / 2);
		const s = Math.sin(Math.PI / 2);
		// A 100×60 layer turned a quarter: its world box is 60×100 around the
		// same centre.
		const turned = card(INSTANCE, [
			rect(INSTANCE, "1:2", "logo", { x: 60, y: 20, width: 60, height: 100 }, {
				width: 100,
				height: 60,
				absoluteTransform: [
					[c, -s, INSTANCE.originX + 120],
					[s, c, 20],
				],
			} as Partial<FigmaNode>),
		]);
		const out = await run(base, [{ label: "Turned", front: turned }]);

		const [delta] = deltas(out, "turned");
		expect(delta.id).toBe("logo");
		expect(Math.abs(delta.rotation as number)).toBeCloseTo(90);
		expect(delta.pos).toBeUndefined();
		expect(delta.size).toBeUndefined();
	});

	it("gives a resized frame's children their own position deltas", async () => {
		const panel = (side: Side, width: number, dotX: number): FigmaNode =>
			container(
				side,
				"FRAME",
				"1:3",
				"panel",
				{ x: 100, y: 100, width, height: 200 },
				[
					rect(
						side,
						"1:4",
						"dot",
						{ x: 100 + dotX, y: 120, width: 40, height: 40 },
						{
							relativeTransform: [
								[1, 0, dotX],
								[0, 1, 20],
							],
						} as Partial<FigmaNode>,
					),
				],
				{
					fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
				} as Partial<FigmaNode>,
			);
		const base = card(BASE, [panel(BASE, 300, 240)]);
		const wide = card(INSTANCE, [panel(INSTANCE, 400, 340)]);
		const out = await run(base, [{ label: "Wide", front: wide }]);

		expect(deltas(out, "wide")).toEqual([
			{ id: "panel", properties: {}, size: { width: 400, height: 200 } },
			{ id: "dot", properties: {}, pos: { x: 340, y: 20 } },
		]);
	});

	it("round-trips through compile: the colorway's layer lands where the instance put it", async () => {
		const base = card(BASE, [rect(BASE, "1:2", "logo", LOGO)]);
		const moved = card(INSTANCE, [
			rect(INSTANCE, "1:2", "logo", { ...LOGO, x: 700, y: 400 }),
		]);
		const out = await run(base, [{ label: "Moved", front: moved }]);
		const template = out.template as Template;
		expect(validate(template).ok).toBe(true);

		const logoOf = (variantId?: string) => {
			const compiled = compile(
				template,
				{},
				{ width: 1000, height: 600, variantId },
			);
			const frame = compiled.frames[0];
			const found = findNode(frame?.root, "logo");
			if (!found) throw new Error("no logo in the compiled frame");
			return found;
		};
		expect(logoOf()).toMatchObject({ pos: { x: 40, y: 40 } });
		expect(logoOf("moved")).toMatchObject({ pos: { x: 700, y: 400 } });
	});
});

describe("variant visibility", () => {
	it("writes a layer the instance hides as hidden, and the duplicate after it still aligns", async () => {
		const tags = (side: Side, firstVisible: boolean) =>
			card(side, [
				rect(side, "1:2", "tag", LOGO, { visible: firstVisible }),
				rect(side, "1:3", "tag", { ...LOGO, y: 200 }),
			]);
		const out = await run(tags(BASE, true), [
			{ label: "Plain", front: tags(INSTANCE, false) },
		]);

		expect(deltas(out, "plain")).toEqual([
			{ id: "tag", properties: {}, hidden: true },
		]);
		expect(out.warnings.map((w) => w.code)).not.toContain(
			"variant_structure_mismatch",
		);
		const compiled = compile(
			out.template as Template,
			{},
			{ width: 1000, height: 600, variantId: "plain" },
		);
		expect(findNode(compiled.frames[0]?.root, "tag")).toBeUndefined();
		expect(findNode(compiled.frames[0]?.root, "tag_2")).toBeDefined();
	});

	it("reads a layer at zero opacity in the instance as hidden", async () => {
		const base = card(BASE, [rect(BASE, "1:2", "logo", LOGO)]);
		const gone = card(INSTANCE, [
			rect(INSTANCE, "1:2", "logo", LOGO, { opacity: 0 }),
		]);
		const out = await run(base, [{ label: "Gone", front: gone }]);

		expect(deltas(out, "gone")).toEqual([
			{ id: "logo", properties: {}, hidden: true },
		]);
	});

	it("hides a frame as one delta, not one per child", async () => {
		const box = (side: Side, visible: boolean) =>
			card(side, [
				container(
					side,
					"FRAME",
					"1:3",
					"panel",
					{ x: 100, y: 100, width: 300, height: 200 },
					[rect(side, "1:4", "dot", { x: 120, y: 120, width: 40, height: 40 })],
					{
						visible,
						fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
					} as Partial<FigmaNode>,
				),
			]);
		const out = await run(box(BASE, true), [
			{ label: "Bare", front: box(INSTANCE, false) },
		]);

		expect(deltas(out, "bare")).toEqual([
			{ id: "panel", properties: {}, hidden: true },
		]);
	});

	it("hides each layer of a hidden group, since a group is no element", async () => {
		const grouped = (side: Side, visible: boolean) =>
			card(side, [
				container(
					side,
					"GROUP",
					"1:3",
					"badge",
					{ x: 40, y: 40, width: 300, height: 60 },
					[
						rect(side, "1:4", "pill", LOGO),
						rect(side, "1:5", "star", { ...LOGO, x: 240 }),
					],
					{ visible },
				),
			]);
		const out = await run(grouped(BASE, true), [
			{ label: "Bare", front: grouped(INSTANCE, false) },
		]);

		expect(deltas(out, "bare")).toEqual([
			{ id: "pill", properties: {}, hidden: true },
			{ id: "star", properties: {}, hidden: true },
		]);
	});

	it("warns about a layer the instance shows and the base hides, and leaves it hidden", async () => {
		const base = card(BASE, [
			rect(BASE, "1:2", "extra", LOGO, { visible: false }),
			rect(BASE, "1:3", "logo", { ...LOGO, y: 200 }),
		]);
		const shown = card(INSTANCE, [
			rect(INSTANCE, "1:2", "extra", LOGO),
			rect(INSTANCE, "1:3", "logo", { ...LOGO, y: 200 }),
		]);
		const out = await run(base, [{ label: "Loud", front: shown }]);

		expect(out.warnings).toContainEqual(
			expect.objectContaining({
				severity: "warn",
				code: "variant_unhide_unsupported",
				nodeId: "I9;1:2",
				slot: "front",
			}),
		);
		expect(out.warnings.map((w) => w.code)).not.toContain(
			"variant_structure_mismatch",
		);
		const v = (out.template as Out).variants?.find((x) => x.id === "loud");
		expect(v?.overrides).toEqual([]);
	});
});

describe("variant ids", () => {
	it("keeps the synthetic default first and suffixes repeated slugs", async () => {
		const base = card(BASE, [rect(BASE, "1:2", "logo", LOGO)]);
		const same = () => card(INSTANCE, [rect(INSTANCE, "1:2", "logo", LOGO)]);
		const out = await run(base, [
			{ label: "Default", front: same() },
			{ label: "Amber", front: same() },
			{ label: "amber!", front: same() },
			{ label: "Amber", front: same() },
		]);

		const variants = (out.template as Out).variants ?? [];
		expect(variants.map((v) => [v.id, v.label])).toEqual([
			["default", "Default"],
			["default-2", "Default"],
			["amber", "Amber"],
			["amber-2", "amber!"],
			["amber-3", "Amber"],
		]);
		expect(variants[0].overrides).toEqual([]);
		expect(Object.keys(out.variantPicks)).toEqual([
			"default-2",
			"amber",
			"amber-2",
			"amber-3",
		]);
		expect(validate(out.template).ok).toBe(true);
	});
});

function findNode(
	node: unknown,
	id: string,
): Record<string, unknown> | undefined {
	if (!node || typeof node !== "object") return undefined;
	const n = node as Record<string, unknown>;
	if (n.id === id) return n;
	for (const child of (n.children as unknown[] | undefined) ?? []) {
		const found = findNode(child, id);
		if (found) return found;
	}
	return undefined;
}

describe("hiddenElements", () => {
	const trace = [
		{ slot: "front", nodeId: "1:1", elementId: "group" },
		{ slot: "front", nodeId: "1:2", elementId: "label" },
		{ slot: "front", nodeId: "1:3" },
		{ slot: "back", nodeId: "1:1", elementId: "other" },
	].map((t) => ({
		...t,
		name: t.nodeId,
		nodeType: "FRAME",
		decision: "native",
	}));
	const elements = [
		{
			id: "group",
			type: "frame",
			properties: { children: [{ id: "label", type: "text" }] },
		},
		{ id: "solo", type: "rect" },
	];

	it("indexes the side's trace by node", () => {
		expect([...traceElementsByNode(trace as never, "front")]).toEqual([
			["1:1", ["group"]],
			["1:2", ["label"]],
		]);
	});

	it("marks the outermost hidden element and everything under it", () => {
		const index = traceElementsByNode(trace as never, "front");
		const hidden = hiddenElements(elements, index, new Set(["1:1", "1:2"]));
		expect([...hidden.top]).toEqual(["group"]);
		expect([...hidden.within]).toEqual(["group", "label"]);
	});
});
