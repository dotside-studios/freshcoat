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
import { FontEmbedder } from "../src/pdf/fonts";
import { glyphTexts, lineClusters, paintPdf } from "../src/pdf/paint";
import { PdfWriter } from "../src/pdf/writer";
import { createRenderer, type RenderPdfOptions, type Renderer } from "../src/renderer";

// Geist alone in a font collection, which a PDF cannot embed.
function collection(sfnt: Uint8Array): Uint8Array {
	const out = new Uint8Array(16 + sfnt.length);
	const dv = new DataView(out.buffer);
	out.set(new TextEncoder().encode("ttcf"), 0);
	dv.setUint32(4, 0x00010000);
	dv.setUint32(8, 1);
	dv.setUint32(12, 16);
	out.set(sfnt, 16);
	for (let i = 0; i < dv.getUint16(16 + 4); i++) {
		const o = 16 + 12 + 16 * i + 8;
		dv.setUint32(o, dv.getUint32(o) + 16);
	}
	return out;
}

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

const label = (family: string, weight: 300 | 400 | 700, value: string, y: number) =>
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
const pdftotext = spawnSync("pdftotext", ["-v"]).status === 0;

function extractText(bytes: Uint8Array): string {
	const dir = mkdtempSync(join(tmpdir(), "freshcoat-pdf-"));
	try {
		writeFileSync(join(dir, "page.pdf"), bytes);
		const run = spawnSync("pdftotext", [join(dir, "page.pdf"), "-"]);
		expect(run.status).toBe(0);
		return run.stdout.toString("utf8");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

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
		const body = source(pdf.bytes);
		expect(body.startsWith("%PDF-1.7")).toBe(true);
		expect(body).toContain("/ShadingType 2");
		expect(body).toContain("/ShadingType 3");
		expect(body).toContain("/BM /Multiply");
		expect(body).toContain("/Subtype /CIDFontType2");
		expect(body).toContain("/FontFile2");
		expect(body).toContain("/ToUnicode");
		expect([pdf.width, pdf.height]).toEqual([W, H]);
	});

	test.skipIf(!pdftotext)("keeps embedded text selectable", async () => {
		const pdf = await renderer.renderPdf(scene, { width: W, height: H });
		expect(extractText(pdf.bytes)).toContain("Fresh coat ÅÉ");
	});

	test("embeds a WOFF2 variable font at its instance", async () => {
		const pdf = await renderer.renderPdf(scene, { width: W, height: H });
		expect(pdf.warnings).toEqual([]);
		expect(source(pdf.bytes)).not.toContain("/Subtype /Image");
	});

	test("draws text a PDF cannot embed as outlines", async () => {
		const collected = await createRenderer({
			ck,
			fonts: {
				Collected: [collection(testFontBytes("Geist-Regular.ttf"))],
				Blended: [testFontBytes("VendSans-Variable-CFF2.otf")],
			},
		});
		const scene = frame([
			label("Collected", 400, "In a collection", 8),
			label("Blended", 700, "CFF2 at 700", 40),
		]);
		const pdf = await collected.renderPdf(scene, { width: W, height: H });
		expect(pdf.warnings).toEqual([]);
		const body = source(pdf.bytes);
		expect(body).not.toContain("/Font");
		expect(body).not.toContain("/Subtype /Image");
		if (pdftoppm) {
			const png = await collected.render(scene, { width: W, height: H });
			expect(compare(png.bytes, rasterize(pdf.bytes), []).mean).toBeLessThan(4);
		}
	});

	test("embeds text set in a WOFF2 file", async () => {
		const pdf = await renderer.renderPdf(frame([label("Vend", 300, "Light", 8)]), {
			width: W,
			height: H,
		});
		expect(pdf.warnings).toEqual([]);
		const body = source(pdf.bytes);
		expect(body).toContain("/FontFile2");
		expect(body).not.toContain("/Subtype /Image");
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
		expect(mean).toBeLessThan(8);
	});

	test("sizes the page by dpi and repeats with a fixed date", async () => {
		const date = new Date("2026-01-01T00:00:00Z");
		const a = await renderer.renderPdf(scene, { width: W, height: H, dpi: 300, date });
		const b = await renderer.renderPdf(scene, { width: W, height: H, dpi: 300, date });
		expect(b.bytes).toEqual(a.bytes);
		expect(a.width).toBeCloseTo((W / 300) * 72, 6);
		expect(source(a.bytes)).toContain("/CreationDate (D:20260101000000Z)");
	});

	test("draws a layer PDF cannot express as an image, by layer", async () => {
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
		expect(pdf.warnings).toEqual([
			{ kind: "vector_rasterized", feature: "shadow", layer: "card" },
			{ kind: "vector_rasterized", feature: "layer blur", layer: "soft" },
		]);
		expect(source(pdf.bytes)).toContain("/Subtype /Image");
	});

	test("draws a bitmap without smoothing", async () => {
		const pixels = new Uint8Array(4 * 4 * 4);
		for (let i = 0; i < 16; i++) {
			const on = (i + Math.floor(i / 4)) % 2 === 0;
			pixels.set(on ? [0, 0, 0, 255] : [255, 255, 255, 255], i * 4);
		}
		const pdf = await renderer.renderPdf(
			frame([
				createBitmap({
					pos: { x: 10, y: 10 },
					size: { width: 40, height: 40 },
					pixels,
					pixelWidth: 4,
					pixelHeight: 4,
				}),
			]),
			{ width: W, height: H },
		);
		expect(pdf.warnings).toEqual([]);
		expect(source(pdf.bytes)).toContain("/Interpolate false");
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

	test("tags a JPEG carrying an ICC profile with that profile", async () => {
		const jpeg = new Uint8Array(readFileSync(join(__dirname, "fixtures/pdf/display-p3.jpg")));
		const scene = frame([
			createImage({ pos: { x: 0, y: 0 }, size: { width: 80, height: 80 }, src: "a.jpg", fit: "fill" }),
			createImage({ pos: { x: 100, y: 0 }, size: { width: 80, height: 80 }, src: "b.jpg", fit: "fill" }),
		]);
		const images = new Map([
			["a.jpg", jpeg],
			["b.jpg", jpeg.slice()],
		]);
		const pdf = await renderer.renderPdf(scene, { width: W, height: H, images });
		expect(pdf.warnings).toEqual([]);
		const body = source(pdf.bytes);
		expect(body.includes(source(jpeg))).toBe(true);
		expect(body).not.toMatch(/\/Subtype \/Image[^>]*\/DeviceRGB/);
		const profiles = [...body.matchAll(/\/ColorSpace \[\/ICCBased (\d+) 0 R\]/g)];
		expect(profiles.length).toBe(2);
		expect(new Set(profiles.map((m) => m[1])).size).toBe(1);
		expect(body).toMatch(new RegExp(`${profiles[0]?.[1]} 0 obj\\s*<<[^>]*/N 3`));
		if (pdftoppm) {
			const png = await renderer.render(scene, { width: W, height: H, images });
			const { at } = compare(png.bytes, rasterize(pdf.bytes), [
				[20, 40],
				[60, 40],
			]);
			for (const d of at) expect(d).toBeLessThanOrEqual(4);
		}
	});

	test("decodes a JPEG whose ICC profile does not fit it", async () => {
		const jpeg = new Uint8Array(readFileSync(join(__dirname, "fixtures/pdf/display-p3.jpg")));
		const at = source(jpeg).indexOf("ICC_PROFILE\0") + 14;
		const gray = jpeg.slice();
		gray.set(new TextEncoder().encode("GRAY"), at + 16);
		const split = jpeg.slice();
		split[at - 1] = 2;
		for (const bytes of [gray, split]) {
			const pdf = await renderer.renderPdf(
				frame([createImage({ pos: { x: 0, y: 0 }, size: { width: 80, height: 80 }, src: "a.jpg", fit: "fill" })]),
				{ width: W, height: H, images: new Map([["a.jpg", bytes]]) },
			);
			expect(pdf.warnings).toEqual([]);
			const body = source(pdf.bytes);
			expect(body).not.toContain("/DCTDecode");
			expect(body).not.toContain("/ColorSpace [/ICCBased");
		}
	});

	const masked = (id?: string) =>
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
			{ ...(id ? { id } : {}), channel: "luminance", invert: true },
		);

	test("draws a mask as an image", async () => {
		const pdf = await renderer.renderPdf(frame([masked("masked")]), {
			width: W,
			height: H,
		});
		expect(pdf.warnings).toEqual([
			{ kind: "vector_rasterized", feature: "mask", layer: "masked" },
		]);
		if (pdftoppm) {
			const png = await renderer.render(
				frame([
					masked(),
				]),
				{ width: W, height: H },
			);
			const vec = await renderer.renderPdf(
				frame([
					masked(),
				]),
				{ width: W, height: H },
			);
			const { at } = compare(png.bytes, rasterize(vec.bytes), [
				[40, 40],
				[3, 3],
			]);
			expect(at).toEqual([0, 0]);
		}
	});

	test("draws an SVG image as vectors, and as an image when it holds text", async () => {
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
			{ kind: "vector_rasterized", feature: "SVG text", layer: "titled" },
		]);
		const only = await renderer.renderPdf(
			frame([createImage({ pos: { x: 0, y: 0 }, size: { width: 80, height: 40 }, src: "logo.svg", fit: "cover" })]),
			{ width: W, height: H, images: new Map([["logo.svg", logo]]) },
		);
		expect(source(only.bytes)).not.toContain("/Subtype /Image");
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

	test("makes typefaces only for the families a run names, and frees them", async () => {
		const made: Array<{ delete: () => void }> = [];
		let deleted = 0;
		const spy = {
			Typeface: {
				MakeTypefaceFromData: (data: ArrayBuffer) => {
					const typeface = ck.Typeface.MakeTypefaceFromData(data);
					const free = typeface.delete.bind(typeface);
					typeface.delete = () => {
						deleted++;
						free();
					};
					made.push(typeface);
					return typeface;
				},
			},
		};
		const geist = testFontBytes("Geist-Regular.ttf");
		const embedder = new FontEmbedder(
			spy as never,
			new Map([
				["Geist", [geist]],
				["Vend", [testFontBytes("VendSans-Variable-latin.woff2")]],
			]),
			new PdfWriter(),
		);
		const probe = ck.Typeface.MakeTypefaceFromData(geist.buffer.slice(geist.byteOffset, geist.byteOffset + geist.byteLength));
		const run = { typeface: probe, glyphs: [], offsets: [] };
		const file = embedder.file(run as never, { weight: 400, italic: false }, new Map());
		probe.delete();
		expect("reason" in file).toBe(false);
		expect(made).toHaveLength(1);
		embedder.dispose();
		expect(deleted).toBe(1);
	});

	describe("layers drawn as images", () => {
		const shadow = { color: "#0008", dx: 2, dy: 3, blur: 4 };
		const png = () => {
			const surface = ck.MakeSurface(4, 4);
			surface.getCanvas().clear(ck.RED);
			const image = surface.makeImageSnapshot();
			const bytes = image.encodeToBytes(ck.ImageFormat.PNG, 100) as Uint8Array;
			image.delete();
			surface.delete();
			return bytes;
		};
		const pictured = (src: string, x: number) =>
			createImage({
				pos: { x, y: 10 },
				size: { width: 40, height: 40 },
				src,
				fit: "cover",
				shadow,
			});

		test("covers only the area a layer touches", async () => {
			const size = 1000;
			const pdf = await renderer.renderPdf(
				createFrame({
					pos: { x: 0, y: 0 },
					size: { width: size, height: size },
					children: [
						createRect({
							pos: { x: 500, y: 500 },
							size: { width: 40, height: 40 },
							fills: [{ kind: "solid", color: "#e63946" }],
							shadow,
						}),
					],
				}),
				{ width: size, height: size },
			);
			const body = source(pdf.bytes);
			const edge = Number(/\/Width (\d+)/.exec(body)?.[1]);
			expect(Number(/\/Height (\d+)/.exec(body)?.[1])).toBe(edge);
			// 40 units plus the shadow's reach, at 8.192 pixels per unit.
			expect(edge).toBeGreaterThan(40 * 8);
			expect(edge).toBeLessThan(120 * 8);
		});

		test("decodes each image once across layers", async () => {
			const bytes = new Map([
				["a.png", png()],
				["b.png", png()],
			]);
			const loads: string[] = [];
			const commands = renderer.compile(
				frame([
					pictured("a.png", 0),
					pictured("a.png", 60),
					pictured("b.png", 120),
					createRect({
						pos: { x: 0, y: 70 },
						size: { width: 40, height: 40 },
						fills: [{ kind: "solid", color: "#00f" }],
						shadow,
					}),
				]),
				{ width: W, height: H },
			);
			const pdf = await paintPdf(ck, commands, {
				resolveFont: () => {
					throw new Error("no fonts in this scene");
				},
				loadBytes: async (src) => {
					loads.push(src);
					return bytes.get(src) as Uint8Array;
				},
			});
			expect(pdf.warnings.filter((w) => w.kind !== "vector_rasterized")).toEqual([]);
			// Once to embed it, once to decode it for every layer that draws it.
			expect(loads.filter((src) => src === "a.png")).toHaveLength(2);
			expect(loads.filter((src) => src === "b.png")).toHaveLength(2);
		});
	});
});

