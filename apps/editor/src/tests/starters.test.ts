// @vitest-environment node
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Element, Template } from "@freshcoat-js/coatfile";
import {
	applyVariant,
	checkVariants,
	compile,
	isElementVisible,
	resizeTemplate,
	setBarcodeEncoder,
	validate,
} from "@freshcoat-js/coatfile";
import { bwipBarcodeEncoder } from "@freshcoat-js/coatfile/barcode";
import type { Node } from "@freshcoat-js/engine";
import { renderSceneToPng } from "@freshcoat-js/engine/headless";
import CanvasKitInit from "canvaskit-wasm";
import { beforeAll, describe, expect, test } from "vitest";
import { walkLayers } from "../doc/path";
import { sampleValues } from "../doc/values";
import { SAMPLES } from "../samples";
import { DAVI_WORDMARK_HEIGHT, daviWordmark } from "../samples/davi-wordmark";
import { findStarter, STARTERS } from "../samples/starters";
import { VEND_SANS } from "../samples/vend-sans";

const CK_BIN = join(
	dirname(createRequire(import.meta.url).resolve("canvaskit-wasm")),
	"..",
	"bin",
);

let ck: unknown;
// The Google fonts the Davi card names are not reachable offline, so Vend Sans
// stands in for them and the text is still shaped with a real face.
let fonts: Map<string, Uint8Array[]>;

beforeAll(async () => {
	setBarcodeEncoder(bwipBarcodeEncoder);
	ck = await (
		CanvasKitInit as unknown as (o: {
			locateFile(f: string): string;
		}) => Promise<unknown>
	)({ locateFile: (f) => join(CK_BIN, f) });
	const src = VEND_SANS.kind === "local" ? VEND_SANS.files[0].src : "";
	const bytes = new Uint8Array(
		Buffer.from(src.slice(src.indexOf(",") + 1), "base64"),
	);
	fonts = new Map(
		["Vend Sans", "Playfair Display", "Roboto"].map((f) => [f, [bytes]]),
	);
});

async function load(id: string): Promise<Template> {
	const s = findStarter(id);
	if (!s) throw new Error(`no starter ${id}`);
	return s.load();
}

function byId(t: Template, side: number, id: string): Element {
	for (const { element } of walkLayers(t, side))
		if (element.id === id) return element as Element;
	throw new Error(`no ${id}`);
}

describe("starters", () => {
	test("ids are unique, distinct from the samples, and each lists its size", async () => {
		const ids = STARTERS.map((s) => s.id);
		expect(ids).toEqual([
			"davi-card",
			"davi-card-portrait",
			"photo-watermark",
			"event-badge",
		]);
		for (const s of SAMPLES) expect(ids).not.toContain(s.id);
		for (const s of STARTERS) {
			const t = await s.load();
			expect([t.width, t.height]).toEqual([s.width, s.height]);
			expect(t.id).toBe(s.id);
		}
	});

	for (const s of [...STARTERS, ...SAMPLES]) {
		test(`${s.id} validates and renders every side and variant without warnings`, async () => {
			const t = await s.load();
			const v = validate(t);
			expect(v.ok ? [] : v.errors).toEqual([]);
			expect(checkVariants(t)).toEqual([]);
			for (const variantId of [
				undefined,
				...(t.variants ?? []).map((x) => x.id),
			]) {
				const out = compile(t, sampleValues(t), {
					width: t.width,
					height: t.height,
					variantId,
				});
				expect(out.frames.map((f) => f.name)).toEqual(
					t.template_data.map((f) => f.name),
				);
				for (const frame of out.frames) {
					expect(frame.warnings ?? []).toEqual([]);
					const result = await renderSceneToPng(frame.root as Node, {
						width: t.width,
						height: t.height,
						ck,
						fonts,
					});
					expect(result.warnings).toEqual([]);
					expect(Array.from(result.bytes.slice(0, 4))).toEqual([
						137, 80, 78, 71,
					]);
				}
			}
		});
	}
});

