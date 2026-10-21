import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	spliceHistoryComment,
	spliceHistoryTable,
} from "../scripts/format-history";
import { FORMAT_HISTORY, minimumFormatVersion } from "../src/format";
import type { Element } from "../src/types";
import {
	base,
	cases,
	deltaTemplate,
	frame,
	nested,
	withElement,
} from "./helpers/format-cases";

// Each minor's backticked names, from FORMAT_HISTORY.
const listedNames = (): Map<number, Set<string>> =>
	new Map(
		FORMAT_HISTORY.map((text, minor) => [
			minor,
			new Set([...text.matchAll(/`([^`]+)`/g)].map((m) => m[1] as string)),
		]),
	);

const read = (path: string) =>
	readFileSync(new URL(path, import.meta.url), "utf8");

const baseMinor = (element: Element) =>
	Number(minimumFormatVersion(withElement(element)).split(".")[1]);

describe("format history", () => {
	test("README.md and src/format.ts match FORMAT_HISTORY", () => {
		const hint = "run `bun run schema` in packages/coatfile";
		expect(
			read("../README.md") === spliceHistoryTable(read("../README.md")),
			`README.md is out of date: ${hint}`,
		).toBe(true);
		expect(
			read("../src/format.ts") ===
				spliceHistoryComment(read("../src/format.ts")),
			`src/format.ts is out of date: ${hint}`,
		).toBe(true);
	});

	test("every listed field has a detection case, and every case is listed", () => {
		const listed = [...listedNames()].flatMap(([minor, fields]) =>
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
