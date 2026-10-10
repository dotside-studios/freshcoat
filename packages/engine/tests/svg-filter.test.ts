import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test } from "vitest";
import { createHeadlessEnv } from "./helpers/headless";
import { compileScene, createImage } from "../src/index";
import type { ImageNode } from "../src/node";

// biome-ignore lint/suspicious/noExplicitAny: CanvasKit is untyped here
let ck: any;
beforeAll(async () => {
	ck = await loadCanvasKit();
});

async function paint(markup: string, size: number, node: Partial<ImageNode> = {}, scale?: number) {
	const env = createHeadlessEnv({
		images: new Map([["art.svg", new TextEncoder().encode(markup)]]),
	});
	const scene = createImage({
		pos: { x: 0, y: 0 },
		size: { width: size, height: size },
		src: "art.svg",
		fit: "fill",
		...node,
	});
	const result = (await env.paint(
		compileScene(scene, { width: size, height: size, ...(scale ? { scale } : {}) }),
		ck,
	)) as { bytes: Uint8Array; warnings: unknown[] };
	const img = ck.MakeImageFromEncoded(result.bytes);
	const w = img.width();
	const px = img.readPixels(0, 0, {
		width: w,
		height: img.height(),
		colorType: ck.ColorType.RGBA_8888,
		alphaType: ck.AlphaType.Unpremul,
		colorSpace: ck.ColorSpace.SRGB,
	}) as Uint8Array;
	img.delete();
	const at = (x: number, y: number) => [...px.slice((y * w + x) * 4, (y * w + x) * 4 + 4)];
	return { at, warnings: result.warnings };
}

