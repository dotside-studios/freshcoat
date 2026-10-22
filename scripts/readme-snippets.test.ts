import { afterAll, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";

// Typecheck-only test: the TypeScript blocks in each README's "Quick start"
// section must compile against the workspace sources. A block whose info
// string contains `no-check` (```ts no-check) is skipped.

const repo = resolve(import.meta.dir, "..");
const scratch = join(repo, "node_modules", ".cache");
mkdirSync(scratch, { recursive: true });
const work = mkdtempSync(join(scratch, "readme-snippets-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

// Names a quick start may use without defining, supplied as `any`.
const ASSUMED = ["template", "values", "renderer", "ck", "records", "fonts"];

export type Snippet = { line: number; code: string };

// TS blocks of the `## Quick start` section (up to the next `## ` heading).
export function extractSnippets(markdown: string): Snippet[] {
	const lines = markdown.split("\n");
	const out: Snippet[] = [];
	let inSection = false;
	let fence: { line: number; body: string[]; keep: boolean } | null = null;
	for (const [i, text] of lines.entries()) {
		if (fence) {
			if (/^```\s*$/.test(text)) {
				if (fence.keep)
					out.push({ line: fence.line, code: fence.body.join("\n") });
				fence = null;
			} else fence.body.push(text);
			continue;
		}
		const open = /^```(\S*)\s*(.*)$/.exec(text);
		if (open) {
			const lang = open[1] ?? "";
			const keep =
				inSection &&
				["ts", "typescript", "tsx"].includes(lang) &&
				!/\bno-check\b/.test(open[2] ?? "");
			fence = { line: i + 2, body: [], keep };
		} else if (/^## /.test(text)) inSection = /^## Quick start\s*$/.test(text);
	}
	return out;
}

function declares(code: string, name: string): boolean {
	const n = name.replace(/\$/g, "\\$");
	return (
		new RegExp(`\\b(?:const|let|var|function|class)\\s+${n}\\b`).test(code) ||
		new RegExp(
			`\\b(?:const|let|var)\\s*[{\\[][^=]*\\b${n}\\b[^=]*[}\\]]\\s*=`,
		).test(code) ||
		new RegExp(`\\bimport\\b[^;]*\\b${n}\\b[^;]*\\bfrom\\b`).test(code)
	);
}

function prelude(code: string): string {
	const used = ASSUMED.filter(
		(n) => new RegExp(`\\b${n}\\b`).test(code) && !declares(code, n),
	);
	return used.map((n) => `declare const ${n}: any;`).join("\n");
}

// `@freshcoat-js/<pkg>[/sub]` -> the file named by that package's `exports`.
function workspacePaths(): Record<string, string[]> {
	const paths: Record<string, string[]> = {};
	for (const dir of readdirSync(join(repo, "packages"))) {
		const file = join(repo, "packages", dir, "package.json");
		if (!existsSync(file)) continue;
		const pkg = JSON.parse(readFileSync(file, "utf8")) as {
			name?: string;
			exports?: Record<string, unknown> | string;
		};
		if (!pkg.name) continue;
		const exp =
			typeof pkg.exports === "string" ? { ".": pkg.exports } : pkg.exports;
		for (const [key, target] of Object.entries(exp ?? {})) {
			if (typeof target !== "string") continue;
			paths[join(pkg.name, key)] = [join(repo, "packages", dir, target)];
		}
	}
	return paths;
}

// Bun types are installed per package, so borrow the first package's.
function typeRoots(): string[] {
	for (const dir of readdirSync(join(repo, "packages")).sort()) {
		const root = join(repo, "packages", dir, "node_modules", "@types");
		if (existsSync(join(root, "bun"))) return [root];
	}
	return [];
}

function compilerOptions(): ts.CompilerOptions {
	const base = join(repo, "tsconfig.base.json");
	const read = ts.readConfigFile(base, ts.sys.readFile);
	const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, repo);
	return {
		...parsed.options,
		noEmit: true,
		skipLibCheck: true,
		// Snippets may leave results unused.
		noUnusedLocals: false,
		noUnusedParameters: false,
		types: ["bun"],
		typeRoots: typeRoots(),
		baseUrl: repo,
		paths: workspacePaths(),
	};
}

// Typechecks each snippet as its own module; returns formatted diagnostics.
export function checkSnippets(snippets: Snippet[]): string {
	if (snippets.length === 0) return "";
	const dir = mkdtempSync(join(work, "s-"));
	const files = snippets.map((s, i) => {
		const file = join(dir, `snippet-${i}.ts`);
		writeFileSync(file, `${prelude(s.code)}\n${s.code}\nexport {};\n`);
		return file;
	});
	const program = ts.createProgram(files, compilerOptions());
	const out: string[] = [];
	for (const [i, file] of files.entries()) {
		const sf = program.getSourceFile(file);
		const diags = [
			...program.getSyntacticDiagnostics(sf),
			...program.getSemanticDiagnostics(sf),
		];
		if (diags.length === 0) continue;
		const offset = prelude(snippets[i]?.code ?? "").split("\n").length;
		out.push(`block at README line ${snippets[i]?.line}:`);
		for (const d of diags) {
			const pos =
				d.file && d.start !== undefined
					? d.file.getLineAndCharacterOfPosition(d.start)
					: null;
			const where = pos ? `snippet line ${pos.line + 1 - offset}: ` : "";
			out.push(
				`  ${where}${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`,
			);
		}
	}
	return out.join("\n");
}

function readmes(): string[] {
	const found = ["README.md"];
	for (const dir of readdirSync(join(repo, "packages")).sort()) {
		const rel = join("packages", dir, "README.md");
		if (existsSync(join(repo, rel))) found.push(rel);
	}
	return found;
}

describe("README quick start snippets", () => {
	for (const rel of readmes()) {
		test(rel, () => {
			const snippets = extractSnippets(readFileSync(join(repo, rel), "utf8"));
			expect(checkSnippets(snippets), `${rel}`).toBe("");
		});
	}
});

describe("snippet checker", () => {
	const md = (body: string) => `## Quick start\n\n\`\`\`ts\n${body}\n\`\`\`\n`;

	test("extracts only TS blocks of the Quick start section", () => {
		const text = [
			"```ts",
			"outside();",
			"```",
			"## Quick start",
			"```sh",
			"npm i x",
			"```",
			"```typescript",
			"a();",
			"```",
			"```ts no-check",
			"skipped();",
			"```",
			"### Sub",
			"```tsx",
			"b();",
			"```",
			"## Other",
			"```ts",
			"c();",
			"```",
		].join("\n");
		expect(extractSnippets(text).map((s) => s.code)).toEqual(["a();", "b();"]);
		expect(extractSnippets("# T\n\nno section\n")).toEqual([]);
	});

	test("accepts a valid workspace import and assumed free names", () => {
		const [s] = extractSnippets(
			md(
				'import { createRenderer } from "@freshcoat-js/engine";\nconst r = await createRenderer({ ck });',
			),
		);
		expect(checkSnippets(s ? [s] : [])).toBe("");
	});

	test("reports type errors, unknown exports and unknown names", () => {
		const bad = [
			md('import { nope } from "@freshcoat-js/engine";\nnope();'),
			md("const n: number = 'x';"),
			md("missingThing();"),
		].flatMap(extractSnippets);
		const out = checkSnippets(bad);
		expect(out).toContain("nope");
		expect(out).toContain("not assignable");
		expect(out).toContain("missingThing");
	});
});
