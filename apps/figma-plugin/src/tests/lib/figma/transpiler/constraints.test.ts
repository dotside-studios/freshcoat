import {
	FORMAT_VERSION,
	resizeTemplate,
	type Template,
	validate,
} from "@freshcoat/coatfile";
import { describe, expect, it, vi } from "vitest";
import { transpile } from "~/lib/figma/transpiler";
import {
	elementConstraints,
	mapConstraint,
} from "~/lib/figma/transpiler/constraints";
import { fixtures } from "~/lib/figma/transpiler/fixtures";
import type {
	FigmaConstraints,
	FigmaContainerNode,
	FigmaNode,
	FigmaRectangleNode,
} from "~/lib/figma/types";
import { readBaseFields } from "~/main/read-scene-graph";

const W = 1000;
const H = 600;

function rect(
	id: string,
	x: number,
	y: number,
	w: number,
	h: number,
	extra: Partial<FigmaRectangleNode> = {},
): FigmaRectangleNode {
	return {
		id,
		name: `r${id.replace(":", "_")}`,
		type: "RECTANGLE",
		visible: true,
		opacity: 1,
		blendMode: "NORMAL",
		absoluteBoundingBox: { x, y, width: w, height: h },
		relativeTransform: [
			[1, 0, x],
			[0, 1, y],
		],
		width: w,
		height: h,
		fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
		...extra,
	};
}

function container(
	id: string,
	type: "FRAME" | "GROUP",
	box: { x: number; y: number; width: number; height: number },
	children: FigmaNode[],
	extra: Partial<FigmaContainerNode> = {},
): FigmaContainerNode {
	return {
		id,
		name: `c${id.replace(":", "_")}`,
		type,
		visible: true,
		opacity: 1,
		blendMode: "NORMAL",
		absoluteBoundingBox: box,
		relativeTransform: [
			[1, 0, box.x],
			[0, 1, box.y],
		],
		width: box.width,
		height: box.height,
		children,
		...extra,
	};
}

const cons = (
	horizontal: FigmaConstraints["horizontal"],
	vertical: FigmaConstraints["vertical"],
): FigmaConstraints => ({ horizontal, vertical });

type El = Record<string, unknown> & {
	id: string;
	properties: { children?: El[] };
};

async function elementsOf(
	children: FigmaNode[],
	renderImage = vi.fn(),
): Promise<El[]> {
	const front = container("0:1", "FRAME", { x: 0, y: 0, width: W, height: H }, [
		...children,
	]);
	front.name = "Front";
	const result = await transpile({
		product: {
			sku: "custom",
			displayName: "Custom",
			width: W,
			height: H,
			frames: [{ name: "front", label: "Front", required: true }],
		},
		sizeMode: "from-design",
		picks: {
			front: {
				fileKey: "FK",
				nodeId: "0:1",
				nodeName: "Front",
				width: W,
				height: H,
			},
		},
		metadata: {
			id: "t",
			name: "T",
			version: "1.0.0",
			formatVersion: FORMAT_VERSION,
		},
		fetchNodeTree: async () => front,
		renderImage,
	});
	return (result.template as { template_data: [{ elements: El[] }] })
		.template_data[0].elements;
}

describe("mapConstraint", () => {
	it.each([
		["MIN", "start"],
		["MAX", "end"],
		["CENTER", "center"],
		["STRETCH", "stretch"],
		["SCALE", "scale"],
	] as const)("%s → %s", (figma, coat) => {
		expect(mapConstraint(figma)).toBe(coat);
	});
});

describe("elementConstraints", () => {
	it("writes nothing for start on both axes, coatfile's default", () => {
		expect(elementConstraints(cons("MIN", "MIN"))).toBeUndefined();
		expect(elementConstraints(undefined)).toBeUndefined();
	});

	it("leaves out an axis at start", () => {
		expect(elementConstraints(cons("MAX", "MIN"))).toEqual({
			horizontal: "end",
		});
		expect(elementConstraints(cons("MIN", "STRETCH"))).toEqual({
			vertical: "stretch",
		});
	});

	it("writes both axes when neither is start", () => {
		expect(elementConstraints(cons("CENTER", "SCALE"))).toEqual({
			horizontal: "center",
			vertical: "scale",
		});
	});
});

