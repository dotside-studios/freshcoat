import { describe, expect, it } from "vitest";
import { polygonMaskBox, transpileImage } from "~/lib/figma/transpiler/image";
import type {
	FigmaImagePaint,
	FigmaRectangleNode,
	FigmaVectorNode,
} from "~/lib/figma/types";

const FRAME = { x: 0, y: 0, width: 1000, height: 600 };

const baseImage = (
	overrides: Partial<FigmaRectangleNode> = {},
): FigmaRectangleNode => ({
	id: "1:4",
	name: "avatar",
	type: "RECTANGLE",
	visible: true,
	opacity: 1,
	blendMode: "NORMAL",
	absoluteBoundingBox: { x: 0, y: 0, width: 80, height: 80 },
	fills: [{ type: "IMAGE", scaleMode: "FILL", imageRef: "abc123" }],
	...overrides,
});

describe("transpileImage", () => {
	// Field registration (incl. aspect) is covered in binding.test; these assert
	// the rasterize-vs-dynamic-element decision and the rendered properties.
	it("returns { kind: 'rasterize', nodeId } for static images", () => {
		const r = transpileImage(baseImage(), { frame: FRAME, scale: 1 });
		expect(r.kind).toBe("rasterize");
		if (r.kind === "rasterize") {
			// Placement is the caller's job (it uses absoluteRenderBounds); the
			// rasterize result only carries the node id to export.
			expect(r.nodeId).toBe("1:4");
		}
	});

	it("static images with any scaleMode still return { kind: 'rasterize' } (fit is always 'fill' post-rasterize)", () => {
		const fillR = transpileImage(baseImage(), { frame: FRAME, scale: 1 });
		expect(fillR.kind).toBe("rasterize");
		const fitR = transpileImage(
			baseImage({
				fills: [{ type: "IMAGE", scaleMode: "FIT", imageRef: "abc" }],
			}),
			{ frame: FRAME, scale: 1 },
		);
		expect(fitR.kind).toBe("rasterize");
		const tileR = transpileImage(
			baseImage({
				fills: [{ type: "IMAGE", scaleMode: "TILE", imageRef: "abc" }],
			}),
			{ frame: FRAME, scale: 1 },
		);
		expect(tileR.kind).toBe("rasterize");
	});

	it("detects {{name}} layer name and returns { kind: 'element' } with dynamic src", () => {
		const r = transpileImage(baseImage({ name: "{{user_avatar}}" }), {
			frame: FRAME,
			scale: 1,
		});
		expect(r.kind).toBe("element");
		if (r.kind === "element") {
			expect(r.element.properties.src).toBe("{{user_avatar}}");
			expect(r.element.properties.fit).toBe("cover");
		}
	});

	it("goes dynamic from an image binding template even without a bare-token name", () => {
		// e.g. an `image:{{avatar}}` marker or a stored pluginData image binding.
		const r = transpileImage(
			baseImage({ name: "image:{{avatar}}" }),
			{ frame: FRAME, scale: 1 },
			"{{avatar}}",
		);
		expect(r.kind).toBe("element");
		if (r.kind === "element") {
			expect(r.element.id).toBe("avatar");
			expect(r.element.properties.src).toBe("{{avatar}}");
		}
	});

	it("goes dynamic on a SOLID-fill rect (image: placeholder, no image fill) without crashing", () => {
		// The Layer-tab "Image" button binds a plain gray {{logo}} box: no IMAGE
		// fill, so `fill` is undefined — fit must default to cover, not throw on
		// `.scaleMode`.
		const r = transpileImage(
			baseImage({
				name: "image:{{logo}}",
				fills: [{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.9, a: 1 } }],
			}),
			{ frame: FRAME, scale: 1 },
			"{{logo}}",
		);
		expect(r.kind).toBe("element");
		if (r.kind === "element") {
			expect(r.element.id).toBe("logo");
			expect(r.element.properties.fit).toBe("cover");
		}
	});
});

