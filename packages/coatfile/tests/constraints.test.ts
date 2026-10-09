import { describe, expect, test } from "vitest";
import { fixtures } from "../fixtures";
import { compile } from "../src/compile";
import {
	barcodeBox,
	constrainBox,
	fitDesignSize,
	resizeElements,
	resizeTemplate,
	resizeVectorPath,
} from "../src/constraints";
import type {
	Command,
	Constraint,
	Element,
	FrameElement,
	GroupNode,
	Node,
	Template,
	VectorElement,
} from "../src/types";
import { validate } from "../src/validate";
import { applyVariant } from "../src/variants";
import { compileToCommands } from "./helpers/compile-commands";

const FROM = { width: 200, height: 100 };
const TO = { width: 300, height: 160 };

function rect(
	id: string,
	x: number,
	y: number,
	w: number,
	h: number,
	constraints?: Element["constraints"],
): Element {
	return {
		id,
		type: "rect",
		pos: { x, y },
		size: { width: w, height: h },
		...(constraints ? { constraints } : {}),
		properties: { fill: "#000" },
	};
}

function template(elements: Element[], size = FROM): Template {
	return {
		format_version: "1.2",
		id: "c",
		name: "C",
		width: size.width,
		height: size.height,
		fields: {
			type: "object",
			properties: { name: { type: "string", default: "A fairly long name" } },
		},
		template_data: [
			{
				name: "front",
				background: { id: "bg", type: "rect", properties: { fill: "#fff" } },
				elements,
			},
		],
	};
}

describe("constrainBox", () => {
	// x 20, w 40 in a parent 200 wide that becomes 300 (delta 100, ratio 1.5).
	const cases: [Constraint | undefined, number, number][] = [
		[undefined, 20, 40],
		["start", 20, 40],
		["end", 120, 40],
		["center", 70, 40],
		["stretch", 20, 140],
		["scale", 30, 60],
	];
	for (const [c, x, w] of cases) {
		test(`horizontal ${c ?? "default"}`, () => {
			const box = constrainBox(
				rect("r", 20, 10, 40, 30, c ? { horizontal: c } : undefined),
				FROM,
				TO,
			);
			expect(box.pos.x).toBeCloseTo(x, 9);
			expect(box.size.width).toBeCloseTo(w, 9);
			expect(box.pos.y).toBe(10);
			expect(box.size.height).toBe(30);
		});
	}

	// y 10, h 30 in a parent 100 tall that becomes 160 (delta 60, ratio 1.6).
	const vertical: [Constraint, number, number][] = [
		["start", 10, 30],
		["end", 70, 30],
		["center", 40, 30],
		["stretch", 10, 90],
		["scale", 16, 48],
	];
	for (const [c, y, h] of vertical) {
		test(`vertical ${c}`, () => {
			const box = constrainBox(
				rect("r", 20, 10, 40, 30, { vertical: c }),
				FROM,
				TO,
			);
			expect(box.pos.y).toBeCloseTo(y, 9);
			expect(box.size.height).toBeCloseTo(h, 9);
			expect(box.pos.x).toBe(20);
			expect(box.size.width).toBe(40);
		});
	}

	test("stretch never produces a negative size", () => {
		const box = constrainBox(
			rect("r", 0, 0, 40, 30, { horizontal: "stretch" }),
			FROM,
			{ width: 100, height: 100 },
		);
		expect(box.size.width).toBe(0);
	});

	test("a rotated element is constrained by its unrotated box", () => {
		const el = {
			...rect("r", 20, 10, 40, 30, { horizontal: "end" }),
			rotation: 45,
		};
		const [out] = resizeElements([el], FROM, TO);
		expect(out.pos).toEqual({ x: 120, y: 10 });
		expect(out.size).toEqual({ width: 40, height: 30 });
		expect(out.rotation).toBe(45);
	});
});

