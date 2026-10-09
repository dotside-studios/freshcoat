import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test } from "vitest";
import { decodePixels } from "../src/decode";
import {
	createBitmap,
	createEllipse,
	createFrame,
	createGroup,
	createImage,
	createMask,
	createPath,
	createRect,
	createText,
	type Node,
} from "../src/node";
import { createRenderer, type Renderer } from "../src/renderer";

// biome-ignore lint/suspicious/noExplicitAny: CanvasKit instance
let ck: any;
let renderer: Renderer;
beforeAll(async () => {
	ck = await loadCanvasKit();
	renderer = await createRenderer({
		ck,
		fonts: {
			Geist: [testFontBytes("Geist-Regular.ttf")],
			Vend: [testFontBytes("VendSans-Variable-latin.woff2")],
		},
	});
});

const W = 200;
const H = 120;
const source = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

const frame = (children: Node[]) =>
	createFrame({
		pos: { x: 0, y: 0 },
		size: { width: W, height: H },
		background: createRect({
			pos: { x: 0, y: 0 },
			size: { width: W, height: H },
			fills: [{ kind: "solid", color: "#ffffff" }],
		}),
		children,
	});

const label = (family: string, weight: 400 | 700, value: string, y: number) =>
	createText({
		pos: { x: 8, y },
		size: { width: 184, height: 30 },
		text: value,
		font: { family, weight, style: "normal", size: 22, lineHeight: 1.2 },
		color: "#1d3557",
	});

const scene = frame([
	createRect({
		pos: { x: 8, y: 8 },
		size: { width: 60, height: 40 },
		cornerRadius: 8,
		fills: [
			{
				kind: "linear",
				from: { x: 0, y: 0 },
				to: { x: 1, y: 1 },
				stops: [
					{ offset: 0, color: "#ff5a36" },
					{ offset: 1, color: "#3a86ff" },
				],
			},
		],
		stroke: { color: "#111111", width: 3, align: "inside" },
	}),
	createEllipse({
		pos: { x: 80, y: 8 },
		size: { width: 50, height: 40 },
		fills: [
			{
				kind: "radial",
				center: { x: 0.5, y: 0.5 },
				radius: 0.5,
				stops: [
					{ offset: 0, color: "#ffffff" },
					{ offset: 1, color: "#8338ec" },
				],
			},
		],
	}),
	createPath({
		pos: { x: 140, y: 8 },
		size: { width: 50, height: 40 },
		d: "M0 40 L25 0 L50 40 Z",
		fills: [{ kind: "solid", color: "#ef476f" }],
		rotation: 15,
		opacity: 0.6,
	}),
	label("Geist", 400, "Fresh coat ÅÉ", 52),
	label("Vend", 700, "Bold 700", 84),
	createGroup(
		[
			createRect({
				pos: { x: 150, y: 80 },
				size: { width: 30, height: 30 },
				fills: [{ kind: "solid", color: "#ffb703" }],
			}),
			createRect({
				pos: { x: 160, y: 90 },
				size: { width: 30, height: 30 },
				fills: [{ kind: "solid", color: "#219ebc" }],
				blendMode: "multiply",
			}),
		],
		{ isolate: true },
	),
]);

const pdftoppm = spawnSync("pdftoppm", ["-v"]).status === 0;

