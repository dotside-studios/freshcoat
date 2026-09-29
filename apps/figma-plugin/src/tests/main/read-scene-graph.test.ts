import { describe, expect, it, test } from "vitest";
import { figmaPaintToFill } from "~/lib/figma/transpiler/colors";
import { findUnpostable } from "~/main/postable";
import {
	gradientHandlesFromTransform,
	readBaseFields,
	readContainerAsync,
	readFrameTree,
	readNode,
	readPaint,
	readRectangleNode,
	readTextNode,
	readVectorNode,
} from "~/main/read-scene-graph";

describe("readPaint (solid)", () => {
	it("folds RGB + paint.opacity into FigmaSolidPaint with color.a = 1", () => {
		const p = readPaint({
			type: "SOLID",
			color: { r: 1, g: 0, b: 0 },
			opacity: 0.5,
			visible: true,
		});
		expect(p).toEqual({
			type: "SOLID",
			visible: true,
			opacity: 0.5,
			color: { r: 1, g: 0, b: 0, a: 1 },
		});
	});
});

describe("gradientHandlesFromTransform", () => {
	it("identity transform → start (0,0.5), end (1,0.5): a left→right gradient along the midline", () => {
		const handles = gradientHandlesFromTransform(
			[
				[1, 0, 0],
				[0, 1, 0],
			],
			"linear",
		);
		expect(handles[0]).toEqual({ x: 0, y: 0.5 });
		expect(handles[1]).toEqual({ x: 1, y: 0.5 });
		expect(handles[2]).toEqual({ x: 0, y: 1 });
	});

	it("identity transform, radial → center (0.5,0.5) and the two axis ends", () => {
		// A radial gradient is the circle at the middle of the unit square, not a
		// run along its x axis. Sampling it at the linear handle points reports
		// the square's CORNER as the center, which pins a glow meant for the
		// middle of a shape to its edge.
		const handles = gradientHandlesFromTransform(
			[
				[1, 0, 0],
				[0, 1, 0],
			],
			"radial",
		);
		expect(handles[0]).toEqual({ x: 0.5, y: 0.5 });
		expect(handles[1]).toEqual({ x: 1, y: 0.5 });
		expect(handles[2]).toEqual({ x: 0.5, y: 1 });
	});

	it("carries the transform's rotation and scale into the radial handles", () => {
		// Quarter turn about the origin, then shifted right by 1 — the shape the
		// certificate's background glow arrived in, where reading handle 0 off the
		// LINEAR points gave (1, 0) for a gradient centered at (0.5, 0.5).
		const handles = gradientHandlesFromTransform(
			[
				[0, 1, 0],
				[-1, 0, 1],
			],
			"radial",
		);
		expect(handles[0].x).toBeCloseTo(0.5, 10);
		expect(handles[0].y).toBeCloseTo(0.5, 10);
	});
});

