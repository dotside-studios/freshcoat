import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { fixtures } from "../fixtures";
import { FORMAT_MINOR, minimumFormatVersion } from "../src/format";
import type { Element, Template } from "../src/types";

// Each minor's backticked names, from the history comment in format.ts and
// the README's "Format versions" table.
function historyComment(): Map<number, Set<string>> {
	const source = readFileSync(
		new URL("../src/format.ts", import.meta.url),
		"utf8",
	);
	const byMinor = new Map<number, string>();
	let minor: number | undefined;
	for (const line of source.split("\n")) {
		const entry = /^\/\/ {3}1\.(\d+) {2}(.*)$/.exec(line);
		if (entry) {
			minor = Number(entry[1]);
			byMinor.set(minor, entry[2]);
		} else if (minor !== undefined && /^\/\/ {8}/.test(line)) {
			byMinor.set(minor, `${byMinor.get(minor)} ${line.slice(2).trim()}`);
		} else if (minor !== undefined) {
			break;
		}
	}
	return names(byMinor);
}

function readmeTable(): Map<number, Set<string>> {
	const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
	const byMinor = new Map<number, string>();
	for (const line of readme.split("\n")) {
		const row = /^\| 1\.(\d+) \| (.*) \|$/.exec(line);
		if (row) byMinor.set(Number(row[1]), row[2]);
	}
	return names(byMinor);
}

