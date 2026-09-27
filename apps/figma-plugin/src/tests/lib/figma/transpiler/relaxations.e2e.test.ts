import { compile, type Template } from "@freshcoat-js/coatfile";
import {
	approxEngine,
	compileScene,
	type DrawCommand,
} from "@freshcoat-js/engine";
import { describe, expect, it, vi } from "vitest";
import {
	type ProductRegistryEntry,
	transpile,
} from "~/lib/figma/transpiler/index";
import type { FigmaContainerNode } from "~/lib/figma/types";

// Recursively find draw commands by op (draws nest inside groups). Text bakes
// via the dependency-free approxEngine — no DOM/CanvasKit needed here.
function findDraws(commands: DrawCommand[], op: string): DrawCommand[] {
	const out: DrawCommand[] = [];
	for (const c of commands) {
		if (c.op === op) out.push(c);
		if (c.op === "drawGroup") out.push(...findDraws(c.children, op));
	}
	return out;
}

// The frame's top-level draws (background + elements) — compileScene wraps them
// in one root group, so return that group's children.
function topDraws(template: Template): DrawCommand[] {
	const compiled = compile(template, {}, { width: 1000, height: 600 });
	const [frame] = compiled.frames;
	if (!frame) throw new Error("the template compiled to no frames");
	const commands = compileScene(frame.root, {
		width: compiled.width,
		height: compiled.height,
		textEngine: approxEngine,
		fonts: frame.assets.fonts,
		images: frame.assets.images,
	});
	const root = commands.find((c) => c.op === "drawGroup");
	return root?.op === "drawGroup" ? root.children : [];
}

// End-to-end exercise of every relaxation we shipped on this branch:
//   • multi-fill rect
//   • image with TILE scaleMode
//   • drop shadow + layer blur effects
//   • vector with single-segment fillGeometry
//   • clipping FRAME with own fill
//   • TEXT with characterStyleOverrides
//
// One Figma tree, one transpile pass, one set of assertions on the
// resulting template. No flatten markers expected — if any of these
// regress to flatten, this test catches it.

const PRODUCT: ProductRegistryEntry = {
	sku: "card_cr80",
	displayName: "CR80 Card",
	width: 1000,
	height: 600,
	frames: [{ name: "front", label: "Front", required: true }],
};