describe("readPaint (linear gradient) → existing colors.figmaPaintToFill", () => {
	it("identity-transform linear gradient runs left to right across the middle", () => {
		const p = readPaint({
			type: "GRADIENT_LINEAR",
			gradientTransform: [
				[1, 0, 0],
				[0, 1, 0],
			],
			gradientStops: [
				{ position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
				{ position: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
			],
			visible: true,
		});
		expect(figmaPaintToFill(p)).toMatchObject({
			kind: "fill",
			value: { kind: "linear", angle: 0, from: [0, 0.5], to: [1, 0.5] },
		});
	});
});

describe("readBaseFields", () => {
	it("maps id/name/visibility/opacity/blend/bbox/rotation", () => {
		const base = readBaseFields({
			id: "1:5",
			name: "Title",
			visible: true,
			opacity: 0.8,
			blendMode: "MULTIPLY",
			rotation: 0,
			absoluteBoundingBox: { x: 10, y: 20, width: 100, height: 40 },
			effects: [
				{
					type: "DROP_SHADOW",
					visible: true,
					radius: 4,
					offset: { x: 1, y: 2 },
					color: { r: 0, g: 0, b: 0, a: 0.5 },
				},
			],
		});
		expect(base.id).toBe("1:5");
		expect(base.absoluteBoundingBox).toEqual({
			x: 10,
			y: 20,
			width: 100,
			height: 40,
		});
		expect(base.blendMode).toBe("MULTIPLY");
		expect(base.effects?.[0]).toEqual({
			type: "DROP_SHADOW",
			visible: true,
			radius: 4,
			offset: { x: 1, y: 2 },
			color: { r: 0, g: 0, b: 0, a: 0.5 },
		});
	});
});

function textNode(overrides: Record<string, unknown>) {
	return {
		id: "1:9",
		name: "{{displayName}}",
		type: "TEXT",
		visible: true,
		opacity: 1,
		blendMode: "NORMAL",
		rotation: 0,
		absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 50 },
		effects: [],
		characters: "Hi",
		fontName: { family: "Comfortaa", style: "Bold" },
		fontSize: 24,
		fontWeight: 700,
		letterSpacing: { value: 0, unit: "PIXELS" },
		lineHeight: { unit: "AUTO" },
		textAlignHorizontal: "LEFT",
		textAlignVertical: "TOP",
		textAutoResize: "NONE",
		fills: [
			{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 1, visible: true },
		],
		getStyledTextSegments: () => [
			{
				characters: "Hi",
				start: 0,
				end: 2,
				fontName: { family: "Comfortaa", style: "Bold" },
				fontSize: 24,
				fontWeight: 700,
				letterSpacing: { value: 0, unit: "PIXELS" },
			},
		],
		...overrides,
	};
}

describe("readTextNode", () => {
	it("maps a single-style TEXT node to FigmaTextNode (no overrides)", () => {
		const t = readTextNode(textNode({}) as never);
		expect(t.type).toBe("TEXT");
		expect(t.characters).toBe("Hi");
		expect(t.style.fontFamily).toBe("Comfortaa");
		expect(t.style.fontSize).toBe(24);
		expect(t.style.fontWeight).toBe(700);
		expect(t.style.italic).toBe(false);
		expect(t.style.textAlignHorizontal).toBe("LEFT");
		expect(t.fills[0].type).toBe("SOLID");
		// single uniform segment → no per-character overrides
		expect((t.characterStyleOverrides ?? []).some((k: number) => k !== 0)).toBe(
			false,
		);
	});

	it("reconstructs characterStyleOverrides + styleOverrideTable from segments", () => {
		const t = readTextNode(
			textNode({
				characters: "AB",
				getStyledTextSegments: () => [
					{
						characters: "A",
						start: 0,
						end: 1,
						fontName: { family: "Comfortaa", style: "Regular" },
						fontSize: 24,
						fontWeight: 400,
						letterSpacing: { value: 0, unit: "PIXELS" },
					},
					{
						characters: "B",
						start: 1,
						end: 2,
						fontName: { family: "Comfortaa", style: "Bold" },
						fontSize: 24,
						fontWeight: 700,
						letterSpacing: { value: 0, unit: "PIXELS" },
					},
				],
			}) as never,
		);
		// two distinct styles → first char key 0 (base), second char a non-zero key
		expect(t.characterStyleOverrides?.length).toBe(2);
		const key = t.characterStyleOverrides?.[1] ?? 0;
		expect(key).not.toBe(0);
		expect(t.styleOverrideTable?.[String(key)]?.fontWeight).toBe(700);
	});

	it("splits segments that differ only in line height, and records it", () => {
		const seg = (start: number, lineHeight: unknown) => ({
			characters: "x",
			start,
			end: start + 1,
			fontName: { family: "Comfortaa", style: "Regular" },
			fontSize: 20,
			fontWeight: 400,
			lineHeight,
		});
		const t = readTextNode(
			textNode({
				characters: "AB",
				// Runs that disagree read back as figma.mixed at the node level.
				lineHeight: Symbol("mixed"),
				getStyledTextSegments: () => [
					seg(0, { value: 150, unit: "PERCENT" }),
					seg(1, { unit: "AUTO" }),
				],
			}) as never,
		);
		// One text node, two line boxes — the keys must not collapse.
		const [k0, k1] = t.characterStyleOverrides ?? [];
		expect(k0).not.toBe(k1);
		const override = t.styleOverrideTable?.[String(k0 !== 0 ? k0 : k1)];
		expect(override).toBeDefined();
		// AUTO contributes no fields — the transpiler reads that absence as "auto".
		expect(override?.lineHeightPercentFontSize).toBeUndefined();
		// The base falls back to the first run rather than reporting AUTO for all.
		expect(t.style.lineHeightPercentFontSize).toBe(150);
		expect(findUnpostable(t)).toBeNull();
	});

	it("reads each run's fills and decoration, and takes mixed fills from the first run", () => {
		const seg = (
			start: number,
			color: { r: number; g: number; b: number },
			textDecoration: string,
		) => ({
			characters: "x",
			start,
			end: start + 1,
			fontName: { family: "Comfortaa", style: "Bold" },
			fontSize: 24,
			fontWeight: 700,
			letterSpacing: { value: 0, unit: "PIXELS" },
			fills: [{ type: "SOLID", color, opacity: 1, visible: true }],
			textDecoration,
		});
		const t = readTextNode(
			textNode({
				characters: "AB",
				fills: Symbol("mixed"),
				textDecoration: Symbol("mixed"),
				getStyledTextSegments: () => [
					seg(0, { r: 0, g: 0, b: 0 }, "UNDERLINE"),
					seg(1, { r: 1, g: 0, b: 0 }, "NONE"),
				],
			}) as never,
		);
		expect(t.fills[0]).toMatchObject({ color: { r: 0, g: 0, b: 0 } });
		expect(t.style.textDecoration).toBe("UNDERLINE");
		const key = t.characterStyleOverrides?.[1] ?? 0;
		expect(key).not.toBe(0);
		const run = t.styleOverrideTable?.[String(key)];
		expect(run?.textDecoration).toBe("NONE");
		expect(run?.fills?.[0]).toMatchObject({ color: { r: 1, g: 0, b: 0 } });
		expect(findUnpostable(t)).toBeNull();
	});

	it("treats same letterSpacing.value with different unit as distinct styles", () => {
		const t = readTextNode(
			textNode({
				characters: "AB",
				getStyledTextSegments: () => [
					{
						characters: "A",
						start: 0,
						end: 1,
						fontName: { family: "Comfortaa", style: "Regular" },
						fontSize: 24,
						fontWeight: 400,
						letterSpacing: { value: 2, unit: "PIXELS" },
					},
					{
						characters: "B",
						start: 1,
						end: 2,
						fontName: { family: "Comfortaa", style: "Regular" },
						fontSize: 24,
						fontWeight: 400,
						letterSpacing: { value: 2, unit: "PERCENT" },
					},
				],
			}) as never,
		);
		// The two segments have the same value (2) but different units —
		// they must NOT collapse to the same override key.
		expect(t.characterStyleOverrides?.length).toBe(2);
		const k0 = t.characterStyleOverrides?.[0] ?? -1;
		const k1 = t.characterStyleOverrides?.[1] ?? -1;
		expect(k0).not.toBe(k1);
		// The non-base key must appear in styleOverrideTable
		const overrideKey = k0 !== 0 ? k0 : k1;
		expect(t.styleOverrideTable?.[String(overrideKey)]).toBeDefined();
	});
});

describe("readRectangleNode", () => {
	it("maps fills/strokes/cornerRadius and preserves image fills via imageHash→imageRef", () => {
		const r = readRectangleNode({
			id: "1:1",
			name: "photo",
			type: "RECTANGLE",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			rotation: 0,
			absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
			effects: [],
			cornerRadius: 8,
			strokeWeight: 2,
			fills: [
				{ type: "IMAGE", scaleMode: "FILL", imageHash: "HASH1", visible: true },
			],
			strokes: [
				{
					type: "SOLID",
					color: { r: 0, g: 0, b: 0 },
					opacity: 1,
					visible: true,
				},
			],
		} as never);
		expect(r.type).toBe("RECTANGLE");
		expect(r.cornerRadius).toBe(8);
		expect(r.fills[0]).toMatchObject({
			type: "IMAGE",
			scaleMode: "FILL",
			imageRef: "HASH1",
		});
		expect(r.strokeWeight).toBe(2);
	});
});

describe("readVectorNode", () => {
	it("maps vectorPaths[].data → fillGeometry[].path", () => {
		const v = readVectorNode({
			id: "1:2",
			name: "star",
			type: "STAR",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			rotation: 0,
			absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
			effects: [],
			fills: [
				{
					type: "SOLID",
					color: { r: 1, g: 1, b: 1 },
					opacity: 1,
					visible: true,
				},
			],
			strokes: [],
			vectorPaths: [{ windingRule: "NONZERO", data: "M0 0 L10 0 L10 10 Z" }],
		} as never);
		expect(v.fillGeometry?.[0]?.path).toBe("M0 0 L10 0 L10 10 Z");
	});

	it("reads string strokeCap/strokeJoin, drops figma.mixed symbols", () => {
		const base = {
			id: "1:2",
			name: "icon",
			type: "VECTOR",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			rotation: 0,
			absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
			effects: [],
			fills: [],
			strokes: [],
			vectorPaths: [],
		};
		const plain = readVectorNode({
			...base,
			strokeCap: "ROUND",
			strokeJoin: "ROUND",
		} as never);
		expect(plain.strokeCap).toBe("ROUND");
		expect(plain.strokeJoin).toBe("ROUND");

		const mixed = readVectorNode({
			...base,
			strokeCap: Symbol("figma.mixed"),
			strokeJoin: Symbol("figma.mixed"),
		} as never);
		expect(mixed.strokeCap).toBeUndefined();
		expect(mixed.strokeJoin).toBeUndefined();
	});

	const shape = (type: string, extra: Record<string, unknown>) =>
		readVectorNode({
			id: "1:9",
			name: type.toLowerCase(),
			type,
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			rotation: 0,
			absoluteBoundingBox: { x: 0, y: 0, width: 24, height: 24 },
			effects: [],
			fills: [],
			strokes: [],
			...extra,
		} as never);

	it("reads fillGeometry for a shape that has no vectorPaths", () => {
		// The bug this guards: only VECTOR and BOOLEAN_OPERATION carry
		// `vectorPaths`. An ELLIPSE has `fillGeometry` and nothing else, so
		// reading vectorPaths alone left it with no geometry, and the transpiler
		// rasterized it — a circle in a logo came out of the export as a bitmap.
		const e = shape("ELLIPSE", {
			fills: [
				{
					type: "SOLID",
					color: { r: 0, g: 0, b: 0 },
					opacity: 1,
					visible: true,
				},
			],
			fillGeometry: [
				{ windingRule: "NONZERO", data: "M12 0 C18 0 24 6 24 12 Z" },
			],
		});
		expect(e.fillGeometry?.[0]?.path).toBe("M12 0 C18 0 24 6 24 12 Z");
	});

	it("prefers the resolved fill outline for a FILLED shape", () => {
		// fillGeometry has the node's per-point corner rounding resolved into it
		// and the authored path does not, so a curve softened by a 200px corner
		// exports with a hard join when vectorPaths wins.
		const v = shape("VECTOR", {
			fills: [
				{
					type: "SOLID",
					color: { r: 0, g: 0, b: 0 },
					opacity: 1,
					visible: true,
				},
			],
			vectorPaths: [{ windingRule: "NONE", data: "M0 0 L24 0 L24 24 Z" }],
			fillGeometry: [
				{ windingRule: "NONZERO", data: "M0 0 L20 0 C24 0 24 4 24 8 Z" },
			],
		});
		expect(v.fillGeometry?.[0]?.path).toBe("M0 0 L20 0 C24 0 24 4 24 8 Z");
	});

	it("uses the authored path for a stroke-only shape", () => {
		// Nothing to fill means no fill region to resolve; the stroke follows the
		// authored path, which for an open rule is not a closed outline at all.
		const v = shape("VECTOR", {
			fills: [],
			strokes: [
				{
					type: "SOLID",
					color: { r: 0, g: 0, b: 0 },
					opacity: 1,
					visible: true,
				},
			],
			vectorPaths: [{ windingRule: "NONE", data: "M0 0 L24 0" }],
			fillGeometry: [{ windingRule: "NONZERO", data: "M0 0 L24 0 L24 1 Z" }],
		});
		expect(v.fillGeometry?.[0]?.path).toBe("M0 0 L24 0");
	});

	it("ignores a hidden fill when deciding which geometry to read", () => {
		const v = shape("VECTOR", {
			fills: [
				{
					type: "SOLID",
					color: { r: 0, g: 0, b: 0 },
					opacity: 1,
					visible: false,
				},
			],
			vectorPaths: [{ windingRule: "NONE", data: "M0 0 L24 0" }],
			fillGeometry: [{ windingRule: "NONZERO", data: "M0 0 L24 0 L24 1 Z" }],
		});
		expect(v.fillGeometry?.[0]?.path).toBe("M0 0 L24 0");
	});

	it("synthesizes the segment for a LINE, which has neither", () => {
		// A Figma line has nothing to fill and no height in its own space; all of
		// its paint is stroke, so the shape IS the segment across its width.
		const l = shape("LINE", { width: 63, height: 0, vectorPaths: [] });
		expect(l.fillGeometry?.[0]?.path).toBe("M 0 0 L 63 0");
	});

	it("leaves geometry empty when a shape genuinely has none", () => {
		expect(shape("POLYGON", {}).fillGeometry).toEqual([]);
	});
});

describe("readRectangleNode (corner radius)", () => {
	const rect = (extra: Record<string, unknown>) =>
		readRectangleNode({
			id: "1:4",
			name: "box",
			type: "RECTANGLE",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x: 0, y: 0, width: 40, height: 40 },
			effects: [],
			fills: [],
			strokes: [],
			...extra,
		} as never);

	it("reads a uniform radius straight off cornerRadius", () => {
		expect(rect({ cornerRadius: 8 }).cornerRadius).toBe(8);
	});

	it("reads the four corners when cornerRadius is mixed", () => {
		// The bug this guards: a shape whose corners differ reports the uniform
		// property as figma.mixed, which read back as undefined and dropped the
		// rounding outright.
		const r = rect({
			cornerRadius: Symbol("figma.mixed"),
			topLeftRadius: 200,
			topRightRadius: 0,
			bottomRightRadius: 0,
			bottomLeftRadius: 0,
		});
		expect(r.cornerRadius).toEqual([200, 0, 0, 0]);
	});

	it("collapses four equal corners to a single number", () => {
		const r = rect({
			cornerRadius: Symbol("figma.mixed"),
			topLeftRadius: 12,
			topRightRadius: 12,
			bottomRightRadius: 12,
			bottomLeftRadius: 12,
		});
		expect(r.cornerRadius).toBe(12);
	});

	it("reports no radius when neither form is readable", () => {
		const r = rect({ cornerRadius: Symbol("figma.mixed") });
		expect(r.cornerRadius).toBeUndefined();
	});
});

