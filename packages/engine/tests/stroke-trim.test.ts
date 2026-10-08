import { loadCanvasKit } from "@freshcoat-js/test-utils";
import type { CanvasKit } from "canvaskit-wasm";
import { beforeAll, describe, expect, test } from "vitest";
import { decodePixels } from "../src/decode";
import {
	createEllipse,
	createGroup,
	createPath,
	createRect,
	type Node,
} from "../src/node";
import { strokeTrim, trimPath } from "../src/trim";
import type { Stroke } from "../src/types";
import { validateCommands } from "../src/validate-commands";
import { compileScene } from "../src/compile-scene";
import { renderSceneToPng } from "./helpers/headless";

const W = 100;
const H = 100;
const ring = { pos: { x: 10, y: 10 }, size: { width: 80, height: 80 } };
const black = (trim: Partial<Stroke>): Stroke => ({
	color: "#000000",
	width: 8,
	...trim,
});

let ck: CanvasKit;
beforeAll(async () => {
	ck = (await loadCanvasKit()) as CanvasKit;
});

async function paint(node: Node) {
	const ground = createRect({
		pos: { x: 0, y: 0 },
		size: { width: W, height: H },
		fills: [{ kind: "solid", color: "#ffffff" }],
	});
	const { bytes } = await renderSceneToPng(createGroup([ground, node]), {
		width: W,
		height: H,
		ck,
	});
	const pixels = decodePixels(ck, bytes);
	if (!pixels) throw new Error("decode failed");
	return (x: number, y: number) => {
		const v = pixels.data[(y * pixels.width + x) * 4] as number;
		return v < 64 ? "ink" : v > 192 ? "paper" : "edge";
	};
}

// The pixel on the ring's centre line `turns` of the way round, clockwise
// from the top.
function onRing(turns: number): [number, number] {
	const a = turns * 2 * Math.PI;
	return [
		Math.floor(50 + 40 * Math.sin(a)),
		Math.floor(50 - 40 * Math.cos(a)),
	];
}

describe("strokeTrim", () => {
	test("is null for an untrimmed or whole stroke", () => {
		expect(strokeTrim({})).toBeNull();
		expect(strokeTrim({ trimOffset: 0.3 })).toBeNull();
		expect(strokeTrim({ trimStart: 0, trimEnd: 1 })).toBeNull();
	});

	test("clamps, swaps and offsets", () => {
		expect(strokeTrim({ trimEnd: 0.25 })).toEqual({ start: 0, end: 0.25 });
		expect(strokeTrim({ trimStart: 0.75, trimEnd: 0.25 })).toEqual({
			start: 0.25,
			end: 0.75,
		});
		expect(strokeTrim({ trimStart: -1, trimEnd: 0.5 })).toEqual({
			start: 0,
			end: 0.5,
		});
		expect(strokeTrim({ trimEnd: 0.25, trimOffset: 0.875 })).toEqual({
			start: 0.875,
			end: 1.125,
		});
		expect(strokeTrim({ trimEnd: 0.5, trimOffset: -0.25 })).toEqual({
			start: 0.75,
			end: 1.25,
		});
	});
});

describe("trimPath", () => {
	test("keeps a wrapped closed contour in one piece", () => {
		const path = ck.Path.MakeFromSVGString("M 0 0 H 40 V 40 H 0 Z");
		if (!path) throw new Error("no path");
		const out = trimPath(ck, path, { start: 0.875, end: 1.125 });
		expect(out?.toSVGString().match(/M/g)?.length).toBe(1);
		expect(out?.getBounds()[1]).toBeCloseTo(0);
		path.delete();
		out?.delete();
	});

	test("draws nothing for an empty span", () => {
		const path = ck.Path.MakeFromSVGString("M 0 0 H 40");
		if (!path) throw new Error("no path");
		expect(trimPath(ck, path, { start: 0.5, end: 0.5 })).toBeNull();
		path.delete();
	});
});