describe("resizeElements", () => {
	test("nested frames re-place their children when their size changed", () => {
		const frame: FrameElement = {
			id: "panel",
			type: "frame",
			pos: { x: 0, y: 0 },
			size: { width: 200, height: 100 },
			constraints: { horizontal: "stretch", vertical: "stretch" },
			properties: {
				children: [
					rect("pin-right", 150, 10, 40, 20, { horizontal: "end" }),
					{
						id: "inner",
						type: "frame",
						pos: { x: 10, y: 50 },
						size: { width: 100, height: 40 },
						constraints: { horizontal: "stretch" },
						properties: {
							children: [
								rect("inner-right", 80, 0, 20, 20, { horizontal: "end" }),
							],
						},
					},
				],
			},
		};
		const [out] = resizeElements([frame], FROM, TO) as FrameElement[];
		expect(out.size).toEqual({ width: 300, height: 160 });
		const [pin, inner] = out.properties.children as [Element, FrameElement];
		expect(pin.pos).toEqual({ x: 250, y: 10 });
		expect(inner.size).toEqual({ width: 200, height: 40 });
		expect(inner.properties.children[0].pos).toEqual({ x: 180, y: 0 });
	});

	test("a frame whose size did not change leaves its children alone", () => {
		const frame: FrameElement = {
			id: "badge",
			type: "frame",
			pos: { x: 150, y: 60 },
			size: { width: 40, height: 30 },
			constraints: { horizontal: "end", vertical: "end" },
			properties: {
				children: [rect("dot", 30, 20, 5, 5, { horizontal: "end" })],
			},
		};
		const [out] = resizeElements([frame], FROM, TO) as FrameElement[];
		expect(out.pos).toEqual({ x: 250, y: 120 });
		expect(out.properties.children[0]).toBe(frame.properties.children[0]);
	});

	test("auto-layout children ignore constraints; absolute ones follow them", () => {
		const flow = rect("flow", 0, 0, 40, 20, { horizontal: "end" });
		const pinned = {
			...rect("pinned", 150, 0, 40, 20, { horizontal: "end" }),
			layoutChild: { absolute: true },
		};
		const frame: FrameElement = {
			id: "row",
			type: "frame",
			pos: { x: 0, y: 0 },
			size: { width: 200, height: 100 },
			constraints: { horizontal: "stretch" },
			properties: {
				layout: { direction: "row", gap: 4 },
				children: [flow, pinned],
			},
		};
		const [out] = resizeElements([frame], FROM, TO) as FrameElement[];
		expect(out.properties.children[0]).toBe(flow);
		expect(out.properties.children[1].pos).toEqual({ x: 250, y: 0 });
	});

	test("a mask re-places its shape and content", () => {
		const mask: Element = {
			id: "m",
			type: "mask",
			pos: { x: 0, y: 0 },
			size: { width: 200, height: 100 },
			constraints: { horizontal: "scale", vertical: "scale" },
			properties: {
				mask: rect("shape", 0, 0, 200, 100, {
					horizontal: "stretch",
					vertical: "stretch",
				}),
				children: [rect("content", 100, 50, 20, 20, { horizontal: "center" })],
			},
		};
		const [out] = resizeElements([mask], FROM, TO);
		if (out.type !== "mask") throw new Error("expected mask");
		expect(out.properties.mask.size).toEqual(TO);
		expect(out.properties.children[0].pos).toEqual({ x: 150, y: 50 });
	});

	test("a QR stretched unevenly stays square, centred in its box", () => {
		const qr: Element = {
			id: "qr",
			type: "qr_code",
			pos: { x: 20, y: 20 },
			size: { width: 60, height: 60 },
			constraints: { horizontal: "stretch", vertical: "start" },
			properties: { value: "x" },
		};
		const [out] = resizeElements([qr], FROM, TO);
		// The constrained box is 160 x 60 at (20, 20).
		expect(out.size).toEqual({ width: 60, height: 60 });
		expect(out.pos).toEqual({ x: 70, y: 20 });
		const scaled = resizeElements(
			[{ ...qr, constraints: { horizontal: "scale", vertical: "scale" } }],
			FROM,
			TO,
		)[0];
		expect(scaled.size?.width).toBeCloseTo(scaled.size?.height ?? 0, 9);
	});
});