test("readContainer copies auto-layout container + child fields", () => {
	const node = {
		id: "1:2",
		name: "stack",
		type: "FRAME",
		absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 50 },
		layoutMode: "VERTICAL",
		itemSpacing: 8,
		counterAxisSpacing: 4,
		paddingTop: 2,
		paddingRight: 3,
		paddingBottom: 2,
		paddingLeft: 3,
		primaryAxisAlignItems: "CENTER",
		counterAxisAlignItems: "MAX",
		layoutWrap: "WRAP",
		children: [
			{
				id: "1:3",
				name: "child",
				type: "RECTANGLE",
				absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 20 },
				layoutGrow: 1,
				layoutAlign: "STRETCH",
				layoutSizingHorizontal: "FILL",
				layoutSizingVertical: "HUG",
				layoutPositioning: "AUTO",
				minWidth: 10,
				maxWidth: 80,
				fills: [],
			},
		],
	};
	const out = readFrameTree(node as never);
	expect(out.layoutMode).toBe("VERTICAL");
	expect(out.itemSpacing).toBe(8);
	expect(out.counterAxisSpacing).toBe(4);
	expect(out.paddingLeft).toBe(3);
	expect(out.primaryAxisAlignItems).toBe("CENTER");
	expect(out.counterAxisAlignItems).toBe("MAX");
	expect(out.layoutWrap).toBe("WRAP");
	const child = out.children[0];
	expect(child.layoutGrow).toBe(1);
	expect(child.layoutAlign).toBe("STRETCH");
	expect(child.layoutSizingHorizontal).toBe("FILL");
	expect(child.layoutSizingVertical).toBe("HUG");
	expect(child.layoutPositioning).toBe("AUTO");
	expect(child.minWidth).toBe(10);
	expect(child.maxWidth).toBe(80);
});

