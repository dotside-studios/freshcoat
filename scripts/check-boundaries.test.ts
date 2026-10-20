import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	checkBoundaries,
	packageName,
	parseJsonc,
	scriptRefs,
	type Violation,
} from "./check-boundaries.ts";

let parent: string;
let root: string;

function write(path: string, content: string | object) {
	const full = join(root, path);
	mkdirSync(dirname(full), { recursive: true });
	writeFileSync(
		full,
		typeof content === "string" ? content : JSON.stringify(content, null, "\t"),
	);
}

const at = (vs: Violation[], file: string) =>
	vs.filter((v) => v.file === file).map((v) => `${v.line}: ${v.message}`);

beforeAll(() => {
	parent = mkdtempSync(join(tmpdir(), "boundaries-"));
	root = join(parent, "freshcoat");
	write("app/package.json", {
		name: "@freshcoat-js/app",
		dependencies: {
			"@freshcoat-js/coatfile": "workspace:*",
			"@freshcoat-js/lib": "workspace:*",
			react: "^19.0.0",
		},
		devDependencies: { "@types/bun": "^1.3.0", tailwindcss: "^4.0.0" },
	});
	write("lib/package.json", {
		name: "@freshcoat-js/lib",
		dependencies: {
			"@davi/ui": "workspace:*",
			"local-thing": "file:../../elsewhere",
		},
		scripts: {
			build: "bun ../../tools/build.ts",
			test: "bun ./run.ts",
		},
	});
	write(
		"app/src/ok.tsx",
		`// A comment that says import x from "left-pad" is not an import.
/* nor is require("left-pad") */
import { readFileSync } from "node:fs";
import { test } from "bun:test";
import React, { useState } from "react";
import { compile } from "@freshcoat-js/coatfile/render";
import { cn } from "@freshcoat-js/lib/cn";
import { helper } from "~/helper";
import GiftIcon from "~icons/mingcute/gift-2-line";
import css from "./style.css?inline";
import "./side-effect";
export { other } from "../src/other";
const prose = "import 'left-pad' is only text";
const re = /from "left-pad"/;
const view = <p>Don't import from "left-pad" here</p>;
const worker = new Worker(new URL("./worker.ts", import.meta.url));
const lazy = () => import("./lazy");
const tmpl = \`a \${"b"} c\`;
`,
	);
	write(
		"app/src/bad.ts",
		`import pad from "left-pad";
import type { Tier } from "@davi/api-client";
export * from "../../../outside/thing";
const later = await import("undeclared-dynamic");
const cjs = require("undeclared-cjs");
vi.mock("undeclared-mock");
const url = new URL("../../../../escape.png", import.meta.url);
type T = typeof import("undeclared-type");
import x from "https://example.com/x.js";
`,
	);
	write(
		"app/src/styles.css",
		`@import "tailwindcss";
@import "undeclared-css";
@source "../../lib/src";
@source "../../../packages/ui/src";
.a { background: url("../../../outside.png"); }
.b { background: url(data:image/png;base64,AAAA); }
`,
	);
	write(
		"app/index.html",
		`<script type="module" src="/src/main.tsx"></script>
<link rel="icon" href="../../favicon.svg" />
<a href="https://example.com">x</a>`,
	);
	write(
		"app/vite.config.ts",
		`import { fileURLToPath } from "node:url";
export default {
	resolve: { alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) } },
	server: { fs: { allow: ["../../packages"] } },
};
`,
	);
	write("app/tsconfig.json", {
		extends: "../../tsconfig.base.json",
		include: ["src/**/*.ts", "../lib/src/**/*.ts", "../../packages/x/**/*.ts"],
		compilerOptions: {
			types: ["bun", "vite/client"],
			baseUrl: ".",
			paths: { "~/*": ["./src/*"], "@x/*": ["../../packages/x/*"] },
		},
	});
	write(
		"app/biome.json",
		`{
	// JSONC is allowed here
	"extends": "//",
	"linter": { "enabled": true },
}`,
	);
	write("lib/biome.json", { extends: ["../app/biome.json"] });
	for (const name of ["engine", "workspace", "test-utils"])
		write(`packages/${name}/package.json`, { name: `@freshcoat-js/${name}` });
	write("packages/for-print/package.json", {
		name: "@freshcoat-js/for-print",
		dependencies: {
			"@freshcoat-js/engine": "workspace:*",
			"@freshcoat-js/workspace": "workspace:*",
		},
		devDependencies: { "@freshcoat-js/test-utils": "workspace:*" },
	});
	write("packages/for-print/src/ok.ts", `import { x } from "@freshcoat-js/engine";\n`);
	write("packages/for-print/src/up.ts", `import { y } from "@freshcoat-js/workspace";\n`);
	write("packages/ui/package.json", {
		name: "@freshcoat-js/ui",
		devDependencies: { "@freshcoat-js/coatfile": "workspace:*" },
	});
	write("packages/ui/src/a.ts", `import { z } from "@freshcoat-js/coatfile";\n`);
	write("packages/coatfile/package.json", {
		name: "@freshcoat-js/coatfile",
		dependencies: { "@freshcoat-js/test-utils": "workspace:*" },
	});
	for (const file of [
		"src/lib.ts",
		"src/lib.test.ts",
		"src/lib.spec.tsx",
		"tests/lib.ts",
		"e2e/lib.ts",
		"conformance/run.ts",
	])
		write(`packages/coatfile/${file}`, `import { f } from "@freshcoat-js/test-utils";\n`);
	write("scripts/tool.ts", `import { join } from "node:path";\nimport ts from "typescript";\n`);
});

