// Effect layers bounded to their content paint what an unbounded layer paints.
import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { setLayerBounds } from "../src/canvaskit";
import { compileScene } from "../src/compile-scene";
import { decodePixels } from "../src/decode";
import { deriveFontMetrics } from "../src/font-metrics";
import { createHeadlessEnv } from "../src/headless";
import { createParagraphEngine } from "../src/paragraph-layout";
import type { EncodedPaintResult } from "../src/types";
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

// A rounded corner's antialiased pixels can move by up to 1/8 coverage under a
// bounded layer's new origin. See originInvariant.
const ROUNDED_TOLERANCE = 32;

const FONTS = () =>
	new Map([["Geist", [testFontBytes("Geist-Regular.ttf")]]]);

// Laid out with every font, painted with `fonts`.
async function render(
	children: Node[],
	bounded: boolean,
	scale = 1,
	fonts = FONTS(),
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
		const layout = new Map([
			...FONTS(),
			["Missing", [testFontBytes("Geist-Regular.ttf")]],
		]);
		const textEngine = createParagraphEngine(ck, layout);
		let commands: ReturnType<typeof compileScene>;
		try {
			commands = compileScene(scene, {
				width: W,
				height: H,
				scale,
				textEngine,
				fontMetrics: deriveFontMetrics(layout),
			});
		} finally {
			textEngine.dispose();
		}
		const out = (await createHeadlessEnv({ fonts }).paint(
			commands,
			ck,
		)) as EncodedPaintResult;
		const px = decodePixels(ck, out.bytes);
		if (!px) throw new Error("decode failed");
		return { data: px.data, boundedLayers };
	} finally {
		ck.Canvas.prototype.saveLayer = saveLayer;
	}
}

async function compare(children: Node[], scale = 1, fonts = FONTS()) {
	const unbounded = await render(children, false, scale, fonts);
	const bounded = await render(children, true, scale, fonts);
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

	for (const style of ["normal", "italic"] as const)
		test(`a drop shadow on ${style} text`, async () => {
			const r = await compare([
				createText({
					...box(30, 40, 160, 60),
					text: "Shadowed text that wraps",
					font: {
						family: "Geist",
						weight: 400,
						style,
						size: 22,
						lineHeight: 1.2,
					},
					color: "#101828",
					shadow: [shadow(14, 18, 12), shadow(-40, 0, 0)],
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

	test("a shadowed rounded rect stays within the corner tolerance", async () => {
		const r = await compare([
			createRect({
				...box(72.5, 17.5, 31.5, 21),
				fills: solid("#2f6fed"),
				cornerRadius: 12,
				shadow: shadow(-29, 0, 14, -2),
			}),
		]);
		expect(r.boundedLayers).toBe(1);
		expect(r.maxDiff).toBeLessThanOrEqual(ROUNDED_TOLERANCE);
	});

	for (const decoration of ["underline", "line-through"] as const)
		test(`${decoration} with a missing font`, async () => {
			const text = (
				x: number,
				y: number,
				effect: Partial<Parameters<typeof createText>[0]>,
			) =>
				createText({
					...box(x, y, 160, 40),
					text: "No typeface here",
					font: {
						family: "Missing",
						weight: 400,
						style: "normal",
						size: 24,
						lineHeight: 1.2,
						decoration,
					},
					color: "#101828",
					...effect,
				});
			const children = [
				text(20, 20, { opacity: 0.5 }),
				text(30, 90, { shadow: shadow(6, 8, 4) }),
			];
			const r = await compare(children, 1, new Map());
			expect(r.boundedLayers).toBe(2);
			expect(r.maxDiff).toBe(0);
			const { data } = await render(children, true, 1, new Map());
			expect(data.some((v, i) => i % 4 !== 3 && v < 128)).toBe(true);
		});

	for (const scale of [0.5, 1, 2])
		test(`a blurred group holding a shadowed text group at ${scale}x`, async () => {
			const r = await compare(
				[
					createGroup(
						[
							createGroup(
								[
									createText({
										...box(120.25, 90.5, 110, 60),
										text: "Shadowed text that wraps",
										font: {
											family: "Geist",
											weight: 400,
											style: "normal",
											size: 18.5,
											lineHeight: 1.2,
											decoration: "underline",
										},
										color: "#101828",
									}),
									createRect({
										...box(176.25, 101, 73, 51.25),
										fills: solid("#2f6fed"),
										shadow: shadow(-20.25, 28.75, 18, -1.25),
									}),
								],
								{ ...box(0, 0, W, H), shadow: shadow(-26.5, -12, 17.5, 2.75) },
							),
						],
						{ ...box(0, 0, W, H), blur: 6.5 },
					),
				],
				scale,
			);
			expect(r.boundedLayers).toBe(3);
			expect(r.maxDiff).toBe(0);
		});
});

// Seeded random scenes of rects and text under nested opacity, blur and shadow
// layers, at several scales.
describe("bounded effect layers, randomized", () => {
	const random = (seed: number) => {
		let s = seed >>> 0;
		return () => {
			s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
			return s / 2 ** 32;
		};
	};

	const scene = (r: () => number, rounded: boolean): Node[] => {
		const pick = <T>(list: readonly T[]) =>
			list[Math.floor(r() * list.length)] as T;
		const n = (lo: number, hi: number) =>
			Math.round((lo + r() * (hi - lo)) * 4) / 4;
		const effect = () => {
			const k = r();
			if (k < 0.3) return { opacity: n(0.2, 0.9) };
			if (k < 0.55) return { blur: n(1, 20) };
			if (k < 0.85)
				return { shadow: shadow(n(-30, 30), n(-30, 30), n(0, 20), n(-3, 5)) };
			return {};
		};
		const leaf = (): Node =>
			r() < 0.5
				? createRect({
						...box(n(-20, 200), n(-20, 150), n(5, 80), n(5, 60)),
						fills: solid(pick(["#e33", "#2f6fed", "#3e3"])),
						...(rounded && r() < 0.5 ? { cornerRadius: n(1, 16) } : {}),
						...effect(),
					})
				: createText({
						...box(n(-20, 180), n(-10, 140), n(40, 160), 60),
						text: pick(["Hello", "Shadowed text that wraps", "Ag"]),
						font: {
							family: "Geist",
							weight: 400,
							style: pick(["normal", "italic"] as const),
							size: n(8, 28),
							lineHeight: 1.2,
							...(r() < 0.3
								? { decoration: pick(["underline", "line-through"] as const) }
								: {}),
						},
						color: "#101828",
						...effect(),
					});
		const node = (depth: number): Node =>
			depth > 0 && r() < 0.5
				? createGroup(
						Array.from({ length: 1 + Math.floor(r() * 3) }, () =>
							node(depth - 1),
						),
						{ ...box(0, 0, W, H), ...effect() },
					)
				: leaf();
		return Array.from({ length: 1 + Math.floor(r() * 3) }, () => node(2));
	};

	for (const [rounded, tolerance] of [
		[false, 0],
		[true, ROUNDED_TOLERANCE],
	] as const)
		test(`${rounded ? "with" : "without"} rounded corners`, async () => {
			for (let seed = 1; seed <= 12; seed++) {
				const scale = [0.5, 1, 2][seed % 3] as number;
				const r = await compare(scene(random(seed * 7919), rounded), scale);
				expect(r.maxDiff, `seed ${seed}`).toBeLessThanOrEqual(tolerance);
			}
		}, 120_000);
});
