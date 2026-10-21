import { createRenderer } from "@freshcoat-js/engine";
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import jsQR from "jsqr";
import { beforeAll, describe, expect, test } from "vitest";
import { compile } from "../src/compile";
import { renderCompiledPdf, renderTemplate } from "../src/render";
import type { Template } from "../src/types";

let ck: any;
let logoSrc: string;

beforeAll(async () => {
	ck = await loadCanvasKit();
	const surface = ck.MakeSurface(64, 64);
	const canvas = surface.getCanvas();
	canvas.clear(ck.Color(200, 30, 60, 1));
	const paint = new ck.Paint();
	paint.setColor(ck.Color(20, 20, 20, 1));
	canvas.drawCircle(32, 32, 20, paint);
	const img = surface.makeImageSnapshot();
	logoSrc = `data:image/png;base64,${Buffer.from(img.encodeToBytes()).toString("base64")}`;
	img.delete();
	surface.delete();
});

const VALUE = "https://freshcoat.app/c/AB12CD?ref=qr-style-matrix";

function template(properties: Record<string, unknown>): Template {
	return {
		format_version: "1.7",
		version: "1.0.0",
		id: "qr-style",
		name: "QR style",
		product: "test",
		width: 120,
		height: 120,
		fields: { type: "object", properties: {} },
		template_data: [
			{
				name: "front",
				background: {
					id: "bg",
					type: "rect",
					pos: { x: 0, y: 0 },
					size: { width: 120, height: 120 },
					properties: { fill: "#ffffff" },
				},
				elements: [
					{
						id: "qr",
						type: "qr_code",
						pos: { x: 10, y: 10 },
						size: { width: 100, height: 100 },
						properties: {
							value: VALUE,
							background: "#ffffff",
							quietZone: 4,
							...properties,
						},
					},
				],
			},
		],
	} as unknown as Template;
}

async function renderPng(
	properties: Record<string, unknown>,
	scale = 3,
): Promise<Uint8Array> {
	const t = template(properties);
	const [front] = await renderTemplate(
		await createRenderer({ ck, cache: false }),
		t,
		{},
		{ width: 120 * scale, height: 120 * scale },
	);
	return (front as { bytes: Uint8Array }).bytes;
}

function decodePng(png: Uint8Array): string | undefined {
	const img = ck.MakeImageFromEncoded(png);
	const width = img.width();
	const height = img.height();
	const rgba: Uint8Array = img.readPixels(0, 0, {
		width,
		height,
		colorType: ck.ColorType.RGBA_8888,
		alphaType: ck.AlphaType.Unpremul,
		colorSpace: ck.ColorSpace.SRGB,
	});
	img.delete();
	return jsQR(new Uint8ClampedArray(rgba), width, height, {
		inversionAttempts: "dontInvert",
	})?.data;
}

const SHAPES = ["square", "dot", "rounded", "classy"] as const;
const FINDERS = [
	["square", "square"],
	["rounded", "rounded"],
	["circle", "dot"],
	["rounded", "dot"],
] as const;
const LOGOS = [undefined, 0.15, 0.22, 0.3] as const;

describe("styled QR codes decode", () => {
	const matrix = SHAPES.flatMap((moduleShape) =>
		FINDERS.flatMap(([finderOuter, finderInner]) =>
			LOGOS.map((logo) => ({ moduleShape, finderOuter, finderInner, logo })),
		),
	);
	test.each(
		matrix,
	)("$moduleShape modules, $finderOuter/$finderInner finders, logo $logo", async ({
		moduleShape,
		finderOuter,
		finderInner,
		logo,
	}) => {
		const png = await renderPng({
			moduleShape,
			finderOuter,
			finderInner,
			...(logo ? { logo: { src: logoSrc, size: logo } } : {}),
		});
		expect(decodePng(png)).toBe(VALUE);
	});

	test("a linear gradient decodes", async () => {
		const png = await renderPng({
			moduleShape: "rounded",
			gradient: {
				kind: "linear",
				angle: 45,
				stops: [
					{ offset: 0, color: "#1a237e" },
					{ offset: 1, color: "#880e4f" },
				],
			},
			logo: { src: logoSrc, size: 0.25 },
		});
		expect(decodePng(png)).toBe(VALUE);
	});

	test("a logo larger than the cap is drawn at the cap and decodes", async () => {
		const png = await renderPng({ logo: { src: logoSrc, size: 0.6 } });
		expect(decodePng(png)).toBe(VALUE);
	});

	test("snaps square modules to whole pixels at a fractional scale", async () => {
		const png = await renderPng({}, 2.37);
		const img = ck.MakeImageFromEncoded(png);
		const rgba: Uint8Array = img.readPixels(0, 0, {
			width: img.width(),
			height: img.height(),
			colorType: ck.ColorType.RGBA_8888,
			alphaType: ck.AlphaType.Unpremul,
			colorSpace: ck.ColorSpace.SRGB,
		});
		img.delete();
		const greys = new Set<number>();
		for (let i = 0; i < rgba.length; i += 4) {
			const v = rgba[i] as number;
			if (v !== 0 && v !== 255) greys.add(v);
		}
		expect([...greys]).toEqual([]);
		expect(decodePng(png)).toBe(VALUE);
	});

	test("a margin insets the symbol, logo included", async () => {
		const png = await renderPng({
			margin: 12,
			quietZone: 0,
			moduleShape: "classy",
			logo: { src: logoSrc, size: 0.25 },
		});
		expect(decodePng(png)).toBe(VALUE);
	});

	test("decodes at a fractional module size", async () => {
		const png = await renderPng({ moduleShape: "dot" }, 2.37);
		expect(decodePng(png)).toBe(VALUE);
	});
});

describe("styled QR codes in PDF", () => {
	const pdf = async (properties: Record<string, unknown>) => {
		const renderer = await createRenderer({ ck });
		const compiled = compile(
			template(properties),
			{},
			{ width: 120, height: 120 },
		);
		const [page] = await renderCompiledPdf(renderer, compiled, { dpi: 72 });
		const text = new TextDecoder("latin1").decode(page?.bytes);
		return {
			warnings: page?.warnings,
			images: text.match(/\/Subtype\s*\/Image/g)?.length ?? 0,
		};
	};

	test("draws the modules as paths", async () => {
		for (const moduleShape of SHAPES) {
			const out = await pdf({
				moduleShape,
				finderOuter: "circle",
				finderInner: "dot",
				gradient: {
					kind: "linear",
					angle: 90,
					stops: [
						{ offset: 0, color: "#000000" },
						{ offset: 1, color: "#1a237e" },
					],
				},
			});
			expect(out).toEqual({ warnings: [], images: 0 });
		}
	});

	test("embeds only the logo as an image", async () => {
		const out = await pdf({ logo: { src: logoSrc, size: 0.2 } });
		expect(out).toEqual({ warnings: [], images: 1 });
	});
});