describe("dynamic image filters and crop", () => {
	const dynamic = (fill: Record<string, unknown>) => {
		const r = transpileImage(
			baseImage({
				name: "{{photo}}",
				fills: [{ type: "IMAGE", imageRef: "abc", ...fill } as FigmaImagePaint],
			}),
			{ frame: FRAME, scale: 1 },
		);
		if (r.kind !== "element") throw new Error("expected an element");
		return r;
	};

	it("maps exposure, contrast and saturation to adjust", () => {
		const r = dynamic({
			scaleMode: "FILL",
			filters: { exposure: 1, contrast: 0.2, saturation: -1 },
		});
		expect(r.element.adjust).toEqual({
			saturation: 0,
			contrast: 1.2,
			brightness: 2,
		});
		expect(r.warnings.map((w) => w.code)).toEqual([
			"image_filter_approximated",
		]);
	});

	it("reports filters with no counterpart", () => {
		const r = dynamic({
			scaleMode: "FILL",
			filters: { temperature: 0.3, shadows: -0.2 },
		});
		expect(r.element.adjust).toBeUndefined();
		expect(r.warnings).toMatchObject([
			{
				code: "image_filter_unsupported",
				message: "Image temperature, shadows adjustments were left out.",
			},
		]);
	});

	it("maps an upright crop to fill with a crop region", () => {
		const r = dynamic({
			scaleMode: "STRETCH",
			imageTransform: [
				[0.5, 0, 0.25],
				[0, 0.8, 0.1],
			],
		});
		expect(r.element.properties).toMatchObject({
			fit: "fill",
			crop: { x: 0.25, y: 0.1, width: 0.5, height: 0.8 },
		});
		expect(r.warnings).toEqual([]);
	});

	it("falls back to cover for a turned crop, and warns", () => {
		const r = dynamic({
			scaleMode: "STRETCH",
			imageTransform: [
				[0, -1, 1],
				[1, 0, 0],
			],
		});
		expect(r.element.properties.fit).toBe("cover");
		expect(r.element.properties).not.toHaveProperty("crop");
		expect(r.warnings.map((w) => w.code)).toEqual(["image_crop_unsupported"]);
	});
});

const imageFill = [
	{ type: "IMAGE" as const, scaleMode: "FILL" as const, imageRef: "abc" },
];

const shapeNode = (
	overrides: Partial<FigmaVectorNode> & Pick<FigmaVectorNode, "type">,
): FigmaVectorNode => ({
	id: "1:5",
	name: "{{avatar}}",
	visible: true,
	opacity: 1,
	blendMode: "NORMAL",
	absoluteBoundingBox: { x: 0, y: 0, width: 80, height: 80 },
	relativeTransform: [
		[1, 0, 0],
		[0, 1, 0],
	],
	width: 80,
	height: 80,
	fills: imageFill,
	...overrides,
});

function dynamicElement(node: FigmaRectangleNode | FigmaVectorNode) {
	const r = transpileImage(node, { frame: FRAME, scale: 1 });
	if (r.kind !== "element") throw new Error("expected an element");
	return r;
}