describe("readBaseFields (constraints)", () => {
	const node = {
		id: "1:1",
		name: "n",
		absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
	};

	it("reads a node's constraints", () => {
		expect(
			readBaseFields({
				...node,
				constraints: { horizontal: "MAX", vertical: "CENTER" },
			}).constraints,
		).toEqual({ horizontal: "MAX", vertical: "CENTER" });
	});

	it("leaves them off a node that has none, like a group", () => {
		expect("constraints" in readBaseFields(node)).toBe(false);
	});
});

describe("transpile (constraints)", () => {
	it("puts each layer's constraints on its element", async () => {
		const els = await elementsOf([
			rect("1:1", 10, 10, 50, 50, { constraints: cons("MAX", "MAX") }),
			rect("1:2", 100, 10, 50, 50, { constraints: cons("STRETCH", "SCALE") }),
			rect("1:3", 200, 10, 50, 50, { constraints: cons("MIN", "MIN") }),
			rect("1:4", 300, 10, 50, 50),
		]);
		expect(els.map((e) => e.constraints)).toEqual([
			{ horizontal: "end", vertical: "end" },
			{ horizontal: "stretch", vertical: "scale" },
			undefined,
			undefined,
		]);
	});

	it("a group's children take the group's constraints", async () => {
		const group = container(
			"2:1",
			"GROUP",
			{ x: 700, y: 400, width: 200, height: 100 },
			[
				rect("2:2", 700, 400, 50, 50, { constraints: cons("MIN", "MIN") }),
				rect("2:3", 800, 450, 50, 50, { constraints: cons("SCALE", "MIN") }),
			],
			{ constraints: cons("MAX", "MAX") },
		);
		const els = await elementsOf([group]);
		expect(els.map((e) => e.constraints)).toEqual([
			{ horizontal: "end", vertical: "end" },
			{ horizontal: "end", vertical: "end" },
		]);
	});

	it("a group without constraints of its own passes on what its children agree on", async () => {
		const group = container(
			"2:1",
			"GROUP",
			{ x: 700, y: 400, width: 200, height: 100 },
			[
				rect("2:2", 700, 400, 50, 50, { constraints: cons("MAX", "MAX") }),
				rect("2:3", 800, 450, 50, 50, { constraints: cons("MAX", "MAX") }),
			],
		);
		const els = await elementsOf([group]);
		expect(els.map((e) => e.constraints)).toEqual([
			{ horizontal: "end", vertical: "end" },
			{ horizontal: "end", vertical: "end" },
		]);
	});

	it("a group given its own layer carries the group's constraints", async () => {
		const group = container(
			"2:1",
			"GROUP",
			{ x: 700, y: 400, width: 200, height: 100 },
			[rect("2:2", 700, 400, 200, 100)],
			{
				constraints: cons("MAX", "MIN"),
				effects: [
					{
						type: "DROP_SHADOW",
						visible: true,
						color: { r: 0, g: 0, b: 0, a: 0.5 },
						offset: { x: 0, y: 4 },
						radius: 8,
					},
				],
			},
		);
		const [layer] = await elementsOf([group]);
		expect(layer.type).toBe("frame");
		expect(layer.constraints).toEqual({ horizontal: "end" });
	});

	it("a frame's children keep their own constraints, against the frame", async () => {
		const frame = container(
			"3:1",
			"FRAME",
			{ x: 100, y: 100, width: 400, height: 300 },
			[
				rect("3:2", 110, 110, 20, 20, { constraints: cons("MAX", "MIN") }),
				rect("3:3", 150, 110, 20, 20, { constraints: cons("CENTER", "MAX") }),
			],
			{ constraints: cons("STRETCH", "STRETCH") },
		);
		const [el] = await elementsOf([frame]);
		expect(el.constraints).toEqual({
			horizontal: "stretch",
			vertical: "stretch",
		});
		expect(el.properties.children?.map((c) => c.constraints)).toEqual([
			{ horizontal: "end" },
			{ horizontal: "center", vertical: "end" },
		]);
	});

	it("an auto-layout frame's flow children get none; an absolutely positioned one keeps its own", async () => {
		const frame = container(
			"3:1",
			"FRAME",
			{ x: 100, y: 100, width: 400, height: 300 },
			[
				rect("3:2", 110, 110, 20, 20, { constraints: cons("MAX", "MAX") }),
				rect("3:3", 150, 110, 20, 20, {
					constraints: cons("MAX", "MAX"),
					layoutPositioning: "ABSOLUTE",
				}),
			],
			{ layoutMode: "HORIZONTAL", itemSpacing: 8 },
		);
		const [el] = await elementsOf([frame]);
		expect(el.properties.children?.map((c) => c.constraints)).toEqual([
			undefined,
			{ horizontal: "end", vertical: "end" },
		]);
	});

	it("a rasterized layer takes the constraints of the node it replaces", async () => {
		const blurred = rect("5:1", 900, 500, 50, 50, {
			constraints: cons("MAX", "MAX"),
			absoluteRenderBounds: { x: 900, y: 500, width: 50, height: 50 },
			effects: [{ type: "BACKGROUND_BLUR", visible: true, radius: 4 }],
		});
		const renderImage = vi.fn().mockResolvedValue({
			blob: new Blob([new Uint8Array([1])], { type: "image/png" }),
			sha256: "SHA",
			width: 100,
			height: 100,
		});
		const [el] = await elementsOf([blurred], renderImage);
		expect(el.type).toBe("image");
		expect(el.constraints).toEqual({ horizontal: "end", vertical: "end" });
	});
});