// The page rasterized by poppler at one pixel per design unit.
function rasterize(bytes: Uint8Array): Uint8Array {
	const dir = mkdtempSync(join(tmpdir(), "freshcoat-pdf-"));
	try {
		writeFileSync(join(dir, "page.pdf"), bytes);
		const run = spawnSync("pdftoppm", [
			"-png",
			"-r",
			"72",
			"-singlefile",
			join(dir, "page.pdf"),
			join(dir, "page"),
		]);
		expect(run.status).toBe(0);
		return new Uint8Array(readFileSync(join(dir, "page.png")));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// Mean absolute channel difference, and the largest one at each probe.
function compare(a: Uint8Array, b: Uint8Array, probes: Array<[number, number]>) {
	const pa = decodePixels(ck, a);
	const pb = decodePixels(ck, b);
	if (!pa || !pb) throw new Error("decode failed");
	expect([pa.width, pa.height]).toEqual([pb.width, pb.height]);
	let sum = 0;
	for (let i = 0; i < pa.data.length; i++)
		if (i % 4 !== 3) sum += Math.abs((pa.data[i] as number) - (pb.data[i] as number));
	const at = probes.map(([x, y]) => {
		const i = (y * pa.width + x) * 4;
		return Math.max(
			...[0, 1, 2].map((c) => Math.abs((pa.data[i + c] as number) - (pb.data[i + c] as number))),
		);
	});
	return { mean: sum / ((pa.data.length / 4) * 3), at };
}

describe("renderPdf", () => {
	test("paints shapes, gradients, blends and text as vectors", async () => {
		const pdf = await renderer.renderPdf(scene, { width: W, height: H });
		expect(pdf.warnings).toEqual([]);
		const body = source(pdf.bytes);
		expect(body.startsWith("%PDF-1.7")).toBe(true);
		expect(body).toContain("/ShadingType 2");
		expect(body).toContain("/ShadingType 3");
		expect(body).toContain("/BM /Multiply");
		expect(body).not.toContain("/Subtype /Image");
		expect([pdf.width, pdf.height]).toEqual([W, H]);
	});

	test.skipIf(!pdftoppm)("matches the raster render", async () => {
		const png = await renderer.render(scene, { width: W, height: H });
		const pdf = await renderer.renderPdf(scene, { width: W, height: H });
		// Flat colour matches exactly; edges differ where poppler and Skia
		// antialias apart.
		const { mean, at } = compare(png.bytes, rasterize(pdf.bytes), [
			[38, 28],
			[105, 28],
			[170, 100],
			[155, 85],
			[185, 115],
			[100, 110],
		]);
		expect(at.slice(2)).toEqual([0, 0, 0, 0]);
		// Gradients step through their stops a little differently.
		expect(Math.max(...at.slice(0, 2))).toBeLessThanOrEqual(8);
		expect(mean).toBeLessThan(5);
	});

	test("sizes the page by dpi and repeats with a fixed date", async () => {
		const date = new Date("2026-01-01T00:00:00Z");
		const a = await renderer.renderPdf(scene, { width: W, height: H, dpi: 300, date });
		const b = await renderer.renderPdf(scene, { width: W, height: H, dpi: 300, date });
		expect(b.bytes).toEqual(a.bytes);
		expect(a.width).toBeCloseTo((W / 300) * 72, 6);
		expect(source(a.bytes)).toContain("/CreationDate (D:20260101000000Z)");
	});

	test("reports what a PDF cannot draw, by layer", async () => {
		const pdf = await renderer.renderPdf(
			frame([
				createRect({
					id: "card",
					pos: { x: 10, y: 10 },
					size: { width: 50, height: 50 },
					fills: [
						{
							kind: "angular",
							center: { x: 0.5, y: 0.5 },
							rotation: 0,
							stops: [
								{ offset: 0, color: "#000" },
								{ offset: 1, color: "#fff" },
							],
						},
					],
					shadow: { color: "#0008", dx: 0, dy: 2, blur: 4 },
				}),
				createRect({
					id: "soft",
					pos: { x: 70, y: 10 },
					size: { width: 50, height: 50 },
					fills: [{ kind: "solid", color: "#f00" }],
					blur: 4,
					blendMode: "plus",
				}),
			]),
			{ width: W, height: H },
		);
		expect(pdf.warnings).toEqual(
			expect.arrayContaining([
				{ kind: "vector_unsupported", feature: "shadow", layer: "card" },
				{ kind: "vector_unsupported", feature: "angular gradient", layer: "card" },
				{ kind: "vector_unsupported", feature: "layer blur", layer: "soft" },
				{ kind: "vector_unsupported", feature: "plus blend", layer: "soft" },
			]),
		);
	});

	test("draws a flat bitmap as rectangles and others as an image", async () => {
		const flat = new Uint8Array(4 * 4 * 4);
		for (let i = 0; i < 16; i++) {
			const on = (i + Math.floor(i / 4)) % 2 === 0;
			flat.set(on ? [0, 0, 0, 255] : [255, 255, 255, 255], i * 4);
		}
		const box = { pos: { x: 10, y: 10 }, size: { width: 40, height: 40 } };
		const codes = await renderer.renderPdf(
			frame([createBitmap({ ...box, pixels: flat, pixelWidth: 4, pixelHeight: 4 })]),
			{ width: W, height: H },
		);
		expect(source(codes.bytes)).not.toContain("/Subtype /Image");
		const soft = flat.slice();
		soft[3] = 128;
		const photo = await renderer.renderPdf(
			frame([createBitmap({ ...box, pixels: soft, pixelWidth: 4, pixelHeight: 4 })]),
			{ width: W, height: H },
		);
		const body = source(photo.bytes);
		expect(body).toContain("/Subtype /Image");
		expect(body).toContain("/Interpolate false");
		expect(body).toContain("/SMask");
	});

	test("embeds a PNG with its alpha and a JPEG as it is", async () => {
		const surface = ck.MakeSurface(8, 8);
		surface.getCanvas().clear(ck.TRANSPARENT);
		const paint = new ck.Paint();
		paint.setColor(ck.RED);
		surface.getCanvas().drawCircle(4, 4, 3, paint);
		const image = surface.makeImageSnapshot();
		const png = image.encodeToBytes(ck.ImageFormat.PNG, 100) as Uint8Array;
		image.delete();
		paint.delete();
		surface.delete();
		const jpeg = new Uint8Array(readFileSync(join(__dirname, "fixtures/pdf/stripes.jpg")));
		const pdf = await renderer.renderPdf(
			frame([
				createImage({ pos: { x: 0, y: 0 }, size: { width: 40, height: 40 }, src: "a.png", fit: "cover" }),
				createImage({ pos: { x: 50, y: 0 }, size: { width: 40, height: 40 }, src: "b.jpg", fit: "contain" }),
			]),
			{
				width: W,
				height: H,
				images: new Map([
					["a.png", png],
					["b.jpg", jpeg],
				]),
			},
		);
		expect(pdf.warnings).toEqual([]);
		const body = source(pdf.bytes);
		expect(body).toContain("/DCTDecode");
		expect(body).toContain("/SMask");
		expect(body.includes(source(jpeg))).toBe(true);
	});

	test("masks content by a shape's luminance", async () => {
		const pdf = await renderer.renderPdf(
			frame([
				createMask(
					createEllipse({
						pos: { x: 10, y: 10 },
						size: { width: 60, height: 60 },
						fills: [{ kind: "solid", color: "#fff" }],
					}),
					[
						createRect({
							pos: { x: 0, y: 0 },
							size: { width: 80, height: 80 },
							fills: [{ kind: "solid", color: "#2a9d8f" }],
						}),
					],
					{ channel: "luminance", invert: true },
				),
			]),
			{ width: W, height: H },
		);
		const body = source(pdf.bytes);
		expect(body).toContain("/S /Luminosity");
		expect(body).toContain("/TR");
	});

	test("draws an SVG image as vectors and names what it leaves out", async () => {
		const logo = new TextEncoder().encode(
			'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10" viewBox="0 0 20 10"><rect width="20" height="10" fill="#e63946"/><circle cx="10" cy="5" r="4" fill="#fff"/></svg>',
		);
		const titled = new TextEncoder().encode(
			'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><text x="0" y="8">Hi</text></svg>',
		);
		const pdf = await renderer.renderPdf(
			frame([
				createImage({ pos: { x: 0, y: 0 }, size: { width: 80, height: 40 }, src: "logo.svg", fit: "contain" }),
				createImage({ pos: { x: 100, y: 0 }, size: { width: 80, height: 40 }, src: "logo.svg", fit: "cover" }),
				createImage({ id: "titled", pos: { x: 0, y: 50 }, size: { width: 80, height: 40 }, src: "titled.svg", fit: "fill" }),
			]),
			{
				width: W,
				height: H,
				images: new Map([
					["logo.svg", logo],
					["titled.svg", titled],
				]),
			},
		);
		expect(pdf.warnings).toEqual([
			{ kind: "vector_unsupported", feature: "SVG text", layer: "titled" },
		]);
		const body = source(pdf.bytes);
		expect(body).not.toContain("/Subtype /Image");
		if (pdftoppm) {
			const png = await renderer.render(
				frame([createImage({ pos: { x: 0, y: 0 }, size: { width: 80, height: 40 }, src: "logo.svg", fit: "contain" })]),
				{ width: W, height: H, images: new Map([["logo.svg", logo]]) },
			);
			const vec = await renderer.renderPdf(
				frame([createImage({ pos: { x: 0, y: 0 }, size: { width: 80, height: 40 }, src: "logo.svg", fit: "contain" })]),
				{ width: W, height: H, images: new Map([["logo.svg", logo]]) },
			);
			const { at } = compare(png.bytes, rasterize(vec.bytes), [
				[10, 20],
				[40, 20],
				[100, 100],
			]);
			expect(at).toEqual([0, 0, 0]);
		}
	});
});
