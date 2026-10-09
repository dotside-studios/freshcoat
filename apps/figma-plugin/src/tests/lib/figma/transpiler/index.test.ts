import { FORMAT_VERSION } from "@freshcoat-js/coatfile";
import { describe, expect, it, vi } from "vitest";
import { SizeMismatchError } from "~/lib/figma/transpiler/exact-size";
import { fixtures } from "~/lib/figma/transpiler/fixtures";
import {
	type ColorwayInput,
	type ProductRegistryEntry,
	type TranspileInput,
	transpile,
} from "~/lib/figma/transpiler/index";
import type { FigmaContainerNode, FigmaNode } from "~/lib/figma/types";

const PRODUCT: ProductRegistryEntry = {
	sku: "card_cr80",
	displayName: "CR80 Card",
	width: 1017,
	height: 639,
	frames: [
		{ name: "front", label: "Front", required: true },
		{ name: "back", label: "Back", required: true },
	],
};

function frameNode(
	id: string,
	width: number,
	height: number,
): FigmaContainerNode {
	return {
		id,
		name: id,
		type: "FRAME",
		visible: true,
		opacity: 1,
		blendMode: "NORMAL",
		absoluteBoundingBox: { x: 0, y: 0, width, height },
		children: [],
		fills: [],
	};
}

const META = { id: "t", name: "T", version: "1.0.0", formatVersion: "1.0" };

const EXACT_PRODUCT: ProductRegistryEntry = {
	sku: "card_cr80",
	displayName: "CR80 Card",
	width: 1013,
	height: 638,
	frames: [
		{ name: "front", label: "Front", required: true },
		{ name: "back", label: "Back", required: true },
	],
};

function hexToRgba(hex: string): {
	r: number;
	g: number;
	b: number;
	a: number;
} {
	const h = hex.replace("#", "");
	return {
		r: Number.parseInt(h.slice(0, 2), 16) / 255,
		g: Number.parseInt(h.slice(2, 4), 16) / 255,
		b: Number.parseInt(h.slice(4, 6), 16) / 255,
		a: 1,
	};
}

function rectFrame(fill: string): FigmaContainerNode {
	return {
		id: `swatch-${fill}`,
		name: "swatch",
		type: "FRAME",
		visible: true,
		opacity: 1,
		blendMode: "NORMAL",
		absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
		children: [],
		fills: [{ type: "SOLID", color: hexToRgba(fill) }],
	};
}

function makeInput(opts: {
	frontSize: [number, number];
	backSize: [number, number];
	variants?: Array<{ label: string; frontFill: string; backFill: string }>;
}): TranspileInput {
	const fetchNodeTree = vi.fn(async (_fileKey: string, nodeId: string) => {
		if (nodeId === "front")
			return frameNode("front", opts.frontSize[0], opts.frontSize[1]);
		if (nodeId === "back")
			return frameNode("back", opts.backSize[0], opts.backSize[1]);
		throw new Error(`unexpected nodeId ${nodeId}`);
	});
	const variants: ColorwayInput[] = (opts.variants ?? []).map((v, i) => ({
		instanceId: `I${i}`,
		label: v.label,
		perSide: {
			front: rectFrame(v.frontFill),
			back: rectFrame(v.backFill),
		},
	}));
	return {
		product: EXACT_PRODUCT,
		picks: {
			front: {
				fileKey: "FK",
				nodeId: "front",
				nodeName: "Front",
				width: opts.frontSize[0],
				height: opts.frontSize[1],
			},
			back: {
				fileKey: "FK",
				nodeId: "back",
				nodeName: "Back",
				width: opts.backSize[0],
				height: opts.backSize[1],
			},
		},
		variants,
		metadata: META,
		fetchNodeTree,
		renderImage: vi.fn(),
	};
}

describe("transpile (exact sizing)", () => {
	it("emits the exact canonical dims for an exactly-sized landscape card", async () => {
		const out = await transpile(
			makeInput({ frontSize: [1013, 638], backSize: [1013, 638] }),
		);
		const t = out.template as { width: number; height: number };
		expect(t.width).toBe(1013);
		expect(t.height).toBe(638);
	});

	it("emits the canonical dims (not the measured dims) for a within-tolerance off-round size", async () => {
		const out = await transpile(
			makeInput({ frontSize: [1012, 638], backSize: [1012, 638] }),
		);
		const t = out.template as { width: number; height: number };
		expect(t.width).toBe(1013);
		expect(t.height).toBe(638);
	});

	it("throws with a suggested size when a side is off-size", async () => {
		await expect(
			transpile(makeInput({ frontSize: [1000, 630], backSize: [1013, 638] })),
		).rejects.toThrow(/exact_size|resize .* 1013.638/i);
	});

	it("rejects a side whose orientation disagrees with the first, in the canvas's terms", async () => {
		// Portrait is a valid CR80 orientation on its own — it's only wrong here
		// because the front already settled the canvas as landscape. The author
		// gets the target dims rather than the word "orientation".
		await expect(
			transpile(makeInput({ frontSize: [1013, 638], backSize: [638, 1013] })),
		).rejects.toThrow(/'back' is 638×1013 — resize to 1013×638/);
	});

	it("reports every off-size side at once, not just the first", async () => {
		const err = await transpile(
			makeInput({ frontSize: [1000, 630], backSize: [900, 500] }),
		).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(SizeMismatchError);
		if (!(err instanceof SizeMismatchError)) return;
		expect(err.code).toBe("exact_size");
		expect(err.issues.map((i) => i.slot)).toEqual(["front", "back"]);
		expect(err.issues[0]).toMatchObject({
			nodeId: "front",
			nodeName: "Front",
			width: 1000,
			height: 630,
			expectedWidth: 1013,
			expectedHeight: 638,
		});
	});

	it("does not build elements when a side is off-size", async () => {
		// The size gate runs as a pre-pass, so an off-size export costs one tree
		// fetch per slot and no rasterization.
		const input = makeInput({ frontSize: [1000, 630], backSize: [1013, 638] });
		await expect(transpile(input)).rejects.toThrow(SizeMismatchError);
		expect(input.renderImage).not.toHaveBeenCalled();
	});
});

describe("transpile (variants from instances)", () => {
	it("emits Default + one variant per colorway instance", async () => {
		const out = await transpile(
			makeInput({
				frontSize: [1013, 638],
				backSize: [1013, 638],
				variants: [
					{ label: "Amber", frontFill: "#ffbf00", backFill: "#ffbf00" },
					{ label: "Sky", frontFill: "#00aaff", backFill: "#00aaff" },
				],
			}),
		);
		const t = out.template as {
			variants?: Array<{ id: string; label: string }>;
		};
		expect(t.variants?.map((v) => v.id)).toEqual(["default", "amber", "sky"]);
		expect(t.variants?.[1].label).toBe("Amber");
		expect(out.variantPicks).toEqual({
			amber: { instanceId: "I0", label: "Amber" },
			sky: { instanceId: "I1", label: "Sky" },
		});
	});

	it("omits variants entirely when there are no colorway instances", async () => {
		const out = await transpile(
			makeInput({
				frontSize: [1013, 638],
				backSize: [1013, 638],
				variants: [],
			}),
		);
		const t = out.template as { variants?: unknown };
		expect(t.variants).toBeUndefined();
		expect(out.variantPicks).toEqual({});
	});

	it("does not throw when a colorway's perSide omits a side, and only overrides the present side", async () => {
		const input = makeInput({
			frontSize: [1013, 638],
			backSize: [1013, 638],
		});
		input.variants = [
			{
				instanceId: "I:amber",
				label: "Amber",
				perSide: { front: rectFrame("#ffbf00") }, // back intentionally omitted
			},
		];
		const out = await transpile(input);
		const t = out.template as {
			variants?: Array<{ id: string; overrides: Array<{ name: string }> }>;
		};
		const amber = t.variants?.find((v) => v.id === "amber");
		expect(amber?.overrides.map((o) => o.name)).toEqual(["front"]);
	});

	it("does not invoke renderImage for a pure-paint variant (no flatten/static-image content)", async () => {
		const renderImage = vi.fn();
		const input = makeInput({
			frontSize: [1013, 638],
			backSize: [1013, 638],
			variants: [{ label: "Amber", frontFill: "#ffbf00", backFill: "#ffbf00" }],
		});
		input.renderImage = renderImage;
		const out = await transpile(input);
		expect(renderImage).not.toHaveBeenCalled();
		expect(
			out.warnings.some((w) => w.code === "variants_background_only"),
		).toBe(false);
	});
});