describe("transpile (pinned logo fixture)", () => {
	async function run(): Promise<Template> {
		const { front } = fixtures.pinnedLogo.figma;
		const result = await transpile({
			product: {
				sku: "custom",
				displayName: "Custom",
				width: 1000,
				height: 600,
				frames: [{ name: "front", label: "Front", required: true }],
			},
			sizeMode: "from-design",
			picks: {
				front: {
					fileKey: "FK",
					nodeId: "4:1",
					nodeName: "Front",
					width: 1000,
					height: 600,
				},
			},
			metadata: {
				id: "pinned-logo",
				name: "Pinned Logo",
				version: "1.0.0",
				formatVersion: FORMAT_VERSION,
			},
			fetchNodeTree: async () => front,
			renderImage: vi.fn(),
		});
		expect(result.warnings).toEqual([]);
		return result.template as Template;
	}

	it("produces the expected Template", async () => {
		expect(await run()).toEqual(fixtures.pinnedLogo.expected);
	});

	it("the pinned-corner logo keeps its margin after resizeTemplate", async () => {
		const template = await run();
		expect(validate(template).ok).toBe(true);
		const byId = (t: Template) =>
			new Map(t.template_data[0].elements.map((e) => [e.id, e]));

		const before = byId(template).get("logo");
		expect(before?.pos).toEqual({ x: 840, y: 500 });
		// 40 from the right and bottom edges of a 1000x600 side.
		for (const [w, h] of [
			[1400, 600],
			[1000, 900],
			[700, 450],
		]) {
			const resized = byId(resizeTemplate(template, w, h));
			const logo = resized.get("logo");
			expect(logo?.size).toEqual({ width: 120, height: 60 });
			expect(logo?.pos).toEqual({ x: w - 40 - 120, y: h - 40 - 60 });
			// The layer left at the default stays put; the banner stretches with
			// the side, keeping both margins.
			expect(resized.get("footnote")?.pos).toEqual({ x: 40, y: 440 });
			expect(resized.get("banner")?.size).toEqual({
				width: w - 80,
				height: 80,
			});
		}
	});
});