const leaf = (id: string, name: string) => ({
	id,
	name,
	type: "RECTANGLE",
	visible: true,
	opacity: 1,
	blendMode: "NORMAL",
	rotation: 0,
	absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
	effects: [],
	fills: [
		{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 1, visible: true },
	],
	strokes: [],
});

describe("readNode (container) + readFrameTree", () => {
	it("recurses children and maps clipsContent", () => {
		const frame = {
			id: "1:0",
			name: "front",
			type: "FRAME",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			rotation: 0,
			absoluteBoundingBox: { x: 0, y: 0, width: 1017, height: 639 },
			effects: [],
			clipsContent: true,
			fills: [
				{
					type: "SOLID",
					color: { r: 1, g: 1, b: 1 },
					opacity: 1,
					visible: true,
				},
			],
			strokes: [],
			children: [leaf("1:1", "a"), leaf("1:2", "b")],
		};
		const out = readFrameTree(frame as never);
		expect(out.type).toBe("FRAME");
		expect(out.clipsContent).toBe(true);
		expect(out.children).toHaveLength(2);
		expect(out.children[0].id).toBe("1:1");
		// readNode dispatch: a RECTANGLE leaf resolves to a FigmaRectangleNode
		expect(readNode(leaf("1:3", "x") as never)?.type).toBe("RECTANGLE");
	});

	it("returns all component children of a COMPONENT_SET, tagged with variantProperties", () => {
		const comp = (id: string, color: string, childId: string) => ({
			...leaf(childId, "a"),
			id,
			name: `Card / Color=${color}`,
			type: "COMPONENT",
			variantProperties: { Color: color },
			clipsContent: false,
			strokes: [],
			children: [leaf(childId, "a")],
		});
		const set = {
			id: "1:7",
			name: "Card",
			type: "COMPONENT_SET",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			rotation: 0,
			absoluteBoundingBox: { x: 0, y: 0, width: 1017, height: 639 },
			effects: [],
			children: [comp("c1", "Amber", "1:1"), comp("c2", "Sky", "1:2")],
		};
		const out = readFrameTree(set as never);
		expect(out.type).toBe("COMPONENT_SET");
		expect(out.children).toHaveLength(2);
		expect(out.children[0].type).toBe("COMPONENT");
		// each component carries its variant properties for the transpiler's join key
		const c0 = out.children[0] as {
			componentProperties?: Record<string, { value: string }>;
		};
		expect(c0.componentProperties?.Color?.value).toBe("Amber");
	});
});