describe("transpile (variant element deltas)", () => {
	const singleSlotProduct: ProductRegistryEntry = {
		sku: "card_cr80",
		displayName: "CR80 Card",
		width: 1013,
		height: 638,
		frames: [{ name: "front", label: "Front", required: true }],
	};

	function textNode(
		id: string,
		name: string,
		color: string,
	): FigmaContainerNode["children"][number] {
		return {
			id,
			name,
			type: "TEXT",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x: 10, y: 10, width: 200, height: 40 },
			characters: "Name",
			style: {
				fontFamily: "Arial",
				fontSize: 24,
				fontWeight: 400,
				italic: false,
				textAlignHorizontal: "LEFT",
				textAlignVertical: "TOP",
				textAutoResize: "NONE",
				lineHeightPercentFontSize: 120,
			},
			fills: [{ type: "SOLID", color: hexToRgba(color) }],
		} as unknown as FigmaContainerNode["children"][number];
	}

	function sideFrame(
		bgFill: string | undefined,
		nameColor: string,
		extraChild?: FigmaContainerNode["children"][number],
	): FigmaContainerNode {
		const children = [textNode("1:2", "name", nameColor)];
		if (extraChild) children.push(extraChild);
		return {
			id: "1:1",
			name: "front",
			type: "FRAME",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x: 0, y: 0, width: 1013, height: 638 },
			fills: bgFill ? [{ type: "SOLID", color: hexToRgba(bgFill) }] : [],
			children,
		} as unknown as FigmaContainerNode;
	}

	function run(base: FigmaContainerNode, cwFront: FigmaContainerNode) {
		return transpile({
			product: singleSlotProduct,
			picks: {
				front: {
					fileKey: "FK",
					nodeId: "front",
					nodeName: "Front",
					width: 1013,
					height: 638,
				},
			},
			variants: [
				{ instanceId: "I:amber", label: "Amber", perSide: { front: cwFront } },
			],
			metadata: META,
			fetchNodeTree: vi.fn(async () => base),
			renderImage: vi.fn(),
		});
	}

	it("Default has no overrides; a colorway with a changed element color emits an element delta and no background key", async () => {
		const base = sideFrame(undefined, "#111111");
		const amber = sideFrame(undefined, "#ff0000");
		const out = await run(base, amber);

		const t = out.template as {
			variants?: Array<{
				id: string;
				overrides: Array<{
					name: string;
					background?: unknown;
					elements?: Array<{ id: string; properties: Record<string, unknown> }>;
				}>;
			}>;
		};

		const defaultVariant = t.variants?.find((v) => v.id === "default");
		expect(defaultVariant?.overrides).toEqual([]);

		const amberVariant = t.variants?.find((v) => v.id === "amber");
		expect(amberVariant?.overrides).toEqual([
			{
				name: "front",
				elements: [{ id: "name", properties: { color: "#ff0000" } }],
			},
		]);
	});

	it("emits background AND element deltas when both the side bg and an element differ", async () => {
		const base = sideFrame("#ffffff", "#111111");
		const amber = sideFrame("#00ff00", "#ff0000");
		const out = await run(base, amber);

		const t = out.template as {
			variants?: Array<{
				id: string;
				overrides: Array<{
					name: string;
					background?: { properties?: { fill?: string } };
					elements?: Array<{ id: string; properties: Record<string, unknown> }>;
				}>;
			}>;
		};
		const amberVariant = t.variants?.find((v) => v.id === "amber");
		expect(amberVariant?.overrides).toHaveLength(1);
		const [front] = amberVariant?.overrides ?? [];
		expect(front.background?.properties?.fill).toBe("#00ff00");
		expect(front.elements).toEqual([
			{ id: "name", properties: { color: "#ff0000" } },
		]);
	});

	it("emits a variant_structure_mismatch warning (no throw) when a colorway side's element structure differs, diffing only the aligned ids", async () => {
		const base = sideFrame(undefined, "#111111");
		const extraChild = textNode("1:9", "extra", "#00ff00");
		const mismatched = sideFrame(undefined, "#ff0000", extraChild);

		const out = await run(base, mismatched);

		expect(out.warnings).toContainEqual(
			expect.objectContaining({
				code: "variant_structure_mismatch",
				severity: "warn",
			}),
		);

		const t = out.template as {
			variants?: Array<{
				id: string;
				overrides: Array<{
					name: string;
					elements?: Array<{ id: string; properties: Record<string, unknown> }>;
				}>;
			}>;
		};
		const amberVariant = t.variants?.find((v) => v.id === "amber");
		expect(amberVariant?.overrides).toEqual([
			{
				name: "front",
				elements: [{ id: "name", properties: { color: "#ff0000" } }],
			},
		]);
	});
});

describe("transpile (variant raster assets are embedded)", () => {
	const singleSlotProduct: ProductRegistryEntry = {
		sku: "card_cr80",
		displayName: "CR80 Card",
		width: 1013,
		height: 638,
		frames: [{ name: "front", label: "Front", required: true }],
	};

	// A static image-fill RECTANGLE (no binding) → rasterized to an asset. The
	// base card node is `1:2`; the same layer inside a colorway INSTANCE carries
	// Figma's `I<instanceId>;<baseNodeId>` form, so it slugs to the SAME element
	// id (`image_1_2`) and the variant diff aligns to it.
	function photoRect(nodeId: string): FigmaContainerNode["children"][number] {
		return {
			id: nodeId,
			name: "photo",
			type: "RECTANGLE",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x: 100, y: 100, width: 200, height: 100 },
			absoluteTransform: [
				[1, 0, 100],
				[0, 1, 100],
			],
			relativeTransform: [
				[1, 0, 100],
				[0, 1, 100],
			],
			width: 200,
			height: 100,
			fills: [{ type: "IMAGE", scaleMode: "FILL", imageRef: "img-ref" }],
		} as unknown as FigmaContainerNode["children"][number];
	}

	function sideFrame(photoNodeId: string): FigmaContainerNode {
		return {
			id: "1:1",
			name: "front",
			type: "FRAME",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x: 0, y: 0, width: 1013, height: 638 },
			fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
			children: [photoRect(photoNodeId)],
		} as unknown as FigmaContainerNode;
	}

	it("embeds a variant's recolored raster and emits the matching src delta", async () => {
		const baseBlob = new Blob([new Uint8Array([1])], { type: "image/png" });
		const variantBlob = new Blob([new Uint8Array([2])], { type: "image/png" });
		// Keyed by node id so the base layer and the instance sublayer resolve to
		// distinct rasters (a recolored strip has different pixels → new sha256).
		const renderImage = vi.fn(async (req: { nodeIds: string[] }) => {
			const id = req.nodeIds[0];
			if (id === "1:2") return { blob: baseBlob, sha256: "BASE_SHA" };
			if (id === "I9:9;1:2")
				return { blob: variantBlob, sha256: "VARIANT_SHA" };
			throw new Error(`unexpected nodeId ${id}`);
		});

		const out = await transpile({
			product: singleSlotProduct,
			picks: {
				front: {
					fileKey: "FK",
					nodeId: "front",
					nodeName: "Front",
					width: 1013,
					height: 638,
				},
			},
			variants: [
				{
					instanceId: "I9:9",
					label: "Amber",
					perSide: { front: sideFrame("I9:9;1:2") },
				},
			],
			metadata: META,
			fetchNodeTree: vi.fn(async () => sideFrame("1:2")),
			renderImage,
		});

		// The variant's recolored raster bytes ride along in the bundle (without
		// this the emitted `asset:VARIANT_SHA` override is unresolvable at import).
		const shas = out.pendingAssets.map((a) => a.sha256);
		expect(shas).toContain("BASE_SHA");
		expect(shas).toContain("VARIANT_SHA");
		const variantAsset = out.pendingAssets.find(
			(a) => a.sha256 === "VARIANT_SHA",
		);
		expect(variantAsset?.blob).toBe(variantBlob);

		const t = out.template as {
			variants?: Array<{
				id: string;
				overrides: Array<{
					name: string;
					elements?: Array<{ id: string; properties: Record<string, unknown> }>;
				}>;
			}>;
		};
		const amber = t.variants?.find((v) => v.id === "amber");
		const front = amber?.overrides.find((o) => o.name === "front");
		expect(front?.elements).toEqual([
			{ id: "image_1_2", properties: { src: "asset:VARIANT_SHA" } },
		]);
	});
});

describe("transpile (deep id uniqueness across nested frames)", () => {
	const singleSlotProduct: ProductRegistryEntry = {
		sku: "card_cr80",
		displayName: "CR80 Card",
		width: 1013,
		height: 638,
		frames: [{ name: "front", label: "Front", required: true }],
	};

	function textNode(
		id: string,
		name: string,
		color: string,
		box: { x: number; y: number; width: number; height: number },
	): FigmaContainerNode["children"][number] {
		return {
			id,
			name,
			type: "TEXT",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: box,
			characters: "Name",
			style: {
				fontFamily: "Arial",
				fontSize: 24,
				fontWeight: 400,
				italic: false,
				textAlignHorizontal: "LEFT",
				textAlignVertical: "TOP",
				textAutoResize: "NONE",
				lineHeightPercentFontSize: 120,
			},
			fills: [{ type: "SOLID", color: hexToRgba(color) }],
		} as unknown as FigmaContainerNode["children"][number];
	}

	function frameChild(
		id: string,
		name: string,
		box: { x: number; y: number; width: number; height: number },
		children: FigmaContainerNode["children"],
	): FigmaContainerNode["children"][number] {
		return {
			id,
			name,
			type: "FRAME",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: box,
			fills: [],
			children,
		} as unknown as FigmaContainerNode["children"][number];
	}

	// Top-level text "name" and a nested text inside a "card" frame ALSO
	// named "name" — Figma auto-naming routinely produces exactly this (e.g.
	// two "Text" layers both slug to "text"). nestedColor lets the variant
	// test below change only the nested one.
	function sideFrame(
		topColor: string,
		nestedColor: string,
	): FigmaContainerNode {
		return {
			id: "1:1",
			name: "front",
			type: "FRAME",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x: 0, y: 0, width: 1013, height: 638 },
			fills: [],
			children: [
				textNode("1:2", "name", topColor, {
					x: 10,
					y: 10,
					width: 200,
					height: 40,
				}),
				frameChild("1:3", "card", { x: 300, y: 10, width: 200, height: 100 }, [
					textNode("1:4", "name", nestedColor, {
						x: 10,
						y: 10,
						width: 180,
						height: 30,
					}),
				]),
			],
		} as unknown as FigmaContainerNode;
	}

	function run(base: FigmaContainerNode, cwFront: FigmaContainerNode) {
		return transpile({
			product: singleSlotProduct,
			picks: {
				front: {
					fileKey: "FK",
					nodeId: "front",
					nodeName: "Front",
					width: 1013,
					height: 638,
				},
			},
			variants: [
				{ instanceId: "I:amber", label: "Amber", perSide: { front: cwFront } },
			],
			metadata: META,
			fetchNodeTree: vi.fn(async () => base),
			renderImage: vi.fn(),
		});
	}

	it("assigns distinct ids to a top-level and a same-named nested element (deep uniquify)", async () => {
		const base = sideFrame("#111111", "#222222");
		const out = await run(base, sideFrame("#111111", "#222222"));

		const t = out.template as {
			template_data: Array<{ elements: Array<Record<string, unknown>> }>;
		};
		const els = t.template_data[0].elements;
		const topText = els.find((e) => e.type === "text");
		const cardFrame = els.find((e) => e.type === "frame") as
			| { properties: { children: Array<Record<string, unknown>> } }
			| undefined;
		const nestedText = cardFrame?.properties.children.find(
			(c) => c.type === "text",
		);

		expect(topText?.id).toBe("name");
		expect(nestedText?.id).toBeDefined();
		expect(nestedText?.id).not.toBe(topText?.id);
	});

	it("a variant changing ONLY the nested element's color emits a delta for ONLY that (unique) nested id", async () => {
		const base = sideFrame("#111111", "#222222");
		const changedNested = sideFrame("#111111", "#ff00ff"); // top unchanged, nested recolored
		const out = await run(base, changedNested);

		const t = out.template as {
			template_data: Array<{ elements: Array<Record<string, unknown>> }>;
			variants?: Array<{
				id: string;
				overrides: Array<{
					name: string;
					elements?: Array<{ id: string; properties: Record<string, unknown> }>;
				}>;
			}>;
		};
		const cardFrame = t.template_data[0].elements.find(
			(e) => e.type === "frame",
		) as
			| { properties: { children: Array<Record<string, unknown>> } }
			| undefined;
		const nestedId = cardFrame?.properties.children.find(
			(c) => c.type === "text",
		)?.id;

		const amber = t.variants?.find((v) => v.id === "amber");
		const frontOverride = amber?.overrides.find((o) => o.name === "front");
		expect(frontOverride?.elements).toEqual([
			{ id: nestedId, properties: { color: "#ff00ff" } },
		]);
	});

	it("a variant changing a nested element does NOT emit a `children` delta on the ancestor frame", async () => {
		const base = sideFrame("#111111", "#222222");
		const changedNested = sideFrame("#111111", "#ff00ff");
		const out = await run(base, changedNested);

		const t = out.template as {
			variants?: Array<{
				id: string;
				overrides: Array<{
					name: string;
					elements?: Array<{ id: string; properties: Record<string, unknown> }>;
				}>;
			}>;
		};
		const amber = t.variants?.find((v) => v.id === "amber");
		const frontOverride = amber?.overrides.find((o) => o.name === "front");

		const cardDelta = frontOverride?.elements?.find((e) => e.id === "card");
		expect(cardDelta).toBeUndefined();
		for (const d of frontOverride?.elements ?? []) {
			expect(d.properties).not.toHaveProperty("children");
		}
	});
});

