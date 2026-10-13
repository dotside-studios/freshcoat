import { readFileSync } from "node:fs";
import { join } from "node:path";
import { iccProfile, loadCanvasKit } from "@freshcoat-js/test-utils";
import { unzlibSync } from "fflate";
import { beforeAll, describe, expect, test } from "vitest";
import {
	readIccProfile,
	resolveOutputIntent,
	SRGB_OUTPUT_INTENT,
	SRGB_PROFILE,
} from "../src/icc";
import { createFrame, createImage, createRect, type Node } from "../src/node";
import { createRenderer, type Renderer } from "../src/renderer";

let renderer: Renderer;
beforeAll(async () => {
	renderer = await createRenderer({ ck: await loadCanvasKit(), fonts: {} });
});

const W = 200;
const H = 120;
const source = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

const scene = (children: Node[] = []) =>
	createFrame({
		pos: { x: 0, y: 0 },
		size: { width: W, height: H },
		background: createRect({
			pos: { x: 0, y: 0 },
			size: { width: W, height: H },
			fills: [{ kind: "solid", color: "#e63946" }],
		}),
		children,
	});

/** An object's dictionary, and its stream inflated when it has one. */
function object(pdf: Uint8Array, id: string) {
	const text = source(pdf);
	const at = text.indexOf(`\n${id} 0 obj\n`);
	if (at < 0) throw new Error(`no object ${id}`);
	const start = at + `\n${id} 0 obj\n`.length;
	const end = text.indexOf("\nendobj", start);
	const body = text.slice(start, end);
	const open = body.indexOf("\nstream\n");
	if (open < 0) return { dict: body, data: null };
	const dict = body.slice(0, open);
	const length = Number(/\/Length (\d+)/.exec(dict)?.[1]);
	const from = start + open + "\nstream\n".length;
	const raw = pdf.subarray(from, from + length);
	return { dict, data: /FlateDecode/.test(dict) ? unzlibSync(raw) : raw };
}

function catalog(pdf: Uint8Array) {
	const root = /\/Root (\d+) 0 R/.exec(source(pdf))?.[1];
	if (!root) throw new Error("no root");
	return object(pdf, root).dict;
}

const iccStreams = (pdf: Uint8Array) =>
	new Set([...source(pdf).matchAll(/\[\/ICCBased (\d+) 0 R\]/g)].map((m) => m[1]));

describe("readIccProfile", () => {
	test("reads the bundled sRGB profile", () => {
		const read = readIccProfile(SRGB_PROFILE);
		expect(read).toEqual({
			ok: true,
			info: {
				version: "2.1",
				deviceClass: "mntr",
				colorSpace: "RGB",
				components: 3,
				description: "sRGB",
			},
		});
	});

	test("the bundled profile is the file shipped in icc/", () => {
		const file = readFileSync(join(__dirname, "../icc/sRGB-v2-magic.icc"));
		expect(new Uint8Array(file)).toEqual(SRGB_PROFILE);
	});

	test("reads a v4 description", () => {
		const read = readIccProfile(iccProfile({ version: 4, description: "Coated FOGRA39" }));
		expect(read.ok && read.info).toMatchObject({
			version: "4.1",
			colorSpace: "CMYK",
			components: 4,
			description: "Coated FOGRA39",
		});
	});

	test.each([
		["a short file", new Uint8Array(100), /too short/],
		["no signature", (() => {
			const b = iccProfile();
			b.set([0, 0, 0, 0], 36);
			return b;
		})(), /acsp/],
		["a size that disagrees", iccProfile().slice(0, -1), /header says/],
		["an abstract profile", iccProfile({ deviceClass: "abst" }), /"abst" profile/],
		["an input profile", iccProfile({ deviceClass: "scnr", space: "RGB " }), /"scnr" profile/],
		["a Lab profile", iccProfile({ space: "Lab " }), /"Lab" is not gray, RGB or CMYK/],
		["iccMAX", iccProfile({ version: 5 }), /version 5/],
	])("refuses %s", (_, bytes, message) => {
		const read = readIccProfile(bytes);
		expect(read.ok).toBe(false);
		if (!read.ok) expect(read.message).toMatch(message);
	});

	test("resolveOutputIntent names a profile by its description", () => {
		expect(resolveOutputIntent({ profile: iccProfile() })).toEqual({
			profile: iccProfile(),
			components: 4,
			identifier: "Test CMYK",
			info: "Test CMYK",
		});
		expect(resolveOutputIntent(false)).toBeNull();
		expect(resolveOutputIntent(undefined)?.identifier).toBe(SRGB_OUTPUT_INTENT.identifier);
	});
});

