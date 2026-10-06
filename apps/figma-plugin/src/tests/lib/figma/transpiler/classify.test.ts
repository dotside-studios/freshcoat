import { describe, expect, it } from "vitest";
import { classify } from "~/lib/figma/transpiler/classify";
import type { FigmaNode } from "~/lib/figma/types";

const baseAttrs = {
	visible: true,
	opacity: 1,
	blendMode: "NORMAL" as const,
	absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
};

describe("classify", () => {
	it("hidden layer → skip", () => {
		const n: FigmaNode = {
			...baseAttrs,
			id: "1",
			name: "x",
			type: "RECTANGLE",
			visible: false,
			fills: [],
		};
		expect(classify(n).kind).toBe("skip");
	});

	it("opacity-0 layer → skip", () => {
		const n: FigmaNode = {
			...baseAttrs,
			id: "1",
			name: "x",
			type: "RECTANGLE",
			opacity: 0,
			fills: [],
		};
		expect(classify(n).kind).toBe("skip");
	});

	it("TEXT with single solid fill → native-text", () => {
		const n: FigmaNode = {
			...baseAttrs,
			id: "1",
			name: "x",
			type: "TEXT",
			characters: "Hello",
			style: {
				fontFamily: "Inter",
				fontSize: 16,
				fontWeight: 400,
				textAlignHorizontal: "LEFT",
				textAlignVertical: "TOP",
			},
			fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
		};
		expect(classify(n).kind).toBe("native-text");
	});

	it("TEXT with character-style overrides → native-text (lowers to spans)", () => {
		const n: FigmaNode = {
			...baseAttrs,
			id: "1",
			name: "x",
			type: "TEXT",
			characters: "Hello",
			style: {
				fontFamily: "Inter",
				fontSize: 16,
				fontWeight: 400,
				textAlignHorizontal: "LEFT",
				textAlignVertical: "TOP",
			},
			fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
			characterStyleOverrides: [0, 1, 0, 0, 0],
			styleOverrideTable: { "1": { fontWeight: 700 } },
		};
		expect(classify(n).kind).toBe("native-text");
	});

	it("RECTANGLE with single solid fill → native-rect", () => {
		const n: FigmaNode = {
			...baseAttrs,
			id: "1",
			name: "bg",
			type: "RECTANGLE",
			fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
		};
		expect(classify(n).kind).toBe("native-rect");
	});

	it("RECTANGLE with image fill (FILL) → native-image", () => {
		const n: FigmaNode = {
			...baseAttrs,
			id: "1",
			name: "x",
			type: "RECTANGLE",
			fills: [{ type: "IMAGE", scaleMode: "FILL", imageRef: "abc" }],
		};
		expect(classify(n).kind).toBe("native-image");
	});

	it("RECTANGLE with image fill (TILE) → native-image (coatfile supports tile)", () => {
		const n: FigmaNode = {
			...baseAttrs,
			id: "1",
			name: "x",
			type: "RECTANGLE",
			fills: [{ type: "IMAGE", scaleMode: "TILE", imageRef: "abc" }],
		};
		expect(classify(n).kind).toBe("native-image");
	});

	it("RECTANGLE with multiple solid/gradient fills → native-rect (stacked fills)", () => {
		const n: FigmaNode = {
			...baseAttrs,
			id: "1",
			name: "x",
			type: "RECTANGLE",
			fills: [
				{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } },
				{ type: "SOLID", color: { r: 0, g: 1, b: 0, a: 0.5 } },
			],
		};
		expect(classify(n).kind).toBe("native-rect");
	});

	it("RECTANGLE with image fill mixed with other fills → flatten (image-as-fill not yet a Fill kind)", () => {
		const n: FigmaNode = {
			...baseAttrs,
			id: "1",
			name: "x",
			type: "RECTANGLE",
			fills: [
				{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } },
				{ type: "IMAGE", scaleMode: "FILL", imageRef: "abc" },
			],
		};
		const c = classify(n);
		expect(c.kind).toBe("flatten");
		if (c.kind === "flatten") expect(c.reason).toBe("multi_fill_flattened");
	});

	it("RECTANGLE with qr: layer name → native-qr", () => {
		const n: FigmaNode = {
			...baseAttrs,
			id: "1",
			name: "qr:{{link}}",
			type: "RECTANGLE",
			fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
		};
		expect(classify(n).kind).toBe("native-qr");
	});

	it("VECTOR with qr: layer name → native-qr (type-agnostic placeholder)", () => {
		const n: FigmaNode = {
			...baseAttrs,
			id: "1",
			name: "qr:{{link}}",
			type: "VECTOR",
			// A drawn QR graphic: would flatten on its own, but the qr: name wins.
			fillGeometry: [{ path: "M0,0 L10,10 Z" }],
		};
		expect(classify(n).kind).toBe("native-qr");
	});

	it("hidden qr: layer still skips (visibility wins; walk warns)", () => {
		const n: FigmaNode = {
			...baseAttrs,
			id: "1",
			name: "qr:test",
			type: "RECTANGLE",
			visible: false,
			fills: [],
		};
		expect(classify(n).kind).toBe("skip");
	});

	it("VECTOR with single-segment fillGeometry (no arc) → native-vector", () => {
		const n: FigmaNode = {
			...baseAttrs,
			id: "1",
			name: "x",
			type: "VECTOR",
			fillGeometry: [{ path: "M0,0 L10,10 Z" }],
		};
		expect(classify(n).kind).toBe("native-vector");
	});

	it("VECTOR without fillGeometry → flatten", () => {
		const n: FigmaNode = {
			...baseAttrs,
			id: "1",
			name: "x",
			type: "VECTOR",
		};
		const c = classify(n);
		expect(c.kind).toBe("flatten");
		if (c.kind === "flatten") expect(c.reason).toBe("vector_flattened");
	});

	it("VECTOR with multi-segment fillGeometry → native-vector", () => {
		const n: FigmaNode = {
			...baseAttrs,
			id: "1",
			name: "x",
			type: "VECTOR",
			fillGeometry: [{ path: "M0,0 L10,10" }, { path: "M5,5 L15,15" }],
		};
		expect(classify(n).kind).toBe("native-vector");
	});

	it("VECTOR whose regions disagree on a winding rule → flatten", () => {
		const n: FigmaNode = {
			...baseAttrs,
			id: "1",
			name: "x",
			type: "VECTOR",
			fillGeometry: [
				{ path: "M0,0 L10,10", windingRule: "NONZERO" },
				{ path: "M5,5 L15,15", windingRule: "EVENODD" },
			],
		};
		const c = classify(n);
		expect(c.kind).toBe("flatten");
		if (c.kind === "flatten") expect(c.reason).toBe("vector_flattened");
	});

	it("VECTOR with arc command (A) → native-vector", () => {
		const n: FigmaNode = {
			...baseAttrs,
			id: "1",
			name: "x",
			type: "VECTOR",
			fillGeometry: [{ path: "M0,0 A5 5 0 0 1 10,10" }],
		};
		expect(classify(n).kind).toBe("native-vector");
	});

	it("RECTANGLE with drop shadow → native-rect (lowers to Drawable.shadow)", () => {
		const n: FigmaNode = {
			...baseAttrs,
			id: "1",
			name: "x",
			type: "RECTANGLE",
			fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
			effects: [{ type: "DROP_SHADOW", visible: true }],
		};
		expect(classify(n).kind).toBe("native-rect");
	});

	it("RECTANGLE with layer blur → native-rect (lowers to Drawable.blur)", () => {
		const n: FigmaNode = {
			...baseAttrs,
			id: "1",
			name: "x",
			type: "RECTANGLE",
			fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
			effects: [{ type: "LAYER_BLUR", visible: true }],
		};
		expect(classify(n).kind).toBe("native-rect");
	});

	it("RECTANGLE with an inner shadow → native (the shell carries it)", () => {
		const n: FigmaNode = {
			...baseAttrs,
			id: "1",
			name: "x",
			type: "RECTANGLE",
			fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
			effects: [{ type: "INNER_SHADOW", visible: true }],
		};
		expect(classify(n).kind).toBe("native-rect");
	});

	it("RECTANGLE with a background blur → flatten (it samples what is behind)", () => {
		const n: FigmaNode = {
			...baseAttrs,
			id: "1",
			name: "x",
			type: "RECTANGLE",
			fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
			effects: [{ type: "BACKGROUND_BLUR", visible: true }],
		};
		const c = classify(n);
		expect(c.kind).toBe("flatten");
		if (c.kind === "flatten") expect(c.reason).toBe("effect_flattened");
	});

	it("RECTANGLE with linear burn → native-rect", () => {
		const n: FigmaNode = {
			...baseAttrs,
			id: "1",
			name: "x",
			type: "RECTANGLE",
			blendMode: "LINEAR_BURN",
			fills: [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5, a: 1 } }],
		};
		expect(classify(n).kind).toBe("native-rect");
	});

	it("plain FRAME with no own fill / clip → native-frame (nested, not flattened away)", () => {
		const n: FigmaNode = {
			...baseAttrs,
			id: "1",
			name: "g",
			type: "FRAME",
			children: [],
		};
		expect(classify(n).kind).toBe("native-frame");
	});

	it("a plain transparent group is a pass-through container (GROUPs are coordinate-transparent → flatten)", () => {
		const node = {
			id: "1:1",
			name: "group",
			type: "GROUP",
			absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 50 },
			fills: [],
			strokes: [],
			children: [
				{
					id: "1:2",
					name: "c",
					type: "RECTANGLE",
					fills: [],
					absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
				},
			],
		};
		expect(classify(node as never)).toEqual({ kind: "container" });
	});

	it("clipping FRAME → native-frame (lowers to GroupShape with clip)", () => {
		const n: FigmaNode = {
			...baseAttrs,
			id: "1",
			name: "g",
			type: "FRAME",
			children: [],
			clipsContent: true,
		};
		expect(classify(n).kind).toBe("native-frame");
	});

	it("FRAME with own fill → native-frame (bg shows up in lowered group)", () => {
		const n: FigmaNode = {
			...baseAttrs,
			id: "1",
			name: "card",
			type: "FRAME",
			children: [],
			fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
		};
		expect(classify(n).kind).toBe("native-frame");
	});

	it("FRAME with own stroke → native-frame", () => {
		const n: FigmaNode = {
			...baseAttrs,
			id: "1",
			name: "card",
			type: "FRAME",
			children: [],
			strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
		};
		expect(classify(n).kind).toBe("native-frame");
	});

	it("an auto-layout frame with no fill/stroke/clip is a native-frame", () => {
		const node = {
			id: "1:1",
			name: "stack",
			type: "FRAME",
			absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 50 },
			layoutMode: "VERTICAL",
			fills: [],
			strokes: [],
			children: [],
		};
		expect(classify(node as never)).toEqual({ kind: "native-frame" });
	});

	it("a plain (NONE) frame with no fill/stroke/clip is still a native-frame (nesting, not pass-through)", () => {
		const node = {
			id: "1:1",
			name: "group",
			type: "FRAME",
			absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 50 },
			layoutMode: "NONE",
			fills: [],
			strokes: [],
			children: [],
		};
		expect(classify(node as never)).toEqual({ kind: "native-frame" });
	});

	it("a solid rect named image:{{token}} → native-image (placeholder)", () => {
		const n: FigmaNode = {
			...baseAttrs,
			id: "1",
			name: "image:{{logo}}",
			type: "RECTANGLE",
			fills: [{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.9, a: 1 } }],
		};
		expect(classify(n).kind).toBe("native-image");
	});

	it("non-decomposable (skew) transform → flatten, not native", () => {
		// A shear matrix: columns (1,0) and (0.5,1) aren't orthogonal, so it's
		// not a clean rotation+scale — placeLocal/placeWorld would fall back to
		// flatten, and classify must agree so collectRasterTargets exports it.
		const n: FigmaNode = {
			...baseAttrs,
			id: "1",
			name: "skewed",
			type: "RECTANGLE",
			fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
			relativeTransform: [
				[1, 0.5, 0],
				[0, 1, 0],
			],
		};
		const c = classify(n);
		expect(c.kind).toBe("flatten");
		if (c.kind === "flatten") {
			expect(c.reason).toBe("transform_undecomposable_flattened");
		}
	});

	it("a rotation Figma left off-orthogonal by float noise → still native", () => {
		// Figma's own matrix for a 48px icon three groups deep: a pure rotation
		// re-multiplied through its ancestors in float32 until the columns
		// disagree by 0.015°, which is 0.012px of shear across the icon. Reading
		// that as a real shear costs the layer its vector for nothing.
		const n: FigmaNode = {
			...baseAttrs,
			id: "1",
			name: "pug",
			type: "VECTOR",
			absoluteBoundingBox: { x: 0, y: 0, width: 49.7, height: 49.8 },
			width: 48.12,
			height: 48.18,
			fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
			fillGeometry: [{ path: "M 0 0 L 10 0 L 10 10 Z" }],
			relativeTransform: [
				[0.033359663110880025, 0.9994347375251241, 6.567742717543329],
				[-0.9994433702605207, 0.033617302633198835, 190.60072218052855],
			],
		} as unknown as FigmaNode;
		expect(classify(n).kind).toBe("native-vector");
	});

	describe("image-filled ellipses and polygons", () => {
		const IMAGE = [
			{ type: "IMAGE" as const, scaleMode: "FILL" as const, imageRef: "a" },
		];
		const GEOMETRY = [{ path: "M 0 0 L 10 0 L 10 10 Z" }];
		const shape = (extra: Partial<FigmaNode>): FigmaNode =>
			({
				...baseAttrs,
				id: "1",
				name: "{{avatar}}",
				fills: IMAGE,
				fillGeometry: GEOMETRY,
				...extra,
			}) as FigmaNode;

		it("a full ellipse → native-image", () => {
			expect(classify(shape({ type: "ELLIPSE" })).kind).toBe("native-image");
			expect(
				classify(
					shape({
						type: "ELLIPSE",
						arcData: {
							startingAngle: 0,
							endingAngle: 2 * Math.PI,
							innerRadius: 0,
						},
					} as Partial<FigmaNode>),
				).kind,
			).toBe("native-image");
		});

		it("a partial arc or a donut → flatten", () => {
			for (const arcData of [
				{ startingAngle: 0, endingAngle: Math.PI, innerRadius: 0 },
				{ startingAngle: 0, endingAngle: 2 * Math.PI, innerRadius: 0.5 },
			]) {
				expect(
					classify(shape({ type: "ELLIPSE", arcData } as Partial<FigmaNode>)),
				).toEqual({ kind: "flatten", reason: "paint_flattened" });
			}
		});

		it("a regular polygon → native-image", () => {
			expect(
				classify(
					shape({ type: "POLYGON", pointCount: 6 } as Partial<FigmaNode>),
				).kind,
			).toBe("native-image");
		});

		it("a polygon with rounded corners → flatten", () => {
			expect(
				classify(
					shape({
						type: "POLYGON",
						pointCount: 6,
						cornerRadius: 4,
					} as Partial<FigmaNode>),
				).kind,
			).toBe("flatten");
		});

		it("a solid ellipse named image:{{token}} → native-image", () => {
			expect(
				classify(
					shape({
						type: "ELLIPSE",
						name: "image:{{avatar}}",
						fills: [{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.9, a: 1 } }],
					} as Partial<FigmaNode>),
				).kind,
			).toBe("native-image");
		});

		it("a star with an image fill → flatten", () => {
			expect(classify(shape({ type: "STAR" })).kind).toBe("flatten");
		});
	});
});
