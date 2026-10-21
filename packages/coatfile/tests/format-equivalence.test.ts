import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fixtures } from "../fixtures";
import {
	minimumFormatVersion,
	minimumFormatVersionFromSchema,
} from "../src/format";
import type { Template } from "../src/types";
import { caseTemplates } from "./helpers/format-cases";

const root = join(import.meta.dir, "..", "..", "..");

const jsonTemplates = (dir: string): [string, Template][] =>
	readdirSync(join(root, dir))
		.filter((file) => file.endsWith(".json"))
		.map((file): [string, unknown] => [
			`${dir}/${file}`,
			JSON.parse(readFileSync(join(root, dir, file), "utf8")),
		])
		.filter((entry): entry is [string, Template] => {
			const t = entry[1] as Partial<Template>;
			return Array.isArray(t.template_data);
		});

const templates: [string, Template][] = [
	...Object.entries(fixtures),
	...jsonTemplates("packages/coatfile/fixtures"),
	...jsonTemplates("packages/coatfile/tests/fixtures"),
	...jsonTemplates("apps/figma-plugin/src/lib/figma/transpiler/fixtures"),
	...caseTemplates(),
];

describe("schema tags agree with the hand-written detectors", () => {
	test.each(templates)("%s", (_name, template) => {
		expect(minimumFormatVersionFromSchema(template)).toBe(
			minimumFormatVersion(template),
		);
	});
});