describe("transpile (rotated frame)", () => {
	const rotatedFrameProduct: ProductRegistryEntry = {
		sku: "card_cr80",
		displayName: "CR80 Card",
		width: 1272,
		height: 799,
		frames: [
			{ name: "front", label: "Front", required: true },
			{ name: "back", label: "Back", required: true },
		],
	};

	it("carries rotation on a rotated frame's background/clip and emits no flatten warning", async () => {
		// A frame rotated 90° via relativeTransform ([[0,-1],[1,0]] → atan2(1,0)
		// = 90°). The painter rotates the whole group (background + clip +
		// children) around its center, so the frame element CARRIES rotation
		// rather than being flagged as flattened.
		const rotatedPanel = {
			id: "1:2",
			name: "panel",
			type: "FRAME",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x: 100, y: 100, width: 120, height: 60 },
			relativeTransform: [
				[0, -1, 200],
				[1, 0, 100],
			],
			// Slot is axis-aligned at the origin, so world == local: the absolute
			// transform mirrors the relative one (rotation 90).
			absoluteTransform: [
				[0, -1, 200],
				[1, 0, 100],
			],
			width: 120,
			height: 60,
			clipsContent: true,
			fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
			children: [],
		} as unknown as FigmaContainerNode;
		const front: FigmaContainerNode = {
			...frameNode("1:1", 1272, 799),
			children: [rotatedPanel],
		};
		const fetchNodeTree = vi.fn(async (_k: string, id: string) =>
			id === "1:1" ? front : frameNode("1:10", 1272, 799),
		);
		const result = await transpile({
			product: rotatedFrameProduct,
			picks: {
				front: {
					fileKey: "FK",
					nodeId: "1:1",
					nodeName: "F",
					width: 1272,
					height: 799,
				},
				back: {
					fileKey: "FK",
					nodeId: "1:10",
					nodeName: "B",
					width: 1272,
					height: 799,
				},
			},
			metadata: META,
			fetchNodeTree,
			renderImage: vi.fn(),
		});

		const tmpl = result.template as {
			template_data: Array<{ elements: Array<Record<string, unknown>> }>;
		};
		const frameEl = tmpl.template_data[0].elements.find(
			(e) => e.type === "frame",
		);
		expect(frameEl).toBeDefined();
		expect(frameEl?.rotation).toBe(90);
		expect(
			result.warnings.some(
				(w) => w.code === "rotated_frame_background_flattened",
			),
		).toBe(false);
	});

	it("leaves a rotated child of a live auto-layout frame in the flow", async () => {
		// A rotated band inside a NON-rotated auto-layout column. freshcoat's
		// resolveLayout reserves the bounding box of the turn and hands the child
		// its own box back (see its rotated-flow tests), which is what Figma does
		// — so the band flows and carries no absolute pin.
		const rotatedBand = {
			id: "1:3",
			name: "band",
			type: "FRAME",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x: 110, y: 110, width: 100, height: 20 },
			relativeTransform: [
				[0, -1, 130],
				[1, 0, 10],
			],
			width: 100,
			height: 20,
			fills: [],
			children: [],
		} as unknown as FigmaContainerNode;
		const autoCol = {
			id: "1:2",
			name: "col",
			type: "FRAME",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x: 100, y: 100, width: 200, height: 300 },
			layoutMode: "VERTICAL",
			itemSpacing: 10,
			fills: [],
			children: [rotatedBand],
		} as unknown as FigmaContainerNode;
		const front: FigmaContainerNode = {
			...frameNode("1:1", 1272, 799),
			children: [autoCol],
		};
		const result = await transpile({
			product: rotatedFrameProduct,
			picks: {
				front: {
					fileKey: "FK",
					nodeId: "1:1",
					nodeName: "F",
					width: 1272,
					height: 799,
				},
				back: {
					fileKey: "FK",
					nodeId: "1:10",
					nodeName: "B",
					width: 1272,
					height: 799,
				},
			},
			metadata: META,
			fetchNodeTree: vi.fn(async (_k: string, id: string) =>
				id === "1:1" ? front : frameNode("1:10", 1272, 799),
			),
			renderImage: vi.fn(),
		});
		const tmpl = result.template as {
			template_data: Array<{
				elements: Array<{
					type: string;
					properties: { children: Array<Record<string, unknown>> };
				}>;
			}>;
		};
		const col = tmpl.template_data[0].elements.find((e) => e.type === "frame");
		const band = col?.properties.children[0];
		expect(band?.rotation).toBe(90);
		expect(
			(band?.layoutChild as { absolute?: boolean } | undefined)?.absolute,
		).toBeUndefined();
	});
});

describe("transpile (rotated slot frame)", () => {
	const singleSlotProduct: ProductRegistryEntry = {
		sku: "card_cr80",
		displayName: "CR80 Card",
		width: 1108,
		height: 696,
		frames: [{ name: "front", label: "Front", required: true }],
	};

	it("places a slot's direct child via WORLD (slot rotation stripped), not slot-local", async () => {
		// The slot frame is rotated −90° in Figma: its unrotated portrait local
		// space (696×1108) is rotated to a landscape world AABB (1108×696 = the
		// card). A child that is upright in WORLD has absoluteTransform rotation 0
		// but a +90 relativeTransform (relative to the rotated slot). Placing it
		// slot-local would emit rotation 90 + a portrait position (off-canvas);
		// placing it world (re-anchored to the slot AABB) emits rotation 0 at the
		// landscape position. The card is axis-aligned, so WORLD is correct.
		const front: FigmaContainerNode = {
			id: "1:1",
			name: "Front",
			type: "FRAME",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x: 0, y: 0, width: 1108, height: 696 },
			fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
			children: [
				{
					id: "legal",
					name: "legal",
					type: "TEXT",
					visible: true,
					opacity: 1,
					blendMode: "NORMAL",
					absoluteBoundingBox: { x: 700, y: 250, width: 410, height: 184 },
					// upright in world (rotation 0) at world top-left (700,250).
					absoluteTransform: [
						[1, 0, 700],
						[0, 1, 250],
					],
					// +90 relative to the rotated slot — WRONG if used (rotation 90).
					relativeTransform: [
						[0, 1, 0],
						[-1, 0, 0],
					],
					width: 410,
					height: 184,
					characters: "x",
					style: {
						fontFamily: "Arial",
						fontSize: 40,
						fontWeight: 400,
						italic: false,
						textAlignHorizontal: "LEFT",
						textAlignVertical: "TOP",
						textAutoResize: "NONE",
						lineHeightPercentFontSize: 120,
					},
					fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
				},
			],
		} as unknown as FigmaContainerNode;

		const result = await transpile({
			product: singleSlotProduct,
			picks: {
				front: {
					fileKey: "FK",
					nodeId: "1:1",
					nodeName: "Front",
					width: 1108,
					height: 696,
				},
			},
			metadata: {
				id: "rot-slot",
				name: "Rot Slot",
				version: "1.0.0",
				formatVersion: "1.0",
			},
			fetchNodeTree: vi.fn(async () => front),
			renderImage: vi.fn(),
		});

		const tmpl = result.template as {
			template_data: [{ elements: Array<Record<string, unknown>> }];
		};
		const legal = tmpl.template_data[0].elements.find((e) => e.id === "legal");
		expect(legal).toBeDefined();
		// WORLD placement: rotation 0 (horizontal), pos re-anchored to slot origin.
		expect(legal?.rotation ?? 0).toBe(0);
		expect(legal?.pos).toEqual({ x: 700, y: 250 });
		expect(legal?.size).toEqual({ width: 410, height: 184 });
	});
});

describe("transpile (minimal card fixture)", () => {
	it("produces the expected Template", async () => {
		const fetchNodeTree = vi.fn(async (_fileKey: string, nodeId: string) => {
			if (nodeId === "1:1") return fixtures.minimalCard.figma.front;
			if (nodeId === "1:10") return fixtures.minimalCard.figma.back;
			throw new Error(`unexpected nodeId ${nodeId}`);
		});
		const renderImage = vi.fn();

		const result = await transpile({
			product: PRODUCT,
			picks: {
				front: {
					fileKey: "FK",
					nodeId: "1:1",
					nodeName: "Front",
					width: 1017,
					height: 639,
				},
				back: {
					fileKey: "FK",
					nodeId: "1:10",
					nodeName: "Back",
					width: 1017,
					height: 639,
				},
			},
			metadata: {
				id: "minimal-card",
				name: "Minimal Card",
				version: "1.0.0",
				formatVersion: FORMAT_VERSION,
			},
			fetchNodeTree,
			renderImage,
		});

		expect(result.warnings.filter((w) => w.severity === "error")).toEqual([]);
		expect(result.template).toEqual(fixtures.minimalCard.expected);
		expect(result.pendingAssets).toEqual([]);
		expect(renderImage).not.toHaveBeenCalled();
	});

	it("registers detected fields", async () => {
		const fetchNodeTree = vi.fn(async (_k: string, id: string) => {
			if (id === "1:1") return fixtures.minimalCard.figma.front;
			return fixtures.minimalCard.figma.back;
		});
		const result = await transpile({
			product: PRODUCT,
			picks: {
				front: {
					fileKey: "FK",
					nodeId: "1:1",
					nodeName: "Front",
					width: 1017,
					height: 639,
				},
				back: {
					fileKey: "FK",
					nodeId: "1:10",
					nodeName: "Back",
					width: 1017,
					height: 639,
				},
			},
			metadata: {
				id: "minimal-card",
				name: "Minimal Card",
				version: "1.0.0",
				formatVersion: FORMAT_VERSION,
			},
			fetchNodeTree,
			renderImage: vi.fn(),
		});
		expect(result.fieldsInferred).toEqual([
			{ id: "display_name", field: { type: "string", title: "Display name" } },
		]);
	});
});

