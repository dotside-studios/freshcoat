#!/usr/bin/env bun
// Writes the JSON Schema for a template, derived from the zod schema that
// `validate` runs, so an editor can check a template as it is typed.
//
// The JSON Schema covers shape only. The cross-field rules (unique ids, frame
// names a variant override can resolve, mustache references with a field
// behind them) live in `validate`, and a template that passes the schema can
// still fail those.
//
//   bun run schema          # regenerate it
//   bun run schema:check    # exit 1 on drift

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { templateJsonSchema } from "../src/json-schema";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = "coatfile.v1.schema.json";
const TARGETS = [join(PACKAGE_ROOT, "schema", FILE)];

const expected = `${JSON.stringify(templateJsonSchema(), null, "\t")}\n`;
const check = process.argv.includes("--check");

let drifted = false;
for (const target of TARGETS) {
	const current = existsSync(target) ? readFileSync(target, "utf8") : null;
	if (current === expected) continue;
	if (check) {
		console.error(`drift  ${target.slice(PACKAGE_ROOT.length + 1)}`);
		drifted = true;
		continue;
	}
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, expected);
	console.log(`wrote  ${target.slice(PACKAGE_ROOT.length + 1)}`);
}

if (drifted) {
	console.error("Run: bun run schema");
	process.exit(1);
}