describe("PDF output intent", () => {
	test("declares sRGB by default, its profile written once", async () => {
		const pdf = (await renderer.renderPdf(scene(), { width: W, height: H })).bytes;
		const root = catalog(pdf);
		expect(root).toContain("/OutputIntents [<<");
		expect(root).toContain("/Type /OutputIntent");
		expect(root).toContain("/S /GTS_PDFX");
		expect(root).toContain("/OutputConditionIdentifier (sRGB IEC61966-2.1)");
		expect(root).toContain("/Info (sRGB IEC61966-2.1)");
		expect(root).toContain("/RegistryName (http://www.color.org)");
		const dest = /\/DestOutputProfile (\d+) 0 R/.exec(root)?.[1] as string;
		const profile = object(pdf, dest);
		expect(profile.dict).toMatch(/\/N 3\b/);
		expect(profile.data).toEqual(SRGB_PROFILE);
		// DeviceRGB content is read as sRGB, through the same stream.
		expect(source(pdf)).toContain(`/DefaultRGB [/ICCBased ${dest} 0 R]`);
		expect(source(pdf)).toContain(`/Group <</S /Transparency /CS [/ICCBased ${dest} 0 R]>>`);
		expect(iccStreams(pdf)).toEqual(new Set([dest]));
		// Nothing claims PDF/X or PDF/A conformance.
		expect(source(pdf)).not.toMatch(/GTS_PDFXVersion|pdfaid/);
	});

	test("declares a caller's CMYK profile, content still sRGB", async () => {
		const cmyk = iccProfile({ description: "Coated FOGRA39 (ISO 12647-2:2004)" });
		const pdf = (
			await renderer.renderPdf(scene(), {
				width: W,
				height: H,
				outputIntent: { profile: cmyk, identifier: "FOGRA39", registry: "http://www.color.org" },
			})
		).bytes;
		const root = catalog(pdf);
		expect(root).toContain("/OutputConditionIdentifier (FOGRA39)");
		expect(root).toContain("/Info (Coated FOGRA39 \\(ISO 12647-2:2004\\))");
		const dest = /\/DestOutputProfile (\d+) 0 R/.exec(root)?.[1] as string;
		const profile = object(pdf, dest);
		expect(profile.dict).toMatch(/\/N 4\b/);
		expect(profile.data).toEqual(cmyk);
		const rgb = /\/DefaultRGB \[\/ICCBased (\d+) 0 R\]/.exec(source(pdf))?.[1] as string;
		expect(rgb).not.toBe(dest);
		expect(object(pdf, rgb).data).toEqual(SRGB_PROFILE);
	});

	test("shares one stream between the intent and images with the same profile", async () => {
		const jpeg = new Uint8Array(readFileSync(join(__dirname, "fixtures/pdf/display-p3.jpg")));
		const images = new Map([
			["a.jpg", jpeg],
			["b.jpg", jpeg.slice()],
		]);
		const image = (src: string, x: number) =>
			createImage({ pos: { x, y: 0 }, size: { width: 80, height: 80 }, src, fit: "fill" });
		const pdf = (
			await renderer.renderPdf(scene([image("a.jpg", 0), image("b.jpg", 100)]), {
				width: W,
				height: H,
				images,
			})
		).bytes;
		// The photos' Display P3 profile and sRGB, each once.
		const streams = [...iccStreams(pdf)].map((id) => object(pdf, id).data);
		expect(streams.length).toBe(2);
		expect(streams).toContainEqual(SRGB_PROFILE);
	});

	test("false leaves the intent and the tagging out", async () => {
		const pdf = (await renderer.renderPdf(scene(), { width: W, height: H, outputIntent: false }))
			.bytes;
		expect(catalog(pdf)).not.toContain("OutputIntents");
		expect(source(pdf)).not.toContain("ICCBased");
		expect(source(pdf)).not.toContain("DefaultRGB");
		expect(source(pdf)).toContain("/Group <</S /Transparency /CS /DeviceRGB>>");
	});

	test("refuses a profile that cannot be an output profile", async () => {
		await expect(
			renderer.renderPdf(scene(), {
				width: W,
				height: H,
				outputIntent: { profile: iccProfile({ deviceClass: "abst" }) },
			}),
		).rejects.toThrow(/output intent profile: an? "abst" profile does not describe an output device/);
	});
});