function buildTree(): FigmaContainerNode {
	return {
		id: "1:1",
		name: "Front",
		type: "FRAME",
		visible: true,
		opacity: 1,
		blendMode: "NORMAL",
		absoluteBoundingBox: { x: 0, y: 0, width: 1000, height: 600 },
		fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
		children: [
			// 1. Multi-fill rect (was multi_fill_flattened)
			{
				id: "1:2",
				name: "stacked-bg",
				type: "RECTANGLE",
				visible: true,
				opacity: 1,
				blendMode: "NORMAL",
				absoluteBoundingBox: { x: 50, y: 50, width: 200, height: 100 },
				relativeTransform: [
					[1, 0, 50],
					[0, 1, 50],
				],
				fills: [
					{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } },
					{ type: "SOLID", color: { r: 0, g: 1, b: 0, a: 1 } },
				],
			},
			// 2. Image with TILE scaleMode (was multi_fill_flattened)
			{
				id: "1:3",
				name: "tile-bg",
				type: "RECTANGLE",
				visible: true,
				opacity: 1,
				blendMode: "NORMAL",
				absoluteBoundingBox: { x: 300, y: 50, width: 100, height: 100 },
				fills: [{ type: "IMAGE", scaleMode: "TILE", imageRef: "tile_ref" }],
			},
			// 3. Rect with drop shadow + layer blur (was effect_flattened)
			{
				id: "1:4",
				name: "shadowed-card",
				type: "RECTANGLE",
				visible: true,
				opacity: 1,
				blendMode: "NORMAL",
				absoluteBoundingBox: { x: 450, y: 50, width: 100, height: 100 },
				relativeTransform: [
					[1, 0, 450],
					[0, 1, 50],
				],
				fills: [{ type: "SOLID", color: { r: 0.2, g: 0.2, b: 0.2, a: 1 } }],
				effects: [
					{
						type: "DROP_SHADOW",
						visible: true,
						color: { r: 0, g: 0, b: 0, a: 0.4 },
						offset: { x: 0, y: 4 },
						radius: 8,
					},
					{ type: "LAYER_BLUR", visible: true, radius: 2 },
				],
			},
			// 4. Vector with fillGeometry (was vector_flattened)
			{
				id: "1:5",
				name: "icon",
				type: "VECTOR",
				visible: true,
				opacity: 1,
				blendMode: "NORMAL",
				absoluteBoundingBox: { x: 600, y: 50, width: 60, height: 60 },
				relativeTransform: [
					[1, 0, 600],
					[0, 1, 50],
				],
				fillGeometry: [{ path: "M0,0 L60,0 L30,52 Z" }],
				fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 1, a: 1 } }],
			},
			// 5. Clipping FRAME with own fill (was clip_overflow_flattened)
			{
				id: "1:6",
				name: "clipped-group",
				type: "FRAME",
				visible: true,
				opacity: 1,
				blendMode: "NORMAL",
				absoluteBoundingBox: { x: 50, y: 200, width: 300, height: 200 },
				clipsContent: true,
				cornerRadius: 16,
				fills: [{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.9, a: 1 } }],
				children: [
					{
						id: "1:7",
						name: "inside-clip",
						type: "RECTANGLE",
						visible: true,
						opacity: 1,
						blendMode: "NORMAL",
						absoluteBoundingBox: { x: 60, y: 220, width: 80, height: 60 },
						relativeTransform: [
							[1, 0, 10],
							[0, 1, 20],
						],
						fills: [{ type: "SOLID", color: { r: 1, g: 0.5, b: 0, a: 1 } }],
					},
				],
			},
			// 6. TEXT with character-style overrides (was text_mixed_styling_flattened)
			{
				id: "1:8",
				name: "headline",
				type: "TEXT",
				visible: true,
				opacity: 1,
				blendMode: "NORMAL",
				absoluteBoundingBox: { x: 50, y: 450, width: 400, height: 60 },
				relativeTransform: [
					[1, 0, 50],
					[0, 1, 450],
				],
				characters: "PLAN: PRO",
				style: {
					fontFamily: "Comfortaa",
					fontSize: 32,
					fontWeight: 400,
					textAlignHorizontal: "LEFT",
					textAlignVertical: "TOP",
				},
				fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
				characterStyleOverrides: [0, 0, 0, 0, 0, 0, 1, 1, 1],
				styleOverrideTable: { "1": { fontWeight: 700 } },
			},
		],
	};
}

