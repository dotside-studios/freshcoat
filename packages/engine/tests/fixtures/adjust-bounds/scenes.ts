import { buildAdjust } from "../../../src/adjust";
import {
	createBitmap,
	createEllipse,
	createFrame,
	createGroup,
	createMask,
	createPath,
	createRect,
	createText,
	type Node,
} from "../../../src/node";
import type { ResolvedFill } from "../../../src/types";

export type BoundsCase = {
	name: string;
	width: number;
	height: number;
	scale?: number;
	supersample?: number;
	// Renders with the Geist test font registered.
	fonts?: boolean;
	scene: Node;
};

const backdrop = (width: number, height: number) =>
	createRect({
		pos: { x: 0, y: 0 },
		size: { width, height },
		fills: [{ kind: "solid", color: "#f4f1ea" }],
	});

const ramp: ResolvedFill = {
	kind: "linear",
	stops: [
		{ offset: 0, color: "#1d3f8a" },
		{ offset: 0.5, color: "#e0a030" },
		{ offset: 1, color: "#b0203a" },
	],
	from: { x: 0, y: 0 },
	to: { x: 1, y: 1 },
};

const font = (size: number) => ({
	family: "Geist",
	weight: 400 as const,
	style: "normal" as const,
	size,
	lineHeight: 1.2,
});

const bars = (pattern: string): Uint8Array => {
	const px = new Uint8Array(pattern.length * 4);
	for (let i = 0; i < pattern.length; i++) {
		const v = pattern[i] === "1" ? 0 : 255;
		px.set([v, v, v, 255], i * 4);
	}
	return px;
};

const frame = (width: number, height: number, children: Node[]) =>
	createFrame({
		pos: { x: 0, y: 0 },
		size: { width, height },
		children: [backdrop(width, height), ...children],
	});

