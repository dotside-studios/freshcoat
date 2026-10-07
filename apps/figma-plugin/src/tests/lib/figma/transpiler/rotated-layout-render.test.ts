// A rotated auto-layout frame keeps its live layout. Each case renders the
// transpiled template twice: as emitted, and with every `layout`/`layoutChild`
// stripped so the baked Figma positions draw as-is. The two must match.
import { type Template, validate } from "@freshcoat-js/coatfile";
import { renderTemplate } from "@freshcoat-js/coatfile/render";
import { createRenderer, decodePixels } from "@freshcoat-js/engine";
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, it } from "vitest";
import {
	type ProductRegistryEntry,
	transpile,
} from "~/lib/figma/transpiler/index";
import type {
	FigmaContainerNode,
	FigmaNode,
	FigmaTransform,
} from "~/lib/figma/types";

const W = 400;
const H = 300;

const PRODUCT: ProductRegistryEntry = {
	sku: "test",
	displayName: "Test",
	width: W,
	height: H,
	frames: [{ name: "front", label: "Front", required: true }],
};

type Rgb = { r: number; g: number; b: number };
const RED: Rgb = { r: 1, g: 0, b: 0 };
const GREEN: Rgb = { r: 0, g: 0.7, b: 0 };
const BLUE: Rgb = { r: 0, g: 0, b: 1 };
const GREY: Rgb = { r: 0.85, g: 0.85, b: 0.85 };

// `at` is the top-left of the node's axis-aligned box in its parent's space,
// `rotation` is clockwise degrees (coatfile's sense).
type Spec = {
	name: string;
	at: { x: number; y: number };
	w: number;
	h: number;
	rotation?: number;
	color?: Rgb;
	frame?: Partial<FigmaContainerNode>;
	child?: Partial<FigmaNode>;
	children?: Spec[];
};

type M = [[number, number, number], [number, number, number]];

const mul = (a: M, b: M): M => [
	[
		a[0][0] * b[0][0] + a[0][1] * b[1][0],
		a[0][0] * b[0][1] + a[0][1] * b[1][1],
		a[0][0] * b[0][2] + a[0][1] * b[1][2] + a[0][2],
	],
	[
		a[1][0] * b[0][0] + a[1][1] * b[1][0],
		a[1][0] * b[0][1] + a[1][1] * b[1][1],
		a[1][0] * b[0][2] + a[1][1] * b[1][2] + a[1][2],
	],
];

const clean = (n: number) => Math.round(n * 1e9) / 1e9;