describe("the Davi card", () => {
	test("has the production fields, fonts, sides and variants", async () => {
		const t = await load("davi-card");
		expect(t.product).toBe("card_cr80");
		expect([t.width, t.height]).toEqual([1012, 638]);
		expect(t.template_data.map((f) => f.name)).toEqual(["front", "back"]);
		const f = t.fields.properties;
		expect(f.name).toMatchObject({ default: "Juan Dela Cruz", maxLength: 48 });
		expect(t.fields.required).toEqual(["name"]);
		expect(f.position.maxLength).toBe(48);
		expect(f.organization.maxLength).toBe(48);
		expect(f.card_url).toMatchObject({
			readOnly: true,
			"x-source": "system",
			default: "https://davi.social/c/XXXXXXXX",
		});
		expect(f.identifier).toBeUndefined();
		expect(t.fonts?.map((x) => [x.kind, x.family])).toEqual([
			["google", "Playfair Display"],
			["google", "Roboto"],
		]);
		expect(t.variants?.map((v) => [v.id, v.swatch])).toEqual([
			["cobalt", "#1d4ed8"],
			["sage", "#3f6f4a"],
			["plum", "#5b2a55"],
		]);
	});

	test("puts the card link QR at the top right of the back, and the wordmark bottom right of the front", async () => {
		const t = await load("davi-card");
		const qr = byId(t, 1, "back_qr");
		expect(qr.type).toBe("qr_code");
		expect(qr.properties).toMatchObject({
			value: "{{card_url}}",
			errorCorrection: "M",
		});
		const tile = byId(t, 1, "qr_tile");
		expect((tile.pos?.x ?? 0) + (tile.size?.width ?? 0)).toBe(1012 - 64);
		expect(tile.pos?.y).toBe(64);

		const mark = byId(t, 0, "davi_wordmark");
		expect((mark.pos?.x ?? 0) + (mark.size?.width ?? 0)).toBeCloseTo(1012 - 64);
		expect((mark.pos?.y ?? 0) + (mark.size?.height ?? 0)).toBeCloseTo(638 - 64);
		const footer = byId(t, 1, "back_footer");
		expect(footer.properties).toMatchObject({
			value: "MADE WITH LOVE BY DAVI SOCIAL",
		});
		expect(footer.pos?.x).toBe(64);
	});

	test("the portrait card carries the same content at 638 x 1012", async () => {
		const [wide, tall] = await Promise.all([
			load("davi-card"),
			load("davi-card-portrait"),
		]);
		expect([tall.width, tall.height]).toEqual([638, 1012]);
		expect(tall.fields).toEqual(wide.fields);
		expect(tall.fonts).toEqual(wide.fonts);
		expect(tall.variants?.map((v) => v.id)).toEqual(
			wide.variants?.map((v) => v.id),
		);
		const tokens = (t: Template) =>
			new Set(JSON.stringify(t.template_data).match(/\{\{\w+\}\}/g));
		expect(tokens(tall)).toEqual(tokens(wide));
	});

	test("the wordmark scales its path to the width asked for", () => {
		const m = daviWordmark(197);
		expect(m.height).toBeCloseTo((DAVI_WORDMARK_HEIGHT * 197) / 985);
		expect(m.d.startsWith("M13.325 29.528C")).toBe(true);
	});
});

describe("the Event badge", () => {
	test("is 4 × 3 in at 300 dpi, front only, with a Code 128 of the ticket", async () => {
		const t = await load("event-badge");
		expect([t.width, t.height]).toEqual([1200, 900]);
		expect(t.template_data.map((f) => f.name)).toEqual(["front"]);
		expect(Object.keys(t.fields.properties)).toEqual([
			"name",
			"company",
			"role",
			"ticket_id",
		]);
		const code = byId(t, 0, "ticket");
		expect(code).toMatchObject({
			type: "barcode",
			properties: {
				value: "{{ticket_id}}",
				symbology: "code128",
				showText: true,
			},
		});
		const band = byId(t, 0, "band");
		expect(band).toMatchObject({
			type: "rect",
			pos: { x: 0, y: 0 },
			size: { width: 1200 },
		});
		const json = JSON.stringify(t.template_data);
		for (const token of ["{{name}}", "{{company}}", "{{role}}"])
			expect(json).toContain(token);
	});

	test("Speaker and Staff recolor the band, and Staff hides the ticket", async () => {
		const t = await load("event-badge");
		expect(t.variants?.map((v) => [v.id, v.label, v.swatch])).toEqual([
			["speaker", "Speaker", "#6d28d9"],
			["staff", "Staff", "#c2410c"],
		]);
		const ids = (x: Template) => [...walkLayers(x, 0)].map((e) => e.element.id);
		const base = ids(t);
		for (const v of t.variants ?? []) {
			const applied = applyVariant(t, v.id);
			expect(byId(applied, 0, "band").properties).toEqual({ fill: v.swatch });
			expect(byId(applied, 0, "role").properties).toMatchObject({
				color: v.swatch,
			});
		}
		expect(ids(applyVariant(t, "speaker"))).toEqual(base);
		expect(ids(applyVariant(t, "staff"))).toEqual(
			base.filter((id) => id !== "ticket" && id !== "divider"),
		);
		// kept for editing, with the delta's flag the only record of it
		expect(ids(applyVariant(t, "staff", { hidden: "keep" }))).toEqual(base);
		const staff = compile(t, sampleValues(t), {
			width: t.width,
			height: t.height,
			variantId: "staff",
		});
		expect(JSON.stringify(staff.frames[0]?.root)).not.toContain("TKT-2026");
		const speaker = compile(t, sampleValues(t), {
			width: t.width,
			height: t.height,
			variantId: "speaker",
		});
		expect(JSON.stringify(speaker.frames[0]?.root)).toContain("TKT-2026");
	});
});