test("readBaseFields reads absoluteRenderBounds (defaults to null when absent)", () => {
	const withBounds = readBaseFields({
		id: "1:1",
		name: "n",
		absoluteBoundingBox: { x: 50, y: 80, width: 600, height: 600 },
		absoluteRenderBounds: { x: 100, y: 120, width: 400, height: 300 },
	} as never);
	expect(withBounds.absoluteRenderBounds).toEqual({
		x: 100,
		y: 120,
		width: 400,
		height: 300,
	});

	const withoutBounds = readBaseFields({
		id: "1:2",
		name: "n",
		absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
	} as never);
	expect(withoutBounds.absoluteRenderBounds).toBeNull();
});

test("readBaseFields copies relativeTransform", () => {
	const base = readBaseFields({
		id: "1:1",
		name: "n",
		absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
		relativeTransform: [
			[0, -1, 5],
			[1, 0, 6],
		],
	} as never);
	expect(base.relativeTransform).toEqual([
		[0, -1, 5],
		[1, 0, 6],
	]);
});

it("captures mainComponentId for an INSTANCE node", async () => {
	const inst = {
		id: "i:1",
		name: "Aurora Card / Amber",
		type: "INSTANCE",
		visible: true,
		opacity: 1,
		blendMode: "NORMAL",
		absoluteBoundingBox: { x: 0, y: 0, width: 1013, height: 638 },
		children: [],
		fills: [],
		getMainComponentAsync: async () => ({ id: "c:base" }),
	};
	const node = await readContainerAsync(inst as never);
	expect(node.mainComponentId).toBe("c:base");
});

