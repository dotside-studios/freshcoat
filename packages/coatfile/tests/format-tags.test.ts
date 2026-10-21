import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { FORMAT_HISTORY, FORMAT_MINOR } from "../src/format";
import { formatHistory } from "../src/format-version";
import { schemaPaths } from "../src/format-walk";
import { TemplateSchema } from "../src/schemas";

// Every field, union member and enum value 1.0 had. Anything else in the
// schema needs a `since` tag; this list only changes when a 1.0 field goes.
const BASELINE = new Set(
	readFileSync(new URL("./format-baseline.txt", import.meta.url), "utf8")
		.split("\n")
		.filter(Boolean),
);

// Listed in FORMAT_HISTORY but found by minimumFormatVersion's overrides, not
// by a tag: 1.1 made them optional, so it is their absence that needs 1.1.
const OVERRIDDEN = ["1.1 product", "1.1 version"];

function untaggedOutsideBaseline(
	schema: z.core.$ZodType,
	baseline: Set<string>,
): string[] {
	return schemaPaths(schema)
		.filter((p) => !p.since && !baseline.has(p.path))
		.map((p) => p.path);
}

const next = `1.${FORMAT_MINOR + 1}`;
const tagHint = `In src/schemas.ts, tag a field or union member with .register(formatHistory, { since: "${next}" }) and an enum value with .register(formatHistory, { values: { name: "${next}" } }), then add it to FORMAT_HISTORY.`;

describe("format tags", () => {
	test("every field, member and value past the 1.0 baseline has a since tag", () => {
		const untagged = untaggedOutsideBaseline(TemplateSchema, BASELINE);
		if (untagged.length > 0)
			throw new Error(
				`Not in the 1.0 baseline (tests/format-baseline.txt) and not tagged with the minor that added it, so minimumFormatVersion cannot see it:\n  ${untagged.join("\n  ")}\n${tagHint}`,
			);
	});

	test("the baseline lists only untagged paths the schema has", () => {
		const untagged = new Set(
			schemaPaths(TemplateSchema)
				.filter((p) => !p.since)
				.map((p) => p.path),
		);
		expect([...BASELINE].filter((path) => !untagged.has(path))).toEqual([]);
	});

	test("an untagged addition is caught, a tagged one is not", () => {
		const baseline = new Set([".a"]);
		const schema = z.object({
			a: z.string(),
			b: z.number().optional(),
			c: z.number().optional().register(formatHistory, { since: "1.8" }),
		});
		expect(untaggedOutsideBaseline(schema, baseline)).toEqual([".b"]);
	});

	test("FORMAT_HISTORY lists every tag under its minor, and nothing else", () => {
		const tagged = new Set(
			schemaPaths(TemplateSchema)
				.filter((p) => p.feature !== undefined)
				.map((p) => `${p.since} ${p.feature}`),
		);
		for (const name of OVERRIDDEN) tagged.add(name);
		const listed = new Set(
			FORMAT_HISTORY.flatMap((text, minor) =>
				[...text.matchAll(/`([^`]+)`/g)].map((m) => `1.${minor} ${m[1]}`),
			),
		);
		expect([...tagged].filter((name) => !listed.has(name))).toEqual([]);
		expect([...listed].filter((name) => !tagged.has(name))).toEqual([]);
	});
});
