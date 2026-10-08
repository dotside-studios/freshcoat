// Focal points and spread methods of SVG gradients, painted through the image
// path and compared against analytically computed samples.
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test } from "vitest";
import { createHeadlessEnv } from "./helpers/headless";
import { compileScene, createImage } from "../src/index";

// biome-ignore lint/suspicious/noExplicitAny: CanvasKit is untyped here
let ck: any;
beforeAll(async () => {
	ck = await loadCanvasKit();
});

const TOLERANCE = 4;

async function paint(markup: string, width: number, height: number) {
	const env = createHeadlessEnv({
		images: new Map([["art.svg", new TextEncoder().encode(markup)]]),
	});
	const scene = createImage({
		pos: { x: 0, y: 0 },
		size: { width, height },
		src: "art.svg",
		fit: "fill",
	});
	const result = (await env.paint(
		compileScene(scene, { width, height }),
		ck,
	)) as { bytes: Uint8Array; warnings: { code?: string }[] };
	const img = ck.MakeImageFromEncoded(result.bytes);
	const px = img.readPixels(0, 0, {
		width,
		height,
		colorType: ck.ColorType.RGBA_8888,
		alphaType: ck.AlphaType.Unpremul,
		colorSpace: ck.ColorSpace.SRGB,
	}) as Uint8Array;
	img.delete();
	return {
		red: (x: number, y: number) => px[(y * width + x) * 4] as number,
		warnings: result.warnings,
	};
}

const svg = (w: number, h: number, body: string) =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`;

// Black at t = 0 to red at t = 1, so the red channel reads t back.
const STOPS = '<stop stop-color="#000"/><stop offset="1" stop-color="#f00"/>';

// Where `p` falls in a gradient from a point focus `f` out to the circle
// (`c`, `r`): the t with |p - f - t(c - f)| = t·r.
function focalT(
	p: [number, number],
	f: [number, number],
	c: [number, number],
	r: number,
): number {
	const d = [p[0] - f[0], p[1] - f[1]] as const;
	const e = [c[0] - f[0], c[1] - f[1]] as const;
	const a = e[0] * e[0] + e[1] * e[1] - r * r;
	const b = d[0] * e[0] + d[1] * e[1];
	const dd = d[0] * d[0] + d[1] * d[1];
	return (b - Math.sqrt(b * b - a * dd)) / a;
}

const pad = (t: number) => Math.min(1, Math.max(0, t));
const repeat = (t: number) => t - Math.floor(t);
const reflect = (t: number) => {
	const m = t - 2 * Math.floor(t / 2);
	return m > 1 ? 2 - m : m;
};

function expectRed(actual: number, t: number) {
	expect(Math.abs(actual - Math.round(t * 255))).toBeLessThanOrEqual(TOLERANCE);
}

describe("SVG radial focal points", () => {
	test("an off-centre focus in user space", async () => {
		const { red, warnings } = await paint(
			svg(
				100,
				100,
				`<radialGradient id="g" gradientUnits="userSpaceOnUse" cx="50" cy="50" r="50" fx="20" fy="50">${STOPS}</radialGradient><rect width="100" height="100" fill="url(#g)"/>`,
			),
			100,
			100,
		);
		for (const [x, y] of [
			[20, 50],
			[50, 50],
			[5, 50],
			[70, 20],
			[30, 85],
		] as const) {
			const t = focalT([x + 0.5, y + 0.5], [20, 50], [50, 50], 50);
			expectRed(red(x, y), pad(t));
		}
		// A centred gradient would be black at the centre.
		expect(red(50, 50)).toBeGreaterThan(80);
		expect(warnings).toEqual([]);
	});

	test("a focus in bounding-box units on a wide box draws an ellipse", async () => {
		const { red } = await paint(
			svg(
				200,
				100,
				`<radialGradient id="g" fx="0.2">${STOPS}</radialGradient><rect width="200" height="100" fill="url(#g)"/>`,
			),
			200,
			100,
		);
		for (const [x, y] of [
			[40, 50],
			[100, 50],
			[40, 25],
			[150, 70],
		] as const) {
			const t = focalT(
				[(x + 0.5) / 200, (y + 0.5) / 100],
				[0.2, 0.5],
				[0.5, 0.5],
				0.5,
			);
			expectRed(red(x, y), pad(t));
		}
	});

	test("gradientTransform turns the focus with the gradient", async () => {
		const { red } = await paint(
			svg(
				100,
				100,
				`<radialGradient id="g" fx="0.2" gradientTransform="rotate(90 0.5 0.5)">${STOPS}</radialGradient><rect width="100" height="100" fill="url(#g)"/>`,
			),
			100,
			100,
		);
		for (const [x, y] of [
			[50, 20],
			[50, 50],
			[20, 50],
			[75, 75],
		] as const) {
			const t = focalT(
				[(x + 0.5) / 100, (y + 0.5) / 100],
				[0.5, 0.2],
				[0.5, 0.5],
				0.5,
			);
			expectRed(red(x, y), pad(t));
		}
	});

	test("a focal radius starts the gradient at its circle", async () => {
		const { red } = await paint(
			svg(
				100,
				100,
				`<radialGradient id="g" gradientUnits="userSpaceOnUse" cx="50" cy="50" r="40" fr="20">${STOPS}</radialGradient><rect width="100" height="100" fill="url(#g)"/>`,
			),
			100,
			100,
		);
		for (const x of [55, 70, 80, 89, 95]) {
			const t = (Math.abs(x + 0.5 - 50) - 20) / 20;
			expectRed(red(x, 50), pad(t));
		}
	});
});

describe("SVG spreadMethod", () => {
	const modes = { pad, reflect, repeat } as const;

	for (const [mode, spread] of Object.entries(modes)) {
		test(`linear ${mode}`, async () => {
			const { red } = await paint(
				svg(
					100,
					10,
					`<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" x2="25" spreadMethod="${mode}">${STOPS}</linearGradient><rect width="100" height="10" fill="url(#g)"/>`,
				),
				100,
				10,
			);
			for (const x of [5, 20, 30, 45, 60, 90])
				expectRed(red(x, 5), spread((x + 0.5) / 25));
		});

		test(`radial ${mode}`, async () => {
			const { red } = await paint(
				svg(
					100,
					100,
					`<radialGradient id="g" gradientUnits="userSpaceOnUse" cx="50" cy="50" r="20" spreadMethod="${mode}">${STOPS}</radialGradient><rect width="100" height="100" fill="url(#g)"/>`,
				),
				100,
				100,
			);
			for (const x of [60, 75, 76, 85, 95])
				expectRed(red(x, 50), spread((x + 0.5 - 50) / 20));
		});

		test(`focal radial ${mode}`, async () => {
			const { red } = await paint(
				svg(
					100,
					100,
					`<radialGradient id="g" gradientUnits="userSpaceOnUse" cx="50" cy="50" r="20" fx="40" spreadMethod="${mode}">${STOPS}</radialGradient><rect width="100" height="100" fill="url(#g)"/>`,
				),
				100,
				100,
			);
			for (const [x, y] of [
				[60, 50],
				[75, 50],
				[90, 50],
				[50, 80],
			] as const) {
				const t = focalT([x + 0.5, y + 0.5], [40, 50], [50, 50], 20);
				expectRed(red(x, y), spread(t));
			}
		});
	}
});
