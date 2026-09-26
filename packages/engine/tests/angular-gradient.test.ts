// An angular gradient sweeps the full circle from `rotation` (0 = twelve
// o'clock), clockwise. Skia measures a sweep's angles from 0 to 360 at three
// o'clock, so the rotation is a shader local matrix about the centre rather
// than a start angle: a start angle other than 0 leaves part of the circle
// outside the swept window, where the clamp paints an end stop.
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import CanvasKitInit from "canvaskit-wasm";
import { beforeAll, describe, expect, test } from "vitest";
import { renderSceneToPng } from "../src/headless";
import { createRect } from "../src/index";
import type { ResolvedFill } from "../src/types";

const CK_BIN = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	"node_modules",
	"canvaskit-wasm",
	"bin",
);

const SIZE = 200;
const C = SIZE / 2;

let ck: any;
beforeAll(async () => {
	ck = await (CanvasKitInit as (o: unknown) => Promise<unknown>)({
		locateFile: (f: string) => join(CK_BIN, f),
	});
});

/** Paints a SIZE×SIZE rect filled with `fill` and returns its RGBA pixels. */
async function paint(fill: ResolvedFill): Promise<Uint8Array> {
	const scene = createRect({
		pos: { x: 0, y: 0 },
		size: { width: SIZE, height: SIZE },
		fills: [fill],
	});
	const out = await renderSceneToPng(scene, { width: SIZE, height: SIZE, ck });
	const img = ck.MakeImageFromEncoded(out.bytes);
	const px = img.readPixels(0, 0, {
		width: SIZE,
		height: SIZE,
		colorType: ck.ColorType.RGBA_8888,
		alphaType: ck.AlphaType.Unpremul,
		colorSpace: ck.ColorSpace.SRGB,
	}) as Uint8Array;
	img.delete();
	return px;
}

/** The pixel `r` from the centre at `deg` clockwise from twelve o'clock. */
function at(px: Uint8Array, deg: number, r = 60): [number, number, number] {
	const a = (deg * Math.PI) / 180;
	const x = Math.round(C + Math.sin(a) * r);
	const y = Math.round(C - Math.cos(a) * r);
	const o = (y * SIZE + x) * 4;
	return [px[o] as number, px[o + 1] as number, px[o + 2] as number];
}

// Red to blue: the red channel reads as how far round the sweep a pixel is.
const RED_BLUE = [
	{ offset: 0, color: "#ff0000" },
	{ offset: 1, color: "#0000ff" },
];
const angular = (rotation: number): ResolvedFill => ({
	kind: "angular",
	stops: RED_BLUE,
	center: { x: 0.5, y: 0.5 },
	rotation,
});

describe("angular gradient", () => {
	test("at rotation 0 the sweep starts at twelve o'clock and goes clockwise", async () => {
		const px = await paint(angular(0));
		const [r1, , b1] = at(px, 3);
		expect(r1).toBeGreaterThan(240);
		expect(b1).toBeLessThan(15);
		const [r2, , b2] = at(px, 357);
		expect(r2).toBeLessThan(15);
		expect(b2).toBeGreaterThan(240);
	});

	test("the quarter from twelve to three o'clock interpolates", async () => {
		const px = await paint(angular(0));
		const reds = [15, 45, 75].map((d) => at(px, d)[0]);
		// A quarter of the way round is three quarters red, and it falls
		// steadily; the clamp painted this whole quarter the last stop.
		expect(reds[1]).toBeGreaterThan(200);
		expect(reds[1]).toBeLessThan(235);
		expect(reds[0]).toBeGreaterThan(reds[1] as number);
		expect(reds[1]).toBeGreaterThan(reds[2] as number);
	});

	test("rotation turns the start clockwise", async () => {
		const px = await paint(angular(135));
		expect(at(px, 138)[0]).toBeGreaterThan(240);
		expect(at(px, 132)[2]).toBeGreaterThan(240);
	});

	test("rotation 90, which was already right, paints the same pixels", async () => {
		const px = await paint(angular(90));
		expect(createHash("sha256").update(px).digest("hex")).toBe(BEFORE_90);
	});
});

// The pixels shaderFor painted at rotation 90 with a start angle of 0 and no
// local matrix, before the rotation moved into the matrix.
const BEFORE_90 =
	"d892ee757a15f3cf5a27565ab479adfdda5e0c7f0c450a8162964375229fa3b9";
