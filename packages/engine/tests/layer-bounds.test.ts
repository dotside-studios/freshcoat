// Effect layers bounded to their content paint what an unbounded layer paints.
import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { setLayerBounds } from "../src/canvaskit";
import { decodePixels } from "../src/decode";
import { renderSceneToPng } from "../src/headless";
import {
	createBitmap,
	createEllipse,
	createFrame,
	createGroup,
	createRect,
	createText,
	type Node,
} from "../src/node";

const W = 240;
const H = 180;

let ck: any;
beforeAll(async () => {
	ck = await loadCanvasKit();
});
afterEach(() => setLayerBounds(true));

const solid = (color: string) => [{ kind: "solid" as const, color }];
const box = (x: number, y: number, width: number, height: number) => ({
	pos: { x, y },
	size: { width, height },
});

async function render(
	children: Node[],
	bounded: boolean,
	scale = 1,
): Promise<{ data: Uint8Array; boundedLayers: number }> {
	setLayerBounds(bounded);
	let boundedLayers = 0;
	const saveLayer = ck.Canvas.prototype.saveLayer;
	ck.Canvas.prototype.saveLayer = function (paint: unknown, bounds: unknown) {
		if (bounds) boundedLayers++;
		return saveLayer.call(this, paint, bounds);
	};
	try {
		const scene = createFrame({
			...box(0, 0, W, H),
			background: createRect({ ...box(0, 0, W, H), fills: solid("#ffffff") }),
			children,
		});
		const out = await renderSceneToPng(scene, {
			width: W,
			height: H,
			scale,
			ck,
			fonts: new Map([["Geist", [testFontBytes("Geist-Regular.ttf")]]]),
		});
		const px = decodePixels(ck, out.bytes);
		if (!px) throw new Error("decode failed");
		return { data: px.data, boundedLayers };
	} finally {
		ck.Canvas.prototype.saveLayer = saveLayer;
	}
}

async function compare(children: Node[], scale = 1) {
	const unbounded = await render(children, false, scale);
	const bounded = await render(children, true, scale);
	expect(unbounded.boundedLayers).toBe(0);
	let maxDiff = 0;
	for (let i = 0; i < bounded.data.length; i++)
		maxDiff = Math.max(
			maxDiff,
			Math.abs((bounded.data[i] ?? 0) - (unbounded.data[i] ?? 0)),
		);
	return { maxDiff, boundedLayers: bounded.boundedLayers };
}

const shadow = (dx: number, dy: number, blur: number, spread = 0) => ({
	color: "#000000aa",
	dx,
	dy,
	blur,
	spread,
});

