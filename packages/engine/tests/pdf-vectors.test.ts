import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test } from "vitest";
import { decodePixels } from "../src/decode";
import {
	createEllipse,
	createFrame,
	createGroup,
	createImage,
	createPath,
	createRect,
	createText,
	type Node,
} from "../src/node";
import { instanceFont } from "../src/pdf/instance";
import { readSfnt } from "../src/pdf/sfnt";
import { createRenderer, type Renderer } from "../src/renderer";
import type { GradientFill } from "../src/types";
import { sfntBytes } from "../src/woff";

// biome-ignore lint/suspicious/noExplicitAny: CanvasKit instance
let ck: any;
let renderer: Renderer;
const geist = testFontBytes("Geist-Regular.ttf");
const vend = testFontBytes("VendSans-Variable-latin.woff2");

// Geist wrapped as WOFF 1.0, each table deflated.
function woff1(sfnt: Uint8Array): Uint8Array {
	const dv = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
	const count = dv.getUint16(4);
	const tables = Array.from({ length: count }, (_, i) => {
		const o = 12 + 16 * i;
		const at = dv.getUint32(o + 8);
		const data = sfnt.subarray(at, at + dv.getUint32(o + 12));
		const packed = new Uint8Array(deflateSync(data));
		return { o, data, packed: packed.length < data.length ? packed : data };
	});
	let size = 44 + 20 * count;
	const starts = tables.map((t) => {
		const at = size;
		size += (t.packed.length + 3) & ~3;
		return at;
	});
	const out = new Uint8Array(size);
	const ov = new DataView(out.buffer);
	out.set(new TextEncoder().encode("wOFF"), 0);
	out.set(sfnt.subarray(0, 4), 4);
	ov.setUint32(8, size);
	ov.setUint16(12, count);
	tables.forEach((t, i) => {
		const e = 44 + 20 * i;
		out.set(sfnt.subarray(t.o, t.o + 4), e);
		ov.setUint32(e + 4, starts[i] as number);
		ov.setUint32(e + 8, t.packed.length);
		ov.setUint32(e + 12, t.data.length);
		ov.setUint32(e + 16, dv.getUint32(t.o + 4));
		out.set(t.packed, starts[i]);
	});
	return out;
}

beforeAll(async () => {
	ck = await loadCanvasKit();
	renderer = await createRenderer({
		ck,
		fonts: {
			Geist: [geist],
			Wrapped: [woff1(geist)],
			Vend: [vend],
		},
	});
});

const W = 200;
const H = 120;

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

const latin1 = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

// Every stream of the file, inflated where it is compressed.
function streams(bytes: Uint8Array): string[] {
	const body = latin1(bytes);
	const out: string[] = [];
	const re = /<<(.*?)>>\nstream\n/gs;
	for (let m = re.exec(body); m; m = re.exec(body)) {
		const length = Number(/\/Length (\d+)/.exec(m[1] as string)?.[1]);
		const start = m.index + m[0].length;
		const data = bytes.subarray(start, start + length);
		out.push(
			(m[1] as string).includes("/FlateDecode")
				? latin1(inflateSync(data))
				: latin1(data),
		);
	}
	return out;
}

// The page's content and the forms it paints, joined.
const content = (bytes: Uint8Array) =>
	streams(bytes)
		.filter((s) => /^q\n| sh\n| Do\n/.test(s))
		.join("\n");

const pdftoppm = spawnSync("pdftoppm", ["-v"]).status === 0;
const pdftotext = spawnSync("pdftotext", ["-v"]).status === 0;

