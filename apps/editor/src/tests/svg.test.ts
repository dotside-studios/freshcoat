import type { Template } from "@freshcoat-js/coatfile";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readClipboard } from "~/app/clipboard";
import { EditorController } from "~/app/controller";
import { rasterSize, sizedSvg, svgMarkup, svgSize } from "~/app/svg";
import { doc } from "./doc-fixture";

vi.mock("~/app/raster", () => ({
	rasterizeSvg: vi.fn(
		async () =>
			new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }),
	),
}));

const ICON =
	'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="12" viewBox="0 0 24 12"><path d="M0 0h24v12H0z"/></svg>';

function clipboardText(text: string) {
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: {
			readText: async () => text,
			writeText: async () => {},
		},
	});
}

afterEach(() => {
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: undefined,
	});
});

describe("svgMarkup", () => {
	it("accepts an SVG document", () => {
		expect(svgMarkup(ICON)).toBe(ICON);
		expect(svgMarkup(`\n  ${ICON}\n`)).toBe(ICON);
	});
	it("accepts a prolog, doctype and comments before the root", () => {
		const text = `<?xml version="1.0" encoding="UTF-8"?>\n<!-- Generator: x -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">\n${ICON}`;
		expect(svgMarkup(text)).toBe(text);
	});
	it("refuses text that only mentions SVG", () => {
		expect(svgMarkup("Hello <svg></svg>")).toBeNull();
		expect(svgMarkup(`${ICON} trailing`)).toBeNull();
		expect(svgMarkup("<svgfoo></svgfoo>")).toBeNull();
		expect(svgMarkup("<div><svg></svg></div>")).toBeNull();
	});
	it("refuses malformed markup", () => {
		expect(
			svgMarkup('<svg xmlns="http://www.w3.org/2000/svg"><g></svg>'),
		).toBeNull();
	});
});

describe("svgSize", () => {
	it("reads width and height", () => {
		expect(svgSize(ICON)).toEqual({ width: 24, height: 12 });
		expect(svgSize('<svg width="30px" height="10.5px"></svg>')).toEqual({
			width: 30,
			height: 10.5,
		});
	});
	it("falls back to the viewBox", () => {
		expect(svgSize('<svg viewBox="0 0 100 50"></svg>')).toEqual({
			width: 100,
			height: 50,
		});
		expect(svgSize('<svg width="100%" viewBox="-5,-5 40 20"></svg>')).toEqual({
			width: 40,
			height: 20,
		});
	});
	it("keeps the viewBox aspect when one side is given", () => {
		expect(svgSize('<svg width="10" viewBox="0 0 100 50"></svg>')).toEqual({
			width: 10,
			height: 5,
		});
	});
	it("falls back to 300 by 150", () => {
		expect(svgSize("<svg></svg>")).toEqual({ width: 300, height: 150 });
	});
});

describe("rasterSize", () => {
	it("draws the longest side at 2048", () => {
		expect(rasterSize({ width: 24, height: 12 })).toEqual({
			width: 2048,
			height: 1024,
		});
	});
	it("never shrinks below the drawing's own size, up to 4096", () => {
		expect(rasterSize({ width: 3000, height: 1000 })).toEqual({
			width: 3000,
			height: 1000,
		});
		expect(rasterSize({ width: 8000, height: 2000 })).toEqual({
			width: 4096,
			height: 1024,
		});
	});
});

describe("sizedSvg", () => {
	it("sets the size and keeps the drawing's coordinates", () => {
		const out = new DOMParser().parseFromString(
			sizedSvg(
				'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="12"/>',
				{
					width: 48,
					height: 24,
				},
			),
			"image/svg+xml",
		).documentElement;
		expect(out.getAttribute("width")).toBe("48");
		expect(out.getAttribute("height")).toBe("24");
		expect(out.getAttribute("viewBox")).toBe("0 0 24 12");
	});
	it("adds the SVG namespace an image needs", () => {
		const out = sizedSvg("<svg></svg>", { width: 300, height: 150 });
		expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
	});
});

describe("pasting SVG", () => {
	it("reads SVG markup as a drawing, not text", async () => {
		clipboardText(ICON);
		expect(await readClipboard()).toEqual({ kind: "svg", svg: ICON });
	});

	it("places one image layer at the drawing's aspect", async () => {
		clipboardText(ICON);
		const c = new EditorController();
		const t = doc();
		c.open(t, "doc.coat");
		const before = (c.template as Template).template_data[0].elements.length;
		await c.paste();
		const after = c.template as Template;
		const elements = after.template_data[0].elements;
		expect(elements).toHaveLength(before + 1);
		const placed = elements.at(-1);
		expect(placed?.type).toBe("image");
		expect(
			elements.some((e) => e.type === "text" && e.properties.value === ICON),
		).toBe(false);
		const width = placed?.size?.width ?? 0;
		const height = placed?.size?.height ?? 0;
		expect(width / height).toBeCloseTo(2, 1);
		expect(width).toBeLessThanOrEqual(t.width / 2);
		const src = placed?.type === "image" ? placed.properties.src : "";
		const asset = after.assets?.find((a) => src.endsWith(a.sha256));
		expect(asset?.contentType).toBe("image/png");
		c.undo();
		expect((c.template as Template).template_data[0].elements).toHaveLength(
			before,
		);
	});

	it("pastes the markup as text when asked to", async () => {
		clipboardText(ICON);
		const c = new EditorController();
		c.open(doc(), "doc.coat");
		c.setSvgPastePrompt(async () => "text");
		await c.paste();
		const placed = (c.template as Template).template_data[0].elements.at(-1);
		expect(placed?.type).toBe("text");
		expect(placed?.type === "text" && placed.properties.value).toBe(ICON);
	});

	it("imports the drawing when asked to", async () => {
		clipboardText(ICON);
		const c = new EditorController();
		c.open(doc(), "doc.coat");
		c.setSvgPastePrompt(async () => "image");
		await c.paste();
		const placed = (c.template as Template).template_data[0].elements.at(-1);
		expect(placed?.type).toBe("image");
	});

	it("pastes nothing when the prompt is dismissed", async () => {
		clipboardText(ICON);
		const c = new EditorController();
		const t = doc();
		c.open(t, "doc.coat");
		c.setSvgPastePrompt(async () => "cancel");
		await c.paste();
		expect(c.template).toEqual(t);
	});

	it("pastes other text as a text layer", async () => {
		clipboardText("Hello <svg></svg>");
		const c = new EditorController();
		c.open(doc(), "doc.coat");
		await c.paste();
		const placed = (c.template as Template).template_data[0].elements.at(-1);
		expect(placed?.type).toBe("text");
	});
});
