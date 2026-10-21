#!/usr/bin/env bun
// Writes the JSON Schema for a template, derived from the zod schema that
// `validate` runs, so an editor can check a template as it is typed. Also
// writes the format history (README table, comment in src/format.ts) from
// FORMAT_HISTORY.
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
import { spliceHistoryComment, spliceHistoryTable } from "./format-history";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = "coatfile.v1.schema.json";
const check = process.argv.includes("--check");

const schemaText = `${JSON.stringify(templateJsonSchema(), null, "\t")}\n`;
const TARGETS: { path: string; build: (current: string) => string }[] = [
	{ path: join(PACKAGE_ROOT, "schema", FILE), build: () => schemaText },
	{ path: join(PACKAGE_ROOT, "README.md"), build: spliceHistoryTable },
	{ path: join(PACKAGE_ROOT, "src", "format.ts"), build: spliceHistoryComment },
];

let drifted = false;
for (const { path: target, build } of TARGETS) {
	const current = existsSync(target) ? readFileSync(target, "utf8") : null;
	const expected = build(current ?? "");
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