describe("bounded effect layers", () => {
	for (const scale of [1, 2, 0.5]) {
		test(`drop shadows with large offsets and blur at ${scale}x`, async () => {
			const r = await compare(
				[
					createRect({
						...box(150.37, 120.5, 60, 40),
						fills: solid("#2f6fed"),
						shadow: [shadow(-90, -70, 60, 4), shadow(40, 30, 0)],
					}),
					createRect({
						...box(-30, -20, 70, 50),
						fills: solid("#e33"),
						shadow: shadow(120, 90, 30),
					}),
				],
				scale,
			);
			expect(r.boundedLayers).toBe(2);
			expect(r.maxDiff).toBe(0);
		}, 30_000);
	}

	test("a drop shadow on text", async () => {
		const r = await compare([
			createText({
				...box(30, 40, 160, 60),
				text: "Shadowed text that wraps",
				font: {
					family: "Geist",
					weight: 400,
					style: "normal",
					size: 22,
					lineHeight: 1.2,
				},
				color: "#101828",
				shadow: shadow(14, 18, 12),
			}),
		]);
		expect(r.boundedLayers).toBe(1);
		expect(r.maxDiff).toBe(0);
	});

	test("an inner shadow stays unbounded", async () => {
		const r = await compare([
			createRect({
				...box(40, 30, 120, 90),
				fills: solid("#2f6fed"),
				shadow: [
					{ color: "#ff0000", dx: 12, dy: 9, blur: 16, inset: true },
					shadow(30, 20, 10),
				],
			}),
		]);
		expect(r.boundedLayers).toBe(0);
		expect(r.maxDiff).toBe(0);
	});

	test("layer blur", async () => {
		const r = await compare([
			createRect({
				...box(20.25, 30, 90, 60),
				fills: solid("#2f6fed"),
				stroke: { color: "#111111", width: 4, align: "outside" },
				blur: 24,
			}),
		]);
		expect(r.boundedLayers).toBe(1);
		expect(r.maxDiff).toBe(0);
	});

	test("an opacity group with children overflowing its box", async () => {
		const r = await compare([
			createGroup(
				[
					createRect({ ...box(10, 60, 200, 30), fills: solid("#e33") }),
					createRect({ ...box(90, 10, 20, 150), fills: solid("#3e3") }),
					createText({
						...box(150, 120, 120, 40),
						text: "overflow",
						font: {
							family: "Geist",
							weight: 400,
							style: "normal",
							size: 20,
							lineHeight: 1.2,
						},
						color: "#101828",
					}),
				],
				{ ...box(80, 50, 40, 40), opacity: 0.5 },
			),
		]);
		expect(r.boundedLayers).toBe(1);
		expect(r.maxDiff).toBe(0);
	});

	for (const align of ["inside", "center", "outside"] as const)
		test(`a stroked rect, ${align}`, async () => {
			const r = await compare([
				createRect({
					...box(30.5, 25.25, 110, 70),
					fills: solid("#2f6fed"),
					stroke: { color: "#111111", width: 9, align },
					shadow: shadow(-20, 25, 8),
				}),
				createRect({
					...box(150, 40, 60, 100),
					stroke: { color: "#e33333", width: 3, dash: [6, 4], align },
					opacity: 0.6,
				}),
			]);
			expect(r.boundedLayers).toBe(2);
			expect(r.maxDiff).toBe(0);
		});

	const modules = (n: number) =>
		new Uint8Array(n * n * 4).map((_, i) =>
			i % 4 === 3 ? 255 : ((i >> 2) * 7919) % 3 ? 0 : 255,
		);

	test("a scaled bitmap clear of pixel centers", async () => {
		const r = await compare([
			createBitmap({
				...box(40, 30, 144, 144),
				pixels: modules(25),
				pixelWidth: 25,
				pixelHeight: 25,
				shadow: shadow(0, 14, 32),
			}),
		]);
		expect(r.boundedLayers).toBe(1);
		expect(r.maxDiff).toBe(0);
	});

	test("a bitmap edge on a pixel center stays unbounded", async () => {
		const r = await compare([
			createBitmap({
				...box(40.5, 30, 50, 50),
				pixels: modules(10),
				pixelWidth: 10,
				pixelHeight: 10,
				opacity: 0.5,
			}),
		]);
		expect(r.boundedLayers).toBe(0);
		expect(r.maxDiff).toBe(0);
	});

	test("rotated layers stay unbounded", async () => {
		const r = await compare([
			createRect({
				...box(60, 40, 90, 60),
				fills: solid("#2f6fed"),
				rotation: 33,
				shadow: shadow(20, 20, 12),
			}),
			createGroup(
				[
					createRect({
						...box(20, 120, 60, 30),
						fills: solid("#e33"),
						rotation: 15,
					}),
				],
				{ ...box(20, 120, 60, 30), opacity: 0.5 },
			),
		]);
		expect(r.boundedLayers).toBe(0);
		expect(r.maxDiff).toBe(0);
	});

	test("curves stay unbounded", async () => {
		const r = await compare([
			createEllipse({
				...box(50, 40, 90, 70),
				fills: solid("#2f6fed"),
				shadow: shadow(20, 20, 12),
			}),
		]);
		expect(r.boundedLayers).toBe(0);
		expect(r.maxDiff).toBe(0);
	});

	// Rounded corners are bounded on purpose: the layer's new origin can move a
	// few corner pixels by some levels.
	test("a shadowed rounded rect moves at most a few levels", async () => {
		const r = await compare([
			createRect({
				...box(72.5, 17.5, 31.5, 21),
				fills: solid("#2f6fed"),
				cornerRadius: 12,
				shadow: shadow(-29, 0, 14, -2),
			}),
		]);
		expect(r.boundedLayers).toBe(1);
		expect(r.maxDiff).toBeLessThanOrEqual(10);
	});
});