describe("transpile (full card fixture - front slot only)", () => {
	it("flattens the VECTOR layer and produces an image element with asset hash", async () => {
		const fakeBlob = new Blob([new Uint8Array([1, 2, 3])], {
			type: "image/png",
		});
		const fetchNodeTree = vi.fn(async (_k: string, id: string) => {
			if (id === "2:1") return fixtures.fullCard.figma.front;
			throw new Error(`unexpected ${id}`);
		});
		const renderImage = vi.fn().mockResolvedValue({
			blob: fakeBlob,
			sha256: "RASTER_2_4_SHA",
		});

		const product: ProductRegistryEntry = {
			sku: "card_cr80",
			displayName: "CR80 Card",
			width: 1017,
			height: 639,
			frames: [{ name: "front", label: "Front", required: true }],
		};

		const result = await transpile({
			product,
			picks: {
				front: {
					fileKey: "FK",
					nodeId: "2:1",
					nodeName: "Front",
					width: 1017,
					height: 639,
				},
			},
			metadata: {
				id: "full-card",
				name: "Full Card",
				version: "1.0.0",
				formatVersion: FORMAT_VERSION,
			},
			fetchNodeTree,
			renderImage,
		});

		expect(renderImage).toHaveBeenCalledTimes(1);
		expect(renderImage).toHaveBeenCalledWith({
			fileKey: "FK",
			nodeIds: ["2:4"],
			scale: expect.any(Number),
			format: "png",
		});

		const expected = fixtures.fullCard.expected as unknown as {
			template_data: [{ elements: unknown[] }];
		};
		const tmpl = result.template as {
			template_data: [{ elements: unknown[] }];
		};
		expect(tmpl.template_data[0].elements).toEqual(
			expected.template_data[0].elements,
		);
		expect(result.pendingAssets).toEqual([
			{
				sha256: "RASTER_2_4_SHA",
				blob: fakeBlob,
				contentType: "image/png",
			},
		]);
	});
});

describe("transpile (fonts block)", () => {
	const bbox = { x: 0, y: 0, width: 1017, height: 639 };
	const base = {
		visible: true as const,
		opacity: 1,
		blendMode: "NORMAL" as const,
		effects: [],
	};
	const solidFill = {
		type: "SOLID" as const,
		color: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
	};

	const makeTextNode = (
		id: string,
		fontFamily: string,
		fontWeight = 700,
	): FigmaContainerNode["children"][number] => ({
		...base,
		id,
		name: "Label",
		type: "TEXT" as const,
		absoluteBoundingBox: { x: 64, y: 80, width: 500, height: 60 },
		characters: "Label",
		style: {
			fontFamily,
			fontSize: 40,
			fontWeight,
			italic: false,
			textAlignHorizontal: "LEFT" as const,
			textAlignVertical: "TOP" as const,
			textAutoResize: "NONE" as const,
			lineHeightPercentFontSize: 120,
		},
		fills: [solidFill],
	});

	const makeFrame = (
		id: string,
		child: FigmaContainerNode["children"][number],
	): FigmaContainerNode => ({
		...base,
		id,
		name: "Front",
		type: "FRAME" as const,
		absoluteBoundingBox: bbox,
		children: [child],
		fills: [{ type: "SOLID" as const, color: { r: 1, g: 1, b: 1, a: 1 } }],
	});

	const singleSlotProduct: ProductRegistryEntry = {
		sku: "card_cr80",
		displayName: "CR80 Card",
		width: 1017,
		height: 639,
		frames: [{ name: "front", label: "Front", required: true }],
	};

	it("emits template.fonts when a non-system family is referenced", async () => {
		const frame = makeFrame("f:1", makeTextNode("t:1", "Comfortaa", 700));
		const fetchNodeTree = vi.fn(async () => frame);
		const result = await transpile({
			product: singleSlotProduct,
			picks: {
				front: {
					fileKey: "FK",
					nodeId: "f:1",
					nodeName: "Front",
					width: 1017,
					height: 639,
				},
			},
			metadata: {
				id: "fonts-test",
				name: "Fonts Test",
				version: "1.0.0",
				formatVersion: "1.0",
			},
			fetchNodeTree,
			renderImage: vi.fn(),
		});

		const tmpl = result.template as {
			fonts?: Array<{ kind: string; family: string; url: string }>;
		};
		expect(tmpl.fonts).toBeDefined();
		expect(tmpl.fonts?.[0]).toMatchObject({
			kind: "google",
			family: "Comfortaa",
		});
		expect(tmpl.fonts?.[0].url).toContain("fonts.googleapis.com");
	});

	it("omits template.fonts when only system fonts are referenced (filtered out)", async () => {
		// Arial is in SYSTEM_SAFE — filtered out → empty array → no fonts block.
		const frame = makeFrame("f:2", makeTextNode("t:2", "Arial", 400));
		const fetchNodeTree = vi.fn(async () => frame);
		const result = await transpile({
			product: singleSlotProduct,
			picks: {
				front: {
					fileKey: "FK",
					nodeId: "f:2",
					nodeName: "Front",
					width: 1017,
					height: 639,
				},
			},
			metadata: {
				id: "fonts-test-system",
				name: "Fonts System",
				version: "1.0.0",
				formatVersion: "1.0",
			},
			fetchNodeTree,
			renderImage: vi.fn(),
		});

		const tmpl = result.template as { fonts?: unknown };
		expect(tmpl.fonts).toBeUndefined();
	});

	it("emits template.fonts for a non-system custom family (e.g. Proxima Nova)", async () => {
		// Non-system, non-Google-catalog fonts are still declared as Google and
		// fall back at render via the painter's name-guess. No warning emitted.
		const frame = makeFrame("f:3", makeTextNode("t:3", "Proxima Nova", 400));
		const fetchNodeTree = vi.fn(async () => frame);
		const result = await transpile({
			product: singleSlotProduct,
			picks: {
				front: {
					fileKey: "FK",
					nodeId: "f:3",
					nodeName: "Front",
					width: 1017,
					height: 639,
				},
			},
			metadata: {
				id: "fonts-test-custom",
				name: "Fonts Custom",
				version: "1.0.0",
				formatVersion: "1.0",
			},
			fetchNodeTree,
			renderImage: vi.fn(),
		});

		const tmpl = result.template as {
			fonts?: Array<{ kind: string; family: string }>;
		};
		expect(tmpl.fonts).toBeDefined();
		expect(tmpl.fonts?.[0]).toMatchObject({
			kind: "google",
			family: "Proxima Nova",
		});
		expect(
			result.warnings.filter((w) => w.code === "unknown_font"),
		).toHaveLength(0);
	});
});

describe("transpile (transparent group → flattened up)", () => {
	const singleSlotProduct: ProductRegistryEntry = {
		sku: "card_cr80",
		displayName: "CR80 Card",
		width: 1272,
		height: 799,
		frames: [{ name: "front", label: "Front", required: true }],
	};

	it("flattens a transparent GROUP: its rect surfaces at the slot's top level (no nested frame, no group offset)", async () => {
		// A GROUP is coordinate-transparent in Figma: its descendants' transforms
		// are relative to the nearest FRAME ancestor (the slot here), not the group.
		// So the rect's absolute (110,120) is also its slot-relative position; the
		// group's own (100,100) offset must NOT be applied.
		const front: FigmaContainerNode = {
			id: "1:1",
			name: "Front",
			type: "FRAME",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x: 0, y: 0, width: 1272, height: 799 },
			fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
			children: [
				{
					id: "1:2",
					name: "group",
					type: "GROUP",
					visible: true,
					opacity: 1,
					blendMode: "NORMAL",
					absoluteBoundingBox: { x: 100, y: 100, width: 200, height: 200 },
					relativeTransform: [
						[1, 0, 100],
						[0, 1, 100],
					],
					width: 200,
					height: 200,
					fills: [],
					strokes: [],
					children: [
						{
							id: "1:3",
							name: "inner-rect",
							type: "RECTANGLE",
							visible: true,
							opacity: 1,
							blendMode: "NORMAL",
							absoluteBoundingBox: { x: 110, y: 120, width: 50, height: 50 },
							// Group children are FRAME-relative in Figma — this is relative
							// to the slot frame at the origin, so it equals the abs position.
							relativeTransform: [
								[1, 0, 110],
								[0, 1, 120],
							],
							width: 50,
							height: 50,
							fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
						},
					],
				},
			],
		} as unknown as FigmaContainerNode;

		const fetchNodeTree = vi.fn(async () => front);
		const result = await transpile({
			product: singleSlotProduct,
			picks: {
				front: {
					fileKey: "FK",
					nodeId: "1:1",
					nodeName: "Front",
					width: 1272,
					height: 799,
				},
			},
			metadata: {
				id: "group-card",
				name: "Group Card",
				version: "1.0.0",
				formatVersion: "1.0",
			},
			fetchNodeTree,
			renderImage: vi.fn(),
		});

		const tmpl = result.template as {
			template_data: [{ elements: Array<Record<string, unknown>> }];
		};
		const elements = tmpl.template_data[0].elements;

		// The group flattened away: no nested frame element. The rect is at the
		// slot's top level, placed at its world (= slot-relative) position.
		expect(elements).toHaveLength(1);
		const rect = elements[0];
		expect(rect.type).toBe("rect");
		expect(rect.pos).toEqual({ x: 110, y: 120 });
	});

	it("does NOT double-count a nested group's offset: a FRAME > GROUP{94.5} > TEXT{94.5} places text at frame-relative {94.5,0}, not {189,0}", async () => {
		// Regression for the Davi logo+wordmark gap. The GROUP sits at {94.5,0}
		// inside the Davi FRAME; the TEXT's relativeTransform is {94.5,0} — but in
		// Figma that is FRAME-relative (groups don't re-anchor children), so the
		// correct frame-local position is {94.5,0}, NOT 94.5 + 94.5 = {189,0}.
		const davi: FigmaContainerNode = {
			id: "F:davi",
			name: "Davi",
			type: "FRAME",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x: 648, y: 120, width: 300, height: 80 },
			relativeTransform: [
				[1, 0, 648],
				[0, 1, 120],
			],
			width: 300,
			height: 80,
			fills: [],
			children: [
				{
					id: "G:51515",
					name: "Group_51515",
					type: "GROUP",
					visible: true,
					opacity: 1,
					blendMode: "NORMAL",
					// Group sits at frame-relative {94.5,0} (abs 648+94.5 = 742.5).
					absoluteBoundingBox: { x: 742.5, y: 120, width: 120, height: 60 },
					relativeTransform: [
						[1, 0, 94.5],
						[0, 1, 0],
					],
					width: 120,
					height: 60,
					fills: [],
					strokes: [],
					children: [
						{
							id: "T:davi",
							name: "Davi",
							type: "TEXT",
							visible: true,
							opacity: 1,
							blendMode: "NORMAL",
							// abs 742.5 → frame-relative 94.5. Figma reports this TEXT's
							// relativeTransform as FRAME-relative {94.5,0}, NOT group-relative.
							absoluteBoundingBox: { x: 742.5, y: 120, width: 120, height: 60 },
							relativeTransform: [
								[1, 0, 94.5],
								[0, 1, 0],
							],
							width: 120,
							height: 60,
							characters: "Davi",
							style: {
								fontFamily: "Arial",
								fontSize: 40,
								fontWeight: 700,
								italic: false,
								textAlignHorizontal: "LEFT",
								textAlignVertical: "TOP",
								textAutoResize: "NONE",
								lineHeightPercentFontSize: 120,
							},
							fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
						},
					],
				},
			],
		} as unknown as FigmaContainerNode;

		const front: FigmaContainerNode = {
			...frameNode("1:1", 1272, 799),
			fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
			children: [davi],
		};

		const fetchNodeTree = vi.fn(async () => front);
		const result = await transpile({
			product: singleSlotProduct,
			picks: {
				front: {
					fileKey: "FK",
					nodeId: "1:1",
					nodeName: "Front",
					width: 1272,
					height: 799,
				},
			},
			metadata: {
				id: "davi-logo",
				name: "Davi Logo",
				version: "1.0.0",
				formatVersion: "1.0",
			},
			fetchNodeTree,
			renderImage: vi.fn(),
		});

		const tmpl = result.template as {
			template_data: [{ elements: Array<Record<string, unknown>> }];
		};
		// The Davi FRAME nests; the GROUP inside it flattens, so the TEXT lands in
		// the FRAME's children at frame-relative {94.5,0} — the group's own {94.5,0}
		// is discarded (not double-counted into {189,0}).
		const frameEl = tmpl.template_data[0].elements.find(
			(e) => e.type === "frame",
		);
		expect(frameEl).toBeDefined();
		const children = (frameEl?.properties as Record<string, unknown>)
			.children as Array<Record<string, unknown>>;
		const text = children.find((c) => c.type === "text");
		expect(text).toBeDefined();
		expect(text?.pos).toEqual({ x: 94.5, y: 0 });
	});
});

