// An elliptical radial gradient: Skia only draws circles, so anything other
// than a circle is that circle under a shader local matrix. These paint one and
// read the pixels back to check the reach along each axis.
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test } from "vitest";
import { renderSceneToPng } from "./helpers/headless";
import { createRect } from "../src/index";
import type { ResolvedFill } from "../src/types";

const SIZE = 200;

let ck: any;
beforeAll(async () => {
	ck = await loadCanvasKit();
});

/** Paint a SIZE×SIZE rect filled with `fill`, and return an alpha sampler. */
async function alphaAt(fill: ResolvedFill) {
	const scene = createRect({
		pos: { x: 0, y: 0 },
		size: { width: SIZE, height: SIZE },
		fills: [fill],
	});
	const out = await renderSceneToPng(scene, {
		width: SIZE,
		height: SIZE,
		ck,
	});
	const img = ck.MakeImageFromEncoded(out.bytes);
	const px = img.readPixels(0, 0, {
		width: SIZE,
		height: SIZE,
		colorType: ck.ColorType.RGBA_8888,
		alphaType: ck.AlphaType.Unpremul,
		colorSpace: ck.ColorSpace.SRGB,
	});
	img.delete();
	return (x: number, y: number): number => px[(y * SIZE + x) * 4 + 3];
}

// Opaque at the centre, fully transparent at the edge, so alpha reads directly
// as "how far into the gradient this pixel is".
const STOPS = [
	{ offset: 0, color: "#ff0000ff" },
	{ offset: 1, color: "#ff000000" },
];
const CENTRE = { x: 0.5, y: 0.5 };

describe("radial gradient reach", () => {
	test("a circular gradient reaches equally on both axes", async () => {
		const a = await alphaAt({
			kind: "radial",
			stops: STOPS,
			center: CENTRE,
			radius: 0.25, // 50px of the 200px box
		});
		expect(a(100, 100)).toBeGreaterThan(200);
		// Just inside 50px on either axis still paints; well past it does not.
		expect(a(145, 100)).toBeGreaterThan(0);
		expect(a(155, 100)).toBe(0);
		expect(a(100, 145)).toBeGreaterThan(0);
		expect(a(100, 155)).toBe(0);
	});

	test("radiusY stretches the reach along the secondary axis only", async () => {
		// The certificate's fog shape: a glow reaching far further one way than
		// the other. As a circle it washes sideways across the whole design.
		const a = await alphaAt({
			kind: "radial",
			stops: STOPS,
			center: CENTRE,
			radius: 0.1, // 20px across
			radiusY: 0.45, // 90px down
		});
		expect(a(115, 100)).toBeGreaterThan(0);
		expect(a(125, 100)).toBe(0);
		expect(a(100, 185)).toBeGreaterThan(0);
		expect(a(100, 195)).toBe(0);
	});

	test("rotation turns the ellipse onto the axis it points along", async () => {
		// The same picture as above reached a different way: the long axis is
		// declared first this time, then turned a quarter turn to point down. If
		// rotation were ignored the two reaches would come out swapped.
		const a = await alphaAt({
			kind: "radial",
			stops: STOPS,
			center: CENTRE,
			radius: 0.45,
			radiusY: 0.1,
			rotation: 90,
		});
		expect(a(100, 185)).toBeGreaterThan(0);
		expect(a(100, 195)).toBe(0);
		expect(a(115, 100)).toBeGreaterThan(0);
		expect(a(125, 100)).toBe(0);
	});
});
