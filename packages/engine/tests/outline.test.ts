import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test } from "vitest";
import { compileScene } from "../src/compile-scene";
import { decodePixels } from "../src/decode";
import { renderSceneToPng } from "../src/headless";
import { createGroup, createMask, createRect, type Node } from "../src/node";
import type { CornerRadius, DrawGroupCommand } from "../src/types";

const W = 100;
const H = 100;
const box = { pos: { x: 10, y: 10 }, size: { width: 80, height: 70 } };
// Skia antialiases a clipped path with supersampling and a filled one
// analytically, so a smoothed corner's edge pixels can differ this much even
// along the same outline. RRects and rects clip exactly as they fill.
const PATH_CLIP_TOLERANCE = 16;
const solid = (color: string) => [{ kind: "solid" as const, color }];

let ck: unknown;
beforeAll(async () => {
	ck = await loadCanvasKit();
});

async function paint(node: Node): Promise<Uint8Array> {
	const ground = createRect({
		pos: { x: 0, y: 0 },
		size: { width: W, height: H },
		fills: solid("#ffffff"),
	});
	const { bytes } = await renderSceneToPng(createGroup([ground, node]), {
		width: W,
		height: H,
		ck,
	});
	const pixels = decodePixels(ck, bytes);
	if (!pixels) throw new Error("decode failed");
	return pixels.data;
}

function worstDelta(a: Uint8Array, b: Uint8Array): number {
	let worst = 0;
	for (let i = 0; i < a.length; i++)
		worst = Math.max(worst, Math.abs(a[i] - b[i]));
	return worst;
}

function bleed(color: string): Node {
	return createRect({
		pos: { x: 0, y: 0 },
		size: { width: W, height: H },
		fills: solid(color),
	});
}

function filled(cornerRadius: CornerRadius, cornerSmoothing?: number): Node {
	return createRect({
		...box,
		cornerRadius,
		cornerSmoothing,
		fills: solid("#000000"),
	});
}

function clipped(cornerRadius: CornerRadius, cornerSmoothing?: number): Node {
	return createGroup([bleed("#000000")], {
		...box,
		clip: true,
		cornerRadius,
		cornerSmoothing,
	});
}

function masked(cornerRadius: CornerRadius, cornerSmoothing?: number): Node {
	return createMask(
		createRect({
			...box,
			cornerRadius,
			cornerSmoothing,
			fills: solid("#ffffff"),
		}),
		[bleed("#000000")],
	);
}

describe("one outline for fills and clips", () => {
	// A fringe is background the clipped child leaves uncovered, so the group's
	// background and its children's clip must cover the same pixels.
	test("a smoothed filled group leaves no background fringe", async () => {
		const spec = { ...box, cornerRadius: 24, cornerSmoothing: 1 };
		const group = createGroup([bleed("#00ff00")], {
			...spec,
			clip: true,
			fills: solid("#ff0000"),
		});
		const cmd = compileScene(group, { width: W, height: H }).find(
			(c) => c.op === "drawGroup",
		) as DrawGroupCommand;
		expect(cmd.clip).toEqual({
			kind: "rounded-rect",
			radius: 24,
			smoothing: 1,
		});
		const background = await paint(
			createGroup([], { ...spec, fills: solid("#000000") }),
		);
		const child = await paint(
			createGroup([bleed("#000000")], { ...spec, clip: true }),
		);
		expect(worstDelta(child, background)).toBeLessThanOrEqual(
			PATH_CLIP_TOLERANCE,
		);
	});

	const shapes: [string, CornerRadius, number | undefined][] = [
		["per-corner", [0, 8, 24, 4], undefined],
		["per-corner smoothed", [2, 12, 30, 6], 0.8],
		["uniform", 14, undefined],
		["uniform smoothed", 20, 0.6],
	];
	for (const [name, radius, smoothing] of shapes) {
		test(`${name} fill, group clip and mask cover the same pixels`, async () => {
			const fill = await paint(filled(radius, smoothing));
			const tolerance = smoothing ? PATH_CLIP_TOLERANCE : 0;
			for (const other of [clipped, masked]) {
				const px = await paint(other(radius, smoothing));
				expect(worstDelta(px, fill)).toBeLessThanOrEqual(tolerance);
			}
		});
	}
});