describe("the photo watermark", () => {
	test("pins the mark to the bottom-right and follows a resize", async () => {
		const t = await load("photo-watermark");
		expect([t.width, t.height]).toEqual([1600, 1200]);
		const photo = byId(t, 0, "photo");
		expect(photo).toMatchObject({
			type: "image",
			pos: { x: 0, y: 0 },
			size: { width: 1600, height: 1200 },
			constraints: { horizontal: "stretch", vertical: "stretch" },
			properties: { src: "{{photo}}", fit: "cover" },
		});
		const mark = byId(t, 0, "watermark");
		expect(mark.opacity).toBe(0.6);
		expect(mark.constraints).toEqual({ horizontal: "end", vertical: "end" });
		expect(t.fields.properties.photo.format).toBe("image");
		expect(t.fields.properties.logo.format).toBe("image");
		expect(t.fields.required).toEqual(["photo"]);

		const tall = resizeTemplate(t, 1200, 1600);
		const m = byId(tall, 0, "watermark");
		expect((m.pos?.x ?? 0) + (m.size?.width ?? 0)).toBe(1200 - 48);
		expect((m.pos?.y ?? 0) + (m.size?.height ?? 0)).toBe(1600 - 48);
		expect(byId(tall, 0, "photo").size).toEqual({ width: 1200, height: 1600 });
		const logo = byId(tall, 0, "logo");
		expect((logo.pos?.x ?? 0) + (logo.size?.width ?? 0)).toBe(1200 - 48);
		expect(logo.pos?.y ?? 0).toBeLessThan(m.pos?.y ?? 0);
	});
});

type CK = {
	MakeImageFromEncoded(b: Uint8Array): {
		width(): number;
		height(): number;
		readPixels(x: number, y: number, info: unknown): Uint8Array;
		delete(): void;
	};
	AlphaType: { Unpremul: unknown };
	ColorType: { RGBA_8888: unknown };
	ColorSpace: { SRGB: unknown };
};

/** Left and right ink edges of the light text in rows `top`..`bottom`. */
async function inkEdges(t: Template, top: number, bottom: number) {
	const out = compile(t, sampleValues(t), { width: t.width, height: t.height });
	const png = await renderSceneToPng(out.frames[0]?.root as Node, {
		width: t.width,
		height: t.height,
		ck,
		fonts,
	});
	const kit = ck as CK;
	const img = kit.MakeImageFromEncoded(png.bytes);
	const w = img.width();
	const px = img.readPixels(0, 0, {
		width: w,
		height: img.height(),
		colorType: kit.ColorType.RGBA_8888,
		alphaType: kit.AlphaType.Unpremul,
		colorSpace: kit.ColorSpace.SRGB,
	});
	img.delete();
	let left = w;
	let right = -1;
	for (let y = top; y < bottom; y++)
		for (let x = 0; x < w; x++)
			if ((px[(y * w + x) * 4] as number) > 110) {
				left = Math.min(left, x);
				right = Math.max(right, x);
			}
	return { left, right };
}

describe("the photo watermark's mark", () => {
	// The photo layer is dropped so the mark sits on the dark background.
	const bare = async () => {
		const t = await load("photo-watermark");
		const [frame] = t.template_data;
		if (!frame) throw new Error("no side");
		frame.elements = frame.elements.filter((e) => e.id !== "photo");
		return t;
	};

	for (const [w, h] of [
		[1600, 1200],
		[1200, 1600],
	] as const) {
		test(`ends 48 units from the right edge, whole, at ${w} x ${h}`, async () => {
			const t = resizeTemplate(await bare(), w, h);
			const mark = byId(t, 0, "watermark");
			const top = mark.pos?.y ?? 0;
			const bottom = top + (mark.size?.height ?? 0);
			expect((mark.pos?.x ?? 0) + (mark.size?.width ?? 0)).toBe(w - 48);
			expect(bottom).toBe(h - 48);

			const ink = await inkEdges(t, top, bottom);
			// Right-aligned: the last glyph's ink ends inside the box, just
			// short of its edge (the side bearing), never past the margin.
			expect(ink.right).toBeLessThan(w - 48);
			expect(ink.right).toBeGreaterThan(w - 48 - 12);

			// The same mark in a much wider box, ending at the same place,
			// paints the same ink: nothing was cut off.
			const wide = structuredClone(t);
			const m = byId(wide, 0, "watermark");
			m.pos = { x: (m.pos?.x ?? 0) - 600, y: m.pos?.y ?? 0 };
			m.size = {
				width: (m.size?.width ?? 0) + 600,
				height: m.size?.height ?? 0,
			};
			expect(await inkEdges(wide, top, bottom)).toEqual(ink);
		});
	}

	test("the logo shows only once the logo field is set, above the mark", async () => {
		const t = await load("photo-watermark");
		const values = sampleValues(t);
		expect(values.logo).toBe("");
		const logo = byId(t, 0, "logo");
		expect(isElementVisible(logo, values, t.fields.properties)).toBe(false);
		expect(
			isElementVisible(
				logo,
				{ ...values, logo: "data:image/png;base64,AAAA" },
				t.fields.properties,
			),
		).toBe(true);
		const mark = byId(t, 0, "watermark");
		expect((logo.pos?.y ?? 0) + (logo.size?.height ?? 0)).toBeLessThan(
			mark.pos?.y ?? 0,
		);
		expect(logo.constraints).toEqual({ horizontal: "end", vertical: "end" });
	});
});