describe("dynamic image shape", () => {
	it("keeps a uniform corner radius", () => {
		const { element } = dynamicElement(
			baseImage({ name: "{{avatar}}", cornerRadius: 40 }),
		);
		expect(element.properties.cornerRadius).toBe(40);
		expect(element.properties).not.toHaveProperty("mask");
	});

	it("rounds per-corner radii to the largest, and warns", () => {
		const r = dynamicElement(
			baseImage({ name: "{{avatar}}", cornerRadius: [24, 24, 0, 0] }),
		);
		expect(r.element.properties.cornerRadius).toBe(24);
		expect(r.warnings.map((w) => w.code)).toEqual([
			"image_corner_radius_approximated",
		]);
	});

	it("maps corner smoothing to a squircle mask", () => {
		const { element } = dynamicElement(
			baseImage({ name: "{{avatar}}", cornerRadius: 20, cornerSmoothing: 0.6 }),
		);
		expect(element.properties.mask).toEqual({ kind: "squircle", radius: 20 });
		expect(element.properties).not.toHaveProperty("cornerRadius");
	});

	it("keeps the stroke", () => {
		const { element } = dynamicElement(
			baseImage({
				name: "{{avatar}}",
				strokes: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
				strokeWeight: 4,
				strokeAlign: "INSIDE",
			}),
		);
		expect(element.properties.stroke).toEqual({
			color: "#ffffff",
			width: 4,
			align: "inside",
		});
	});

	it("keeps a gradient stroke", () => {
		const r = dynamicElement(
			baseImage({
				name: "{{avatar}}",
				strokes: [
					{
						type: "GRADIENT_LINEAR",
						gradientHandlePositions: [
							{ x: 0, y: 0.5 },
							{ x: 1, y: 0.5 },
							{ x: 0, y: 1 },
						],
						gradientStops: [
							{ position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
							{ position: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
						],
					},
				],
				strokeWeight: 4,
			}),
		);
		expect(r.element.properties.stroke?.color).toEqual({
			kind: "linear",
			angle: 0,
			from: [0, 0.5],
			to: [1, 0.5],
			stops: [
				{ offset: 0, color: "#000000" },
				{ offset: 1, color: "#ffffff" },
			],
		});
		expect(r.warnings).toEqual([]);
	});

	it("leaves out an image stroke, and warns", () => {
		const r = dynamicElement(
			baseImage({
				name: "{{avatar}}",
				strokes: [{ type: "IMAGE", scaleMode: "FILL", imageRef: "h" }],
				strokeWeight: 4,
			}),
		);
		expect(r.element.properties).not.toHaveProperty("stroke");
		expect(r.warnings.map((w) => w.code)).toEqual(["image_stroke_unsupported"]);
	});

	it("masks a round ellipse as a circle", () => {
		const { element } = dynamicElement(shapeNode({ type: "ELLIPSE" }));
		expect(element.properties.mask).toBe("circle");
		expect(element.properties.src).toBe("{{avatar}}");
	});

	it("masks an oval ellipse as an ellipse", () => {
		const { element } = dynamicElement(
			shapeNode({
				type: "ELLIPSE",
				width: 120,
				absoluteBoundingBox: { x: 0, y: 0, width: 120, height: 80 },
			}),
		);
		expect(element.properties.mask).toBe("ellipse");
	});

	it("masks a polygon and grows its box onto Figma's vertices", () => {
		const { element } = dynamicElement(
			shapeNode({
				type: "POLYGON",
				pointCount: 3,
				relativeTransform: [
					[1, 0, 10],
					[0, 1, 20],
				],
			}),
		);
		expect(element.properties.mask).toEqual({ kind: "polygon", sides: 3 });
		// A triangle spans 1.5 radii tall and sqrt(3) wide.
		expect(element.size).toEqual({ width: 92.5, height: 106.5 });
		expect(element.pos).toEqual({ x: 4, y: 20 });
	});

	it("leaves a square-sided polygon's box as it is", () => {
		const { element } = dynamicElement(
			shapeNode({ type: "POLYGON", pointCount: 4 }),
		);
		expect(element.size).toEqual({ width: 80, height: 80 });
		expect(element.pos).toEqual({ x: 0, y: 0 });
	});
});

describe("polygonMaskBox", () => {
	it("puts each mask vertex on the edge of the node's box", () => {
		for (const sides of [3, 5, 6, 7]) {
			const box = polygonMaskBox(sides, 100, 60);
			const xs: number[] = [];
			const ys: number[] = [];
			for (let i = 0; i < sides; i++) {
				const a = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
				xs.push(box.x + (box.width / 2) * (1 + Math.cos(a)));
				ys.push(box.y + (box.height / 2) * (1 + Math.sin(a)));
			}
			expect(Math.min(...xs)).toBeCloseTo(0);
			expect(Math.max(...xs)).toBeCloseTo(100);
			expect(Math.min(...ys)).toBeCloseTo(0);
			expect(Math.max(...ys)).toBeCloseTo(60);
		}
	});
});