describe("resizeTemplate", () => {
	test("the result validates at the new size", () => {
		const t = template([rect("r", 150, 60, 40, 30, { horizontal: "end" })]);
		t.template_data[0].background.size = { width: 200, height: 100 };
		const out = resizeTemplate(t, 300, 160);
		expect(out.width).toBe(300);
		expect(out.template_data[0].background.size).toEqual(TO);
		expect(validate(out).ok).toBe(true);
	});

	test("the same size returns the template itself", () => {
		const t = template([rect("r", 0, 0, 10, 10)]);
		expect(resizeTemplate(t, 200, 100)).toBe(t);
	});

	test("carries variants: existing pos, size and backgrounds are resized", () => {
		const t = template([
			rect("r", 150, 60, 40, 30, { horizontal: "end", vertical: "end" }),
			rect("s", 10, 10, 20, 20, {
				horizontal: "stretch",
				vertical: "stretch",
			}),
			rect("q", 0, 0, 10, 10),
		]);
		t.format_version = "1.4";
		t.variants = [
			{
				id: "v",
				label: "V",
				overrides: [
					{
						name: "front",
						background: {
							id: "bg",
							type: "rect",
							size: { width: 200, height: 100 },
							properties: { fill: "#000" },
						},
						elements: [
							{ id: "r", properties: {}, pos: { x: 100, y: 20 } },
							{ id: "s", properties: {}, size: { width: 50, height: 40 } },
							{ id: "q", properties: { fill: "#f00" } },
							{ id: "gone", properties: {}, pos: { x: 1, y: 1 } },
						],
					},
				],
			},
		];
		const out = resizeTemplate(t, 300, 160);
		const ov = out.variants![0].overrides[0];
		expect(ov.background?.size).toEqual(TO);
		expect(ov.elements).toEqual([
			{ id: "r", properties: {}, pos: { x: 200, y: 80 } },
			{ id: "s", properties: {}, size: { width: 150, height: 100 } },
			{ id: "q", properties: { fill: "#f00" } },
			{ id: "gone", properties: {}, pos: { x: 1, y: 1 } },
		]);
		expect(validate(out).ok).toBe(true);
		expect(t.variants[0].overrides[0].elements![0].pos).toEqual({
			x: 100,
			y: 20,
		});
	});

	test("carries variants: a vector's path matches its variant laid out", () => {
		const vector = (id: string, w: number): Element => ({
			id,
			type: "vector",
			pos: { x: 0, y: 0 },
			size: { width: w, height: 20 },
			constraints: { horizontal: "stretch" },
			properties: { d: "M0 0 L100 20" },
		});
		const t = template([vector("a", 100), vector("b", 100), vector("c", 100)]);
		t.format_version = "1.4";
		t.variants = [
			{
				id: "v",
				label: "V",
				overrides: [
					{
						name: "front",
						elements: [
							{ id: "a", properties: {}, size: { width: 50, height: 20 } },
							{ id: "b", properties: { d: "M0 0 L50 10" } },
							{ id: "c", properties: { fill: "#f00" } },
						],
					},
				],
			},
		];
		const out = resizeTemplate(t, 300, 100);
		expect(out.template_data[0].elements[0].properties).toEqual({
			d: "M0 0 L200 20",
		});
		expect(out.variants![0].overrides[0].elements).toEqual([
			{
				id: "a",
				properties: { d: "M0 0 L300 20" },
				size: { width: 150, height: 20 },
			},
			{ id: "b", properties: { d: "M0 0 L100 10" } },
			{ id: "c", properties: { fill: "#f00" } },
		]);
		const direct = resizeTemplate(applyVariant(t, "v"), 300, 100);
		expect(applyVariant(out, "v").template_data).toEqual(direct.template_data);
	});
});

