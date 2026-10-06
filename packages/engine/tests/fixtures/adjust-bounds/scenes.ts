import { buildAdjust } from "../../../src/adjust";
import {
	createFrame,
	createGroup,
	createRect,
	type Node,
} from "../../../src/node";
import type { ResolvedFill } from "../../../src/types";

export type BoundsCase = {
	name: string;
	width: number;
	height: number;
	scale?: number;
	supersample?: number;
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
];
