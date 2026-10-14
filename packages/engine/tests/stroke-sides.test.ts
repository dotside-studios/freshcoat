import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { describe, expect, test } from "vitest";
import { buildAdjust } from "../src/adjust";
import { auditAdjustedBounds } from "../src/canvaskit";
import { compileScene } from "../src/compile-scene";
import { createGroup, createRect } from "../src/node";
import { renderSceneToPng } from "./helpers/headless";
import { sideStrokeGeometry } from "../src/outline";
import type { StrokeSides } from "../src/types";
import { validateCommands } from "../src/validate-commands";

const sides: StrokeSides = { top: 2, right: 4, bottom: 6, left: 0 };

describe("sideStrokeGeometry", () => {
	test("inside, the band runs from the edge in by each side", () => {
		const g = sideStrokeGeometry(10, 20, 100, 50, 0, 0, {
			align: "inside",
			sides,
		});
		expect(g?.band).toBe(
			"M 10 20 H 110 V 70 H 10 V 20 Z M 10 22 H 106 V 64 H 10 V 22 Z",
		);
		expect(g?.mid).toBe("M 10 21 H 108 V 67 H 10 V 21 Z");
		expect(g?.midWidth).toBe(12);
		expect(g?.ltrb).toEqual([10, 20, 110, 70]);
	});

	test("outside, it runs from the edge out; centred, half each way", () => {
		expect(
			sideStrokeGeometry(10, 20, 100, 50, 0, 0, { align: "outside", sides })
				?.band,
		).toBe("M 10 18 H 114 V 76 H 10 V 18 Z M 10 20 H 110 V 70 H 10 V 20 Z");
		expect(
			sideStrokeGeometry(10, 20, 100, 50, 0, 0, { sides })?.ltrb,
		).toEqual([10, 19, 112, 73]);
	});

	test("a rounded corner moves by each adjacent width on its own axis", () => {
		const g = sideStrokeGeometry(0, 0, 100, 50, 10, 0, {
			align: "inside",
			sides,
		});
		const inner = g?.band.split(" M ")[1];
		expect(inner).toContain("A 6 8 0 0 1 96 10");
		expect(inner).toContain("A 10 4 0 0 1 0 40");
	});

	test("an outset rounded corner grows and a sharp one stays sharp", () => {
		const rounded = sideStrokeGeometry(0, 0, 100, 50, 10, 0, {
			align: "outside",
			sides,
		});
		expect(rounded?.band.split(" M ")[0]).toContain("A 14 12 0 0 1 104 10");
		const sharp = sideStrokeGeometry(0, 0, 100, 50, [0, 10, 0, 0], 0, {
			align: "outside",
			sides,
		});
		expect(sharp?.band.startsWith("M 0 -2 H 90")).toBe(true);
	});

	test("a band that fills the box has no inner contour", () => {
		const g = sideStrokeGeometry(0, 0, 10, 10, 0, 0, {
			align: "inside",
			sides: { top: 6, right: 0, bottom: 6, left: 0 },
		});
		expect(g?.band).toBe("M 0 0 H 10 V 10 H 0 V 0 Z");
	});

	test("nothing to draw without a width or a box", () => {
		expect(
			sideStrokeGeometry(0, 0, 10, 10, 0, 0, {
				sides: { top: 0, right: 0, bottom: 0, left: 0 },
			}),
		).toBeNull();
		expect(sideStrokeGeometry(0, 0, 0, 10, 0, 0, { sides })).toBeNull();
	});
});

describe("validateCommands", () => {
	test("flags a negative or missing side", () => {
		const commands = compileScene(
			createRect({
				pos: { x: 0, y: 0 },
				size: { width: 10, height: 10 },
				stroke: {
					color: "#000",
					width: 4,
					sides: { top: -1, right: 0, bottom: Number.NaN, left: 4 },
				},
			}),
			{ width: 10, height: 10 },
		);
		expect(
			validateCommands(commands)
				.filter((i) => i.code === "bad_stroke_width")
				.map((i) => i.path),
		).toEqual([
			expect.stringMatching(/sides\.top$/),
			expect.stringMatching(/sides\.bottom$/),
		]);
	});
});

describe("predicted bounds", () => {
	test("cover what a recording of the stroke reports", async () => {
		const ck = await loadCanvasKit();
		const pairs: { predicted: number[] | null; recorded: number[] }[] = [];
		const adjust = buildAdjust({ saturation: 1.4, sharpen: 1 });
		const scene = createGroup([
			createRect({
				pos: { x: 20.5, y: 20.25 },
				size: { width: 60, height: 40 },
				cornerRadius: 8,
				stroke: { color: "#602020", width: 14, sides, align: "outside" },
				adjust,
			}),
			createRect({
				pos: { x: 100, y: 20 },
				size: { width: 60, height: 40 },
				stroke: {
					color: "#602020",
					width: 14,
					sides: { top: 14, right: 2, bottom: 0, left: 6 },
					dash: [6, 3],
					cap: "square",
				},
				adjust,
			}),
		]);
		auditAdjustedBounds((predicted, recorded) =>
			pairs.push({ predicted, recorded }),
		);
		try {
			await renderSceneToPng(scene, { width: 180, height: 90, ck });
		} finally {
			auditAdjustedBounds(undefined);
		}
		expect(pairs.length).toBe(2);
		const EPS = 1e-3;
		for (const { predicted: p, recorded: r } of pairs) {
			expect(p).not.toBeNull();
			const [l, t, rt, b] = p as number[];
			expect(l).toBeLessThanOrEqual((r[0] as number) + EPS);
			expect(t).toBeLessThanOrEqual((r[1] as number) + EPS);
			expect(rt).toBeGreaterThanOrEqual((r[2] as number) - EPS);
			expect(b).toBeGreaterThanOrEqual((r[3] as number) - EPS);
		}
	});
});