describe("transpile (rasters placed at absoluteRenderBounds, the exported region)", () => {
	const singleSlotProduct: ProductRegistryEntry = {
		sku: "card_cr80",
		displayName: "CR80 Card",
		width: 1017,
		height: 639,
		frames: [{ name: "front", label: "Front", required: true }],
	};

	it("places a flatten marker at its RENDER bounds, not its geometry bounding box", async () => {
		// Regression: a decorative blob whose RENDERED region (what exportAsync
		// produces) differs from its geometry AABB — e.g. an effect/clip expands
		// or crops it. The PNG fills the render bounds, so the image element must
		// be placed there (pos/size from absoluteRenderBounds), NOT the geometry
		// bounding box (which would stretch the cropped PNG and overflow the card).
		const front: FigmaContainerNode = {
			id: "9:1",
			name: "Front",
			type: "FRAME",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x: 0, y: 0, width: 1017, height: 639 },
			fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
			children: [
				{
					id: "9:2",
					name: "blob",
					type: "RECTANGLE",
					visible: true,
					opacity: 1,
					blendMode: "NORMAL",
					// Geometry AABB — the WRONG box for the cropped/expanded export.
					absoluteBoundingBox: { x: 50, y: 80, width: 600, height: 600 },
					// Rendered region — what the PNG actually fills.
					absoluteRenderBounds: { x: 100, y: 120, width: 400, height: 300 },
					absoluteTransform: [
						[1, 0, 50],
						[0, 1, 80],
					],
					relativeTransform: [
						[1, 0, 50],
						[0, 1, 80],
					],
					width: 600,
					height: 600,
					fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
					effects: [
						{
							type: "LAYER_BLUR",
							blurType: "PROGRESSIVE",
							visible: true,
							radius: 8,
						},
					],
				},
			],
		} as unknown as FigmaContainerNode;

		const fakeBlob = new Blob([new Uint8Array([5])], { type: "image/png" });
		const result = await transpile({
			product: singleSlotProduct,
			picks: {
				front: {
					fileKey: "FK",
					nodeId: "9:1",
					nodeName: "Front",
					width: 1017,
					height: 639,
				},
			},
			metadata: {
				id: "blob-card",
				name: "Blob Card",
				version: "1.0.0",
				formatVersion: "1.0",
			},
			fetchNodeTree: vi.fn(async () => front),
			renderImage: vi
				.fn()
				.mockResolvedValue({ blob: fakeBlob, sha256: "BLOB_SHA" }),
		});

		const tmpl = result.template as {
			template_data: [{ elements: Array<Record<string, unknown>> }];
		};
		const img = tmpl.template_data[0].elements.find((e) => e.type === "image");
		expect(img).toBeDefined();
		// Render bounds re-anchored to the slot origin (frame at (0,0)), not the
		// geometry box {50,80,600,600}.
		expect(img?.pos).toEqual({ x: 100, y: 120 });
		expect(img?.size).toEqual({ width: 400, height: 300 });
		// Rotation/effects/clipping are baked into the exported pixels → no
		// transform on the placement.
		expect(img?.rotation).toBeUndefined();
	});

	it("places a static image at its RENDER bounds, not its geometry bounding box", async () => {
		// Same contract for a non-tokenized image-fill RECTANGLE: the rasterized
		// PNG fills absoluteRenderBounds, so the image element is placed there.
		const front: FigmaContainerNode = {
			id: "3:1",
			name: "Front",
			type: "FRAME",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x: 0, y: 0, width: 1017, height: 639 },
			fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
			children: [
				{
					id: "3:2",
					name: "photo",
					type: "RECTANGLE",
					visible: true,
					opacity: 1,
					blendMode: "NORMAL",
					absoluteBoundingBox: { x: 50, y: 80, width: 600, height: 600 },
					absoluteRenderBounds: { x: 100, y: 120, width: 400, height: 300 },
					absoluteTransform: [
						[1, 0, 50],
						[0, 1, 80],
					],
					relativeTransform: [
						[1, 0, 50],
						[0, 1, 80],
					],
					width: 600,
					height: 600,
					fills: [{ type: "IMAGE", scaleMode: "FILL", imageRef: "abc123" }],
				},
			],
		} as unknown as FigmaContainerNode;

		const fakeBlob = new Blob([new Uint8Array([7])], { type: "image/png" });
		const result = await transpile({
			product: singleSlotProduct,
			picks: {
				front: {
					fileKey: "FK",
					nodeId: "3:1",
					nodeName: "Front",
					width: 1017,
					height: 639,
				},
			},
			metadata: {
				id: "rot-img-card",
				name: "Rot Img Card",
				version: "1.0.0",
				formatVersion: "1.0",
			},
			fetchNodeTree: vi.fn(async () => front),
			renderImage: vi
				.fn()
				.mockResolvedValue({ blob: fakeBlob, sha256: "ROT_IMG_SHA" }),
		});

		const tmpl = result.template as {
			template_data: [{ elements: Array<Record<string, unknown>> }];
		};
		const img = tmpl.template_data[0].elements.find((e) => e.type === "image");
		expect(img).toBeDefined();
		expect(img?.pos).toEqual({ x: 100, y: 120 });
		expect(img?.size).toEqual({ width: 400, height: 300 });
		expect(img?.rotation).toBeUndefined();
	});

	it("falls back to absoluteBoundingBox when a flatten marker has no render bounds", async () => {
		const front: FigmaContainerNode = {
			id: "2:1",
			name: "Front",
			type: "FRAME",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x: 0, y: 0, width: 1017, height: 639 },
			fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
			children: [
				{
					id: "2:2",
					name: "decoration",
					type: "RECTANGLE",
					visible: true,
					opacity: 1,
					blendMode: "NORMAL",
					// No absoluteRenderBounds → fall back to the geometry box.
					absoluteBoundingBox: { x: 120, y: 80, width: 150, height: 90 },
					absoluteTransform: [
						[1, 0, 120],
						[0, 1, 80],
					],
					relativeTransform: [
						[1, 0, 120],
						[0, 1, 80],
					],
					width: 150,
					height: 90,
					fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 1, a: 1 } }],
					effects: [
						{
							type: "LAYER_BLUR",
							blurType: "PROGRESSIVE",
							visible: true,
							radius: 8,
						},
					],
				},
			],
		} as unknown as FigmaContainerNode;

		const fakeBlob = new Blob([new Uint8Array([3])], { type: "image/png" });
		const result = await transpile({
			product: singleSlotProduct,
			picks: {
				front: {
					fileKey: "FK",
					nodeId: "2:1",
					nodeName: "Front",
					width: 1017,
					height: 639,
				},
			},
			metadata: {
				id: "flat-card",
				name: "Flat Card",
				version: "1.0.0",
				formatVersion: "1.0",
			},
			fetchNodeTree: vi.fn(async () => front),
			renderImage: vi
				.fn()
				.mockResolvedValue({ blob: fakeBlob, sha256: "FLAT_SHA" }),
		});

		const tmpl = result.template as {
			template_data: [{ elements: Array<Record<string, unknown>> }];
		};
		const img = tmpl.template_data[0].elements.find((e) => e.type === "image");
		expect(img?.pos).toEqual({ x: 120, y: 80 });
		expect(img?.size).toEqual({ width: 150, height: 90 });
		expect(img?.rotation).toBeUndefined();
	});

	it("falls back to absoluteBoundingBox when a static image has no render bounds", async () => {
		const front: FigmaContainerNode = {
			id: "4:1",
			name: "Front",
			type: "FRAME",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x: 0, y: 0, width: 1017, height: 639 },
			fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
			children: [
				{
					id: "4:2",
					name: "photo",
					type: "RECTANGLE",
					visible: true,
					opacity: 1,
					blendMode: "NORMAL",
					absoluteBoundingBox: { x: 200, y: 100, width: 240, height: 120 },
					absoluteTransform: [
						[1, 0, 200],
						[0, 1, 100],
					],
					relativeTransform: [
						[1, 0, 200],
						[0, 1, 100],
					],
					width: 240,
					height: 120,
					fills: [{ type: "IMAGE", scaleMode: "FILL", imageRef: "xyz789" }],
				},
			],
		} as unknown as FigmaContainerNode;

		const fakeBlob = new Blob([new Uint8Array([4])], { type: "image/png" });
		const result = await transpile({
			product: singleSlotProduct,
			picks: {
				front: {
					fileKey: "FK",
					nodeId: "4:1",
					nodeName: "Front",
					width: 1017,
					height: 639,
				},
			},
			metadata: {
				id: "static-img-card",
				name: "Static Img Card",
				version: "1.0.0",
				formatVersion: "1.0",
			},
			fetchNodeTree: vi.fn(async () => front),
			renderImage: vi
				.fn()
				.mockResolvedValue({ blob: fakeBlob, sha256: "STATIC_SHA" }),
		});

		const tmpl = result.template as {
			template_data: [{ elements: Array<Record<string, unknown>> }];
		};
		const img = tmpl.template_data[0].elements.find((e) => e.type === "image");
		expect(img?.pos).toEqual({ x: 200, y: 100 });
		expect(img?.size).toEqual({ width: 240, height: 120 });
		expect(img?.rotation).toBeUndefined();
	});
});