describe("text as outlines", () => {
	const outlined = (scene: Node, extra: Partial<RenderPdfOptions> = {}) =>
		renderer.renderPdf(scene, { width: W, height: H, text: "outline", ...extra });

	test("draws every glyph as a path, with no font in the file", async () => {
		const pdf = await outlined(scene);
		expect(pdf.warnings).toEqual([]);
		const body = source(pdf.bytes);
		for (const font of ["/Font", "/FontFile", "/ToUnicode", "/Type0"])
			expect(body).not.toContain(font);
		expect(body).not.toContain("/Subtype /Image");
		expect(body).toContain("/BM /Multiply");
	});

	test.skipIf(!pdftoppm)("looks as the embedded text does", async () => {
		const embedded = rasterize((await renderer.renderPdf(scene, { width: W, height: H })).bytes);
		const outlines = rasterize((await outlined(scene)).bytes);
		const png = await renderer.render(scene, { width: W, height: H });
		// Poppler hints glyphs drawn from a font and not paths, so the two differ
		// at their edges by about what either differs from the raster render.
		expect(compare(embedded, outlines, []).mean).toBeLessThan(3);
		expect(compare(png.bytes, outlines, []).mean).toBeLessThan(8);
	});

	test.skipIf(!pdftotext)("leaves no text to extract", async () => {
		expect(extractText((await outlined(scene)).bytes).trim()).toBe("");
	});

	test("outlines a CFF font and a WOFF2 variable font at its instance", async () => {
		const cff = await createRenderer({
			ck,
			fonts: {
				CFF: [testFontBytes("VendSans-Regular-CFF.otf")],
				Vend: [testFontBytes("VendSans-Variable-latin.woff2")],
			},
		});
		const page = frame([label("CFF", 400, "Set in CFF", 8), label("Vend", 300, "Light", 40)]);
		expect(source((await cff.renderPdf(page, { width: W, height: H })).bytes)).toContain("/FontFile3");
		const pdf = await cff.renderPdf(page, { width: W, height: H, text: "outline" });
		expect(pdf.warnings).toEqual([]);
		expect(source(pdf.bytes)).not.toContain("/Font");
		if (pdftoppm) {
			const png = await cff.render(page, { width: W, height: H });
			expect(compare(png.bytes, rasterize(pdf.bytes), []).mean).toBeLessThan(4);
		}
	});

	test("outlines the layers that ask for it and embeds the rest", async () => {
		const pdf = await renderer.renderPdf(
			frame([
				{ ...label("Geist", 400, "Outlined", 8), pdfText: "outline" } as Node,
				label("Vend", 400, "Embedded", 40),
			]),
			{ width: W, height: H },
		);
		const body = source(pdf.bytes);
		expect(body.match(/\/FontFile2/g)).toHaveLength(1);
		expect(body).toMatch(/\/BaseFont \/[A-Z]{6}\+VendSans/);
		expect(body).not.toMatch(/\/BaseFont \/[A-Z]{6}\+Geist/);
	});

	// Gradients, aligned strokes, opacity, blends and curves, which embedded
	// text draws as an image for the gradient.
	const styled = frame([
		createText({
			pos: { x: 8, y: 4 },
			size: { width: 184, height: 40 },
			text: "Gradient",
			font: { family: "Vend", weight: 700, style: "normal", size: 32, lineHeight: 1.2 },
			color: "#000000",
			fill: {
				kind: "linear",
				from: { x: 0, y: 0 },
				to: { x: 1, y: 1 },
				stops: [
					{ offset: 0, color: "#ff5a36" },
					{ offset: 1, color: "#3a86ff" },
				],
			},
			stroke: { color: "#111111", width: 1.5, align: "inside" },
		}),
		createText({
			pos: { x: 8, y: 44 },
			size: { width: 184, height: 30 },
			text: "Outside",
			font: { family: "Geist", weight: 400, style: "normal", size: 24, lineHeight: 1.2 },
			color: "#1d3557",
			stroke: { color: "#e63946", width: 2, align: "outside" },
			opacity: 0.7,
			blendMode: "multiply",
		}),
		createText({
			pos: { x: 100, y: 40 },
			size: { width: 90, height: 80 },
			text: "Around the ring",
			font: { family: "Geist", weight: 400, style: "normal", size: 12, lineHeight: 1.2 },
			color: "#2a9d8f",
			arc: { startAngle: 0 },
		}),
	]);

	test("paints gradients, strokes, opacity, blends and curves as vectors", async () => {
		const embedded = await renderer.renderPdf(styled, { width: W, height: H });
		expect(embedded.warnings).toEqual([{ kind: "vector_rasterized", feature: "gradient text" }]);
		const pdf = await outlined(styled);
		expect(pdf.warnings).toEqual([]);
		const body = source(pdf.bytes);
		expect(body).not.toContain("/Font");
		expect(body).not.toContain("/Subtype /Image");
		expect(body).toContain("/ShadingType 2");
		expect(body).toContain("/BM /Multiply");
		if (pdftoppm) {
			const png = await renderer.render(styled, { width: W, height: H });
			expect(compare(png.bytes, rasterize(pdf.bytes), []).mean).toBeLessThan(6);
		}
	});

	test("draws a gradient stroke along the outlines", async () => {
		const pdf = await outlined(
			frame([
				createText({
					pos: { x: 8, y: 8 },
					size: { width: 184, height: 40 },
					text: "Stroked",
					font: { family: "Geist", weight: 400, style: "normal", size: 32, lineHeight: 1.2 },
					color: "#ffffff",
					stroke: {
						color: "#000000",
						width: 2,
						gradient: {
							kind: "linear",
							from: { x: 0, y: 0 },
							to: { x: 1, y: 0 },
							stops: [
								{ offset: 0, color: "#ff5a36" },
								{ offset: 1, color: "#3a86ff" },
							],
						},
					},
				}),
			]),
		);
		expect(pdf.warnings).toEqual([]);
		expect(source(pdf.bytes)).toContain("/ShadingType 2");
	});

	test("still draws as an image what PDF has no operator for", async () => {
		const pdf = await outlined(
			frame([
				{
					...label("Geist", 400, "Angular", 8),
					id: "angular",
					fill: {
						kind: "angular",
						center: { x: 0.5, y: 0.5 },
						rotation: 0,
						stops: [
							{ offset: 0, color: "#000" },
							{ offset: 1, color: "#f00" },
						],
					},
				} as Node,
			]),
		);
		expect(pdf.warnings).toEqual([
			{ kind: "vector_rasterized", feature: "angular gradient text", layer: "angular" },
		]);
	});
});