describe("transpile (relaxations e2e)", () => {
	it("emits all six previously-flattened cases as native primitives; static image is rasterized per-node", async () => {
		const fetchNodeTree = vi.fn(async () => buildTree());
		const tileBlob = new Blob([new Uint8Array([9, 8, 7])], {
			type: "image/png",
		});
		const renderImage = vi
			.fn()
			.mockResolvedValue({ blob: tileBlob, sha256: "TILE_SHA" });

		const result = await transpile({
			product: PRODUCT,
			picks: {
				front: {
					fileKey: "FK",
					nodeId: "1:1",
					nodeName: "Front",
					width: 1000,
					height: 600,
				},
			},
			metadata: {
				id: "e2e",
				name: "E2E",
				version: "1.0.0",
				formatVersion: "1.0",
			},
			fetchNodeTree,
			renderImage,
		});

		expect(result.report.counts.flattened).toBe(0);
		// Static tile image → one pending raster asset
		expect(result.pendingAssets).toHaveLength(1);
		expect(result.pendingAssets[0]?.sha256).toBe("TILE_SHA");
		// renderImage called once for the static image node
		expect(renderImage).toHaveBeenCalledTimes(1);
		expect(renderImage).toHaveBeenCalledWith({
			fileKey: "FK",
			nodeIds: ["1:3"],
			scale: expect.any(Number),
			format: "png",
		});

		const tmpl = result.template as {
			template_data: [
				{ name: string; elements: Array<Record<string, unknown>> },
			];
		};
		const elements = tmpl.template_data[0].elements;
		const element = (id: string): Record<string, unknown> => {
			const found = elements.find((e) => e.id === id);
			if (!found) throw new Error(`no element ${id}`);
			return found;
		};

		// Each of the six children produced exactly one element (the frame is
		// one element with a children array, not multiple top-level ones).
		expect(elements).toHaveLength(6);

		// 1. Multi-fill rect: fills array of two
		const stacked = element("stacked_bg");
		expect(stacked.type).toBe("rect");
		expect((stacked.properties as Record<string, unknown>).fill).toEqual([
			"#ff0000",
			"#00ff00",
		]);

		// 2. Static tile image → rasterized per-node; fit is always "fill"
		const tile = element("image_1_3");
		expect(tile.type).toBe("image");
		expect((tile.properties as Record<string, unknown>).fit).toBe("fill");
		expect((tile.properties as Record<string, unknown>).src).toBe(
			"asset:TILE_SHA",
		);

		// 3. Shadow + blur
		const shadowed = element("shadowed_card");
		expect(shadowed.type).toBe("rect");
		expect(shadowed.shadow).toMatchObject({ dy: 4, blur: 8 });
		expect(shadowed.blur).toBe(2);

		// 4. Vector
		const icon = element("icon");
		expect(icon.type).toBe("vector");
		expect((icon.properties as Record<string, unknown>).d).toBe(
			"M0,0 L60,0 L30,52 Z",
		);

		// 5. Frame element with children (the inner rect lives in frame.children,
		// not at the top level)
		const frameEl = element("clipped_group");
		expect(frameEl.type).toBe("frame");
		const fp = frameEl.properties as Record<string, unknown>;
		expect(fp.clipsContent).toBe(true);
		expect(fp.cornerRadius).toBe(16);
		const innerChildren = fp.children as Array<Record<string, unknown>>;
		expect(innerChildren).toHaveLength(1);
		expect(innerChildren[0]?.type).toBe("rect");
		// Inner child pos is frame-local (inside-clip is at absolute (60, 220);
		// frame is at (50, 200) → frame-local (10, 20))
		expect(innerChildren[0]?.pos).toEqual({ x: 10, y: 20 });

		// 6. Text with spans
		const headline = element("headline");
		expect(headline.type).toBe("text");
		const hp = headline.properties as Record<string, unknown>;
		expect(hp.value).toBeUndefined();
		const spans = hp.spans as Array<Record<string, unknown>>;
		expect(spans).toHaveLength(2);
		expect(spans[0]?.text).toBe("PLAN: ");
		expect(spans[1]?.text).toBe("PRO");
		expect((spans[1]?.font as Record<string, unknown>).weight).toBe(700);
	});

	it("the transpiled template parses + compiles cleanly through @freshcoat-js/coatfile", async () => {
		const fetchNodeTree = vi.fn(async () => buildTree());
		const tileBlob = new Blob([new Uint8Array([9, 8, 7])], {
			type: "image/png",
		});
		const result = await transpile({
			product: PRODUCT,
			picks: {
				front: {
					fileKey: "FK",
					nodeId: "1:1",
					nodeName: "Front",
					width: 1000,
					height: 600,
				},
			},
			metadata: {
				id: "e2e",
				name: "E2E",
				version: "1.0.0",
				formatVersion: "1.0",
			},
			fetchNodeTree,
			renderImage: vi
				.fn()
				.mockResolvedValue({ blob: tileBlob, sha256: "TILE_SHA" }),
		});

		// Fields the transpiler-inferred plus product-required defaults — none
		// here since none of our spans use mustache. Just give compile an empty
		// values object; the template should compile to a CompiledTemplate.
		const draws = topDraws(result.template as Template);
		// background + 6 elements at top level
		expect(draws).toHaveLength(7);

		// Frame element survived as a group: rounded-rect clip + (synthetic bg +
		// inner rect) = 2 children.
		const group = draws.find((c) => c.op === "drawGroup");
		expect(group).toBeDefined();
		expect(group?.clip).toEqual({ kind: "rounded-rect", radius: 16 });
		if (group?.op === "drawGroup") expect(group.children).toHaveLength(2);

		// Vector kept as a path
		expect(findDraws(draws, "drawPath").length).toBeGreaterThan(0);

		// Multi-fill rect kept its fills array
		const stacked = findDraws(draws, "drawRect").find(
			(c) => c.op === "drawRect" && (c.fills?.length ?? 0) === 2,
		);
		expect(stacked).toBeDefined();

		// Text with spans
		const text = findDraws(draws, "drawText")[0];
		expect(text).toBeDefined();
		if (text?.op === "drawText") {
			expect(text.layout.lines[0]?.spans).toHaveLength(2);
		}
	});
});