describe("transpile (raster z-order)", () => {
	const singleSlotProduct: ProductRegistryEntry = {
		sku: "card_cr80",
		displayName: "CR80 Card",
		width: 1017,
		height: 639,
		frames: [{ name: "front", label: "Front", required: true }],
	};

	const solidFill = [
		{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } },
	] as unknown as never;

	/** A RECTANGLE that classifies native (plain solid fill). */
	const nativeRect = (id: string, name: string, x: number) =>
		({
			id,
			name,
			type: "RECTANGLE",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x, y: 0, width: 40, height: 40 },
			absoluteTransform: [
				[1, 0, x],
				[0, 1, 0],
			],
			relativeTransform: [
				[1, 0, x],
				[0, 1, 0],
			],
			width: 40,
			height: 40,
			fills: solidFill,
		}) as unknown as FigmaNode;

	/** A RECTANGLE forced down the flatten path by an unsupported effect. */
	const flattenRect = (
		id: string,
		name: string,
		box: { x: number; y: number; width: number; height: number },
	) =>
		({
			id,
			name,
			type: "RECTANGLE",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: box,
			absoluteRenderBounds: box,
			absoluteTransform: [
				[1, 0, box.x],
				[0, 1, box.y],
			],
			relativeTransform: [
				[1, 0, box.x],
				[0, 1, box.y],
			],
			width: box.width,
			height: box.height,
			fills: solidFill,
			effects: [
				{
					type: "LAYER_BLUR",
					blurType: "PROGRESSIVE",
					visible: true,
					radius: 8,
				},
			],
		}) as unknown as FigmaNode;

	const slotFrame = (children: FigmaNode[]): FigmaContainerNode =>
		({
			id: "z:1",
			name: "Front",
			type: "FRAME",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x: 0, y: 0, width: 1017, height: 639 },
			fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
			children,
		}) as unknown as FigmaContainerNode;

	const run = async (
		frame: FigmaContainerNode,
		renderImage = vi.fn(async (req: { nodeIds: string[] }) => ({
			blob: new Blob([new Uint8Array([1])], { type: "image/png" }),
			sha256: `SHA_${req.nodeIds[0]}`,
		})),
	) => {
		const result = await transpile({
			product: singleSlotProduct,
			picks: {
				front: {
					fileKey: "FK",
					nodeId: "z:1",
					nodeName: "Front",
					width: 1017,
					height: 639,
				},
			},
			metadata: {
				id: "z-card",
				name: "Z Card",
				version: "1.0.0",
				formatVersion: "1.0",
			},
			fetchNodeTree: vi.fn(async () => frame),
			renderImage: renderImage as never,
		});
		const tmpl = result.template as {
			template_data: [{ elements: Array<Record<string, unknown>> }];
		};
		return { result, elements: tmpl.template_data[0].elements };
	};

	it("keeps a rasterized region in its own z-position between native siblings", async () => {
		// The bug this guards: rasters batched after the walk and appended to the
		// end of the side, so a flattened backdrop painted OVER every native
		// element above it — text, logos, the lot — instead of under them.
		const { elements } = await run(
			slotFrame([
				nativeRect("z:2", "under", 0),
				flattenRect("z:3", "backdrop", {
					x: 0,
					y: 0,
					width: 400,
					height: 300,
				}),
				nativeRect("z:4", "over", 100),
			]),
		);
		expect(elements.map((e) => e.id)).toEqual(["under", "flatten_z_3", "over"]);
	});

	it("nests a rasterized region inside the frame it was drawn in, positioned frame-locally", async () => {
		const inner = {
			id: "z:5",
			name: "Inner",
			type: "FRAME",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x: 100, y: 50, width: 300, height: 200 },
			absoluteTransform: [
				[1, 0, 100],
				[0, 1, 50],
			],
			relativeTransform: [
				[1, 0, 100],
				[0, 1, 50],
			],
			width: 300,
			height: 200,
			fills: [],
			children: [
				nativeRect("z:6", "first", 100),
				flattenRect("z:7", "blob", {
					x: 140,
					y: 90,
					width: 120,
					height: 60,
				}),
			],
		} as unknown as FigmaNode;

		const { elements } = await run(slotFrame([inner]));
		const frameEl = elements[0] as {
			properties: { children: Array<Record<string, unknown>> };
		};
		const children = frameEl.properties.children;
		expect(children.map((c) => c.id)).toEqual(["first", "flatten_z_7"]);
		// Frame-local: the raster's world box minus the frame's origin.
		expect(children[1].pos).toEqual({ x: 40, y: 40 });
		expect(children[1].size).toEqual({ width: 120, height: 60 });
	});

	it("rasterizes both of two sibling regions when one's box sits inside the other's", async () => {
		// Sibling flatten regions are exported independently, so the outer
		// bitmap does not contain the inner one's pixels. Dropping the inner on
		// geometry alone deleted shapes — mountain detail, badges over a panel —
		// with no warning and no way to get them back.
		const { result, elements } = await run(
			slotFrame([
				flattenRect("z:8", "panel", { x: 0, y: 0, width: 600, height: 400 }),
				flattenRect("z:9", "badge", {
					x: 50,
					y: 50,
					width: 80,
					height: 80,
				}),
			]),
		);
		expect(elements.map((e) => e.id)).toEqual(["flatten_z_8", "flatten_z_9"]);
		expect(result.pendingAssets.map((a) => a.sha256)).toEqual([
			"SHA_z:8",
			"SHA_z:9",
		]);
		expect(result.report.counts.flattened).toBe(2);
	});

	it("skips a zero-area region with a warning instead of emitting an empty raster", async () => {
		// Figma exports a node that renders nothing as a 1x1 transparent pixel.
		// Stretching that across the region it claimed costs the author an asset
		// and leaves a hole where they expect a shape.
		const renderImage = vi.fn();
		const { result, elements } = await run(
			slotFrame([
				nativeRect("z:10", "keeper", 0),
				flattenRect("z:11", "nothing", {
					x: 10,
					y: 20,
					width: 300,
					height: 0,
				}),
			]),
			renderImage as never,
		);
		expect(elements.map((e) => e.id)).toEqual(["keeper"]);
		expect(renderImage).not.toHaveBeenCalled();
		expect(result.pendingAssets).toEqual([]);
		expect(result.warnings.map((w) => w.code)).toContain("raster_empty");
	});

	it("leaves no placeholder behind when a region's bytes never arrive", async () => {
		const renderImage = vi.fn(async () => {
			throw new Error("no exported bytes");
		});
		const { result, elements } = await run(
			slotFrame([
				nativeRect("z:12", "before", 0),
				flattenRect("z:13", "missing", {
					x: 0,
					y: 0,
					width: 100,
					height: 100,
				}),
				nativeRect("z:14", "after", 200),
			]),
			renderImage as never,
		);
		expect(elements.map((e) => e.id)).toEqual(["before", "after"]);
		expect(result.warnings.map((w) => w.code)).toContain("raster_unavailable");
	});
});