function corners(m: M, w: number, h: number) {
	const pts = [
		[0, 0],
		[w, 0],
		[0, h],
		[w, h],
	].map(([x, y]) => ({
		x: clean(m[0][0] * x + m[0][1] * y + m[0][2]),
		y: clean(m[1][0] * x + m[1][1] * y + m[1][2]),
	}));
	const xs = pts.map((p) => p.x);
	const ys = pts.map((p) => p.y);
	const x = Math.min(...xs);
	const y = Math.min(...ys);
	return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function build(spec: Spec, parentAbs: M): FigmaNode {
	const rad = (-(spec.rotation ?? 0) * Math.PI) / 180;
	const c = clean(Math.cos(rad));
	const s = clean(Math.sin(rad));
	const turned: M = [
		[c, s, 0],
		[-s, c, 0],
	];
	const box = corners(turned, spec.w, spec.h);
	const rel: M = [
		[c, s, clean(spec.at.x - box.x)],
		[-s, c, clean(spec.at.y - box.y)],
	];
	const abs = mul(parentAbs, rel);
	const base = {
		id: `1:${spec.name}`,
		name: spec.name,
		visible: true,
		opacity: 1,
		width: spec.w,
		height: spec.h,
		relativeTransform: rel as FigmaTransform,
		absoluteTransform: abs as FigmaTransform,
		absoluteBoundingBox: corners(abs, spec.w, spec.h),
		fills: spec.color
			? [{ type: "SOLID", color: { ...spec.color, a: 1 } }]
			: [],
		...spec.child,
	};
	if (!spec.children) {
		return { ...base, type: "RECTANGLE", blendMode: "NORMAL" } as FigmaNode;
	}
	return {
		...base,
		type: "FRAME",
		blendMode: "PASS_THROUGH",
		...spec.frame,
		children: spec.children.map((ch) => build(ch, abs)),
	} as FigmaNode;
}

function slot(children: Spec[]): FigmaContainerNode {
	return {
		id: "1:1",
		name: "front",
		type: "FRAME",
		visible: true,
		opacity: 1,
		blendMode: "NORMAL",
		absoluteBoundingBox: { x: 0, y: 0, width: W, height: H },
		absoluteTransform: [
			[1, 0, 0],
			[0, 1, 0],
		],
		fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
		children: children.map((ch) =>
			build(ch, [
				[1, 0, 0],
				[0, 1, 0],
			]),
		),
	} as unknown as FigmaContainerNode;
}

async function transpiled(children: Spec[]): Promise<Template> {
	const out = await transpile({
		product: PRODUCT,
		sizeMode: "from-design",
		picks: {
			front: {
				fileKey: "f",
				nodeId: "1:1",
				nodeName: "front",
				width: W,
				height: H,
			},
		},
		metadata: { id: "t", name: "T", version: "1.0.0", formatVersion: "1.0" },
		fetchNodeTree: async () => slot(children),
		renderImage: async () => {
			throw new Error("nothing here rasterizes");
		},
	});
	return out.template as Template;
}

function frozen<T>(v: T): T {
	if (Array.isArray(v)) return v.map(frozen) as T;
	if (v === null || typeof v !== "object") return v;
	const out: Record<string, unknown> = {};
	for (const [k, val] of Object.entries(v)) {
		if (k === "layout" || k === "layoutChild") continue;
		out[k] = frozen(val);
	}
	return out as T;
}

type El = {
	id: string;
	rotation?: number;
	properties: { layout?: unknown; children?: El[] };
	layoutChild?: unknown;
};

function find(template: Template, id: string): El {
	const walk = (els: El[]): El | undefined => {
		for (const el of els) {
			if (el.id === id) return el;
			const hit = walk(el.properties.children ?? []);
			if (hit) return hit;
		}
	};
	const els = (template as unknown as { template_data: { elements: El[] }[] })
		.template_data[0].elements;
	const hit = walk(els);
	if (!hit) throw new Error(`no element ${id}`);
	return hit;
}

// biome-ignore lint/suspicious/noExplicitAny: the untyped CanvasKit instance
let ck: any;
beforeAll(async () => {
	ck = await loadCanvasKit();
});

async function pixels(template: Template): Promise<Uint8Array> {
	expect(validate(template).ok).toBe(true);
	const [frame] = await renderTemplate(
		await createRenderer({ ck, cache: false }),
		template,
		{},
		{ width: W, height: H },
	);
	const decoded = decodePixels(ck, frame.bytes);
	if (!decoded) throw new Error("decode failed");
	return decoded.data;
}

// Pixels off by more than antialiasing noise between the two renders, plus
// how many non-white pixels the baked render has (so a blank pair can't pass).
async function compare(template: Template) {
	const live = await pixels(template);
	const baked = await pixels(frozen(template));
	let differing = 0;
	let inked = 0;
	for (let i = 0; i < baked.length; i += 4) {
		let d = 0;
		for (let c = 0; c < 3; c++)
			d = Math.max(d, Math.abs(live[i + c] - baked[i + c]));
		if (d > 8) differing++;
		if (baked[i] < 250 || baked[i + 1] < 250 || baked[i + 2] < 250) inked++;
	}
	return { differing, inked };
}

const VERTICAL = (extra: Partial<FigmaContainerNode> = {}) => ({
	layoutMode: "VERTICAL" as const,
	itemSpacing: 10,
	paddingTop: 8,
	paddingRight: 8,
	paddingBottom: 8,
	paddingLeft: 8,
	...extra,
});

describe("rotated auto-layout frames render with live layout", () => {
	it("a rotated hug column", async () => {
		// Own box 76×106: 8 + 40 + 10 + 40 + 8 tall, 8 + 60 + 8 wide.
		const template = await transpiled([
			{
				name: "panel",
				at: { x: 100, y: 80 },
				w: 76,
				h: 106,
				rotation: -90,
				color: GREY,
				frame: VERTICAL(),
				children: [
					{ name: "a", at: { x: 8, y: 8 }, w: 60, h: 40, color: RED },
					{ name: "b", at: { x: 8, y: 58 }, w: 40, h: 40, color: BLUE },
				],
			},
		]);
		expect(find(template, "panel").properties.layout).toBeDefined();
		const { differing, inked } = await compare(template);
		expect(inked).toBeGreaterThan(5000);
		expect(differing).toBe(0);
	});

	it("a rotated fixed row with centred, end-justified children", async () => {
		const template = await transpiled([
			{
				name: "panel",
				at: { x: 60, y: 40 },
				w: 200,
				h: 80,
				rotation: 90,
				color: GREY,
				frame: {
					layoutMode: "HORIZONTAL",
					itemSpacing: 12,
					primaryAxisAlignItems: "MAX",
					counterAxisAlignItems: "CENTER",
				},
				children: [
					{ name: "a", at: { x: 98, y: 20 }, w: 30, h: 40, color: RED },
					{ name: "b", at: { x: 140, y: 10 }, w: 60, h: 60, color: GREEN },
				],
			},
		]);
		expect(find(template, "panel").properties.layout).toBeDefined();
		const { differing, inked } = await compare(template);
		expect(inked).toBeGreaterThan(5000);
		expect(differing).toBe(0);
	});

	it("an upright stack nested in a rotated stack, at 30 degrees", async () => {
		// inner hugs to 8 + 30 + 10 + 30 + 8 wide, 8 + 20 + 8 tall.
		const template = await transpiled([
			{
				name: "panel",
				at: { x: 120, y: 60 },
				w: 120,
				h: 120,
				rotation: 30,
				color: GREY,
				frame: VERTICAL(),
				children: [
					{ name: "a", at: { x: 8, y: 8 }, w: 104, h: 20, color: RED },
					{
						name: "inner",
						at: { x: 8, y: 38 },
						w: 86,
						h: 36,
						color: { r: 1, g: 0.9, b: 0.6 },
						child: {
							layoutSizingHorizontal: "HUG",
							layoutSizingVertical: "HUG",
						},
						frame: {
							layoutMode: "HORIZONTAL",
							itemSpacing: 10,
							paddingTop: 8,
							paddingRight: 8,
							paddingBottom: 8,
							paddingLeft: 8,
						},
						children: [
							{ name: "c", at: { x: 8, y: 8 }, w: 30, h: 20, color: BLUE },
							{ name: "d", at: { x: 48, y: 8 }, w: 30, h: 20, color: GREEN },
						],
					},
				],
			},
		]);
		expect(find(template, "panel").properties.layout).toBeDefined();
		expect(find(template, "inner").properties.layout).toBeDefined();
		expect(find(template, "inner").layoutChild).toEqual({
			width: "hug",
			height: "hug",
		});
		const { differing, inked } = await compare(template);
		expect(inked).toBeGreaterThan(5000);
		expect(differing).toBe(0);
	});

	it("a rotated hug stack inside a rotated stack", async () => {
		// inner's own box is 76×56 (hugs 60×40 + padding); turned 90° it covers
		// 56×76 of panel's column.
		const template = await transpiled([
			{
				name: "panel",
				at: { x: 100, y: 40 },
				w: 120,
				h: 160,
				rotation: -90,
				color: GREY,
				frame: VERTICAL(),
				children: [
					{ name: "a", at: { x: 8, y: 8 }, w: 104, h: 20, color: RED },
					{
						name: "inner",
						at: { x: 8, y: 38 },
						w: 76,
						h: 56,
						rotation: 90,
						color: { r: 1, g: 0.9, b: 0.6 },
						child: {
							layoutSizingHorizontal: "HUG",
							layoutSizingVertical: "HUG",
						},
						frame: VERTICAL({ itemSpacing: 0 }),
						children: [
							{ name: "c", at: { x: 8, y: 8 }, w: 60, h: 20, color: BLUE },
							{ name: "d", at: { x: 8, y: 28 }, w: 40, h: 20, color: GREEN },
						],
					},
					{ name: "b", at: { x: 8, y: 124 }, w: 50, h: 20, color: RED },
				],
			},
		]);
		expect(find(template, "panel").properties.layout).toBeDefined();
		expect(find(template, "inner").properties.layout).toBeDefined();
		const { differing, inked } = await compare(template);
		expect(inked).toBeGreaterThan(5000);
		expect(differing).toBe(0);
	});

	it("a rotated hug stack flowing in an upright stack", async () => {
		const template = await transpiled([
			{
				name: "column",
				at: { x: 40, y: 20 },
				w: 200,
				h: 240,
				color: GREY,
				frame: VERTICAL(),
				children: [
					{ name: "a", at: { x: 8, y: 8 }, w: 184, h: 30, color: RED },
					{
						name: "inner",
						at: { x: 8, y: 48 },
						w: 76,
						h: 106,
						rotation: -90,
						color: { r: 1, g: 0.9, b: 0.6 },
						child: {
							layoutSizingHorizontal: "HUG",
							layoutSizingVertical: "HUG",
						},
						frame: VERTICAL(),
						children: [
							{ name: "c", at: { x: 8, y: 8 }, w: 60, h: 40, color: BLUE },
							{ name: "d", at: { x: 8, y: 58 }, w: 40, h: 40, color: GREEN },
						],
					},
					{ name: "b", at: { x: 8, y: 134 }, w: 100, h: 30, color: RED },
				],
			},
		]);
		expect(find(template, "inner").properties.layout).toBeDefined();
		const { differing, inked } = await compare(template);
		expect(inked).toBeGreaterThan(5000);
		expect(differing).toBe(0);
	});
	it("a rotated row with fill and grow children", async () => {
		// b grows into 160 - 10 - 40 - 10 - 10 = 90; a fills the 100 cross.
		const template = await transpiled([
			{
				name: "panel",
				at: { x: 100, y: 60 },
				w: 160,
				h: 120,
				rotation: 90,
				color: GREY,
				frame: {
					layoutMode: "HORIZONTAL",
					itemSpacing: 10,
					paddingTop: 10,
					paddingRight: 10,
					paddingBottom: 10,
					paddingLeft: 10,
				},
				children: [
					{
						name: "a",
						at: { x: 10, y: 10 },
						w: 40,
						h: 100,
						color: RED,
						child: { layoutSizingVertical: "FILL" },
					},
					{
						name: "b",
						at: { x: 60, y: 10 },
						w: 90,
						h: 50,
						color: BLUE,
						child: { layoutSizingHorizontal: "FILL", layoutGrow: 1 },
					},
				],
			},
		]);
		expect(find(template, "b").layoutChild).toMatchObject({ grow: 1 });
		const { differing, inked } = await compare(template);
		expect(inked).toBeGreaterThan(5000);
		expect(differing).toBe(0);
	});

	it("a rotated grid", async () => {
		const track = { type: "FIXED" as const, value: 50 };
		const row = { type: "FIXED" as const, value: 30 };
		const template = await transpiled([
			{
				name: "panel",
				at: { x: 120, y: 60 },
				w: 130,
				h: 90,
				rotation: -90,
				color: GREY,
				frame: {
					layoutMode: "GRID",
					gridColumnSizes: [track, track],
					gridRowSizes: [row, row],
					gridColumnGap: 10,
					gridRowGap: 10,
					paddingTop: 10,
					paddingRight: 10,
					paddingBottom: 10,
					paddingLeft: 10,
				},
				children: [
					{ name: "a", at: { x: 10, y: 10 }, w: 50, h: 30, color: RED },
					{ name: "b", at: { x: 70, y: 10 }, w: 50, h: 30, color: BLUE },
					{ name: "c", at: { x: 10, y: 50 }, w: 50, h: 30, color: GREEN },
					{ name: "d", at: { x: 70, y: 50 }, w: 30, h: 20, color: RED },
				],
			},
		]);
		expect(find(template, "panel").properties.layout).toMatchObject({
			type: "grid",
		});
		const { differing, inked } = await compare(template);
		expect(inked).toBeGreaterThan(5000);
		expect(differing).toBe(0);
	});
});