it("leaves mainComponentId undefined for a non-INSTANCE container", async () => {
	const frame = {
		id: "f:1",
		name: "Frame",
		type: "FRAME",
		visible: true,
		opacity: 1,
		blendMode: "NORMAL",
		absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
		children: [leaf("c:1", "child")],
		fills: [],
		strokes: [],
	};
	const node = await readContainerAsync(frame as never);
	expect(node.mainComponentId).toBeUndefined();
});

it("sets mainComponentId to null for a detached INSTANCE", async () => {
	const detached = {
		id: "i:2",
		name: "Detached Card",
		type: "INSTANCE",
		visible: true,
		opacity: 1,
		blendMode: "NORMAL",
		absoluteBoundingBox: { x: 0, y: 0, width: 1013, height: 638 },
		children: [],
		fills: [],
		getMainComponentAsync: async () => null,
	};
	const node = await readContainerAsync(detached as never);
	expect(node.mainComponentId).toBeNull();
});

// figma.mixed is a symbol, returned for any text property that varies across
// the string — a paragraph with one bold phrase has mixed fontName, fontSize
// and fontWeight at the node level. A symbol cannot cross postMessage, so none
// of these may reach the payload.
const MIXED = Symbol("figma.mixed") as unknown as never;

function mixedTextNode(over: Record<string, unknown> = {}) {
	return {
		id: "1:1",
		name: "body",
		characters: "Regular bold",
		fontName: MIXED,
		fontSize: MIXED,
		fontWeight: MIXED,
		letterSpacing: MIXED,
		lineHeight: MIXED,
		textCase: MIXED,
		textAlignHorizontal: "LEFT",
		textAlignVertical: "TOP",
		fills: [],
		getStyledTextSegments: () => [
			{
				start: 0,
				end: 8,
				fontName: { family: "Inter", style: "Regular" },
				fontSize: 12,
				fontWeight: 400,
				letterSpacing: { value: 0, unit: "PIXELS" as const },
			},
			{
				start: 8,
				end: 12,
				fontName: { family: "Inter", style: "Bold" },
				fontSize: 12,
				fontWeight: 700,
				letterSpacing: { value: 0, unit: "PIXELS" as const },
			},
		],
		...over,
	} as never;
}

