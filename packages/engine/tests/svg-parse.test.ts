import { describe, expect, test } from "vitest";
import {
	isSvg,
	parseSvg,
	type SvgGroup,
	type SvgItem,
	type SvgShape,
} from "../src/svg";
import { SvgError } from "../src/svg/xml";

const svg = (body: string, attrs = 'width="100" height="100"') =>
	`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;

function shapes(items: SvgItem[]): SvgShape[] {
	return items.flatMap((i) => (i.kind === "shape" ? [i] : shapes(i.children)));
}

function only(markup: string): SvgShape {
	const s = shapes(parseSvg(markup).children);
	expect(s).toHaveLength(1);
	return s[0] as SvgShape;
}

describe("isSvg", () => {
	test("sniffs text and bytes", () => {
		expect(isSvg(svg(""))).toBe(true);
		expect(isSvg(`<?xml version="1.0"?>\n<!-- x -->\n<svg/>`)).toBe(true);
		expect(isSvg(new TextEncoder().encode(`﻿  <svg/>`))).toBe(true);
		expect(isSvg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
		expect(isSvg("<html><svg/></html>")).toBe(false);
		expect(isSvg("<svgx/>")).toBe(false);
	});
});

describe("document size", () => {
	test("width and height with a viewBox", () => {
		const d = parseSvg(svg("", 'width="200" height="100" viewBox="10 20 40 20"'));
		expect([d.width, d.height]).toEqual([200, 100]);
		expect(d.viewBox).toEqual({ x: 10, y: 20, width: 40, height: 20 });
	});
	test("units convert to px", () => {
		const d = parseSvg(svg("", 'width="1in" height="72pt"'));
		expect([d.width, d.height]).toEqual([96, 96]);
	});
	test("missing size falls back to the viewBox, keeping its aspect", () => {
		expect(parseSvg(svg("", 'viewBox="0 0 40 20"'))).toMatchObject({
			width: 40,
			height: 20,
		});
		expect(parseSvg(svg("", 'width="80" viewBox="0 0 40 20"'))).toMatchObject({
			width: 80,
			height: 40,
		});
	});
	test("no size and no viewBox is 300 by 150", () => {
		const d = parseSvg(svg("", ""));
		expect([d.width, d.height]).toEqual([300, 150]);
		expect(d.viewBox).toEqual({ x: 0, y: 0, width: 300, height: 150 });
	});
	test("a percentage size reads as unset", () => {
		const d = parseSvg(svg("", 'width="100%" height="100%" viewBox="0 0 24 24"'));
		expect([d.width, d.height]).toEqual([24, 24]);
	});
	test("not an svg root throws", () => {
		expect(() => parseSvg("<html/>")).toThrow(SvgError);
		expect(() => parseSvg("<svg>")).toThrow(SvgError);
	});
});

describe("shapes", () => {
	test("path keeps its data, black fill by default", () => {
		const s = only(svg('<path d="M0 0 H10 V10 Z"/>'));
		expect(s.d).toBe("M0 0L10 0L10 10Z");
		expect(s.fill).toEqual({ kind: "solid", color: "#000000ff" });
		expect(s.stroke).toBeUndefined();
		expect(s.fillRule).toBe("nonzero");
	});
	test("rect", () => {
		expect(only(svg('<rect x="1" y="2" width="3" height="4"/>')).d).toBe(
			"M1 2L4 2L4 6L1 6Z",
		);
	});
	test("rounded rect clamps radii and mirrors a single one", () => {
		const s = only(svg('<rect width="10" height="4" rx="3"/>'));
		expect(s.d.startsWith("M3 0L7 0C")).toBe(true);
	});
	test("circle and ellipse", () => {
		expect(only(svg('<circle cx="5" cy="5" r="5"/>')).d).toMatch(/^M10 5C/);
		expect(only(svg('<ellipse cx="5" cy="5" rx="5" ry="2"/>')).d).toMatch(
			/^M10 5C/,
		);
	});
	test("line, polyline and polygon", () => {
		expect(only(svg('<line x1="0" y1="0" x2="5" y2="5" stroke="red"/>')).d).toBe(
			"M0 0L5 5",
		);
		expect(only(svg('<polyline points="0,0 5,0 5,5"/>')).d).toBe(
			"M0 0L5 0L5 5",
		);
		expect(only(svg('<polygon points="0 0 5 0 5 5"/>')).d).toBe(
			"M0 0L5 0L5 5Z",
		);
	});
	test("a line has no fill", () => {
		expect(
			only(svg('<line x2="5" y2="5" stroke="red"/>')).fill,
		).toBeUndefined();
	});
	test("degenerate shapes are skipped", () => {
		const d = parseSvg(
			svg('<rect width="0" height="5"/><circle r="0"/><path d=""/>'),
		);
		expect(d.children).toEqual([]);
	});
});

describe("paint", () => {
	test("fill, stroke and their opacities fold into colors", () => {
		const s = only(
			svg(
				'<path d="M0 0H1V1Z" fill="red" fill-opacity="0.5" stroke="#00f" stroke-width="3" stroke-opacity=".25" stroke-linecap="round" stroke-linejoin="bevel" stroke-dasharray="1, 2"/>',
			),
		);
		expect(s.fill).toEqual({ kind: "solid", color: "#ff000080" });
		expect(s.stroke).toEqual({
			color: "#0000ff40",
			width: 3,
			cap: "round",
			join: "bevel",
			dash: [1, 2],
		});
	});
	test("fill none and stroke none", () => {
		const d = parseSvg(svg('<path d="M0 0H1V1Z" fill="none"/>'));
		expect(d.children).toEqual([]);
	});
	test("an odd dash array repeats", () => {
		const s = only(
			svg('<path d="M0 0H1" stroke="red" stroke-dasharray="1 2 3"/>'),
		);
		expect(s.stroke?.dash).toEqual([1, 2, 3, 1, 2, 3]);
	});
	test("inheritance, currentColor and opacity", () => {
		const d = parseSvg(
			svg(
				'<g fill="blue" color="lime" opacity="0.5"><path d="M0 0H1V1Z"/><path d="M0 0H1V1Z" fill="currentColor" opacity="0.5"/></g>',
			),
		);
		const g = d.children[0] as SvgGroup;
		expect(g.opacity).toBe(0.5);
		const [a, b] = g.children as SvgShape[];
		expect(a?.fill).toEqual({ kind: "solid", color: "#0000ffff" });
		expect(b?.fill).toEqual({ kind: "solid", color: "#00ff00ff" });
		expect(b?.opacity).toBe(0.5);
	});
	test("cascade: attribute < style sheet < style attribute", () => {
		const d = parseSvg(
			svg(
				'<style>.a{fill:red} #b{fill:lime} path{fill:gray}</style><path class="a" d="M0 0H1V1Z" fill="blue"/><path id="b" class="a" d="M0 0H1V1Z"/><path class="a" style="fill:#123" d="M0 0H1V1Z"/>',
			),
		);
		expect(shapes(d.children).map((s) => s.fill)).toEqual([
			{ kind: "solid", color: "#ff0000ff" },
			{ kind: "solid", color: "#00ff00ff" },
			{ kind: "solid", color: "#112233ff" },
		]);
	});
	test("hidden content is dropped", () => {
		const d = parseSvg(
			svg(
				'<path d="M0 0H1V1Z" display="none"/><g style="display:none"><path d="M0 0H1V1Z"/></g><path d="M0 0H1V1Z" visibility="hidden"/><path d="M0 0H1V1Z" opacity="0"/>',
			),
		);
		expect(d.children).toEqual([]);
	});
	test("fill-rule evenodd", () => {
		expect(only(svg('<path d="M0 0H1V1Z" fill-rule="evenodd"/>')).fillRule).toBe(
			"evenodd",
		);
	});
});

describe("transforms", () => {
	test("are baked into the path, groups and viewBox excluded", () => {
		const d = parseSvg(
			svg(
				'<g transform="translate(10 0)"><path transform="scale(2)" d="M0 0H1V1Z"/></g>',
				'width="100" height="100" viewBox="0 0 50 50"',
			),
		);
		expect(shapes(d.children)[0]?.d).toBe("M10 0L12 0L12 2Z");
	});
	test("stroke width scales with the transform", () => {
		const s = only(
			svg(
				'<path transform="scale(2 8)" d="M0 0H1" stroke="red" stroke-width="1"/>',
			),
		);
		expect(s.stroke?.width).toBe(4);
	});
	test("nested svg is a translated, clipped group", () => {
		const d = parseSvg(
			svg(
				'<svg x="10" y="20" width="5" height="5" viewBox="0 0 10 10"><path d="M0 0H10V10Z"/></svg>',
			),
		);
		const g = d.children[0] as SvgGroup;
		expect(g.kind).toBe("group");
		expect(g.clip?.[0]?.d).toBe("M10 20L15 20L15 25L10 25Z");
		expect(shapes(g.children)[0]?.d).toBe("M10 20L15 20L15 25Z");
	});
});

describe("use and defs", () => {
	test("use places a copy with x and y, defs do not paint", () => {
		const d = parseSvg(
			svg(
				'<defs><path id="p" d="M0 0H1V1Z"/></defs><use href="#p" x="5" y="5"/><use xlink:href="#p" transform="scale(2)"/>',
			),
		);
		expect(shapes(d.children).map((s) => s.d)).toEqual([
			"M5 5L6 5L6 6Z",
			"M0 0L2 0L2 2Z",
		]);
	});
	test("use inherits style from the use element", () => {
		const d = parseSvg(
			svg('<defs><path id="p" d="M0 0H1V1Z"/></defs><use href="#p" fill="red"/>'),
		);
		expect(shapes(d.children)[0]?.fill).toEqual({
			kind: "solid",
			color: "#ff0000ff",
		});
	});
	test("symbol with a viewBox scales into the use size", () => {
		const d = parseSvg(
			svg(
				'<symbol id="s" viewBox="0 0 10 10"><path d="M0 0H10V10Z"/></symbol><use href="#s" width="20" height="20"/>',
			),
		);
		expect(shapes(d.children)[0]?.d).toBe("M0 0L20 0L20 20Z");
	});
	test("cycles and missing targets are cut with a warning", () => {
		const d = parseSvg(
			svg('<g id="a"><use href="#a"/></g><use href="#missing"/>'),
		);
		expect(d.children).toEqual([]);
		expect(d.warnings.map((w) => w.feature).sort()).toEqual([
			"use-cycle",
			"use-missing",
		]);
	});
	test("a symbol referencing itself is cut", () => {
		const d = parseSvg(
			svg('<symbol id="s"><path d="M0 0H10V10Z"/><use href="#s"/></symbol><use href="#s"/>'),
		);
		expect(shapes(d.children)).toHaveLength(1);
		expect(d.warnings.map((w) => w.feature)).toEqual(["use-cycle"]);
	});
	test("many references to a large group stay fast", () => {
		const paths = Array.from({ length: 100 }, (_, i) => `<path d="M${i} 0h1v1Z"/>`).join("");
		const uses = Array.from({ length: 100 }, () => '<use href="#big"/>').join("");
		const d = parseSvg(svg(`<defs><g id="big">${paths}</g></defs>${uses}<g id="a"><use href="#a"/></g>`));
		expect(shapes(d.children)).toHaveLength(10000);
		expect(d.warnings.map((w) => w.feature)).toEqual(["use-cycle"]);
	});
	test("external references are ignored", () => {
		const d = parseSvg(svg('<use href="other.svg#p"/>'));
		expect(d.children).toEqual([]);
		expect(d.warnings.map((w) => w.feature)).toEqual(["use-external"]);
	});
});

describe("gradients", () => {
	test("linear in bounding-box units maps onto the shape box", () => {
		const s = only(
			svg(
				'<linearGradient id="g"><stop offset="0" stop-color="red"/><stop offset="100%" stop-color="blue" stop-opacity="0.5"/></linearGradient><rect x="10" y="10" width="20" height="10" fill="url(#g)"/>',
			),
		);
		expect(s.fill).toEqual({
			kind: "linear",
			x1: 10,
			y1: 10,
			x2: 30,
			y2: 10,
			stops: [
				{ offset: 0, color: "#ff0000ff" },
				{ offset: 1, color: "#0000ff80" },
			],
		});
	});
	test("user space units, transforms and href inheritance", () => {
		const s = only(
			svg(
				'<linearGradient id="base"><stop offset="0.5" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient><linearGradient id="g" href="#base" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="10" y2="0" gradientTransform="translate(5 0)"/><path transform="scale(2)" d="M0 0H10V10Z" fill="url(#g)"/>',
			),
		);
		expect(s.fill).toEqual({
			kind: "linear",
			x1: 10,
			y1: 0,
			x2: 30,
			y2: 0,
			stops: [
				{ offset: 0.5, color: "#ff0000ff" },
				{ offset: 1, color: "#0000ffff" },
			],
		});
	});
	test("radial becomes a user-space ellipse", () => {
		const s = only(
			svg(
				'<radialGradient id="g"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></radialGradient><rect width="40" height="20" fill="url(#g)"/>',
			),
		);
		expect(s.fill).toMatchObject({
			kind: "radial",
			cx: 20,
			cy: 10,
			rx: 20,
			ry: 10,
			rotation: 0,
		});
	});
	test("stop offsets are clamped and never decrease", () => {
		const s = only(
			svg(
				'<linearGradient id="g"><stop offset="0.6" stop-color="red"/><stop offset="0.2" stop-color="blue"/><stop offset="2" stop-color="lime"/></linearGradient><rect width="1" height="1" fill="url(#g)"/>',
			),
		);
		if (s.fill?.kind !== "linear") throw new Error("expected linear");
		expect(s.fill.stops.map((x) => x.offset)).toEqual([0.6, 0.6, 1]);
	});
	test("a missing paint server uses the fallback color, else none", () => {
		const d = parseSvg(
			svg(
				'<rect width="1" height="1" fill="url(#nope) red"/><rect width="1" height="1" fill="url(#nope)"/>',
			),
		);
		expect(shapes(d.children).map((s) => s.fill)).toEqual([
			{ kind: "solid", color: "#ff0000ff" },
		]);
	});
	test("a gradient with one stop is a solid color", () => {
		const s = only(
			svg(
				'<linearGradient id="g"><stop stop-color="red"/></linearGradient><rect width="1" height="1" fill="url(#g)"/>',
			),
		);
		expect(s.fill).toEqual({ kind: "solid", color: "#ff0000ff" });
	});
	test("pattern paint warns and falls back", () => {
		const d = parseSvg(
			svg(
				'<pattern id="p"/><rect width="1" height="1" fill="url(#p) blue"/>',
			),
		);
		expect(shapes(d.children)[0]?.fill).toEqual({
			kind: "solid",
			color: "#0000ffff",
		});
		expect(d.warnings.map((w) => w.feature)).toEqual(["pattern"]);
	});
});

describe("clips and masks", () => {
	test("clip-path wraps the content in a clipped group", () => {
		const d = parseSvg(
			svg(
				'<clipPath id="c"><rect width="5" height="5"/></clipPath><path clip-path="url(#c)" d="M0 0H10V10Z"/>',
			),
		);
		const g = d.children[0] as SvgGroup;
		expect(g.kind).toBe("group");
		expect(g.clip?.map((c) => c.d)).toEqual(["M0 0L5 0L5 5L0 5Z"]);
		expect(shapes(g.children)).toHaveLength(1);
	});
	test("clipPathUnits objectBoundingBox maps onto the content box", () => {
		const d = parseSvg(
			svg(
				'<clipPath id="c" clipPathUnits="objectBoundingBox"><rect width="0.5" height="1"/></clipPath><rect x="10" width="20" height="10" clip-path="url(#c)"/>',
			),
		);
		expect((d.children[0] as SvgGroup).clip?.[0]?.d).toBe(
			"M10 0L20 0L20 10L10 10Z",
		);
	});
	test("mask keeps its content", () => {
		const d = parseSvg(
			svg(
				'<mask id="m"><rect width="5" height="5" fill="white"/></mask><path mask="url(#m)" d="M0 0H10V10Z"/>',
			),
		);
		const g = d.children[0] as SvgGroup;
		expect(g.mask && shapes(g.mask).map((s) => s.d)).toEqual([
			"M0 0L5 0L5 5L0 5Z",
		]);
	});
});

describe("unsupported content and limits", () => {
	test("foreignObject, media and filters warn once each", () => {
		const d = parseSvg(
			svg(
				'<foreignObject/><foreignObject/><video/><audio/><filter id="f"/><path d="M0 0H1V1Z" filter="url(#f)"/>',
			),
		);
		expect(shapes(d.children)).toHaveLength(1);
		expect(d.warnings.map((w) => w.feature).sort()).toEqual([
			"audio",
			"filter",
			"foreignObject",
			"video",
		]);
	});
	test("deep nesting stops at the depth limit", () => {
		const deep = `${"<g>".repeat(200)}<path d="M0 0H1V1Z"/>${"</g>".repeat(200)}`;
		const d = parseSvg(svg(deep));
		expect(shapes(d.children)).toHaveLength(0);
		expect(d.warnings.map((w) => w.feature)).toContain("depth-limit");
	});
	test("exponential use expansion stops at the item limit", () => {
		let body = '<path id="l0" d="M0 0H1V1Z"/>';
		for (let i = 1; i <= 20; i++)
			body += `<g id="l${i}"><use href="#l${i - 1}"/><use href="#l${i - 1}"/></g>`;
		const d = parseSvg(svg(`<defs>${body}</defs><use href="#l20"/>`));
		expect(shapes(d.children).length).toBeLessThanOrEqual(20000);
		expect(d.warnings.map((w) => w.feature)).toContain("item-limit");
	});
});