afterAll(() => {
	rmSync(parent, { recursive: true, force: true });
});

describe("checkBoundaries", () => {
	test("allows relative paths, declared packages, the kits, builtins and aliases", () => {
		expect(at(checkBoundaries(root), "app/src/ok.tsx")).toEqual([]);
	});

	test("reports every kind of import that leaves freshcoat, by line", () => {
		expect(at(checkBoundaries(root), "app/src/bad.ts")).toEqual([
			'1: "left-pad" is not declared in app/package.json',
			'2: "@davi/api-client" is a monorepo package; only the three kits may be imported',
			'3: Path "../../../outside/thing" reaches outside the repository',
			'4: "undeclared-dynamic" is not declared in app/package.json',
			'5: "undeclared-cjs" is not declared in app/package.json',
			'6: "undeclared-mock" is not declared in app/package.json',
			'7: Path "../../../../escape.png" reaches outside the repository',
			'8: "undeclared-type" is not declared in app/package.json',
			'9: Import "https://example.com/x.js" is not a package or a path',
		]);
	});

	test("checks CSS imports, Tailwind sources and url()", () => {
		expect(at(checkBoundaries(root), "app/src/styles.css")).toEqual([
			'2: "undeclared-css" is not declared in app/package.json',
			'4: Path "../../../packages/ui/src" reaches outside the repository',
			'5: Path "../../../outside.png" reaches outside the repository',
		]);
	});

	test("checks HTML script and link sources", () => {
		expect(at(checkBoundaries(root), "app/index.html")).toEqual([
			'2: Path "../../favicon.svg" reaches outside the repository',
		]);
	});

	test("checks relative strings in Vite configs", () => {
		expect(at(checkBoundaries(root), "app/vite.config.ts")).toEqual([
			'4: Path "../../packages" reaches outside the repository',
		]);
	});

	test("checks tsconfig extends, include, paths and types", () => {
		expect(at(checkBoundaries(root), "app/tsconfig.json")).toEqual([
			'2: extends "../../tsconfig.base.json" reaches outside the repository',
			'6: Pattern "../../packages/x/**/*.ts" reaches outside the repository',
			'11: "vite" is not declared in app/package.json',
			'19: Path mapping "../../packages/x/*" reaches outside the repository',
		]);
	});

	test("checks Biome extends, including the root shorthand", () => {
		const vs = checkBoundaries(root);
		expect(at(vs, "app/biome.json")).toEqual([
			`3: extends "//" reaches the monorepo's root config`,
		]);
		expect(at(vs, "lib/biome.json")).toEqual([]);
	});

	test("checks package.json workspace and file dependencies, and script paths", () => {
		expect(at(checkBoundaries(root), "lib/package.json")).toEqual([
			'4: "@davi/ui" is a workspace package outside this repository',
			'5: Dependency "../../elsewhere" reaches outside the repository',
			'8: Script "build" path "../../tools/build.ts" reaches outside the repository',
		]);
	});

	test("a file outside every package may import builtins only", () => {
		expect(at(checkBoundaries(root), "scripts/tool.ts")).toEqual([
			'2: "typescript" is imported outside any freshcoat package',
		]);
	});

	test("allows an import along an allowed layering edge", () => {
		expect(at(checkBoundaries(root), "packages/for-print/src/ok.ts")).toEqual([]);
	});

	test("rejects an upward import and declaration", () => {
		const vs = checkBoundaries(root);
		expect(at(vs, "packages/for-print/src/up.ts")).toEqual([
			'1: "@freshcoat-js/workspace" may not be imported by @freshcoat-js/for-print, which depends on @freshcoat-js/engine',
		]);
		expect(at(vs, "packages/for-print/package.json")).toEqual([
			'5: "@freshcoat-js/workspace" is not an allowed dependency of @freshcoat-js/for-print, which depends on @freshcoat-js/engine',
		]);
	});

	test("ui may not depend on or import the core packages", () => {
		const vs = checkBoundaries(root);
		expect(at(vs, "packages/ui/src/a.ts")).toEqual([
			'1: "@freshcoat-js/coatfile" may not be imported by @freshcoat-js/ui, which depends on no internal package',
		]);
		expect(at(vs, "packages/ui/package.json")).toEqual([
			'4: "@freshcoat-js/coatfile" is not an allowed dependency of @freshcoat-js/ui, which depends on no internal package',
		]);
	});

	test("test-utils is a dev dependency imported by test files only", () => {
		const vs = checkBoundaries(root);
		expect(at(vs, "packages/coatfile/package.json")).toEqual([
			'4: "@freshcoat-js/test-utils" must be a devDependency only',
		]);
		expect(at(vs, "packages/for-print/package.json")).toEqual([
			expect.stringContaining("@freshcoat-js/workspace"),
		]);
		expect(at(vs, "packages/coatfile/src/lib.ts")).toEqual([
			'1: "@freshcoat-js/test-utils" is imported from non-test source; only test files may import it',
		]);
		for (const file of [
			"src/lib.test.ts",
			"src/lib.spec.tsx",
			"tests/lib.ts",
			"e2e/lib.ts",
			"conformance/run.ts",
		])
			expect(at(vs, `packages/coatfile/${file}`)).toEqual([]);
	});

	test("an exact-path exemption lets non-test source import test-utils", () => {
		const vs = checkBoundaries(root, {
			"packages/coatfile/src/lib.ts": "fixture reuse",
		});
		expect(at(vs, "packages/coatfile/src/lib.ts")).toEqual([]);
	});

	test("an exemption is stale when the file is gone or no longer imports test-utils", () => {
		const vs = checkBoundaries(root, {
			"packages/coatfile/missing.ts": "gone",
			"packages/for-print/src/ok.ts": "no import",
		});
		expect(at(vs, "packages/coatfile/missing.ts")).toEqual([
			'1: Exemption for "@freshcoat-js/test-utils" is stale: the file no longer exists',
		]);
		expect(at(vs, "packages/for-print/src/ok.ts")).toEqual([
			'1: Exemption for "@freshcoat-js/test-utils" is stale: the file no longer imports it',
		]);
	});

	test("the real tree passes", () => {
		expect(checkBoundaries(join(import.meta.dir, ".."))).toEqual([]);
	});
});

