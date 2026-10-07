import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test } from "vitest";
import { compileScene } from "../src/compile-scene";
import { decodePixels } from "../src/decode";
import { renderSceneToPng } from "./helpers/headless";
import {
	createEllipse,
	createGroup,
	createImage,
	createPath,
	createRect,
	type Node,
} from "../src/node";
import type { DrawGroupCommand, DrawPathCommand, Stroke } from "../src/types";
import { validateCommands } from "../src/validate-commands";

const W = 100;
const H = 100;
const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];
const box = { pos: { x: 30, y: 30 }, size: { width: 40, height: 40 } };
const white = [{ kind: "solid" as const, color: "#ffffff" }];
const stroke = (align: Stroke["align"]): Stroke => ({
	color: "#000000",
	width: 8,
	align,
});

let ck: unknown;
beforeAll(async () => {
	ck = await loadCanvasKit();
});

async function paint(node: Node) {
	const ground = createRect({
		pos: { x: 0, y: 0 },
		size: { width: W, height: H },
		fills: white,
	});
	const { bytes } = await renderSceneToPng(createGroup([ground, node]), {
		width: W,
		height: H,
		ck,
	});
	const pixels = decodePixels(ck, bytes);
	if (!pixels) throw new Error("decode failed");
	return (x: number, y: number) => {
		const i = (y * pixels.width + x) * 4;
		return [...pixels.data.subarray(i, i + 3)];
	};
}

function pathOf(node: Node): DrawPathCommand {
	const cmd = compileScene(node, { width: W, height: H }).find(
		(c) => c.op === "drawPath",
	);
	return cmd as DrawPathCommand;
}

describe("ellipse stroke alignment", () => {
	test("inside and outside offset the stroked ellipse", () => {
		const inside = pathOf(createEllipse({ ...box, stroke: stroke("inside") }));
		expect(inside.strokeD).toBe(
			"M 4 20 A 16 16 0 1 0 36 20 A 16 16 0 1 0 4 20 Z",
		);
		const outside = pathOf(
			createEllipse({ ...box, stroke: stroke("outside") }),
		);
		expect(outside.strokeD).toBe(
			"M -4 20 A 24 24 0 1 0 44 20 A 24 24 0 1 0 -4 20 Z",
		);
	});

	test("a centered or absent stroke leaves the command as it was", () => {
		expect(
			pathOf(createEllipse({ ...box, stroke: stroke("center") })),
		).not.toHaveProperty("strokeD");
		expect(
			pathOf(createEllipse({ ...box, stroke: stroke(undefined) })),
		).not.toHaveProperty("strokeD");
		expect(pathOf(createEllipse(box))).not.toHaveProperty("strokeD");
	});

	test("paints the band on the aligned side of the edge", async () => {
		const outside = await paint(
			createEllipse({ ...box, fills: white, stroke: stroke("outside") }),
		);
		expect(outside(27, 50)).toEqual(BLACK);
		expect(outside(33, 50)).toEqual(WHITE);
		const inside = await paint(
			createEllipse({ ...box, fills: white, stroke: stroke("inside") }),
		);
		expect(inside(33, 50)).toEqual(BLACK);
		expect(inside(27, 50)).toEqual(WHITE);
	});
});