function names(byMinor: Map<number, string>): Map<number, Set<string>> {
	return new Map(
		[...byMinor].map(([minor, text]) => [
			minor,
			new Set([...text.matchAll(/`([^`]+)`/g)].map((m) => m[1])),
		]),
	);
}

const base = (): Template => structuredClone(fixtures.minimalCard);

const el = (
	type: string,
	properties: Record<string, unknown>,
	shell: Record<string, unknown> = {},
	id = "x",
): Element =>
	({
		id,
		type,
		pos: { x: 0, y: 0 },
		size: { width: 10, height: 10 },
		properties,
		...shell,
	}) as Element;

const rect = (properties: Record<string, unknown> = {}, shell = {}) =>
	el("rect", { fill: "#000", ...properties }, shell);
const vector = (properties: Record<string, unknown> = {}, id = "x") =>
	el("vector", { d: "M0 0L10 10", ...properties }, {}, id);
const frame = (properties: Record<string, unknown> = {}, id = "x") =>
	el("frame", { children: [], ...properties }, {}, id);
const image = (properties: Record<string, unknown> = {}) =>
	el("image", { src: "a.png", fit: "cover", ...properties });
const text = (properties: Record<string, unknown> = {}) =>
	el("text", { value: "Hi", font: { family: "A", size: 10 }, ...properties });
const barcode = (properties: Record<string, unknown> = {}) =>
	el("barcode", { value: "1", symbology: "itf14", ...properties });
const qr = (properties: Record<string, unknown> = {}) =>
	el("qr_code", { value: "1", ...properties });

const gradient = {
	kind: "linear",
	angle: 0,
	stops: [
		{ offset: 0, color: "#000" },
		{ offset: 1, color: "#fff" },
	],
};

type Case = { minor: number; field: string } & (
	| { template: (t: Template) => void }
	| { element: Element }
	| {
			delta: {
				base: Element;
				properties?: Record<string, unknown>;
				shell?: Record<string, unknown>;
			};
	  }
);

const cases: Case[] = [
	{ minor: 1, field: "product", template: (t) => delete t.product },
	{ minor: 1, field: "version", template: (t) => delete t.version },
	{ minor: 1, field: "$schema", template: (t) => (t.$schema = "x") },

	{
		minor: 2,
		field: "from",
		element: rect({ fill: { ...gradient, from: [0, 0] } }),
	},
	{
		minor: 2,
		field: "to",
		element: rect({ fill: [{ ...gradient, to: [1, 1] }] }),
	},
	{
		minor: 2,
		field: "constraints",
		element: rect({}, { constraints: { horizontal: "end" } }),
	},

	{ minor: 3, field: "barcode", element: barcode() },

	{
		minor: 4,
		field: "pos",
		delta: { base: rect(), shell: { pos: { x: 1, y: 1 } } },
	},
	{
		minor: 4,
		field: "size",
		delta: { base: rect(), shell: { size: { width: 1, height: 1 } } },
	},
	{
		minor: 4,
		field: "rotation",
		delta: { base: rect(), shell: { rotation: 45 } },
	},
	{
		minor: 4,
		field: "opacity",
		delta: { base: rect(), shell: { opacity: 0.5 } },
	},
	{
		minor: 4,
		field: "hidden",
		delta: { base: rect(), shell: { hidden: true } },
	},

	{
		minor: 5,
		field: "grid",
		element: frame({ layout: { type: "grid", columns: [10] } }),
	},
	{
		minor: 5,
		field: "grid",
		delta: {
			base: frame(),
			properties: { layout: { type: "grid", columns: [10] } },
		},
	},
	{
		minor: 5,
		field: "grid",
		element: rect({}, { layoutChild: { column: 1 } }),
	},
	{
		minor: 5,
		field: "grid",
		element: rect({}, { layoutChild: { row: [1, 2] } }),
	},
	{
		minor: 5,
		field: "adjust",
		element: rect({}, { adjust: { contrast: 1.2 } }),
	},
	{ minor: 5, field: "focus", element: image({ focus: [0.2, 0.8] }) },
	{
		minor: 5,
		field: "focus",
		delta: { base: image(), properties: { focus: "0.2,0.8" } },
	},
	{
		minor: 5,
		field: "crop",
		element: image({ crop: { x: 0, y: 0, width: 0.5, height: 0.5 } }),
	},
	{
		minor: 5,
		field: "crop",
		delta: {
			base: image(),
			properties: { crop: { x: 0, y: 0, width: 0.5, height: 0.5 } },
		},
	},
	{ minor: 5, field: "bleed", template: (t) => (t.bleed = 3) },
	{ minor: 5, field: "safeArea", template: (t) => (t.safeArea = 3) },
	{ minor: 5, field: "justify", element: text({ align: "justify" }) },
	{ minor: 5, field: "start", element: text({ align: "start" }) },
	{ minor: 5, field: "end", element: text({ align: "end" }) },
	{
		minor: 5,
		field: "end",
		delta: { base: text(), properties: { align: "end" } },
	},
	{ minor: 5, field: "alignLast", element: text({ alignLast: "center" }) },
	{ minor: 5, field: "direction", element: text({ direction: "rtl" }) },
	{
		minor: 5,
		field: "direction",
		delta: { base: text(), properties: { direction: "rtl" } },
	},
	{
		minor: 5,
		field: "paragraphSpacing",
		element: text({ paragraphSpacing: 4 }),
	},
	{
		minor: 5,
		field: "features",
		element: text({ font: { family: "A", size: 10, features: { tnum: 1 } } }),
	},
	{
		minor: 5,
		field: "features",
		element: text({ spans: [{ text: "1", font: { features: { tnum: 1 } } }] }),
	},
	{
		minor: 5,
		field: "cornerRadius",
		element: frame({ cornerRadius: [1, 2, 3, 4] }),
	},
	{
		minor: 5,
		field: "cornerRadius",
		delta: { base: frame(), properties: { cornerRadius: [1, 2, 3, 4] } },
	},
	{
		minor: 5,
		field: "linear-burn",
		element: rect({}, { blendMode: "linear-burn" }),
	},
	{ minor: 5, field: "bearerBars", element: barcode({ bearerBars: "frame" }) },
	{
		minor: 5,
		field: "bearerBars",
		delta: { base: barcode(), properties: { bearerBars: "frame" } },
	},

	{ minor: 6, field: "isolate", element: frame({ isolate: true }) },
	{
		minor: 6,
		field: "isolate",
		delta: { base: frame(), properties: { isolate: true } },
	},
	{ minor: 6, field: "arc", element: text({ arc: {} }) },
	{ minor: 6, field: "arc", delta: { base: text(), properties: { arc: {} } } },
	{ minor: 6, field: "path", element: text({ path: { d: "M0 0L10 0" } }) },
	{
		minor: 6,
		field: "path",
		delta: { base: text(), properties: { path: { ref: "v" } } },
	},
	{ minor: 6, field: "backdropBlur", element: rect({}, { backdropBlur: 4 }) },
	{
		minor: 6,
		field: "color",
		element: rect({ stroke: { color: gradient, width: 1 } }),
	},
	{
		minor: 6,
		field: "color",
		delta: {
			base: rect(),
			properties: { stroke: { color: gradient, width: 1 } },
		},
	},
	{
		minor: 6,
		field: "size",
		template: (t) =>
			(t.variants = [
				{ id: "v", label: "V", size: { width: 1, height: 1 }, overrides: [] },
			]),
	},
	{
		minor: 6,
		field: "boolean",
		element: vector({ boolean: { op: "union", operands: [rect()] } }),
	},
	{
		minor: 6,
		field: "boolean",
		delta: {
			base: vector(),
			properties: { boolean: { op: "union", operands: [] } },
		},
	},

	{ minor: 7, field: "slice", element: rect({ slice: {} }) },
	{ minor: 7, field: "slice", element: vector({ slice: {} }) },
	{
		minor: 7,
		field: "slice",
		delta: { base: rect(), properties: { slice: {} } },
	},
	{ minor: 7, field: "hidden", element: rect({}, { hidden: true }) },
	{
		minor: 7,
		field: "stroke",
		element: text({ stroke: { color: "#000", width: 1 } }),
	},
	{
		minor: 7,
		field: "stroke",
		delta: {
			base: text(),
			properties: { stroke: { color: "#000", width: 1 } },
		},
	},
	{ minor: 7, field: "pdfText", element: text({ pdfText: "outline" }) },
	{
		minor: 7,
		field: "pdfText",
		delta: { base: text(), properties: { pdfText: "outline" } },
	},
	{
		minor: 7,
		field: "cornerSmoothing",
		element: frame({ cornerSmoothing: 0.6 }),
	},
	{
		minor: 7,
		field: "cornerSmoothing",
		element: image({ cornerSmoothing: 0.6 }),
	},
	{
		minor: 7,
		field: "cornerSmoothing",
		delta: { base: frame(), properties: { cornerSmoothing: 0.6 } },
	},
	{
		minor: 7,
		field: "cornerSmoothing",
		delta: { base: image(), properties: { cornerSmoothing: 0.6 } },
	},
	{
		minor: 7,
		field: "cornerRadius",
		element: image({ cornerRadius: [1, 2, 3, 4] }),
	},
	{
		minor: 7,
		field: "cornerRadius",
		delta: { base: image(), properties: { cornerRadius: [1, 2, 3, 4] } },
	},
	{
		minor: 7,
		field: "width",
		element: rect({
			stroke: {
				color: "#000",
				width: { top: 1, right: 0, bottom: 1, left: 0 },
			},
		}),
	},
	{
		minor: 7,
		field: "width",
		element: frame({
			stroke: {
				color: "#000",
				width: { top: 1, right: 0, bottom: 1, left: 0 },
			},
		}),
	},
	{
		minor: 7,
		field: "width",
		delta: {
			base: rect(),
			properties: {
				stroke: {
					color: "#000",
					width: { top: 1, right: 0, bottom: 1, left: 0 },
				},
			},
		},
	},
	{
		minor: 7,
		field: "effects",
		element: rect({}, { effects: [{ type: "blur", radius: 2 }] }),
	},
	{
		minor: 7,
		field: "grain",
		element: rect({}, { effects: [{ type: "grain", amount: 0.2 }] }),
	},
	{
		minor: 7,
		field: "halftone",
		element: rect({}, { effects: [{ type: "halftone", cellSize: 4 }] }),
	},
	{
		minor: 7,
		field: "anchor",
		element: rect(
			{},
			{ effects: [{ type: "halftone", cellSize: 4, anchor: "element" }] },
		),
	},
	{ minor: 7, field: "spot", element: rect({ spot: {} }) },
	{ minor: 7, field: "spot", element: vector({ spot: {} }) },
	{
		minor: 7,
		field: "spot",
		delta: { base: rect(), properties: { spot: {} } },
	},
	{ minor: 7, field: "quietZone", element: qr({ quietZone: 2 }) },
	{ minor: 7, field: "moduleShape", element: qr({ moduleShape: "dot" }) },
	{ minor: 7, field: "finderOuter", element: qr({ finderOuter: "circle" }) },
	{ minor: 7, field: "finderInner", element: qr({ finderInner: "dot" }) },
	{ minor: 7, field: "gradient", element: qr({ gradient }) },
	{ minor: 7, field: "logo", element: qr({ logo: { src: "a.png" } }) },
	{
		minor: 7,
		field: "logo",
		delta: { base: qr(), properties: { logo: { src: "a.png" } } },
	},
];

const withElement = (element: Element): Template => {
	const t = base();
	t.template_data[0].elements.push(element);
	return t;
};

const nested = (element: Element): [string, Template, number][] => [
	["in a frame", withElement(frame({ children: [element] }, "wrap")), 0],
	[
		"in a mask's children",
		withElement(el("mask", { mask: rect(), children: [element] }, {}, "wrap")),
		0,
	],
	[
		"as a mask's shape",
		withElement(el("mask", { mask: element, children: [] }, {}, "wrap")),
		0,
	],
	[
		"as a boolean operand",
		withElement(
			vector({ boolean: { op: "union", operands: [element] } }, "wrap"),
		),
		6,
	],
	[
		"as a variant's background",
		(() => {
			const t = base();
			t.variants = [
				{
					id: "v",
					label: "V",
					overrides: [{ name: "front", background: element as never }],
				},
			];
			return t;
		})(),
		0,
	],
];

const deltaTemplate = (
	{
		base: target,
		properties = {},
		shell = {},
	}: {
		base: Element;
		properties?: Record<string, unknown>;
		shell?: Record<string, unknown>;
	},
	wrap: (e: Element) => Element = (e) => e,
): Template => {
	const t = withElement(wrap(target));
	t.variants = [
		{
			id: "v",
			label: "V",
			overrides: [
				{
					name: "front",
					elements: [{ id: target.id, properties, ...shell }],
				},
			],
		},
	];
	return t;
};

const baseMinor = (element: Element) =>
	Number(minimumFormatVersion(withElement(element)).split(".")[1]);

describe("format history", () => {
	test("the README table lists what the history comment lists", () => {
		expect(readmeTable()).toEqual(historyComment());
	});

	test("the history comment ends at FORMAT_MINOR", () => {
		expect(Math.max(...historyComment().keys())).toBe(FORMAT_MINOR);
	});

	test("every listed field has a detection case, and every case is listed", () => {
		const listed = [...historyComment()].flatMap(([minor, fields]) =>
			[...fields].map((field) => `1.${minor} ${field}`),
		);
		const covered = new Set(cases.map((c) => `1.${c.minor} ${c.field}`));
		expect(listed.filter((key) => !covered.has(key))).toEqual([]);
		expect([...covered].filter((key) => !listed.includes(key))).toEqual([]);
	});
});

describe.each(cases)("1.$minor $field", (c) => {
	const expected = `1.${c.minor}`;

	if ("template" in c) {
		test("on the template", () => {
			const t = base();
			c.template(t);
			expect(minimumFormatVersion(t)).toBe(expected);
		});
	}

	if ("element" in c) {
		test("on an element", () => {
			expect(minimumFormatVersion(withElement(c.element))).toBe(expected);
		});
		test.each(nested(c.element))("%s", (_where, t, floor) => {
			expect(minimumFormatVersion(t)).toBe(`1.${Math.max(c.minor, floor)}`);
		});
	}

	if ("delta" in c) {
		test("in a variant delta", () => {
			expect(baseMinor(c.delta.base)).toBeLessThan(c.minor);
			expect(minimumFormatVersion(deltaTemplate(c.delta))).toBe(expected);
		});
		test("in a variant delta on a frame's child", () => {
			expect(
				minimumFormatVersion(
					deltaTemplate(c.delta, (e) => frame({ children: [e] }, "wrap")),
				),
			).toBe(expected);
		});
	}
});