describe("readTextNode with mixed (symbol) font properties", () => {
	it("takes the base style from the first styled run", () => {
		const out = readTextNode(mixedTextNode());
		expect(out.style.fontFamily).toBe("Inter");
		expect(out.style.fontSize).toBe(12);
		expect(out.style.fontWeight).toBe(400);
		expect(out.style.italic).toBe(false);
	});

	it("emits no symbol anywhere in the result", () => {
		const out = readTextNode(mixedTextNode());
		expect(findUnpostable(out)).toBeNull();
	});

	it("drops mixed textCase rather than passing the symbol through", () => {
		// A symbol is truthy, so a plain `node.textCase ? …` check let it past.
		expect(readTextNode(mixedTextNode()).style.textCase).toBeUndefined();
	});

	it("still captures the bold run as an override", () => {
		const out = readTextNode(mixedTextNode());
		expect(Object.keys(out.styleOverrideTable ?? {})).toHaveLength(1);
		expect(out.characterStyleOverrides?.slice(8)).toEqual([1, 1, 1, 1]);
	});

	it("falls back to defaults when everything is mixed and there are no runs", () => {
		const out = readTextNode(
			mixedTextNode({ getStyledTextSegments: () => [] }),
		);
		expect(out.style.fontSize).toBe(16);
		expect(out.style.fontWeight).toBe(400);
		expect(findUnpostable(out)).toBeNull();
	});

	it("reads the vertical trim, and treats mixed or absent as unset", () => {
		const trimmed = readTextNode(
			mixedTextNode({ leadingTrim: "CAP_HEIGHT" } as never),
		);
		expect(trimmed.style.leadingTrim).toBe("CAP_HEIGHT");
		// figma.mixed is a symbol and an older API omits the property; both mean
		// "unset", which is Figma's own STANDARD default.
		const mixed = readTextNode(
			mixedTextNode({ leadingTrim: Symbol("mixed") } as never),
		);
		expect("leadingTrim" in mixed.style).toBe(false);
		expect(findUnpostable(mixed)).toBeNull();
		expect("leadingTrim" in readTextNode(mixedTextNode()).style).toBe(false);
	});

	it("reads explicit OpenType features, and treats mixed as unset", () => {
		const out = readTextNode(
			mixedTextNode({ openTypeFeatures: { TNUM: true, LIGA: false } } as never),
		);
		expect(out.style.openTypeFeatures).toEqual({ TNUM: true, LIGA: false });
		const mixed = readTextNode(
			mixedTextNode({ openTypeFeatures: Symbol("mixed") } as never),
		);
		expect("openTypeFeatures" in mixed.style).toBe(false);
		expect(findUnpostable(mixed)).toBeNull();
	});

	it("reads paragraph spacing, and treats mixed as unset", () => {
		const out = readTextNode(mixedTextNode({ paragraphSpacing: 12 } as never));
		expect(out.style.paragraphSpacing).toBe(12);
		const mixed = readTextNode(
			mixedTextNode({ paragraphSpacing: Symbol("mixed") } as never),
		);
		expect("paragraphSpacing" in mixed.style).toBe(false);
	});

	it("leaves an unmixed text node alone", () => {
		const out = readTextNode(
			mixedTextNode({
				fontName: { family: "Georgia", style: "Italic" },
				fontSize: 24,
				fontWeight: 700,
				letterSpacing: { value: 2, unit: "PIXELS" },
				lineHeight: { value: 30, unit: "PIXELS" },
				textCase: "UPPER",
			}),
		);
		expect(out.style.fontFamily).toBe("Georgia");
		expect(out.style.fontSize).toBe(24);
		expect(out.style.fontWeight).toBe(700);
		expect(out.style.italic).toBe(true);
		expect(out.style.letterSpacing).toBe(2);
		expect(out.style.textCase).toBe("UPPER");
		expect(out.style.lineHeightPx).toBe(30);
	});
});

