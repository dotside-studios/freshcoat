import { describe, expect, test } from "vitest";
import { parseColor } from "../src/svg/color";
import { applyMatrix, multiply, parseTransform } from "../src/svg/matrix";
import {
	normalizePath,
	pathBounds,
	serializePath,
	transformPath,
} from "../src/svg/path";
import { parseStyleAttr, parseStyleSheet } from "../src/svg/style";
import { parseXml, SvgError } from "../src/svg/xml";

const close = (a: number[], b: number[], eps = 1e-6) => {
	expect(a.length).toBe(b.length);
	a.forEach((v, i) => expect(Math.abs(v - (b[i] ?? 0))).toBeLessThan(eps));
};

describe("parseXml", () => {
	test("reads elements, attributes and text", () => {
		const root = parseXml(
			`<svg a="1" b='two'><g id="x"/><text>hi &amp; bye</text></svg>`,
		);
		expect(root.name).toBe("svg");
		expect(root.attrs).toEqual({ a: "1", b: "two" });
		expect(root.children).toEqual([
			{ name: "g", attrs: { id: "x" }, children: [] },
			{ name: "text", attrs: {}, children: [{ text: "hi & bye" }] },
		]);
	});

	test("skips the prolog, doctype, comments and processing instructions", () => {
		const root = parseXml(
			`﻿<?xml version="1.0"?>\n<!-- c --><!DOCTYPE svg PUBLIC "a" "b" [<!ENTITY x "y">]>\n<svg><!-- inner --><?pi x?><g/></svg>\n<!-- after -->`,
		);
		expect(root.name).toBe("svg");
		expect(root.children).toEqual([{ name: "g", attrs: {}, children: [] }]);
	});

	test("decodes predefined and numeric entities in attributes and text", () => {
		const root = parseXml(
			`<svg t="&lt;&gt;&quot;&apos;&#65;&#x42;"><style><![CDATA[a < b]]></style></svg>`,
		);
		expect(root.attrs.t).toBe(`<>"'AB`);
		expect(root.children[0]).toEqual({
			name: "style",
			attrs: {},
			children: [{ text: "a < b" }],
		});
	});

	test("leaves undeclared entities as written", () => {
		expect(parseXml(`<svg t="&ns_x;"/>`).attrs.t).toBe("&ns_x;");
	});

	test("keeps namespace prefixes on attribute names", () => {
		expect(parseXml(`<svg><use xlink:href="#a"/></svg>`).children[0]).toEqual({
			name: "use",
			attrs: { "xlink:href": "#a" },
			children: [],
		});
	});

	test("refuses malformed documents", () => {
		for (const bad of [
			"",
			"<svg>",
			"<svg><g></svg>",
			"<svg a=1/>",
			"<svg></svg><svg/>",
			"text",
			'<svg a="1" a="2"/>',
		])
			expect(() => parseXml(bad), bad).toThrow(SvgError);
	});
});

describe("parseColor", () => {
	test("hex forms", () => {
		expect(parseColor("#f00")).toEqual([255, 0, 0, 1]);
		expect(parseColor("#f008")).toEqual([255, 0, 0, 0x88 / 255]);
		expect(parseColor("#00ff00")).toEqual([0, 255, 0, 1]);
		expect(parseColor("#0000ff80")).toEqual([0, 0, 255, 0x80 / 255]);
	});
	test("functional forms", () => {
		expect(parseColor("rgb(10, 20, 30)")).toEqual([10, 20, 30, 1]);
		expect(parseColor("rgba(10,20,30,0.5)")).toEqual([10, 20, 30, 0.5]);
		expect(parseColor("rgb(100% 0% 0% / 50%)")).toEqual([255, 0, 0, 0.5]);
		expect(parseColor("hsl(120, 100%, 50%)")).toEqual([0, 255, 0, 1]);
		expect(parseColor("hsla(240 100% 50% / 0.25)")).toEqual([0, 0, 255, 0.25]);
	});
	test("keywords", () => {
		expect(parseColor("red")).toEqual([255, 0, 0, 1]);
		expect(parseColor("CornflowerBlue")).toEqual([100, 149, 237, 1]);
		expect(parseColor("transparent")).toEqual([0, 0, 0, 0]);
		expect(parseColor("none")).toBe("none");
		expect(parseColor("currentColor", [1, 2, 3, 1])).toEqual([1, 2, 3, 1]);
	});
	test("unreadable values are null", () => {
		expect(parseColor("url(#g)")).toBeNull();
		expect(parseColor("#12")).toBeNull();
		expect(parseColor("notacolor")).toBeNull();
	});
});