function poppler(tool: string, args: string[], bytes: Uint8Array, out?: string) {
	const dir = mkdtempSync(join(tmpdir(), "freshcoat-pdf-"));
	try {
		writeFileSync(join(dir, "page.pdf"), bytes);
		const run = spawnSync(tool, [...args, join(dir, "page.pdf"), out ? join(dir, out) : "-"]);
		expect(run.status).toBe(0);
		return out
			? new Uint8Array(readFileSync(join(dir, `${out}.png`)))
			: new Uint8Array(run.stdout);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// Mean absolute channel difference between the raster render and the PDF as
// poppler draws it, at one pixel per unit.
async function difference(
	node: Node,
	images?: Map<string, Uint8Array>,
): Promise<number> {
	const opts = { width: W, height: H, images };
	const png = await renderer.render(node, opts);
	const pdf = await renderer.renderPdf(node, opts);
	const page = poppler("pdftoppm", ["-png", "-r", "72", "-singlefile"], pdf.bytes, "page");
	const a = decodePixels(ck, png.bytes);
	const b = decodePixels(ck, page);
	if (!a || !b) throw new Error("decode failed");
	let sum = 0;
	for (let i = 0; i < a.data.length; i++)
		if (i % 4 !== 3) sum += Math.abs((a.data[i] as number) - (b.data[i] as number));
	return sum / ((a.data.length / 4) * 3);
}

async function vectors(node: Node) {
	const pdf = await renderer.renderPdf(node, { width: W, height: H });
	expect(pdf.warnings).toEqual([]);
	expect(latin1(pdf.bytes)).not.toContain("/Subtype /Image");
	return { body: latin1(pdf.bytes), page: content(pdf.bytes) };
}

const stops = (a: string, b: string) => [
	{ offset: 0, color: a },
	{ offset: 1, color: b },
];

describe("gradients as shadings", () => {
	const faded = frame([
		createRect({
			pos: { x: 10, y: 10 },
			size: { width: 180, height: 100 },
			fills: [
				{
					kind: "linear",
					from: { x: 0, y: 0 },
					to: { x: 1, y: 0 },
					stops: stops("#e63946", "#1d355700"),
				},
			],
		}),
	]);

	test("draws transparent stops through a soft mask", async () => {
		const { body, page } = await vectors(faded);
		expect(body).toContain("/S /Luminosity");
		expect(body).toContain("/ColorSpace /DeviceGray");
		expect(page).toMatch(/\/G\d+ gs\n\/S\d+ sh/);
	});

	const ellipse: GradientFill = {
		kind: "radial",
		center: { x: 0.5, y: 0.5 },
		radius: 0.5,
		radiusY: 0.2,
		rotation: 30,
		stops: stops("#ffbe0b", "#3a0ca3"),
	};
	const focal: GradientFill = {
		kind: "radial",
		center: { x: 0.5, y: 0.5 },
		radius: 0.4,
		focus: { x: 0.3, y: 0.35 },
		focusRadius: 0.05,
		stops: stops("#ffffff", "#2a9d8f"),
	};
	const radials = frame([
		createRect({ pos: { x: 5, y: 10 }, size: { width: 90, height: 100 }, fills: [ellipse] }),
		createRect({ pos: { x: 105, y: 10 }, size: { width: 90, height: 100 }, fills: [focal] }),
	]);

	test("draws an elliptical gradient as a circle under a matrix, and a focal one from its focus", async () => {
		const { body, page } = await vectors(radials);
		expect(body).toContain("/ShadingType 3 /Coords [50 60 0 50 60 50]");
		expect(page).toMatch(/0\.866 0\.5 -0\.5 0\.866 [-\d.]+ [-\d.]+ cm\n1 0 0 0\.4 0 36 cm\n\/S\d+ sh/);
		expect(body).toContain("/ShadingType 3 /Coords [132 45 5 150 60 40]");
	});

	test.skipIf(!pdftoppm)("matches the raster render", async () => {
		expect(await difference(faded)).toBeLessThan(2);
		expect(await difference(radials)).toBeLessThan(2);
	});
});

describe("strokes", () => {
	const gradient: GradientFill = {
		kind: "linear",
		from: { x: 0, y: 0 },
		to: { x: 1, y: 1 },
		stops: stops("#06d6a0", "#118ab288"),
	};
	const stroked = frame([
		createEllipse({
			pos: { x: 10, y: 10 },
			size: { width: 60, height: 60 },
			stroke: { color: "#000", width: 6, gradient },
		}),
		createRect({
			pos: { x: 90, y: 10 },
			size: { width: 90, height: 40 },
			cornerRadius: 8,
			stroke: { color: "#000", width: 4, gradient, dash: [10, 4, 2, 4], cap: "round" },
		}),
		createRect({
			pos: { x: 10, y: 80 },
			size: { width: 60, height: 30 },
			stroke: { color: "#264653", width: 3, trimEnd: 0.6, cap: "round" },
		}),
		createEllipse({
			pos: { x: 90, y: 60 },
			size: { width: 50, height: 50 },
			stroke: { color: "#e76f51", width: 4, trimStart: 0.1, trimEnd: 0.7, trimOffset: 0.6 },
		}),
		createPath({
			pos: { x: 150, y: 60 },
			size: { width: 40, height: 50 },
			d: "M0 50 C10 0 30 0 40 50",
			stroke: { color: "#000", width: 5, gradient, trimEnd: 0.8 },
		}),
	]);

	test("draws gradient strokes as the gradient through the stroke's outline", async () => {
		const { page } = await vectors(stroked);
		expect(page.match(/ c\n(?:[^\n]* [lc]\n)*h\n(?:[^\n]*\n)*?W n\n(?:[^\n]* cm\n)*(?:\/G\d+ gs\n)?\/S\d+ sh/g)?.length).toBe(3);
	});

	test("draws a trimmed stroke as the cut outline, stroked", async () => {
		const { page } = await vectors(stroked);
		expect(page).toContain("0.149 0.2745 0.3255 RG\n3 w 1 J 0 j 4 M\n10 80 m\n70 80 l\n70 110 l\n52 110 l\nS");
		expect(page).toMatch(/0\.9059 0\.4353 0\.3176 RG\n4 w 0 J 0 j 4 M\n[-\d.]+ [-\d.]+ m\n(?:[^\n]* c\n)+S/);
	});

	test.skipIf(!pdftoppm)("matches the raster render", async () => {
		expect(await difference(stroked)).toBeLessThan(2);
	});
});

describe("smoothed corners", () => {
	const logo = new TextEncoder().encode(
		'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10" viewBox="0 0 20 10"><rect width="20" height="10" fill="#e63946"/></svg>',
	);
	const smoothed = {
		cornerRadius: [30, 0, 12, 0] as [number, number, number, number],
		cornerSmoothing: 0.6,
	};
	const scene = frame([
		createGroup(
			[
				createRect({
					pos: { x: 0, y: 0 },
					size: { width: 90, height: 100 },
					fills: [{ kind: "solid", color: "#264653" }],
					stroke: { color: "#e76f51", width: 4, align: "inside" },
					...smoothed,
				}),
			],
			{ pos: { x: 5, y: 10 }, size: { width: 90, height: 100 }, clip: true, ...smoothed },
		),
		createImage({
			pos: { x: 105, y: 10 },
			size: { width: 90, height: 100 },
			src: "logo.svg",
			fit: "cover",
			mask: { kind: "rounded-rect", radius: smoothed.cornerRadius, smoothing: 0.6 },
			stroke: { color: "#000", width: 3 },
		}),
	]);
	const images = new Map([["logo.svg", logo]]);

	test("keeps a smoothed frame and image outline as vector paths", async () => {
		const pdf = await renderer.renderPdf(scene, { width: W, height: H, images });
		expect(pdf.warnings).toEqual([]);
		expect(latin1(pdf.bytes)).not.toContain("/Subtype /Image");
		const page = streams(pdf.bytes).join("\n");
		expect(page.match(/ c\n(?:[^\n]* [lc]\n)*h\n(?:[^\n]*\n)*?W n\n/g)?.length).toBeGreaterThanOrEqual(2);
	});

	test.skipIf(!pdftoppm)("matches the raster render", async () => {
		expect(await difference(scene, images)).toBeLessThan(2);
	});
});

describe("per-side strokes", () => {
	const sides = { top: 2, right: 8, bottom: 14, left: 0 };
	const banded = frame([
		createRect({
			pos: { x: 10, y: 10 },
			size: { width: 80, height: 40 },
			stroke: { color: "#1d3557", width: 14, sides, align: "inside" },
		}),
		createRect({
			pos: { x: 110, y: 10 },
			size: { width: 80, height: 40 },
			cornerRadius: 12,
			stroke: {
				color: "#000",
				width: 14,
				sides,
				gradient: { kind: "linear", from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, stops: stops("#e63946", "#457b9d") },
			},
		}),
		createRect({
			pos: { x: 10, y: 70 },
			size: { width: 80, height: 40 },
			cornerRadius: 10,
			cornerSmoothing: 0.6,
			stroke: { color: "#2a9d8f", width: 14, sides, align: "outside" },
		}),
		createRect({
			pos: { x: 110, y: 70 },
			size: { width: 80, height: 40 },
			stroke: { color: "#e76f51", width: 14, sides, dash: [8, 4], align: "inside" },
		}),
	]);

	test("fills the band as one even-odd path", async () => {
		const { page } = await vectors(banded);
		expect(page).toContain("0.1137 0.2078 0.3412 rg\n10 10 m\n90 10 l\n90 50 l\n10 50 l\n10 10 l\nh\n10 12 m\n82 12 l\n82 36 l\n10 36 l\n10 12 l\nh\nf*");
		expect(page).toMatch(/W\* n\n(?:[^\n]* cm\n)*\/S\d+ sh/);
	});

	test("dashes along the band, clipped to it", async () => {
		const { page } = await vectors(banded);
		expect(page).toMatch(/h\nW\* n\nq\n[^\n]* RG\n28 w 0 J 0 j 4 M\n\[8 4\] 0 d\n/);
	});

	test.skipIf(!pdftoppm)("matches the raster render", async () => {
		expect(await difference(banded)).toBeLessThan(2);
	});
});

describe("text in WOFF and variable fonts", () => {
	const line = (family: string, weight: 300 | 400 | 700, value: string, y: number) =>
		createText({
			pos: { x: 8, y },
			size: { width: 184, height: 30 },
			text: value,
			font: { family, weight, style: "normal", size: 22, lineHeight: 1.2 },
			color: "#1d3557",
		});
	const scene = frame([
		line("Wrapped", 400, "Wrapped once", 4),
		line("Vend", 300, "Light woff2", 44),
		line("Vend", 700, "Bold instance", 82),
	]);

	test("fixes a variable font at an instance", () => {
		const unwrapped = sfntBytes(vend);
		const bold = instanceFont(unwrapped, { wght: 700 }) as Uint8Array;
		const light = readSfnt(unwrapped);
		const info = readSfnt(bold);
		expect(info?.axes).toEqual([]);
		expect(info?.weight).toBe(700);
		const typeface = ck.Typeface.MakeTypefaceFromData(unwrapped.slice().buffer);
		const o = typeface.getGlyphIDs("o")[0];
		typeface.delete();
		expect(info?.advance(o)).toBeGreaterThan(light?.advance(o) ?? 0);
	});

	test("embeds each face, at its instance, and sets the text in it", async () => {
		const { body, page } = await vectors(scene);
		expect(body.match(/\/FontFile2/g)).toHaveLength(3);
		expect(body.match(/\/Subtype \/CIDFontType2/g)).toHaveLength(3);
		expect(page.match(/\/F\d+ 1 Tf/g)?.length).toBeGreaterThanOrEqual(3);
		expect(page).toContain("] TJ");
	});

	test.skipIf(!pdftotext)("keeps the text selectable", async () => {
		const pdf = await renderer.renderPdf(scene, { width: W, height: H });
		const text = new TextDecoder().decode(poppler("pdftotext", [], pdf.bytes));
		for (const value of ["Wrapped once", "Light woff2", "Bold instance"])
			expect(text).toContain(value);
	});

	test.skipIf(!pdftoppm)("matches the raster render", async () => {
		expect(await difference(scene)).toBeLessThan(6);
	});
});

describe("text on a curve", () => {
	const font = { family: "Geist", weight: 400, style: "normal", size: 16, lineHeight: 1.2 } as const;
	const scene = frame([
		createText({
			pos: { x: 10, y: 10 },
			size: { width: 100, height: 100 },
			text: "Around the ring",
			font: { ...font, decoration: "underline" },
			color: "#e63946",
			arc: { radius: 40, startAngle: 0, direction: "outside", align: "center" },
		}),
		createText({
			pos: { x: 110, y: 20 },
			size: { width: 80, height: 80 },
			text: "Wavy",
			font: { ...font, family: "Vend", weight: 700 },
			color: "#1d3557",
			path: { d: "M0 60 C20 0 60 0 80 60", startOffset: 0, side: "left", align: "start" },
		}),
	]);

	test("places each glyph along the curve in its embedded font", async () => {
		const { body, page } = await vectors(scene);
		expect(body.match(/\/FontFile2/g)).toHaveLength(2);
		const placed = page.match(/[-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ Tm\n\[<[0-9a-f]{4}>\] TJ/g);
		expect(placed?.length).toBe("Around the ring".length + "Wavy".length);
		expect(page).toMatch(/RG\n[\d.]+ w 0 J 0 j 4 M\n[-\d.]+ [-\d.]+ m\n(?:[^\n]* c\n)+S/);
	});

	test.skipIf(!pdftotext)("keeps the text selectable", async () => {
		const pdf = await renderer.renderPdf(scene, { width: W, height: H });
		const text = new TextDecoder().decode(poppler("pdftotext", [], pdf.bytes)).replace(/\s/g, "");
		expect(text).toContain("Wavy");
	});

	test.skipIf(!pdftoppm)("matches the raster render", async () => {
		expect(await difference(scene)).toBeLessThan(3);
	});
});

describe("stroked text", () => {
	const stroked = (align: "center" | "outside" | "inside", y: number) =>
		createText({
			pos: { x: 10, y },
			size: { width: 180, height: 36 },
			text: `Ink ${align}`,
			font: { family: "Geist", weight: 400, style: "normal", size: 28, lineHeight: 1.2 },
			color: "#1d3557",
			stroke: { color: "#e63946", width: 1.5, join: "round", align },
		});
	const scene = frame([stroked("center", 2), stroked("outside", 40), stroked("inside", 78)]);

	test("strokes the glyphs with a text render mode", async () => {
		const { page } = await vectors(scene);
		expect(page).toContain("0.902 0.2235 0.2745 RG\n1.5 w 0 J 1 j 4 M\nBT\n1 Tr\n");
		expect(page).toContain("0.902 0.2235 0.2745 RG\n3 w 0 J 1 j 4 M\nBT\n1 Tr\n");
		expect(page).toMatch(/BT\n7 Tr\n(?:[^\n]*\n)*?ET\nq\n[^\n]* RG\n3 w/);
	});

	test("rasterizes a gradient stroke", async () => {
		const pdf = await renderer.renderPdf(
			frame([
				createText({
					pos: { x: 10, y: 10 },
					size: { width: 180, height: 36 },
					text: "Ink",
					font: { family: "Geist", weight: 400, style: "normal", size: 28, lineHeight: 1.2 },
					color: "#1d3557",
					id: "ink",
					stroke: {
						color: "#000",
						width: 2,
						gradient: { kind: "linear", from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, stops: stops("#000", "#fff") },
					},
				}),
			]),
			{ width: W, height: H },
		);
		expect(pdf.warnings).toEqual([
			{ kind: "vector_rasterized", feature: "gradient text stroke", layer: "ink" },
		]);
	});

	test.skipIf(!pdftoppm)("matches the raster render", async () => {
		expect(await difference(scene)).toBeLessThan(6);
	});
});