describe("scriptRefs", () => {
	test("finds multi-line imports and ignores `declare module`", () => {
		const refs = scriptRefs(`import {
	a,
	b,
} from "multi";
declare module "ambient" {}
export type { T } from "types-only";
`);
		expect(refs.map((r) => [r.spec, r.line])).toEqual([
			["multi", 4],
			["types-only", 6],
		]);
	});

	test("reads triple-slash type references", () => {
		const refs = scriptRefs(`/// <reference types="vite/client" />\n`);
		expect(refs).toEqual([{ spec: "vite/client", line: 1, kind: "types" }]);
	});

	test("keeps its place after template substitutions and regexes", () => {
		const refs = scriptRefs(
			"const a = `x ${`y ${1}`} z`;\nconst r = /['\"]/g;\nimport q from \"after\";\n",
		);
		expect(refs.map((r) => [r.spec, r.line])).toEqual([["after", 3]]);
	});
});

test("packageName keeps the scope", () => {
	expect(packageName("@freshcoat-js/coatfile/render")).toBe("@freshcoat-js/coatfile");
	expect(packageName("react-dom/client")).toBe("react-dom");
});

test("parseJsonc drops comments and trailing commas but not string contents", () => {
	expect(parseJsonc(`{ "a": "x, }", "b": [1, /* c */ ],\n// d\n}`)).toEqual({
		a: "x, }",
		b: [1],
	});
});