describe("path stroke alignment", () => {
	const square = "M 0 0 H 40 V 40 H 0 Z";

	test("inside keeps the band within the path", async () => {
		const at = await paint(
			createPath({ ...box, d: square, fills: white, stroke: stroke("inside") }),
		);
		expect(at(33, 50)).toEqual(BLACK);
		expect(at(27, 50)).toEqual(WHITE);
		expect(at(50, 50)).toEqual(WHITE);
	});

	test("outside keeps the band beyond the path", async () => {
		const at = await paint(
			createPath({
				...box,
				d: square,
				fills: white,
				stroke: stroke("outside"),
			}),
		);
		expect(at(27, 50)).toEqual(BLACK);
		expect(at(33, 50)).toEqual(WHITE);
	});

	test("an evenodd hole counts as outside", async () => {
		const ring = `${square} M 10 10 H 30 V 30 H 10 Z`;
		const outside = await paint(
			createPath({
				...box,
				d: ring,
				fillRule: "evenodd",
				fills: white,
				stroke: stroke("outside"),
			}),
		);
		expect(outside(42, 50)).toEqual(BLACK);
		expect(outside(35, 50)).toEqual(WHITE);
		const inside = await paint(
			createPath({
				...box,
				d: ring,
				fillRule: "evenodd",
				fills: white,
				stroke: stroke("inside"),
			}),
		);
		expect(inside(38, 50)).toEqual(BLACK);
		expect(inside(42, 50)).toEqual(WHITE);
	});

	test("the stroke scales with a viewBox like a centered one", async () => {
		const at = await paint(
			createPath({
				...box,
				d: "M 0 0 H 20 V 20 H 0 Z",
				viewBox: { width: 20, height: 20 },
				fills: white,
				stroke: { color: "#000000", width: 4, align: "outside" },
			}),
		);
		expect(at(27, 50)).toEqual(BLACK);
		expect(at(33, 50)).toEqual(WHITE);
	});
});

describe("image stroke alignment", () => {
	test("an unmasked image insets its box", async () => {
		const at = await paint(
			createImage({
				...box,
				src: "missing",
				fit: "cover",
				stroke: stroke("outside"),
			}),
		);
		expect(at(27, 50)).toEqual(BLACK);
	});

	test("a rounded mask shrinks its radius with the box", async () => {
		const at = await paint(
			createImage({
				...box,
				src: "missing",
				fit: "cover",
				mask: { kind: "rounded-rect", radius: 10 },
				stroke: stroke("outside"),
			}),
		);
		expect(at(27, 50)).toEqual(BLACK);
		expect(at(50, 27)).toEqual(BLACK);
	});

	test("a polygon mask strokes along its own outline", async () => {
		const at = await paint(
			createImage({
				...box,
				src: "missing",
				fit: "cover",
				mask: { kind: "polygon", sides: 4 },
				stroke: stroke("outside"),
			}),
		);
		expect(at(50, 27)).toEqual(BLACK);
		expect(at(50, 33)).not.toEqual(BLACK);
	});
});

describe("per-corner group clip", () => {
	test("lowers to a per-corner rounded-rect clip", () => {
		const group = (cornerRadius: [number, number, number, number]) =>
			compileScene(
				createGroup([], { ...box, clip: true, cornerRadius }),
				{ width: W, height: H },
			).find((c) => c.op === "drawGroup") as DrawGroupCommand;
		expect(group([8, 0, 4, 0]).clip).toEqual({
			kind: "rounded-rect",
			radius: [8, 0, 4, 0],
		});
		expect(group([0, 0, 0, 0]).clip).toEqual({ kind: "rect" });
	});

	test("clips only the rounded corners", async () => {
		const black = [{ kind: "solid" as const, color: "#000000" }];
		const at = await paint(
			createGroup(
				[
					createRect({
						pos: { x: 0, y: 0 },
						size: box.size,
						fills: black,
					}),
				],
				{ ...box, clip: true, cornerRadius: [0, 20, 0, 20] },
			),
		);
		expect(at(31, 31)).toEqual(BLACK);
		expect(at(68, 31)).toEqual(WHITE);
		expect(at(68, 68)).toEqual(BLACK);
		expect(at(31, 68)).toEqual(WHITE);
	});

	test("validates the clip's per-corner radii", () => {
		const issues = validateCommands([
			{
				op: "drawGroup",
				...box,
				clip: { kind: "rounded-rect", radius: [1, -2, 0, 0] },
				children: [],
			},
		]);
		expect(issues.map((i) => i.code)).toContain("bad_corner_radius");
	});
});
