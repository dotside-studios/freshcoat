import { join } from "node:path";
import { fileURLToPath } from "node:url";
import CanvasKitInit from "canvaskit-wasm";
import { beforeAll, describe, expect, test } from "vitest";
import { createHeadlessEnv } from "../src/headless";
import { compileScene, createImage, createPaintCache } from "../src/index";
import type { ImageNode, MaskNode, PathNode } from "../src/node";
import { parseSvg, svgToNode } from "../src/svg";

const CK_BIN = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	"node_modules",
	"canvaskit-wasm",
	"bin",
);

// biome-ignore lint/suspicious/noExplicitAny: CanvasKit is untyped here
let ck: any;
beforeAll(async () => {
	ck = await (CanvasKitInit as (o: unknown) => Promise<unknown>)({
		locateFile: (f: string) => join(CK_BIN, f),
	});
});

const HALVES =
	'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="5" height="10" fill="red"/><rect x="5" width="5" height="10" fill="blue"/></svg>';

const bytes = (s: string) => new TextEncoder().encode(s);

type Painted = { bytes: Uint8Array; warnings: unknown[] };

async function paint(
	markup: string,
	node: Partial<ImageNode>,
	opts: { width: number; height: number; scale?: number },
	cache?: ReturnType<typeof createPaintCache>,
) {
	const env = createHeadlessEnv({
		images: new Map([["art.svg", bytes(markup)]]),
		cache,
	});
	const scene = createImage({
		pos: { x: 0, y: 0 },
		size: { width: opts.width, height: opts.height },
		src: "art.svg",
		fit: "fill",
		...node,
	});
	const result = (await env.paint(
		compileScene(scene, opts),
		ck,
	)) as Painted;
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

const RED = [255, 0, 0, 255];
const BLUE = [0, 0, 255, 255];
const CLEAR = [0, 0, 0, 0];

describe("svgToNode", () => {
	test("paths carry the viewBox and the target size", () => {
		const node = svgToNode(
			parseSvg(
				'<svg width="20" height="10" viewBox="5 0 10 5"><path d="M5 0H15V5Z"/></svg>',
			),
			{ width: 40, height: 20 },
		);
		expect(node.kind).toBe("group");
		expect(node.size).toEqual({ width: 40, height: 20 });
		expect(node.clip).toBe(true);
		const path = node.children[0] as PathNode;
		expect(path.kind).toBe("path");
		expect(path.size).toEqual({ width: 40, height: 20 });
		expect(path.viewBox).toEqual({ x: 0, y: 0, width: 10, height: 5 });
		expect(path.d).toBe("M0 0L10 0L10 5Z");
	});

	test("preserveAspectRatio meet widens the viewBox around the content", () => {
		const node = svgToNode(
			parseSvg('<svg viewBox="0 0 10 10"><path d="M0 0H10V10Z"/></svg>'),
			{ width: 20, height: 10 },
		);
		const path = node.children[0] as PathNode;
		expect(path.viewBox).toEqual({ x: 0, y: 0, width: 20, height: 10 });
		expect(path.d).toBe("M5 0L15 0L15 10Z");
	});

	test("gradients become fractions of the viewBox", () => {
		const node = svgToNode(
			parseSvg(
				'<svg width="10" height="10"><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" x2="10"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient><radialGradient id="r" gradientUnits="userSpaceOnUse" cx="5" cy="5" r="5"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></radialGradient><rect width="10" height="10" fill="url(#g)"/><rect width="10" height="10" fill="url(#r)"/></svg>',
			),
		);
		const [lin, rad] = node.children as PathNode[];
		expect(lin?.fills).toEqual([
			{
				kind: "linear",
				from: { x: 0, y: 0 },
				to: { x: 1, y: 0 },
				stops: [
					{ offset: 0, color: "#ff0000ff" },
					{ offset: 1, color: "#0000ffff" },
				],
			},
		]);
		expect(rad?.fills?.[0]).toMatchObject({
			kind: "radial",
			center: { x: 0.5, y: 0.5 },
			radius: 0.5,
			radiusY: 0.5,
			rotation: 0,
		});
	});

	test("clips and masks become mask nodes", () => {
		const node = svgToNode(
			parseSvg(
				'<svg width="10" height="10"><clipPath id="c"><rect width="5" height="5"/></clipPath><mask id="m"><rect width="10" height="10" fill="white"/></mask><g clip-path="url(#c)" mask="url(#m)" opacity="0.5"><rect width="10" height="10"/></g></svg>',
			),
		);
		const outer = node.children[0] as MaskNode;
		expect(outer.kind).toBe("mask");
		expect(outer.channel).toBe("luminance");
		expect(outer.opacity).toBe(0.5);
		const inner = outer.children[0] as MaskNode;
		expect(inner.kind).toBe("mask");
		expect(inner.channel).toBeUndefined();
		expect(inner.children[0]?.kind).toBe("path");
	});
});

describe("SVG image sources", () => {
	test("fill stretches the drawing over the box", async () => {
		const { at, warnings } = await paint(HALVES, { fit: "fill" }, { width: 100, height: 50 });
		expect(warnings).toEqual([]);
		expect(at(20, 25)).toEqual(RED);
		expect(at(80, 25)).toEqual(BLUE);
	});

	test("contain letterboxes and cover crops", async () => {
		const contain = await paint(HALVES, { fit: "contain" }, { width: 100, height: 50 });
		expect(contain.at(10, 25)).toEqual(CLEAR);
		expect(contain.at(35, 25)).toEqual(RED);
		expect(contain.at(65, 25)).toEqual(BLUE);
		expect(contain.at(90, 25)).toEqual(CLEAR);
		const cover = await paint(HALVES, { fit: "cover" }, { width: 50, height: 100 });
		expect(cover.at(5, 50)).toEqual(RED);
		expect(cover.at(45, 50)).toEqual(BLUE);
	});

	test("edges stay sharp when scaled up and exported denser", async () => {
		const { at } = await paint(
			HALVES,
			{ fit: "fill" },
			{ width: 100, height: 100, scale: 2 },
		);
		expect(at(98, 100)).toEqual(RED);
		expect(at(101, 100)).toEqual(BLUE);
	});

	test("tile repeats the drawing at its own size", async () => {
		const { at } = await paint(HALVES, { fit: "tile" }, { width: 40, height: 10 });
		expect(at(12, 5)).toEqual(RED);
		expect(at(17, 5)).toEqual(BLUE);
		expect(at(32, 5)).toEqual(RED);
	});

	test("a shape mask clips the drawing", async () => {
		const { at } = await paint(
			HALVES,
			{ fit: "fill", mask: { kind: "circle" } },
			{ width: 100, height: 100 },
		);
		expect(at(1, 1)).toEqual(CLEAR);
		expect(at(30, 50)).toEqual(RED);
	});

	test("the paint cache parses a source once", async () => {
		const cache = createPaintCache();
		await paint(HALVES, {}, { width: 10, height: 10 }, cache);
		await paint(HALVES, {}, { width: 10, height: 10 }, cache);
		expect(cache.stats().imageDecodes).toBe(1);
		cache.dispose();
	});

	test("skipped features are reported per source, cached or not", async () => {
		const cache = createPaintCache();
		const markup =
			'<svg width="10" height="10"><text>hi</text><rect width="10" height="10" fill="red"/></svg>';
		for (let n = 0; n < 2; n++) {
			const { at, warnings } = await paint(markup, {}, { width: 10, height: 10 }, cache);
			expect(at(5, 5)).toEqual(RED);
			expect(warnings).toEqual([
				{ kind: "svg_unsupported", src: "art.svg", feature: "text" },
			]);
		}
		cache.dispose();
	});

	test("embedded images draw, raster and SVG alike", async () => {
		const surface = ck.MakeSurface(2, 2);
		surface.getCanvas().clear(ck.Color(0, 0, 255, 1));
		const snapshot = surface.makeImageSnapshot();
		const png = snapshot.encodeToBytes() as Uint8Array;
		snapshot.delete();
		surface.delete();
		const pngUrl = `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
		const svgUrl = `data:image/svg+xml,${encodeURIComponent(
			'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="red"/></svg>',
		)}`;
		const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image href="${svgUrl}" width="5" height="10" preserveAspectRatio="none"/><image href="${pngUrl}" x="5" width="5" height="10" preserveAspectRatio="none"/></svg>`;
		const { at, warnings } = await paint(markup, {}, { width: 10, height: 10 });
		expect(at(2, 5)).toEqual(RED);
		expect(at(7, 5)).toEqual(BLUE);
		expect(warnings).toEqual([]);
	});

	test("malformed SVG paints the placeholder and reports the load", async () => {
		const { warnings } = await paint(
			'<svg xmlns="http://www.w3.org/2000/svg"><g></svg>',
			{},
			{ width: 10, height: 10 },
		);
		expect(warnings).toEqual([
			expect.objectContaining({ kind: "image_load_failed", src: "art.svg" }),
		]);
	});
});