describe("transpile (opacity)", () => {
	const singleSlotProduct: ProductRegistryEntry = {
		sku: "card_cr80",
		displayName: "CR80 Card",
		width: 1017,
		height: 639,
		frames: [{ name: "front", label: "Front", required: true }],
	};

	const rect = (id: string, name: string, opacity?: number) =>
		({
			id,
			name,
			type: "RECTANGLE",
			visible: true,
			opacity,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x: 0, y: 0, width: 40, height: 40 },
			absoluteTransform: [
				[1, 0, 0],
				[0, 1, 0],
			],
			relativeTransform: [
				[1, 0, 0],
				[0, 1, 0],
			],
			width: 40,
			height: 40,
			fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
		}) as unknown as FigmaNode;

	const container = (
		type: "GROUP" | "FRAME",
		id: string,
		name: string,
		opacity: number,
		children: FigmaNode[],
	) =>
		({
			id,
			name,
			type,
			visible: true,
			opacity,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 200 },
			absoluteTransform: [
				[1, 0, 0],
				[0, 1, 0],
			],
			relativeTransform: [
				[1, 0, 0],
				[0, 1, 0],
			],
			width: 200,
			height: 200,
			fills: [],
			children,
		}) as unknown as FigmaNode;

	const run = async (children: FigmaNode[]) => {
		const front = {
			id: "o:1",
			name: "Front",
			type: "FRAME",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x: 0, y: 0, width: 1017, height: 639 },
			fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
			children,
		} as unknown as FigmaContainerNode;
		const result = await transpile({
			product: singleSlotProduct,
			picks: {
				front: {
					fileKey: "FK",
					nodeId: "o:1",
					nodeName: "Front",
					width: 1017,
					height: 639,
				},
			},
			metadata: {
				id: "o-card",
				name: "O Card",
				version: "1.0.0",
				formatVersion: "1.0",
			},
			fetchNodeTree: vi.fn(async () => front),
			renderImage: vi.fn(),
		});
		const tmpl = result.template as {
			template_data: [{ elements: Array<Record<string, unknown>> }];
		};
		return tmpl.template_data[0].elements;
	};

	it("carries a node's own opacity onto its element", () => {
		return run([rect("o:2", "half", 0.5)]).then((els) => {
			expect(els[0].opacity).toBe(0.5);
		});
	});

	it("omits opacity for a fully opaque node", async () => {
		const els = await run([rect("o:3", "solid")]);
		expect(els[0].opacity).toBeUndefined();
	});

	it("folds a flattened-away GROUP's opacity into its descendants", async () => {
		// The bug this guards: a GROUP has no coordinate space, so it is flattened
		// away and never becomes an element — which left nowhere for its opacity
		// to live. A background group at 35% painted its children at full
		// strength, three times heavier than the design.
		const els = await run([
			container("GROUP", "o:4", "backdrop", 0.35, [rect("o:5", "hill")]),
		]);
		expect(els).toHaveLength(1);
		expect(els[0].id).toBe("hill");
		expect(els[0].opacity).toBe(0.35);
	});

	it("multiplies nested group opacities together with the node's own", async () => {
		const els = await run([
			container("GROUP", "o:6", "outer", 0.5, [
				container("GROUP", "o:7", "inner", 0.5, [rect("o:8", "leaf", 0.5)]),
			]),
		]);
		expect(els[0].opacity).toBe(0.125);
	});

	it("leaves a FRAME's opacity on the frame, not doubled onto its children", async () => {
		// A frame keeps its own element and the painter applies its opacity to the
		// whole group, so pushing it down as well would square it.
		const els = await run([
			container("FRAME", "o:9", "panel", 0.5, [rect("o:10", "child")]),
		]);
		expect(els[0].opacity).toBe(0.5);
		const children = (
			els[0].properties as { children: Record<string, unknown>[] }
		).children;
		expect(children[0].opacity).toBeUndefined();
	});

	it("carries a group's opacity onto a rasterized descendant", async () => {
		// The bitmap comes from exportAsync, which renders the node alone — the
		// ancestor group's opacity is not in those pixels and has to be applied to
		// the element.
		const blob = new Blob([new Uint8Array([1])], { type: "image/png" });
		const flattened = {
			...(rect("o:11", "blob") as unknown as Record<string, unknown>),
			absoluteRenderBounds: { x: 0, y: 0, width: 40, height: 40 },
			effects: [
				{
					type: "LAYER_BLUR",
					blurType: "PROGRESSIVE",
					visible: true,
					radius: 4,
				},
			],
		} as unknown as FigmaNode;
		const front = {
			id: "o:1",
			name: "Front",
			type: "FRAME",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x: 0, y: 0, width: 1017, height: 639 },
			fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
			children: [container("GROUP", "o:12", "backdrop", 0.35, [flattened])],
		} as unknown as FigmaContainerNode;
		const result = await transpile({
			product: singleSlotProduct,
			picks: {
				front: {
					fileKey: "FK",
					nodeId: "o:1",
					nodeName: "Front",
					width: 1017,
					height: 639,
				},
			},
			metadata: {
				id: "o-card",
				name: "O Card",
				version: "1.0.0",
				formatVersion: "1.0",
			},
			fetchNodeTree: vi.fn(async () => front),
			renderImage: vi
				.fn()
				.mockResolvedValue({ blob, sha256: "S", width: 120, height: 120 }),
		});
		const tmpl = result.template as {
			template_data: [{ elements: Array<Record<string, unknown>> }];
		};
		const img = tmpl.template_data[0].elements[0];
		expect(img.type).toBe("image");
		expect(img.opacity).toBe(0.35);
	});
});

describe("transpile (decision trace)", () => {
	const singleSlotProduct: ProductRegistryEntry = {
		sku: "card_cr80",
		displayName: "CR80 Card",
		width: 1017,
		height: 639,
		frames: [{ name: "front", label: "Front", required: true }],
	};

	const leaf = (
		id: string,
		name: string,
		extra: Record<string, unknown> = {},
	) =>
		({
			id,
			name,
			type: "RECTANGLE",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x: 0, y: 0, width: 40, height: 40 },
			absoluteRenderBounds: { x: 0, y: 0, width: 40, height: 40 },
			absoluteTransform: [
				[1, 0, 0],
				[0, 1, 0],
			],
			relativeTransform: [
				[1, 0, 0],
				[0, 1, 0],
			],
			width: 40,
			height: 40,
			fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
			...extra,
		}) as unknown as FigmaNode;

	const run = async (children: FigmaNode[]) => {
		const front = {
			id: "t:1",
			name: "Front",
			type: "FRAME",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x: 0, y: 0, width: 1017, height: 639 },
			fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
			children,
		} as unknown as FigmaContainerNode;
		return transpile({
			product: singleSlotProduct,
			picks: {
				front: {
					fileKey: "FK",
					nodeId: "t:1",
					nodeName: "Front",
					width: 1017,
					height: 639,
				},
			},
			metadata: {
				id: "t-card",
				name: "T Card",
				version: "1.0.0",
				formatVersion: "1.0",
			},
			fetchNodeTree: vi.fn(async () => front),
			renderImage: vi.fn().mockResolvedValue({
				blob: new Blob([new Uint8Array([1])], { type: "image/png" }),
				sha256: "S",
				width: 120,
				height: 120,
			}),
		});
	};

	it("records a row per node with what it produced", async () => {
		const r = await run([leaf("t:2", "box")]);
		expect(r.trace).toEqual([
			{
				slot: "front",
				nodeId: "t:2",
				name: "box",
				nodeType: "RECTANGLE",
				decision: "native-rect",
				elementId: "box",
			},
		]);
	});

	it("names the reason a layer was rasterized", async () => {
		// The question the scene graph cannot answer: everything about the node
		// looks emittable, and it still came out a bitmap.
		const r = await run([
			leaf("t:3", "blob", {
				effects: [
					{
						type: "LAYER_BLUR",
						blurType: "PROGRESSIVE",
						visible: true,
						radius: 8,
					},
				],
			}),
		]);
		expect(r.trace[0]).toMatchObject({
			decision: "flatten",
			reason: "effect_flattened",
			elementId: "flatten_t_3",
		});
	});

	it("records a skipped layer, which produces nothing at all", async () => {
		const r = await run([leaf("t:4", "hidden", { visible: false })]);
		expect(r.trace[0]).toMatchObject({ decision: "skip", name: "hidden" });
		expect(r.trace[0].elementId).toBeUndefined();
	});

	it("records a pass-through group even though it emits no element", async () => {
		const group = {
			id: "t:5",
			name: "wrapper",
			type: "GROUP",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x: 0, y: 0, width: 80, height: 80 },
			fills: [],
			children: [leaf("t:6", "inner")],
		} as unknown as FigmaNode;
		const r = await run([group]);
		expect(r.trace.map((t) => [t.nodeId, t.decision])).toEqual([
			["t:5", "container"],
			["t:6", "native-rect"],
		]);
		expect(r.trace[0].elementId).toBeUndefined();
	});

	it("reports the element id a colliding layer name was renamed to", async () => {
		// Two layers named the same slug to the same id, so one is renamed. A
		// trace that recorded the id at build time would name an element that
		// isn't in the file — which is most of them on a real design.
		const r = await run([leaf("t:7", "box"), leaf("t:8", "box")]);
		expect(r.trace.map((t) => t.elementId)).toEqual(["box", "box_2"]);
	});

	it("carries the flattened and skipped rows into the template's report", async () => {
		const r = await run([
			leaf("t:9", "kept"),
			leaf("t:10", "hidden", { visible: false }),
			leaf("t:11", "blob", {
				effects: [
					{
						type: "LAYER_BLUR",
						blurType: "PROGRESSIVE",
						visible: true,
						radius: 8,
					},
				],
			}),
		]);
		const decisions = r.report.decisions ?? [];
		// Natives are their own evidence; only the ones that changed form ride
		// along in the product artifact.
		expect(decisions.map((d) => [d.name, d.decision])).toEqual([
			["hidden", "skip"],
			["blob", "flatten"],
		]);
		// The slot is implied by where the report sits, so it is not repeated.
		expect(decisions[0]).not.toHaveProperty("slot");
	});

	it("omits the report block entirely when nothing changed form", async () => {
		const r = await run([leaf("t:12", "box")]);
		expect(r.report.decisions).toBeUndefined();
	});
});

describe("transpile (blend modes)", () => {
	function cardWith(blendMode: string): FigmaContainerNode {
		return {
			id: "1:1",
			name: "front",
			type: "FRAME",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x: 0, y: 0, width: 1013, height: 638 },
			fills: [],
			children: [
				{
					id: "1:2",
					name: "tint",
					type: "RECTANGLE",
					visible: true,
					opacity: 1,
					blendMode,
					absoluteBoundingBox: { x: 10, y: 10, width: 100, height: 50 },
					fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
				},
			],
		} as unknown as FigmaContainerNode;
	}

	async function transpileCard(blendMode: string) {
		const out = await transpile({
			product: EXACT_PRODUCT,
			picks: {
				front: {
					fileKey: "FK",
					nodeId: "front",
					nodeName: "Front",
					width: 1013,
					height: 638,
				},
				back: {
					fileKey: "FK",
					nodeId: "back",
					nodeName: "Back",
					width: 1013,
					height: 638,
				},
			},
			metadata: META,
			fetchNodeTree: async (_k, id) =>
				id === "front" ? cardWith(blendMode) : frameNode("back", 1013, 638),
			renderImage: async () => ({
				blob: new Blob([new Uint8Array([1])]),
				sha256: "abc",
				width: 100,
				height: 50,
			}),
		});
		const t = out.template as {
			template_data: Array<{ elements: Array<Record<string, unknown>> }>;
		};
		return { el: t.template_data[0].elements[0], report: out.report };
	}

	// classify() keeps a Multiply layer native instead of rasterizing it, on the
	// strength of the element being able to carry the mode. Dropping it here
	// composites the layer as Normal with nothing to say so.
	it("carries a supported blend mode onto the element", async () => {
		const { el, report } = await transpileCard("MULTIPLY");
		expect(report.counts.flattened).toBe(0);
		expect(el.blendMode).toBe("multiply");
	});

	it("emits nothing for NORMAL", async () => {
		const { el } = await transpileCard("NORMAL");
		expect(el.blendMode).toBeUndefined();
	});

	it("carries the extended modes, linear dodge as plus", async () => {
		expect((await transpileCard("DIFFERENCE")).el.blendMode).toBe("difference");
		expect((await transpileCard("SOFT_LIGHT")).el.blendMode).toBe("soft-light");
		expect((await transpileCard("LINEAR_DODGE")).el.blendMode).toBe("plus");
	});

	it("carries linear burn", async () => {
		const { el, report } = await transpileCard("LINEAR_BURN");
		expect(report.counts.flattened).toBe(0);
		expect(el.blendMode).toBe("linear-burn");
	});
});