describe("trimmed stroke rendering", () => {
	test("a 25% ring runs clockwise from the top", async () => {
		const at = await paint(createEllipse({ ...ring, stroke: black({ trimEnd: 0.25 }) }));
		expect(at(...onRing(0.02))).toBe("ink");
		expect(at(...onRing(0.125))).toBe("ink");
		expect(at(...onRing(0.23))).toBe("ink");
		expect(at(...onRing(0.3))).toBe("paper");
		expect(at(...onRing(0.5))).toBe("paper");
		expect(at(...onRing(0.75))).toBe("paper");
		expect(at(...onRing(0.97))).toBe("paper");
	});

	test("an offset wraps the drawn part past the start", async () => {
		const at = await paint(
			createEllipse({
				...ring,
				stroke: black({ trimEnd: 0.25, trimOffset: 0.875 }),
			}),
		);
		expect(at(...onRing(0.9))).toBe("ink");
		expect(at(...onRing(0))).toBe("ink");
		expect(at(...onRing(0.1))).toBe("ink");
		expect(at(...onRing(0.2))).toBe("paper");
		expect(at(...onRing(0.5))).toBe("paper");
		expect(at(...onRing(0.8))).toBe("paper");
	});

	test("an open path wraps as two pieces", async () => {
		const at = await paint(
			createPath({
				pos: { x: 10, y: 10 },
				size: { width: 80, height: 80 },
				d: "M 0 40 H 80",
				stroke: black({ trimEnd: 0.5, trimOffset: 0.75 }),
			}),
		);
		expect(at(15, 50)).toBe("ink");
		expect(at(85, 50)).toBe("ink");
		expect(at(50, 50)).toBe("paper");
	});

	test("dashes start at the trimmed start and round caps cap it", async () => {
		const stroke = black({ trimStart: 0.3, dash: [10, 20], cap: "round" });
		const at = await paint(createEllipse({ ...ring, stroke }));
		const arc = 2 * Math.PI * 40;
		const along = (d: number) => onRing(0.3 + d / arc);
		expect(at(...along(5))).toBe("ink");
		expect(at(...along(20))).toBe("paper");
		expect(at(...along(35))).toBe("ink");
		expect(at(...along(-2))).toBe("ink");
		expect(at(...along(-6))).toBe("paper");
		expect(at(...onRing(0.15))).toBe("paper");
		const butt = await paint(
			createEllipse({ ...ring, stroke: { ...stroke, cap: "butt" } }),
		);
		expect(butt(...along(-2))).toBe("paper");
	});

	test("a trimmed rect runs clockwise from its top left", async () => {
		const box = { pos: { x: 20, y: 20 }, size: { width: 60, height: 60 } };
		const center = await paint(
			createRect({ ...box, stroke: black({ width: 4, trimEnd: 0.25 }) }),
		);
		expect(center(30, 20)).toBe("ink");
		expect(center(70, 20)).toBe("ink");
		expect(center(80, 50)).toBe("paper");
		expect(center(20, 50)).toBe("paper");
		const inside = await paint(
			createRect({
				...box,
				cornerRadius: 10,
				stroke: black({ width: 4, align: "inside", trimEnd: 0.25 }),
			}),
		);
		expect(inside(50, 21)).toBe("ink");
		expect(inside(50, 18)).toBe("paper");
		expect(inside(78, 70)).toBe("paper");
	});

	test("an outside stroke on a path trims the clipped band", async () => {
		const at = await paint(
			createPath({
				pos: { x: 30, y: 30 },
				size: { width: 40, height: 40 },
				d: "M 0 0 H 40 V 40 H 0 Z",
				stroke: black({ align: "outside", trimEnd: 0.25 }),
			}),
		);
		expect(at(50, 26)).toBe("ink");
		expect(at(50, 34)).toBe("paper");
		expect(at(74, 50)).toBe("paper");
	});

	test("an empty trim draws nothing", async () => {
		const at = await paint(
			createEllipse({ ...ring, stroke: black({ trimStart: 0.4, trimEnd: 0.4 }) }),
		);
		for (const t of [0, 0.25, 0.4, 0.5, 0.75]) expect(at(...onRing(t))).toBe("paper");
	});
});

describe("trim validation", () => {
	test("rejects a trim outside [0, 1]", () => {
		const scene = createEllipse({ ...ring, stroke: black({ trimEnd: 1.5 }) });
		const errors = validateCommands(compileScene(scene, { width: W, height: H }));
		expect(errors.map((e) => e.code)).toContain("bad_trim");
	});
});