describe("text a PDF reader can extract", () => {
	// A run with glyphs at UTF-8 offsets, in the order CanvasKit placed them.
	const run = (glyphs: number[], offsets: number[], ids: Record<string, number> = {}) =>
		({
			glyphs: Uint16Array.from(glyphs),
			offsets: Uint32Array.from(offsets),
			typeface: { getGlyphIDs: (ch: string) => [ids[ch] ?? 0] },
		}) as never;

	test("reads clusters by UTF-8 offset, in either direction", () => {
		const text = "aש b";
		const rtl = run([7, 5], [3, 1]);
		const ltr = run([1, 2], [0, 4]);
		const clusters = lineClusters(text, [ltr, rtl]);
		expect([...clusters]).toEqual([
			[0, "a"],
			[1, "ש"],
			[3, " "],
			[4, "b"],
		]);
		expect(glyphTexts([rtl], clusters)).toEqual([[" ", "ש"]]);
	});

	test("splits a cluster drawn with several glyphs by the font's own map", () => {
		const text = "שָׁ";
		const clusters = lineClusters(text, [run([96, 79, 100], [0, 2, 2])]);
		const marks = run([96, 100, 79], [0, 2, 2], { "\u05b8": 79, "\u05c1": 100 });
		expect(glyphTexts([marks], clusters)).toEqual([["ש", "\u05c1", "\u05b8"]]);
		const unmapped = run([96, 100, 79], [0, 2, 2]);
		expect(glyphTexts([unmapped], clusters)).toEqual([["ש", "\u05b8", "\u05c1"]]);
	});

	test("gives glyph 0 no text", () => {
		const clusters = lineClusters("ab", [run([0, 4], [0, 1])]);
		expect(glyphTexts([run([0, 4], [0, 1])], clusters)).toEqual([["", "b"]]);
	});

	describe.skipIf(!pdftotext)("with poppler", () => {
		let hebrew: Renderer;
		beforeAll(async () => {
			hebrew = await createRenderer({
				ck,
				fonts: {
					Geist: [testFontBytes("Geist-Regular.ttf")],
					Hebrew: [testFontBytes("NotoSansHebrew-Regular.ttf")],
				},
			});
		});

		// The page's text with poppler's direction marks taken out.
		const extract = async (family: string, value: string) => {
			const scene = frame([
				label(family, 400, value, 8),
				label(family === "Geist" ? "Hebrew" : "Geist", 400, "x", 60),
			]);
			const pdf = await hebrew.renderPdf(scene, { width: W, height: H });
			return extractText(pdf.bytes).replace(/[\u200e\u200f\u202a-\u202e]/g, "");
		};

		test("reads Hebrew in logical order", async () => {
			expect(await extract("Hebrew", "שלום עולם")).toContain("שלום עולם");
		});

		test("reads Hebrew set among Latin", async () => {
			const text = await extract("Geist", "Hello שלום world");
			for (const word of ["Hello", "שלום", "world"]) expect(text).toContain(word);
		});
	});
});