describe("readBaseFields (figma.mixed)", () => {
	const node = (extra: Record<string, unknown>) =>
		readBaseFields({
			id: "1:7",
			name: "shape",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
			effects: [],
			...extra,
		} as never);

	it("names a property Figma answered with mixed", () => {
		// readPaints has to narrow mixed away to an empty list, which reads exactly
		// like "the author set no fill" — so a vector painted per region looks
		// unpainted, and there is nothing to explain why it arrived as a bitmap.
		expect(node({ fills: Symbol("figma.mixed") }).mixed).toEqual(["fills"]);
	});

	it("names every mixed property, not just the first", () => {
		const b = node({
			fills: Symbol("figma.mixed"),
			strokes: Symbol("figma.mixed"),
			cornerRadius: Symbol("figma.mixed"),
		});
		expect(b.mixed).toEqual(["fills", "strokes", "cornerRadius"]);
	});

	it("says nothing when every property reads plainly", () => {
		expect(
			node({ fills: [], strokes: [], cornerRadius: 4 }).mixed,
		).toBeUndefined();
	});

	it("says nothing about a property the node does not have", () => {
		expect(node({}).mixed).toBeUndefined();
	});
});

test("readContainer copies a grid's tracks, gaps and each child's cell", () => {
	const out = readFrameTree({
		id: "2:1",
		name: "grid",
		type: "FRAME",
		absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 200 },
		layoutMode: "GRID",
		gridRowGap: 4,
		gridColumnGap: 8,
		gridColumnSizes: [
			{ type: "FIXED", value: 100 },
			{ type: "FLEX", value: 2 },
		],
		gridRowSizes: [{ type: "HUG" }],
		children: [
			{
				...leaf("2:2", "cell"),
				gridRowAnchorIndex: 0,
				gridColumnAnchorIndex: 1,
				gridRowSpan: 2,
				gridColumnSpan: 1,
			},
		],
	} as never);
	expect(out.layoutMode).toBe("GRID");
	expect(out.gridRowGap).toBe(4);
	expect(out.gridColumnGap).toBe(8);
	expect(out.gridColumnSizes).toEqual([
		{ type: "FIXED", value: 100 },
		{ type: "FLEX", value: 2 },
	]);
	expect(out.gridRowSizes).toEqual([{ type: "HUG" }]);
	expect(out.children[0]).toMatchObject({
		gridRowAnchorIndex: 0,
		gridColumnAnchorIndex: 1,
		gridRowSpan: 2,
		gridColumnSpan: 1,
	});
});

test("readContainer leaves grid fields off a flex frame's children", () => {
	const out = readFrameTree({
		id: "3:1",
		name: "row",
		type: "FRAME",
		absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 200 },
		layoutMode: "HORIZONTAL",
		children: [{ ...leaf("3:2", "cell"), gridRowAnchorIndex: 0 }],
	} as never);
	expect(out.children[0]).not.toHaveProperty("gridRowAnchorIndex");
	expect(out).not.toHaveProperty("gridColumnSizes");
});

describe("readPaint (image)", () => {
	it("keeps a crop's transform and any image filters", () => {
		const p = readPaint({
			type: "IMAGE",
			scaleMode: "CROP",
			imageHash: "h",
			imageTransform: [
				[0.5, 0, 0.25],
				[0, 0.5, 0],
			],
			filters: { saturation: -1, exposure: 0 },
		});
		expect(p).toMatchObject({
			scaleMode: "STRETCH",
			imageTransform: [
				[0.5, 0, 0.25],
				[0, 0.5, 0],
			],
			filters: { saturation: -1, exposure: 0 },
		});
	});

	it("drops all-zero filters and a transform outside crop mode", () => {
		const p = readPaint({
			type: "IMAGE",
			scaleMode: "FILL",
			imageHash: "h",
			imageTransform: [
				[1, 0, 0],
				[0, 1, 0],
			],
			filters: { exposure: 0, contrast: 0 },
		});
		expect(p).not.toHaveProperty("imageTransform");
		expect(p).not.toHaveProperty("filters");
	});
});