describe("fitDesignSize", () => {
	const landscape = { width: 1200, height: 800 };
	test("landscape and portrait targets keep the template's short side", () => {
		expect(fitDesignSize(landscape, 4000, 3000)).toEqual({
			width: (800 * 4) / 3,
			height: 800,
		});
		expect(fitDesignSize(landscape, 3000, 4000)).toEqual({
			width: 800,
			height: (800 * 4) / 3,
		});
		expect(fitDesignSize(landscape, 500, 500)).toEqual({
			width: 800,
			height: 800,
		});
	});

	test("a target at the template's aspect gives the template's size", () => {
		expect(fitDesignSize(landscape, 2400, 1600)).toEqual(landscape);
		expect(fitDesignSize({ width: 800, height: 1200 }, 400, 600)).toEqual({
			width: 800,
			height: 1200,
		});
	});

	test("rejects an empty target", () => {
		expect(() => fitDesignSize(landscape, 0, 100)).toThrow();
	});
});

function findNode(node: Node, id: string): Node | undefined {
	if (node.id === id) return node;
	if (node.kind === "group" || node.kind === "mask") {
		for (const c of (node as GroupNode).children) {
			const hit = findNode(c, id);
			if (hit) return hit;
		}
	}
	return undefined;
}

describe("compile with resize", () => {
	const photo: Element = {
		id: "photo",
		type: "image",
		pos: { x: 0, y: 0 },
		size: { width: 200, height: 100 },
		constraints: { horizontal: "stretch", vertical: "stretch" },
		properties: { src: "https://example.com/p.png", fit: "cover" },
	};
	const caption: Element = {
		id: "caption",
		type: "text",
		pos: { x: 10, y: 60 },
		size: { width: 100, height: 30 },
		constraints: { horizontal: "stretch", vertical: "end" },
		properties: {
			value: "{{name}}",
			font: { family: "Inter", size: 14 },
		},
	};
	const mark = rect("mark", 160, 70, 30, 20, {
		horizontal: "end",
		vertical: "end",
	});
	const t = template([photo, caption, mark]);

	test("skips the aspect check and scales the resized design", () => {
		// Design 300 x 160, rendered at twice that.
		const out = compile(t, {}, { width: 600, height: 320, resize: TO });
		const root = out.frames[0].root;
		expect(root.size).toEqual({ width: 600, height: 320 });
		// The background covers the resized frame.
		expect(root.children[0].size).toEqual({ width: 600, height: 320 });
		expect(findNode(root, "mark")?.pos).toEqual({ x: 520, y: 260 });
		// An image fills its new box; the painter fits `cover` to it.
		const img = findNode(root, "photo");
		expect(img?.size).toEqual({ width: 600, height: 320 });
		expect(img?.kind === "image" && img.fit).toBe("cover");
	});

	test("without resize a different aspect still throws", () => {
		expect(() => compile(t, {}, { width: 600, height: 320 })).toThrow(
			/aspect ratio mismatch/,
		);
	});

	test("text gets the new width and rewraps", () => {
		const narrow = template([
			{
				...caption,
				size: { width: 60, height: 30 },
				constraints: { horizontal: "stretch" },
			},
		]);
		const lines = (opts: Parameters<typeof compile>[2]) => {
			const frame = compileToCommands(narrow, {}, opts)[0];
			const text = (frame.commands as Command[]).find(
				(c) => "op" in c && c.op === "drawText",
			);
			if (!text || !("op" in text) || text.op !== "drawText")
				throw new Error("no text");
			return { width: text.size.width, lines: text.layout.lines.length };
		};
		const before = lines({ width: 200, height: 100 });
		const after = lines({
			width: 400,
			height: 100,
			resize: { width: 400, height: 100 },
		});
		expect(after.width).toBe(before.width + 200);
		expect(after.lines).toBeLessThan(before.lines);
	});

	test("a variant's background and moved layer land where a base layer would", () => {
		const bg = { width: 200, height: 100 };
		const withMark = (m: Element) => {
			const out = template([photo, m]);
			out.template_data[0].background.size = bg;
			return out;
		};
		const moved = { x: 20, y: 10 };
		const v = withMark(mark);
		v.format_version = "1.4";
		v.variants = [
			{
				id: "v",
				label: "V",
				overrides: [
					{
						name: "front",
						background: {
							id: "bg",
							type: "rect",
							size: bg,
							properties: { fill: "#123" },
						},
						elements: [{ id: "mark", properties: {}, pos: moved }],
					},
				],
			},
		];
		const opts = { width: 600, height: 320, resize: TO };
		const root = compile(v, {}, { ...opts, variantId: "v" }).frames[0].root;
		const base = compile(withMark({ ...mark, pos: moved }), {}, opts).frames[0]
			.root;
		expect(root.children[0].size).toEqual({ width: 600, height: 320 });
		expect(findNode(root, "mark")?.pos).toEqual(findNode(base, "mark")?.pos);
		expect(findNode(root, "mark")?.pos).toEqual({ x: 240, y: 140 });
	});

	test("a stretched vector's path follows its box", () => {
		const wave: Element = {
			id: "wave",
			type: "vector",
			pos: { x: 0, y: 0 },
			size: { width: 200, height: 20 },
			constraints: { horizontal: "stretch" },
			properties: { d: "M0 0 L200 20 A10 10 0 0 1 180 0 Z", fill: "#000" },
		};
		const root = compile(template([wave]), {}, {
			width: 300,
			height: 100,
			resize: { width: 300, height: 100 },
		}).frames[0].root;
		const node = findNode(root, "wave");
		expect(node?.size).toEqual({ width: 300, height: 20 });
		expect(node?.kind === "path" && node.d).toBe(
			"M0 0 L300 20 A15 10 0 0 1 270 0 Z",
		);
	});

	test("resize at the template's own size compiles every fixture unchanged", () => {
		for (const f of [fixtures.minimalCard, fixtures.fullFeatureCard]) {
			const plain = compile(f, {}, { width: f.width, height: f.height });
			const resized = compile(
				f,
				{},
				{
					width: f.width,
					height: f.height,
					resize: { width: f.width, height: f.height },
				},
			);
			expect(resized).toEqual(plain);
		}
	});
});