describe("transpile (shape warnings)", () => {
	async function warningsFor(rect: Record<string, unknown>) {
		const card = {
			...frameNode("front", 1013, 638),
			children: [
				{
					id: "1:2",
					name: "box",
					type: "RECTANGLE",
					visible: true,
					opacity: 1,
					blendMode: "NORMAL",
					absoluteBoundingBox: { x: 10, y: 10, width: 100, height: 50 },
					fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
					...rect,
				},
			],
		} as unknown as FigmaContainerNode;
		const pick = (nodeId: string) => ({
			fileKey: "FK",
			nodeId,
			nodeName: nodeId,
			width: 1013,
			height: 638,
		});
		const out = await transpile({
			product: EXACT_PRODUCT,
			picks: { front: pick("front"), back: pick("back") },
			metadata: META,
			fetchNodeTree: async (_k, id) =>
				id === "front" ? card : frameNode("back", 1013, 638),
			renderImage: vi.fn(),
		});
		return out.warnings.map((w) => w.code);
	}

	it("warns when per-side stroke weights drop the stroke", async () => {
		expect(
			await warningsFor({
				strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
				strokeWeightMixed: true,
			}),
		).toContain("stroke_weight_mixed_unsupported");
	});

	it("warns when per-corner radii ignore corner smoothing", async () => {
		expect(
			await warningsFor({ cornerRadius: [8, 0, 8, 0], cornerSmoothing: 0.6 }),
		).toContain("corner_smoothing_unsupported");
		expect(
			await warningsFor({ cornerRadius: 8, cornerSmoothing: 0.6 }),
		).not.toContain("corner_smoothing_unsupported");
	});
});

describe("transpile (bound text names its element)", () => {
	// The same field on both sides of a card, with the front's layer left at
	// Figma's auto-name (the preview text) and the back's renamed to the token.
	function side(layerName: string, id: string): FigmaContainerNode {
		return {
			id: `${id}:1`,
			name: id,
			type: "FRAME",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x: 0, y: 0, width: 1013, height: 638 },
			fills: [],
			children: [
				{
					id: `${id}:2`,
					name: layerName,
					type: "TEXT",
					visible: true,
					opacity: 1,
					blendMode: "NORMAL",
					absoluteBoundingBox: { x: 10, y: 10, width: 200, height: 30 },
					relativeTransform: [
						[1, 0, 10],
						[0, 1, 10],
					],
					binding: { bind: { text: "{{name}}" } },
					characters: "Jeanie Mosciski",
					style: {
						fontFamily: "Inter",
						fontSize: 20,
						fontWeight: 400,
						italic: false,
						textAlignHorizontal: "LEFT",
						textAlignVertical: "TOP",
						textAutoResize: "NONE",
					},
					fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
				},
			],
		} as unknown as FigmaContainerNode;
	}

	it("gives the field the same element id on both sides, whatever the layers are called", async () => {
		const out = await transpile({
			product: EXACT_PRODUCT,
			picks: {
				front: {
					fileKey: "FK",
					nodeId: "front",
					nodeName: "Front",
					width: 1013,
					height: 638,
				},
				back: {
					fileKey: "FK",
					nodeId: "back",
					nodeName: "Back",
					width: 1013,
					height: 638,
				},
			},
			metadata: META,
			fetchNodeTree: async (_k, id) =>
				id === "front"
					? side("Jeanie Mosciski", "front")
					: side("{{name}}", "back"),
			renderImage: vi.fn(),
		});
		const t = out.template as {
			template_data: Array<{ elements: Array<{ id: string }> }>;
		};
		expect(t.template_data[0].elements[0].id).toBe("name");
		expect(t.template_data[1].elements[0].id).toBe("name");
	});

	it("keeps a stroked bound text as text and warns that the stroke is dropped", async () => {
		const stroked = (layerName: string, id: string) => {
			const frame = side(layerName, id);
			Object.assign(frame.children[0], {
				strokes: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
				strokeWeight: 2,
			});
			return frame;
		};
		const pick = (nodeId: string) => ({
			fileKey: "FK",
			nodeId,
			nodeName: nodeId,
			width: 1013,
			height: 638,
		});
		const out = await transpile({
			product: EXACT_PRODUCT,
			picks: { front: pick("front"), back: pick("back") },
			metadata: META,
			fetchNodeTree: async (_k, id) => stroked("{{name}}", id),
			renderImage: vi.fn(),
		});
		const t = out.template as {
			template_data: Array<{ elements: Array<{ type: string }> }>;
		};
		expect(t.template_data[0].elements[0].type).toBe("text");
		expect(
			out.warnings.filter((w) => w.code === "text_stroke_unsupported"),
		).toHaveLength(2);
	});
});

describe("transpile (rotated child of a live auto-layout)", () => {
	function tree(): FigmaContainerNode {
		return {
			id: "1:1",
			name: "front",
			type: "FRAME",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x: 0, y: 0, width: 1013, height: 638 },
			fills: [],
			children: [
				{
					id: "1:2",
					name: "stack",
					type: "FRAME",
					visible: true,
					opacity: 1,
					blendMode: "NORMAL",
					width: 300,
					height: 200,
					absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 200 },
					relativeTransform: [
						[1, 0, 0],
						[0, 1, 0],
					],
					absoluteTransform: [
						[1, 0, 0],
						[0, 1, 0],
					],
					fills: [],
					layoutMode: "VERTICAL",
					itemSpacing: 10,
					children: [
						{
							id: "1:3",
							name: "sidebar",
							type: "RECTANGLE",
							visible: true,
							opacity: 1,
							blendMode: "NORMAL",
							width: 20,
							height: 100,
							// Rotated -90 in place: a 100x20 footprint in the column.
							absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 20 },
							relativeTransform: [
								[0, 1, 0],
								[-1, 0, 20],
							],
							layoutPositioning: "AUTO",
							fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
						},
					],
				},
			],
		} as unknown as FigmaContainerNode;
	}

	it("keeps Figma's own sizing on it and lets the layout engine flow it", async () => {
		const out = await transpile({
			product: EXACT_PRODUCT,
			picks: {
				front: {
					fileKey: "FK",
					nodeId: "front",
					nodeName: "Front",
					width: 1013,
					height: 638,
				},
				back: {
					fileKey: "FK",
					nodeId: "back",
					nodeName: "Back",
					width: 1013,
					height: 638,
				},
			},
			metadata: META,
			fetchNodeTree: async (_k, id) =>
				id === "front" ? tree() : frameNode("back", 1013, 638),
			renderImage: vi.fn(),
		});
		const t = out.template as {
			template_data: Array<{
				elements: Array<{
					properties: {
						children: Array<{
							rotation?: number;
							layoutChild?: Record<string, unknown>;
						}>;
					};
				}>;
			}>;
		};
		const child = t.template_data[0].elements[0].properties.children[0];
		expect(child.rotation).toBe(-90);
		expect(child.layoutChild?.absolute).toBeUndefined();
		expect(
			out.warnings.some((w) => w.code === "rotated_layout_child_pinned"),
		).toBe(false);
	});
});

describe("transpile (a group that carries an effect)", () => {
	// A GROUP with an inner shadow, holding two rects. Figma positions a group's
	// children against the enclosing FRAME, not the group, so the group needs a
	// box of its own and its children need shifting onto it.
	function tree(): FigmaContainerNode {
		const rect = (id: string, x: number) => ({
			id,
			name: `r${id}`,
			type: "RECTANGLE",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			width: 40,
			height: 40,
			absoluteBoundingBox: { x: 100 + x, y: 100, width: 40, height: 40 },
			// frame-relative, NOT group-relative
			relativeTransform: [
				[1, 0, 100 + x],
				[0, 1, 100],
			],
			fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
		});
		return {
			id: "1:1",
			name: "front",
			type: "FRAME",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x: 0, y: 0, width: 1013, height: 638 },
			absoluteTransform: [
				[1, 0, 0],
				[0, 1, 0],
			],
			fills: [],
			children: [
				{
					id: "1:2",
					name: "emboss",
					type: "FRAME",
					visible: true,
					opacity: 1,
					blendMode: "NORMAL",
					width: 400,
					height: 300,
					absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 },
					relativeTransform: [
						[1, 0, 0],
						[0, 1, 0],
					],
					absoluteTransform: [
						[1, 0, 0],
						[0, 1, 0],
					],
					fills: [],
					children: [
						{
							id: "1:3",
							name: "badge",
							type: "GROUP",
							visible: true,
							opacity: 1,
							blendMode: "PASS_THROUGH",
							width: 100,
							height: 40,
							absoluteBoundingBox: { x: 100, y: 100, width: 100, height: 40 },
							relativeTransform: [
								[1, 0, 100],
								[0, 1, 100],
							],
							effects: [
								{
									type: "INNER_SHADOW",
									visible: true,
									radius: 3,
									spread: 1,
									offset: { x: 0, y: 2 },
									color: { r: 1, g: 1, b: 1, a: 1 },
								},
							],
							children: [rect("1:4", 0), rect("1:5", 60)],
						},
					],
				},
			],
		} as unknown as FigmaContainerNode;
	}

	async function run() {
		const out = await transpile({
			product: EXACT_PRODUCT,
			picks: {
				front: {
					fileKey: "FK",
					nodeId: "front",
					nodeName: "Front",
					width: 1013,
					height: 638,
				},
				back: {
					fileKey: "FK",
					nodeId: "back",
					nodeName: "Back",
					width: 1013,
					height: 638,
				},
			},
			metadata: META,
			fetchNodeTree: async (_k, id) =>
				id === "front" ? tree() : frameNode("back", 1013, 638),
			renderImage: vi.fn(),
		});
		const t = out.template as {
			template_data: Array<{
				elements: Array<{
					properties: {
						children: Array<{
							id: string;
							type: string;
							pos: { x: number; y: number };
							size: { width: number; height: number };
							shadow?: unknown;
							properties: { children?: Array<{ id: string; pos: unknown }> };
						}>;
					};
				}>;
			}>;
		};
		return {
			out,
			group: t.template_data[0].elements[0].properties.children[0],
		};
	}

	it("gives the group a layer of its own, boxed to what it covers", async () => {
		const { out, group } = await run();
		expect(out.report.counts.flattened).toBe(0);
		expect(group.type).toBe("frame");
		expect(group.pos).toEqual({ x: 100, y: 100 });
		expect(group.size).toEqual({ width: 100, height: 40 });
	});

	it("hangs the effect on that layer, not on each child", async () => {
		const { group } = await run();
		expect(group.shadow).toEqual({
			color: "#ffffff",
			dx: 0,
			dy: 2,
			blur: 3,
			spread: 1,
			inset: true,
		});
		for (const child of group.properties.children ?? [])
			expect((child as { shadow?: unknown }).shadow).toBeUndefined();
	});

	it("shifts the frame-positioned children onto the group's box", async () => {
		const { group } = await run();
		// Frame-relative x was 100 and 160; the group's box starts at 100.
		expect(group.properties.children?.map((c) => c.pos)).toEqual([
			{ x: 0, y: 0 },
			{ x: 60, y: 0 },
		]);
	});
});