const svg = (body: string, attrs = 'width="40" height="40"') =>
	`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;

const close = (got: number[], want: number[], tolerance = 3) => {
	expect(got).toHaveLength(want.length);
	got.forEach((v, i) => expect(Math.abs(v - (want[i] as number))).toBeLessThanOrEqual(tolerance));
};

const FIGMA_SHADOW = `<svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
<g filter="url(#filter0_d_1_2)">
<rect x="20" y="16" width="80" height="80" fill="#3366FF"/>
</g>
<defs>
<filter id="filter0_d_1_2" x="0" y="0" width="120" height="120" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
<feFlood flood-opacity="0" result="BackgroundImageFix"/>
<feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>
<feOffset dy="4"/>
<feGaussianBlur stdDeviation="2"/>
<feComposite in2="hardAlpha" operator="out"/>
<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0"/>
<feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_1_2"/>
<feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_1_2" result="shape"/>
</filter>
</defs>
</svg>`;

const ILLUSTRATOR_SHADOW = svg(
	'<defs><filter id="AI_Shadow" filterUnits="objectBoundingBox" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur in="SourceAlpha" stdDeviation="1" result="blur"/><feOffset in="blur" dx="4" dy="4" result="offsetBlurredAlpha"/><feMerge><feMergeNode in="offsetBlurredAlpha"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><rect x="10" y="10" width="20" height="20" fill="red" filter="url(#AI_Shadow)"/>',
);

const BLUR = svg(
	'<filter id="b"><feGaussianBlur stdDeviation="3"/></filter><rect x="10" y="10" width="20" height="20" fill="red" filter="url(#b)"/>',
);

// The red Gaussian edge at `d` units inside (positive) or outside the edge.
const edge = (d: number, sigma: number) => {
	const erf = (x: number) => {
		const t = 1 / (1 + 0.3275911 * Math.abs(x));
		const y =
			1 -
			((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
				0.254829592) *
				t *
				Math.exp(-x * x);
		return x >= 0 ? y : -y;
	};
	return Math.round(255 * 0.5 * (1 + erf(d / (sigma * Math.SQRT2))));
};

describe("SVG filters", () => {
	test("a Figma drop shadow draws the shape over a soft offset shadow", async () => {
		const { at, warnings } = await paint(FIGMA_SHADOW, 120);
		expect(warnings).toEqual([]);
		close(at(60, 50), [0x33, 0x66, 0xff, 255]);
		const below = at(60, 98);
		close(below.slice(0, 3), [0, 0, 0], 0);
		close([below[3] as number], [Math.round(0.25 * edge(1.5, 2))], 3);
		expect(at(60, 110)[3]).toBe(0);
		expect(at(10, 50)[3]).toBe(0);
	});

	test("an Illustrator drop shadow merges an offset blurred alpha under the graphic", async () => {
		const { at, warnings } = await paint(ILLUSTRATOR_SHADOW, 40);
		expect(warnings).toEqual([]);
		close(at(20, 20), [255, 0, 0, 255]);
		close(at(32, 25), [0, 0, 0, edge(1.5, 1)]);
		expect(at(5, 5)[3]).toBe(0);
		expect(at(35, 35)[3]).toBe(0);
	});

	test("a Gaussian blur fades the edge and is cut at the filter region", async () => {
		const { at, warnings } = await paint(BLUR, 40);
		expect(warnings).toEqual([]);
		close(at(20, 20), [255, 0, 0, 255]);
		close([at(10, 20)[3] as number], [edge(0.5, 3)]);
		close([at(30, 20)[3] as number], [edge(-0.5, 3)]);
		expect(at(7, 20)[3]).toBe(0);
		expect(at(32, 20)[3]).toBe(0);
	});

	test("the blur scales with the image size, the export density and the SVG's transforms", async () => {
		const renders = [
			{ k: 1, r: await paint(BLUR, 40) },
			{ k: 2, r: await paint(BLUR, 80) },
			{ k: 2, r: await paint(BLUR, 40, {}, 2) },
			{
				k: 1,
				r: await paint(
					svg(
						'<filter id="b"><feGaussianBlur stdDeviation="1.5"/></filter><g transform="translate(10 10) scale(2)"><rect width="10" height="10" fill="red" filter="url(#b)"/></g>',
					),
					40,
				),
			},
		];
		for (const { k, r } of renders)
			for (let x = 9 * k; x < 13 * k; x++)
				close([r.at(x, 20 * k)[3] as number], [edge((x + 0.5) / k - 10, 3)], 6);
	});

	test("a saturate matrix greys the colour in sRGB and linearRGB", async () => {
		const shape = (space: string) =>
			svg(
				`<filter id="f" color-interpolation-filters="${space}"><feColorMatrix type="saturate" values="0"/></filter><rect width="40" height="40" fill="red" filter="url(#f)"/>`,
			);
		const srgb = await paint(shape("sRGB"), 40);
		close(srgb.at(20, 20), [54, 54, 54, 255]);
		const linear = await paint(shape("linearRGB"), 40);
		const v = 0.213;
		const encoded = Math.round(255 * (1.055 * v ** (1 / 2.4) - 0.055));
		close(linear.at(20, 20), [encoded, encoded, encoded, 255], 4);
	});

	test("a hueRotate matrix turns the hue", async () => {
		const { at } = await paint(
			svg(
				'<filter id="f" color-interpolation-filters="sRGB"><feColorMatrix type="hueRotate" values="180"/></filter><rect width="40" height="40" fill="red" filter="url(#f)"/>',
			),
			40,
		);
		const c = (x: number) => Math.round(255 * Math.min(1, Math.max(0, x)));
		close(at(20, 20), [c(0.213 - 0.787), c(0.213 + 0.213), c(0.213 + 0.213), 255]);
	});

	test("an unsupported primitive draws the element without its filter and names the primitive", async () => {
		const { at, warnings } = await paint(
			svg(
				'<filter id="f"><feGaussianBlur stdDeviation="3"/><feTurbulence baseFrequency="0.1"/></filter><rect x="10" y="10" width="20" height="20" fill="red" filter="url(#f)"/>',
			),
			40,
		);
		close(at(20, 20), [255, 0, 0, 255]);
		close(at(10, 20), [255, 0, 0, 255]);
		expect(at(9, 20)[3]).toBe(0);
		expect(warnings).toEqual([
			{ kind: "svg_unsupported", src: "art.svg", feature: "filter-feTurbulence" },
		]);
	});

	test("filter objects are deleted with the picture", async () => {
		const live = new Set<object>();
		let created = 0;
		const factory = ck.ImageFilter;
		const names = ["MakeBlur", "MakeOffset", "MakeColorFilter", "MakeBlend", "MakeShader", "MakeDropShadow"];
		const saved = names.map((n) => factory[n]);
		names.forEach((n, i) => {
			factory[n] = (...args: unknown[]) => {
				const f = saved[i].apply(factory, args);
				live.add(f);
				created++;
				const del = f.delete.bind(f);
				f.delete = () => {
					live.delete(f);
					del();
				};
				return f;
			};
		});
		try {
			await paint(FIGMA_SHADOW, 120);
			await paint(ILLUSTRATOR_SHADOW, 40);
		} finally {
			names.forEach((n, i) => {
				factory[n] = saved[i];
			});
		}
		expect(created).toBeGreaterThan(10);
		expect(live.size).toBe(0);
	});

	test("a filtered group inside a filtered group keeps its own picture", async () => {
		const live = new Set<object>();
		const proto = ck.PictureRecorder.prototype;
		const finish = proto.finishRecordingAsPicture;
		proto.finishRecordingAsPicture = function (this: unknown, ...args: unknown[]) {
			const picture = finish.apply(this, args);
			live.add(picture);
			const del = picture.delete.bind(picture);
			picture.delete = () => {
				live.delete(picture);
				del();
			};
			return picture;
		};
		try {
			const { at } = await paint(
				svg(
					'<filter id="a" x="0" y="0" width="40" height="40" filterUnits="userSpaceOnUse"><feOffset dx="8"/></filter><filter id="b" x="0" y="0" width="40" height="40" filterUnits="userSpaceOnUse"><feOffset dx="8"/></filter><g filter="url(#a)"><g filter="url(#b)"><rect x="2" y="10" width="6" height="10" fill="red"/></g></g>',
				),
				40,
			);
			close(at(20, 15), [255, 0, 0, 255]);
			expect(at(5, 15)[3]).toBe(0);
		} finally {
			proto.finishRecordingAsPicture = finish;
		}
		expect(live.size).toBe(0);
	});
});
