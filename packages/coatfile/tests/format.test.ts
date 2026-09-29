import { describe, expect, test } from "vitest";
import { fixtures } from "../fixtures";
import {
	FORMAT_VERSION,
	minimumFormatVersion,
	raiseFormatVersion,
} from "../src/format";
import type { Element, Template } from "../src/types";
import { validate } from "../src/validate";

const base = (): Template => structuredClone(fixtures.minimalCard);

const withElements = (t: Template, ...elements: Element[]): Template => {
	t.template_data[0].elements.push(...elements);
	return t;
};

const rect = (id: string, extra: Partial<Element> = {}): Element =>
	({
		id,
		type: "rect",
		pos: { x: 0, y: 0 },
		size: { width: 10, height: 10 },
		properties: { fill: "#000" },
		...extra,
	}) as Element;

describe("minimumFormatVersion", () => {
	test("a 1.0 template needs 1.0", () => {
		expect(minimumFormatVersion(base())).toBe("1.0");
	});

	test("1.1: $schema, or a missing product or version", () => {
		expect(minimumFormatVersion({ ...base(), $schema: "x" })).toBe("1.1");
		const { product: _p, ...noProduct } = base();
		expect(minimumFormatVersion(noProduct)).toBe("1.1");
		const { version: _v, ...noVersion } = base();
		expect(minimumFormatVersion(noVersion)).toBe("1.1");
	});

	test("1.2: linear fill points, at any depth", () => {
		const gradient = {
			kind: "linear" as const,
			angle: 0,
			from: [0, 0] as [number, number],
			to: [1, 1] as [number, number],
			stops: [
				{ offset: 0, color: "#000" },
				{ offset: 1, color: "#fff" },
			],
		};
		const nested = withElements(base(), {
			id: "f",
			type: "frame",
			properties: {
				children: [rect("r", { properties: { fill: [gradient] } } as never)],
			},
		} as Element);
		expect(minimumFormatVersion(nested)).toBe("1.2");

		const bg = base();
		bg.template_data[0].background.properties = { fill: gradient } as never;
		expect(minimumFormatVersion(bg)).toBe("1.2");

		const angleOnly = { ...gradient, from: undefined, to: undefined };
		const plain = base();
		plain.template_data[0].background.properties = { fill: angleOnly } as never;
		expect(minimumFormatVersion(plain)).toBe("1.0");
	});

	test("1.2: element constraints, inside a mask too", () => {
		const t = withElements(base(), {
			id: "m",
			type: "mask",
			properties: {
				mask: rect("shape", { constraints: { horizontal: "stretch" } }),
				children: [],
			},
		} as Element);
		expect(minimumFormatVersion(t)).toBe("1.2");
	});

	test("1.3: a barcode element", () => {
		const t = withElements(base(), {
			id: "b",
			type: "barcode",
			pos: { x: 0, y: 0 },
			size: { width: 100, height: 40 },
			properties: { value: "123", symbology: "code128" },
		} as Element);
		expect(minimumFormatVersion(t)).toBe("1.3");
	});

	test("1.4: variant deltas; a properties-only override stays older", () => {
		const t = base();
		const id = t.template_data[0].elements[0].id;
		t.variants = [
			{
				id: "dark",
				label: "Dark",
				overrides: [
					{ name: "front", elements: [{ id, properties: { color: "#fff" } }] },
				],
			},
		];
		expect(minimumFormatVersion(t)).toBe("1.0");
		const delta = t.variants[0].overrides[0].elements?.[0];
		if (delta) delta.hidden = true;
		expect(minimumFormatVersion(t)).toBe("1.4");
	});

	test("the highest feature wins", () => {
		const t = withElements(
			{ ...base(), $schema: "x" },
			rect("c", { constraints: { vertical: "end" } }),
			{
				id: "b",
				type: "barcode",
				properties: { value: "1", symbology: "code128" },
			} as Element,
		);
		expect(minimumFormatVersion(t)).toBe("1.3");
	});

	test("never exceeds what this kit writes", () => {
		expect(
			minimumFormatVersion(fixtures.fullFeatureCard) <= FORMAT_VERSION,
		).toBe(true);
	});
});

describe("raiseFormatVersion", () => {
	test("raises an old label to what the fields need", () => {
		const t = withElements({ ...base(), format_version: "1.2" }, {
			id: "b",
			type: "barcode",
			properties: { value: "1", symbology: "code128" },
		} as Element);
		const raised = raiseFormatVersion(t);
		expect(raised.format_version).toBe("1.3");
		expect(t.format_version).toBe("1.2");
		expect(validate(raised).ok).toBe(true);
	});

	test("never lowers, and returns the same object when nothing changes", () => {
		const t = { ...base(), format_version: "1.4" };
		expect(raiseFormatVersion(t)).toBe(t);
		const same = base();
		expect(raiseFormatVersion(same)).toBe(same);
	});

	test("leaves a newer or unsupported version alone", () => {
		const newer = { ...base(), $schema: "x", format_version: "1.99" };
		expect(raiseFormatVersion(newer)).toBe(newer);
		const other = { ...base(), $schema: "x", format_version: "2.0" };
		expect(raiseFormatVersion(other)).toBe(other);
	});
});