export const BOUNDS_CASES: BoundsCase[] = [
	{
		name: "rotated",
		width: 120,
		height: 90,
		scene: frame(120, 90, [
			createGroup(
				[
					createRect({
						pos: { x: 5, y: 5 },
						size: { width: 50, height: 34 },
						rotation: -12,
						fills: [ramp],
						stroke: { color: "#202020", width: 3, align: "outside" },
						shadow: { color: "#00000080", dx: 4, dy: 5, blur: 6 },
						adjust: buildAdjust({ saturation: 1.4, gamma: 1.8 }),
					}),
				],
				{
					pos: { x: 20, y: 15 },
					size: { width: 70, height: 50 },
					rotation: 25,
				},
			),
			createGroup(
				[
					createRect({
						pos: { x: 0, y: 0 },
						size: { width: 24, height: 18 },
						rotation: 40,
						fills: [ramp],
						adjust: buildAdjust({ gamma: 0.7, sharpen: 0.9 }),
					}),
				],
				{
					pos: { x: 82, y: 58 },
					size: { width: 24, height: 18 },
					rotation: -20,
					adjust: buildAdjust({ saturation: 0.3, gamma: 1.3 }),
				},
			),
		]),
	},
	{
		name: "partially-off-frame",
		width: 100,
		height: 80,
		scene: frame(100, 80, [
			createRect({
				pos: { x: -25, y: 50 },
				size: { width: 60, height: 50 },
				fills: [ramp],
				adjust: buildAdjust({ gamma: 0.6, brightness: 1.1 }),
			}),
			createRect({
				pos: { x: 70, y: -15 },
				size: { width: 45, height: 40 },
				rotation: 18,
				fills: [ramp],
				blur: 2,
				adjust: buildAdjust({ contrast: 1.3, sharpen: 0.8 }),
			}),
			createGroup(
				[
					createRect({
						pos: { x: -10, y: 8 },
						size: { width: 40, height: 40 },
						fills: [ramp],
						adjust: buildAdjust({ gamma: 1.5, sharpen: 1 }),
					}),
				],
				{
					pos: { x: 30, y: 10 },
					size: { width: 30, height: 30 },
					clip: true,
				},
			),
			createRect({
				pos: { x: 120, y: 20 },
				size: { width: 20, height: 20 },
				fills: [ramp],
				adjust: buildAdjust({ gamma: 2, sharpen: 1 }),
			}),
		]),
	},
	{
		name: "export-scale",
		width: 80,
		height: 60,
		scale: 2.5,
		scene: frame(80, 60, [
			createRect({
				pos: { x: 10.3, y: 7.7 },
				size: { width: 37.4, height: 29.1 },
				rotation: 9,
				fills: [ramp],
				stroke: { color: "#103020", width: 1.5 },
				shadow: { color: "#20406090", dx: -3, dy: 4, blur: 5, spread: 2 },
				adjust: buildAdjust({ saturation: 0.5, gamma: 2.2, sharpen: 0.6 }),
			}),
			createRect({
				pos: { x: 55, y: 30 },
				size: { width: 30, height: 40 },
				fills: [ramp],
				adjust: buildAdjust({ brightness: 1.2, gamma: 0.8 }),
			}),
		]),
	},
	{
		name: "export-scale-supersampled",
		width: 60,
		height: 40,
		scale: 1.5,
		supersample: 2,
		scene: frame(60, 40, [
			createRect({
				pos: { x: 8.5, y: 6.25 },
				size: { width: 30, height: 22 },
				rotation: -14,
				fills: [ramp],
				adjust: buildAdjust({ contrast: 1.2, gamma: 1.6, sharpen: 0.5 }),
			}),
		]),
	},
	{
		name: "sharpen-near-edge",
		width: 90,
		height: 70,
		scene: frame(90, 70, [
			createRect({
				pos: { x: 0, y: 0 },
				size: { width: 30, height: 30 },
				fills: [ramp],
				stroke: { color: "#ffffff", width: 2, align: "inside" },
				adjust: buildAdjust({ brightness: 1.15, sharpen: 1.5 }),
			}),
			createRect({
				pos: { x: 60.4, y: 40.6 },
				size: { width: 29.6, height: 29.4 },
				fills: [ramp],
				adjust: buildAdjust({ saturation: 1.6, sharpen: 2 }),
			}),
			createRect({
				pos: { x: 35, y: 33 },
				size: { width: 20, height: 1.4 },
				fills: [{ kind: "solid", color: "#2050c0" }],
				adjust: buildAdjust({ brightness: 0.8, sharpen: 1 }),
			}),
		]),
	},
	{
		name: "text",
		width: 160,
		height: 90,
		scale: 2,
		fonts: true,
		scene: frame(160, 90, [
			createText({
				pos: { x: 8, y: 6 },
				size: { width: 140, height: 30 },
				text: "Ågjy Wq",
				font: { ...font(24), decoration: "underline" },
				color: "#203060",
				shadow: { color: "#00000080", dx: 2, dy: 3, blur: 4 },
				adjust: buildAdjust({ gamma: 1.8, sharpen: 1 }),
			}),
			createText({
				pos: { x: 20, y: 40 },
				size: { width: 90, height: 40 },
				text: "Tilted fj",
				font: font(18),
				fill: ramp,
				rotation: -10,
				adjust: buildAdjust({ saturation: 1.3, gamma: 0.7 }),
			}),
			createText({
				pos: { x: 110, y: 50 },
				size: { width: 40, height: 14 },
				text: "Clipped overflow",
				font: font(16),
				color: "#802020",
				fit: "clip",
				adjust: buildAdjust({ brightness: 1.1, sharpen: 0.8 }),
			}),
		]),
	},
	{
		name: "path",
		width: 120,
		height: 90,
		scene: frame(120, 90, [
			createPath({
				pos: { x: 6, y: 8 },
				size: { width: 50, height: 40 },
				d: "M0 0 C 30 -10 60 50 20 40 L 5 30 Z",
				viewBox: { x: 0, y: -10, width: 60, height: 60 },
				fills: [ramp],
				stroke: { color: "#202020", width: 3 },
				adjust: buildAdjust({ gamma: 1.6, sharpen: 1 }),
			}),
			createPath({
				pos: { x: 60, y: 10 },
				size: { width: 40, height: 40 },
				d: "M0 20 Q 20 -20 40 20 Q 20 60 0 20 Z",
				fills: [{ kind: "solid", color: "#40a060" }],
				stroke: { color: "#103010", width: 4, align: "inside" },
				rotation: 20,
				adjust: buildAdjust({ contrast: 1.2, gamma: 1.4 }),
			}),
			createPath({
				pos: { x: 15, y: 55 },
				size: { width: 50, height: 25 },
				d: "M0 0 L 50 25 M 0 25 L 50 0",
				stroke: { color: "#a02060", width: 2, cap: "square", join: "round" },
				shadow: { color: "#00000060", dx: 2, dy: 2, blur: 3 },
				adjust: buildAdjust({ gamma: 0.8, sharpen: 0.6 }),
			}),
			createEllipse({
				pos: { x: 75, y: 55 },
				size: { width: 30, height: 24 },
				fills: [ramp],
				stroke: { color: "#202060", width: 3, align: "outside" },
				adjust: buildAdjust({ saturation: 1.5, gamma: 1.2 }),
			}),
		]),
	},
	{
		name: "path-scaled-down",
		width: 120,
		height: 90,
		scale: 0.5,
		scene: frame(120, 90, [
			createPath({
				pos: { x: 10, y: 10 },
				size: { width: 80, height: 60 },
				d: "M0 0 C 40 -20 80 80 40 60 L 10 50 Z",
				fills: [ramp],
				stroke: { color: "#202020", width: 2, align: "outside" },
				shadow: { color: "#00000080", dx: 3, dy: 4, blur: 8 },
				adjust: buildAdjust({ gamma: 1.6, sharpen: 1 }),
			}),
		]),
	},
	{
		name: "clip-and-mask",
		width: 140,
		height: 100,
		scene: frame(140, 100, [
			createGroup(
				[
					createRect({
						pos: { x: -10, y: -6 },
						size: { width: 60, height: 40 },
						fills: [ramp],
					}),
					createRect({
						pos: { x: 20, y: 10 },
						size: { width: 20, height: 30 },
						fills: [{ kind: "solid", color: "#204080" }],
						shadow: { color: "#00000080", dx: 3, dy: 3, blur: 4 },
					}),
				],
				{
					pos: { x: 6, y: 6 },
					size: { width: 44, height: 34 },
					clip: true,
					cornerRadius: 8,
					adjust: buildAdjust({ gamma: 1.7, sharpen: 1 }),
				},
			),
			createMask(
				createEllipse({
					pos: { x: 0, y: 0 },
					size: { width: 40, height: 30 },
					fills: [
						{
							kind: "linear",
							stops: [
								{ offset: 0, color: "#000000" },
								{ offset: 1, color: "#00000000" },
							],
							from: { x: 0, y: 0 },
							to: { x: 1, y: 0 },
						},
					],
				}),
				[
					createRect({
						pos: { x: -5, y: -5 },
						size: { width: 50, height: 40 },
						fills: [ramp],
					}),
				],
				{
					pos: { x: 70, y: 8 },
					size: { width: 40, height: 30 },
					adjust: buildAdjust({ saturation: 1.4, gamma: 1.3 }),
				},
			),
			createMask(
				createRect({
					pos: { x: 8, y: 6 },
					size: { width: 20, height: 14 },
					fills: [{ kind: "solid", color: "#ffffff" }],
				}),
				[
					createRect({
						pos: { x: 0, y: 0 },
						size: { width: 36, height: 26 },
						fills: [ramp],
					}),
				],
				{
					pos: { x: 20, y: 55 },
					size: { width: 36, height: 26 },
					channel: "luminance",
					invert: true,
					rotation: 12,
					adjust: buildAdjust({ gamma: 0.6, sharpen: 0.7 }),
				},
			),
		]),
	},
	{
		name: "barcode",
		width: 120,
		height: 70,
		scale: 1.5,
		scene: frame(120, 70, [
			createBitmap({
				pos: { x: 10.3, y: 8.6 },
				size: { width: 61.7, height: 20.2 },
				pixels: bars("1011001110001011011100101"),
				pixelWidth: 25,
				pixelHeight: 1,
				role: "barcode",
				adjust: buildAdjust({ gamma: 1.5, sharpen: 1 }),
			}),
			createBitmap({
				pos: { x: 80.2, y: 30.4 },
				size: { width: 30.5, height: 30.5 },
				pixels: bars("1010011001011001"),
				pixelWidth: 4,
				pixelHeight: 4,
				role: "barcode",
				adjust: buildAdjust({ contrast: 1.4, gamma: 0.8 }),
			}),
		]),
	},
];