describe("resizeVectorPath", () => {
	const vector = (d: string, size?: { width: number; height: number }) =>
		({ id: "v", type: "vector", size, properties: { d } }) as VectorElement;

	test("scales the path by the box's change on each axis", () => {
		expect(
			resizeVectorPath(vector("M0 0L10 0L10 20Z", { width: 10, height: 20 }), {
				width: 20,
				height: 10,
			}),
		).toBe("M0 0L20 0L20 10Z");
	});

	test("an empty axis is not scaled", () => {
		expect(
			resizeVectorPath(vector("M0 0L10 0", { width: 10, height: 0 }), {
				width: 30,
				height: 5,
			}),
		).toBe("M0 0L30 0");
	});

	test("keeps the path without a size or when it does not parse", () => {
		expect(resizeVectorPath(vector("M0 0L10 0"), { width: 5, height: 5 })).toBe(
			"M0 0L10 0",
		);
		expect(
			resizeVectorPath(vector("M0 0X10", { width: 10, height: 10 }), {
				width: 5,
				height: 5,
			}),
		).toBe("M0 0X10");
	});
});

describe("barcodeBox", () => {
	const box = { pos: { x: 10, y: 20 }, size: { width: 300, height: 100 } };

	test("a square symbology takes the shorter side, centred", () => {
		expect(barcodeBox("datamatrix", box)).toEqual({
			pos: { x: 110, y: 20 },
			size: { width: 100, height: 100 },
		});
	});

	test("a QR code stays square and a 1D code keeps its box", () => {
		const qr = { id: "q", type: "qr_code" } as Element;
		expect(barcodeBox(qr, box).size).toEqual({ width: 100, height: 100 });
		expect(barcodeBox("code128", box)).toBe(box);
	});
});
