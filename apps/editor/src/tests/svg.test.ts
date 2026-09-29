import type { Template } from "@freshcoat-js/coatfile";
import { afterEach, describe, expect, it } from "vitest";
import { readClipboard } from "~/app/clipboard";
import { EditorController } from "~/app/controller";
import { svgMarkup, svgSize } from "~/app/svg";
import { doc } from "./doc-fixture";

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

describe("pasting SVG", () => {
	it("reads SVG markup as a drawing, not text", async () => {
		clipboardText(ICON);
		expect(await readClipboard()).toEqual({ kind: "svg", svg: ICON });
	});

	it("imports layers by default, fitted and centred, as one undo step", async () => {
		clipboardText(ICON);
		const c = new EditorController();
		const t = doc();
		c.open(t, "doc.coat");
		const before = (c.template as Template).template_data[0].elements.length;
		await c.paste();
		const elements = (c.template as Template).template_data[0].elements;
		expect(elements).toHaveLength(before + 1);
		const placed = elements.at(-1);
		expect(placed?.type).toBe("frame");
		const children = placed?.type === "frame" ? placed.properties.children : [];
		expect(children.map((e) => e.type)).toEqual(["vector"]);
		const { width = 0, height = 0 } = placed?.size ?? {};
		expect(width / height).toBeCloseTo(2, 5);
		expect(width).toBeLessThanOrEqual(t.width / 2);
		expect(height).toBeLessThanOrEqual(t.height / 2);
		expect((placed?.pos?.x ?? 0) + width / 2).toBeCloseTo(t.width / 2, 5);
		expect((placed?.pos?.y ?? 0) + height / 2).toBeCloseTo(t.height / 2, 5);
		const ids = new Set<string>();
		const walk = (els: typeof elements) => {
			for (const e of els) {
				expect(ids.has(e.id)).toBe(false);
				ids.add(e.id);
				if (e.type === "frame") walk(e.properties.children);
			}
		};
		walk(elements);
		c.undo();
		expect((c.template as Template).template_data[0].elements).toHaveLength(
			before,
		);
	});

	it("keeps the SVG itself when imported as an image", async () => {
		clipboardText(ICON);
		const c = new EditorController();
		c.open(doc(), "doc.coat");
		c.setSvgPastePrompt(async () => "image");
		await c.paste();
		const after = c.template as Template;
		const placed = after.template_data[0].elements.at(-1);
		expect(placed?.type).toBe("image");
		const src = placed?.type === "image" ? placed.properties.src : "";
		const asset = after.assets?.find((a) => src.endsWith(a.sha256));
		expect(asset?.contentType).toBe("image/svg+xml");
		expect(atob(asset?.base64 ?? "")).toBe(ICON);
		const { width = 0, height = 0 } = placed?.size ?? {};
		expect(width / height).toBeCloseTo(2, 1);
	});

	it("places SVG files as SVG images", async () => {
		const c = new EditorController();
		c.open(doc(), "doc.coat");
		await c.placeImage(new File([ICON], "icon.svg", { type: "image/svg+xml" }));
		const after = c.template as Template;
		const placed = after.template_data[0].elements.at(-1);
		expect(placed?.type).toBe("image");
		expect(after.assets?.at(-1)?.contentType).toBe("image/svg+xml");
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
