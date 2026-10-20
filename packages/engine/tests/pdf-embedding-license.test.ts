import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test } from "vitest";
import { createFrame, createRect, createText, type Node } from "../src/node";
import { createRenderer } from "../src/renderer";

// biome-ignore lint/suspicious/noExplicitAny: CanvasKit instance
let ck: any;
beforeAll(async () => {
	ck = await loadCanvasKit();
});

const W = 200;
const H = 60;
const source = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

// Geist with its OS/2 fsType set, or the OS/2 table renamed away for null.
function withFsType(fsType: number | null): Uint8Array {
	const bytes = testFontBytes("Geist-Regular.ttf");
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let i = 0; i < dv.getUint16(4); i++) {
		const o = 12 + 16 * i;
		if (String.fromCharCode(...bytes.subarray(o, o + 4)) !== "OS/2") continue;
		if (fsType === null) bytes[o + 3] = "3".charCodeAt(0);
		else dv.setUint16(dv.getUint32(o + 8) + 8, fsType);
		return bytes;
	}
	throw new Error("no OS/2 table");
}

const page = (id?: string): Node =>
	createFrame({
		pos: { x: 0, y: 0 },
		size: { width: W, height: H },
		background: createRect({
			pos: { x: 0, y: 0 },
			size: { width: W, height: H },
			fills: [{ kind: "solid", color: "#ffffff" }],
		}),
		children: [
			createText({
				...(id ? { id } : {}),
				pos: { x: 8, y: 8 },
				size: { width: 184, height: 40 },
				text: "Licensed",
				font: { family: "Licensed", weight: 400, style: "normal", size: 22, lineHeight: 1.2 },
				color: "#1d3557",
			}),
		],
	});

async function render(fsType: number | null, id?: string) {
	const renderer = await createRenderer({ ck, fonts: { Licensed: [withFsType(fsType)] } });
	return renderer.renderPdf(page(id), { width: W, height: H });
}

describe("OS/2 fsType in vector PDFs", () => {
	test.each([
		["installable (0)", 0],
		["preview & print (0x0004)", 0x0004],
		["editable (0x0008)", 0x0008],
		["preview & print with editable (0x000c)", 0x000c],
		["missing an OS/2 table", null],
	])("embeds a font that is %s", async (_, fsType) => {
		const pdf = await render(fsType);
		expect(pdf.warnings).toEqual([]);
		expect(source(pdf.bytes)).toContain("/FontFile2");
	});

	test.each([
		["restricted license (0x0002)", 0x0002],
		["bitmap embedding only (0x0200)", 0x0200],
		["no subsetting (0x0100)", 0x0100],
		["restricted with preview & print (0x0006)", 0x0006],
	])("draws a font with %s as outlines and warns", async (_, fsType) => {
		const pdf = await render(fsType, "title");
		expect(pdf.warnings).toEqual([
			{ kind: "font_embedding_restricted", family: "Geist", layer: "title" },
		]);
		const body = source(pdf.bytes);
		expect(body).not.toContain("/FontFile");
		expect(body).not.toContain("/Type0");
		expect(body).not.toContain("/Subtype /Image");
	});

	test("leaves the layer out of the warning when the text has no id", async () => {
		const pdf = await render(0x0002);
		expect(pdf.warnings).toEqual([{ kind: "font_embedding_restricted", family: "Geist" }]);
	});

	test("does not warn when text is outlined by request", async () => {
		const renderer = await createRenderer({ ck, fonts: { Licensed: [withFsType(0x0002)] } });
		const pdf = await renderer.renderPdf(page(), { width: W, height: H, text: "outline" });
		expect(pdf.warnings).toEqual([]);
	});
});
