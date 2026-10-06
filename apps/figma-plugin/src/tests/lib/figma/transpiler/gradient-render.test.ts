// A linear gradient read from Figma renders where Figma draws it: its length
// and offset survive, not only its direction. The reference is built from the
// same gradient transform Figma holds, evaluated per pixel, and the template is
// rendered by coatfile with CanvasKit.
import { type Template, validate } from "@freshcoat-js/coatfile";
import {
	type EncodedPaintedFrame,
	render,
} from "@freshcoat-js/coatfile/render";
import { decodePixels } from "@freshcoat-js/engine";
import { createHeadlessEnv } from "@freshcoat-js/engine/headless";
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, it } from "vitest";
import { transpileRect } from "~/lib/figma/transpiler/rect";
import type { FigmaRectangleNode, FigmaTransform } from "~/lib/figma/types";
import { readPaint } from "~/main/read-paint";

const W = 300;
const H = 120;

type Vec = [number, number];

// Figma's gradient space runs the gradient from (0, 0.5) to (1, 0.5), with
// (0, 1) setting its width. Build the object-space transform that puts those
// on the given pixel points, the way Figma's handles do, and invert it into
// the gradientTransform the Plugin API reports.
function gradientTransformFor(from: Vec, to: Vec, width: Vec): FigmaTransform {
	const n = (p: Vec): Vec => [p[0] / W, p[1] / H];
	const [f, t, w] = [n(from), n(to), n(width)];
	const colX: Vec = [t[0] - f[0], t[1] - f[1]];
	const colY: Vec = [2 * (w[0] - f[0]), 2 * (w[1] - f[1])];
	const tx = f[0] - 0.5 * colY[0];
	const ty = f[1] - 0.5 * colY[1];
	const det = colX[0] * colY[1] - colY[0] * colX[1];
	const a = colY[1] / det;
	const b = -colY[0] / det;
	const d = -colX[1] / det;
	const e = colX[0] / det;
	return [
		[a, b, -(a * tx + b * ty)],
		[d, e, -(d * tx + e * ty)],
	];
}

const STOPS = [
	{ position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
	{ position: 0.5, color: { r: 0, g: 0.8, b: 0.2, a: 1 } },
	{ position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
];

// What Figma paints at a pixel: the gradient-space x of its centre, clamped,
// looked up in the stops.
function reference(
	transform: FigmaTransform,
	x: number,
	y: number,
): [number, number, number] {
	const u = (x + 0.5) / W;
	const v = (y + 0.5) / H;
	const g = transform[0][0] * u + transform[0][1] * v + transform[0][2];
	const t = Math.min(1, Math.max(0, g));
	let i = 0;
	while (i < STOPS.length - 2 && t > STOPS[i + 1].position) i++;
	const s0 = STOPS[i];
	const s1 = STOPS[i + 1];
	const k = (t - s0.position) / (s1.position - s0.position);
	const mix = (c: "r" | "g" | "b") =>
		Math.round((s0.color[c] + (s1.color[c] - s0.color[c]) * k) * 255);
	return [mix("r"), mix("g"), mix("b")];
}

// biome-ignore lint/suspicious/noExplicitAny: the untyped CanvasKit instance
let ck: any;
beforeAll(async () => {
	ck = await loadCanvasKit();
});

describe("linear gradient points (render)", () => {
	it("a short, off-centre gradient on a non-square layer renders as Figma draws it", async () => {
		// A short run in the right half, turned about 27 degrees, with its width
		// handle square to it on the layer, as Figma's editor keeps it.
		const from: Vec = [170, 50];
		const to: Vec = [230, 80];
		const width: Vec = [170 - 15, 50 + 30];
		const transform = gradientTransformFor(from, to, width);

		const node: FigmaRectangleNode = {
			id: "1:2",
			name: "wash",
			type: "RECTANGLE",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x: 0, y: 0, width: W, height: H },
			fills: [
				readPaint({
					type: "GRADIENT_LINEAR",
					visible: true,
					gradientTransform: transform,
					gradientStops: STOPS,
				}),
			],
		};
		const el = transpileRect(node, {
			frame: { x: 0, y: 0, width: W, height: H },
			scale: 1,
			worldAnchor: { x: 0, y: 0 },
		});
		expect(el.properties.fill).toMatchObject({
			kind: "linear",
			from: [170 / W, 50 / H].map((n) => Math.round(n * 1e4) / 1e4),
			to: [230 / W, 80 / H].map((n) => Math.round(n * 1e4) / 1e4),
		});

		const template = {
			format_version: "1.3",
			id: "gradient",
			name: "Gradient",
			width: W,
			height: H,
			fields: { type: "object", properties: {} },
			template_data: [
				{
					name: "front",
					background: {
						id: "bg",
						type: "rect",
						properties: { fill: "#ffffff" },
					},
					elements: [el],
				},
			],
		} as unknown as Template;
		expect(validate(template).ok).toBe(true);

		const [frame] = (await render(
			template,
			{},
			{ width: W, height: H },
			{ ck, env: createHeadlessEnv() },
		)) as EncodedPaintedFrame[];
		const pixels = decodePixels(ck, frame.bytes);
		if (!pixels) throw new Error("decode failed");
		expect([pixels.width, pixels.height]).toEqual([W, H]);

		let worst = 0;
		let at = "";
		for (let y = 0; y < H; y++) {
			for (let x = 0; x < W; x++) {
				const want = reference(transform, x, y);
				const i = (y * W + x) * 4;
				for (let c = 0; c < 3; c++) {
					const diff = Math.abs(pixels.data[i + c] - want[c]);
					if (diff > worst) {
						worst = diff;
						at = `(${x}, ${y}) channel ${c}: ${pixels.data[i + c]} vs ${want[c]}`;
					}
				}
			}
		}
		expect(worst, at).toBeLessThanOrEqual(2);
	});
});