describe("parseTransform", () => {
	test("each function", () => {
		expect(parseTransform("translate(10 20)")).toEqual([1, 0, 0, 1, 10, 20]);
		expect(parseTransform("translate(10)")).toEqual([1, 0, 0, 1, 10, 0]);
		expect(parseTransform("scale(2)")).toEqual([2, 0, 0, 2, 0, 0]);
		expect(parseTransform("scale(2,3)")).toEqual([2, 0, 0, 3, 0, 0]);
		expect(parseTransform("matrix(1 2 3 4 5 6)")).toEqual([1, 2, 3, 4, 5, 6]);
		close(parseTransform("rotate(90)"), [0, 1, -1, 0, 0, 0]);
		close(applyMatrix(parseTransform("rotate(90 10 10)"), 20, 10), [10, 20]);
		close(parseTransform("skewX(45)"), [1, 0, 1, 1, 0, 0]);
		close(parseTransform("skewY(45)"), [1, 1, 0, 1, 0, 0]);
	});
	test("a list applies right to left", () => {
		const m = parseTransform("translate(10,0) scale(2)");
		expect(applyMatrix(m, 1, 1)).toEqual([12, 2]);
		expect(multiply(parseTransform("translate(10)"), parseTransform("scale(2)"))).toEqual(m);
	});
	test("empty or unreadable is the identity", () => {
		expect(parseTransform("")).toEqual([1, 0, 0, 1, 0, 0]);
		expect(parseTransform("wobble(3)")).toEqual([1, 0, 0, 1, 0, 0]);
	});
});

describe("normalizePath", () => {
	test("absolute lines and close", () => {
		expect(serializePath(normalizePath("M0 0 L10 0 H10 V10 Z"))).toBe(
			"M0 0L10 0L10 0L10 10Z",
		);
	});
	test("relative commands, implicit repeats and compact numbers", () => {
		expect(serializePath(normalizePath("m1 1 2 0 0 2h-2z m5 5l1-1.5.5.5"))).toBe(
			"M1 1L3 1L3 3L1 3ZM6 6L7 4.5L7.5 5",
		);
	});
	test("close returns the pen to the subpath start", () => {
		expect(serializePath(normalizePath("M10 10 h5 z l5 5"))).toBe(
			"M10 10L15 10ZL15 15",
		);
	});
	test("quadratics become cubics and shorthands reflect", () => {
		expect(serializePath(normalizePath("M0 0 Q3 3 6 0 T12 0"))).toBe(
			"M0 0C2 2 4 2 6 0C8 -2 10 -2 12 0",
		);
		expect(serializePath(normalizePath("M0 0 C0 1 1 1 1 0 S2 -1 2 0"))).toBe(
			"M0 0C0 1 1 1 1 0C1 -1 2 -1 2 0",
		);
	});
	test("arcs become cubics through the end point", () => {
		const segs = normalizePath("M0 0 A10 10 0 0 1 20 0");
		const last = segs.at(-1);
		expect(last?.op).toBe("C");
		if (last?.op !== "C") return;
		close([last.x, last.y], [20, 0]);
		const b = pathBounds(segs);
		if (!b) throw new Error("no bounds");
		close([b.x, b.y, b.width, b.height], [0, -10, 20, 10], 1e-3);
	});
	test("a zero-radius arc is a line", () => {
		expect(serializePath(normalizePath("M0 0 A0 5 0 0 1 10 0"))).toBe(
			"M0 0L10 0",
		);
	});
	test("stops at the first error and keeps what came before", () => {
		expect(serializePath(normalizePath("M0 0 L10 10 L oops"))).toBe(
			"M0 0L10 10",
		);
	});
});

describe("path geometry", () => {
	test("bounds use curve extrema, not control points", () => {
		const b = pathBounds(normalizePath("M0 0 C0 10 10 10 10 0"));
		if (!b) throw new Error("no bounds");
		close([b.x, b.y, b.width, b.height], [0, 0, 10, 7.5]);
	});
	test("an empty path has no bounds", () => {
		expect(pathBounds([])).toBeNull();
	});
	test("transform maps every point", () => {
		const segs = transformPath(
			normalizePath("M0 0 L1 0 C1 1 0 1 0 0Z"),
			[2, 0, 0, 3, 10, 20],
		);
		expect(serializePath(segs)).toBe("M10 20L12 20C12 23 10 23 10 20Z");
	});
});

describe("styles", () => {
	test("style attribute declarations", () => {
		expect(parseStyleAttr("fill: red; stroke-width:2 ;;bad")).toEqual({
			fill: "red",
			"stroke-width": "2",
		});
	});
	test("style sheet rules with selectors and specificity", () => {
		const rules = parseStyleSheet(
			"/* c */ .a, #b { fill: red } path{stroke:blue} @media print { .a { fill: green } } .a .b { fill: pink } .c:hover { fill: gray }",
		);
		expect(rules.map((r) => [r.selector, r.specificity, r.decls])).toEqual([
			[{ kind: "class", name: "a" }, 10, { fill: "red" }],
			[{ kind: "id", name: "b" }, 100, { fill: "red" }],
			[{ kind: "type", name: "path" }, 1, { stroke: "blue" }],
		]);
	});
});
