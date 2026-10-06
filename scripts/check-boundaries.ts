// Fails when anything in this repository reaches outside it. Every import has
// to resolve to one of:
//   - a relative path that stays inside this repository;
//   - an npm package declared in the importing package's own package.json;
//   - one of the three core packages (coatfile, engine, for-print), declared;
//   - a Node or Bun builtin, or the `~/` and `~icons/` aliases.
// tsconfig, Vite, Vitest, Playwright and Biome configs, and package.json
// dependency specs and scripts, are held to the same rule.
//
// Usage: bun scripts/check-boundaries.ts [root]
//
// It depends on nothing but Bun, so it runs before `bun install` and in any
// checkout. Imports are found by a small tokenizer rather than a regex over
// raw text, so comments and prose in strings do not count.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isBuiltin } from "node:module";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

export const KITS = [
	"@freshcoat-js/coatfile",
	"@freshcoat-js/engine",
	"@freshcoat-js/for-print",
] as const;

export type Violation = { file: string; line: number; message: string };

const SKIP_DIRS = new Set([
	"node_modules",
	"dist",
	"test-results",
	"playwright-report",
	".git",
	".turbo",
]);
const CODE = /\.(?:[cm]?[jt]s|tsx|jsx)$/;
const CONFIG = /(?:^|[/\\])(?:vite|vitest|playwright)\.config\.[cm]?[jt]s$/;

type Pkg = {
	dir: string;
	name: string | undefined;
	deps: Map<string, string>;
};

type Ref = {
	spec: string;
	line: number;
	// "module" is resolved as an import; "path" is a file path only.
	kind: "module" | "path" | "types";
};

// ── Tokenizer ────────────────────────────────────────────────────────────────

type Token =
	| { t: "id"; v: string; line: number }
	| { t: "str"; v: string; line: number }
	| { t: "p"; v: string; line: number };

const REGEX_AFTER_WORD = new Set([
	"return",
	"typeof",
	"instanceof",
	"in",
	"of",
	"new",
	"delete",
	"void",
	"throw",
	"case",
	"do",
	"else",
	"yield",
	"await",
]);

// Strings and regex literals end at a newline even when unterminated, as
// TypeScript's scanner does, so an apostrophe in JSX text costs one line at
// most rather than derailing the rest of the file.
export function tokenize(src: string): {
	tokens: Token[];
	references: Ref[];
} {
	const tokens: Token[] = [];
	const references: Ref[] = [];
	const templateDepth: number[] = [];
	let braces = 0;
	let line = 1;
	let i = 0;
	const n = src.length;
	const last = () => tokens[tokens.length - 1];
	const regexAllowed = () => {
		const prev = last();
		if (!prev) return true;
		if (prev.t === "str") return false;
		if (prev.t === "id") return REGEX_AFTER_WORD.has(prev.v);
		return prev.v !== ")" && prev.v !== "]";
	};

	const readTemplate = () => {
		// i is just past a backtick or a closing `}` of a substitution.
		while (i < n) {
			const c = src[i];
			if (c === "\\") {
				i += 2;
				continue;
			}
			if (c === "\n") line++;
			if (c === "`") {
				i++;
				tokens.push({ t: "p", v: "`", line });
				return;
			}
			if (c === "$" && src[i + 1] === "{") {
				i += 2;
				templateDepth.push(braces);
				braces++;
				tokens.push({ t: "p", v: "${", line });
				return;
			}
			i++;
		}
	};

	while (i < n) {
		const c = src[i];
		if (c === "\n") {
			line++;
			i++;
			continue;
		}
		if (c === " " || c === "\t" || c === "\r") {
			i++;
			continue;
		}
		if (c === "/" && src[i + 1] === "/") {
			const end = src.indexOf("\n", i);
			const text = src.slice(i, end === -1 ? n : end);
			const ref = /^\/\/\/\s*<reference\s+(types|path)\s*=\s*["']([^"']+)["']/.exec(
				text,
			);
			if (ref)
				references.push({
					spec: ref[2],
					line,
					kind: ref[1] === "types" ? "types" : "path",
				});
			i = end === -1 ? n : end;
			continue;
		}
		if (c === "/" && src[i + 1] === "*") {
			const end = src.indexOf("*/", i + 2);
			const stop = end === -1 ? n : end + 2;
			for (let k = i; k < stop; k++) if (src[k] === "\n") line++;
			i = stop;
			continue;
		}
		if (c === '"' || c === "'") {
			let j = i + 1;
			let v = "";
			while (j < n && src[j] !== c && src[j] !== "\n") {
				if (src[j] === "\\") {
					v += src[j + 1] ?? "";
					j += 2;
					continue;
				}
				v += src[j];
				j++;
			}
			tokens.push({ t: "str", v, line });
			i = src[j] === c ? j + 1 : j;
			continue;
		}
		if (c === "`") {
			// A template with no substitutions is a string for our purposes.
			const start = i + 1;
			const tokenCount = tokens.length;
			const startLine = line;
			i++;
			readTemplate();
			const closed = tokens[tokens.length - 1];
			if (tokens.length === tokenCount + 1 && closed?.v === "`") {
				tokens.pop();
				tokens.push({ t: "str", v: src.slice(start, i - 1), line: startLine });
			}
			continue;
		}
		if (c === "/" && regexAllowed()) {
			let j = i + 1;
			let inClass = false;
			while (j < n && src[j] !== "\n") {
				const d = src[j];
				if (d === "\\") {
					j += 2;
					continue;
				}
				if (d === "[") inClass = true;
				else if (d === "]") inClass = false;
				else if (d === "/" && !inClass) break;
				j++;
			}
			j++;
			while (j < n && /[a-z]/i.test(src[j])) j++;
			tokens.push({ t: "p", v: "/re/", line });
			i = j;
			continue;
		}
		if (/[A-Za-z0-9_$]/.test(c)) {
			let j = i + 1;
			while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
			tokens.push({ t: "id", v: src.slice(i, j), line });
			i = j;
			continue;
		}
		if (c === "{") braces++;
		if (c === "}") {
			braces--;
			if (templateDepth.length && templateDepth[templateDepth.length - 1] === braces) {
				templateDepth.pop();
				i++;
				readTemplate();
				continue;
			}
		}
		tokens.push({ t: "p", v: c, line });
		i++;
	}
	return { tokens, references };
}

// ── Finding references ───────────────────────────────────────────────────────

export function scriptRefs(src: string): Ref[] {
	const { tokens, references } = tokenize(src);
	const refs = [...references];
	const at = (k: number) => tokens[k];
	const is = (k: number, t: Token["t"], v?: string) => {
		const tok = at(k);
		return !!tok && tok.t === t && (v === undefined || tok.v === v);
	};
	for (let k = 0; k < tokens.length; k++) {
		const tok = tokens[k];
		if (tok.t !== "id") continue;
		const afterDot = is(k - 1, "p", ".");
		// import "x"; import x from "x"; export { y } from "x"
		if (tok.v === "from" && is(k + 1, "str")) {
			refs.push({ spec: at(k + 1).v, line: at(k + 1).line, kind: "module" });
		} else if (tok.v === "import" && !afterDot && is(k + 1, "str")) {
			refs.push({ spec: at(k + 1).v, line: at(k + 1).line, kind: "module" });
		} else if (
			// import("x"), including `typeof import("x")` in types; require("x")
			(tok.v === "import" || tok.v === "require") &&
			!afterDot &&
			is(k + 1, "p", "(") &&
			is(k + 2, "str")
		) {
			refs.push({ spec: at(k + 2).v, line: at(k + 2).line, kind: "module" });
		} else if (
			// vi.mock("x"), vi.importActual("x")
			afterDot &&
			is(k - 2, "id", "vi") &&
			["mock", "doMock", "unmock", "importActual"].includes(tok.v) &&
			is(k + 1, "p", "(") &&
			is(k + 2, "str")
		) {
			refs.push({ spec: at(k + 2).v, line: at(k + 2).line, kind: "module" });
		} else if (
			// import.meta.glob("./x/*.ts")
			afterDot &&
			(tok.v === "glob" || tok.v === "globEager") &&
			is(k - 2, "id", "meta") &&
			is(k + 1, "p", "(") &&
			is(k + 2, "str")
		) {
			refs.push({ spec: at(k + 2).v, line: at(k + 2).line, kind: "path" });
		} else if (
			// new URL("./x", import.meta.url): workers, assets, config paths
			tok.v === "URL" &&
			is(k - 1, "id", "new") &&
			is(k + 1, "p", "(") &&
			is(k + 2, "str") &&
			is(k + 3, "p", ",") &&
			is(k + 4, "id", "import")
		) {
			refs.push({ spec: at(k + 2).v, line: at(k + 2).line, kind: "path" });
		}
	}
	return refs;
}

// Config files point at the filesystem through plain strings (aliases,
// roots, `resolve(__dirname, "..")`), so every relative string in one counts.
export function configPathRefs(src: string): Ref[] {
	return tokenize(src)
		.tokens.filter(
			(tok) => tok.t === "str" && /^\.\.?(?:[/\\]|$)/.test(tok.v),
		)
		.map((tok) => ({ spec: tok.v, line: tok.line, kind: "path" as const }));
}

export function cssRefs(src: string): Ref[] {
	const refs: Ref[] = [];
	const text = src.replace(/\/\*[\s\S]*?\*\//g, (m) =>
		m.replace(/[^\n]/g, " "),
	);
	const lines = text.split("\n");
	lines.forEach((l, idx) => {
		const line = idx + 1;
		for (const m of l.matchAll(
			/@import\s+(?:url\(\s*)?["']([^"']+)["']/g,
		))
			refs.push({ spec: m[1], line, kind: "module" });
		for (const m of l.matchAll(/@plugin\s+["']([^"']+)["']/g))
			refs.push({ spec: m[1], line, kind: "module" });
		for (const m of l.matchAll(
			/@(?:source|config|reference)\s+(?:not\s+)?["']([^"']+)["']/g,
		))
			refs.push({ spec: m[1], line, kind: "module" });
		for (const m of l.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
			if (/^(?:data:|https?:|#)/.test(m[1])) continue;
			refs.push({ spec: m[1], line, kind: "path" });
		}
	});
	return refs;
}

export function htmlRefs(src: string): Ref[] {
	const refs: Ref[] = [];
	src.split("\n").forEach((l, idx) => {
		for (const m of l.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/g)) {
			if (/^(?:[a-z]+:|\/\/|#)/i.test(m[1])) continue;
			refs.push({ spec: m[1], line: idx + 1, kind: "path" });
		}
	});
	return refs;
}

// ── Resolution rules ─────────────────────────────────────────────────────────

export function packageName(spec: string): string {
	const parts = spec.split("/");
	return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function isKit(name: string): boolean {
	return (KITS as readonly string[]).includes(name);
}

function inside(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep) && !/^[a-z]:/i.test(rel));
}

function typesName(name: string): string {
	return name.startsWith("@")
		? `@types/${name.slice(1).replace("/", "__")}`
		: `@types/${name}`;
}

type Ctx = {
	root: string;
	freshcoatPackages: Set<string>;
	violations: Violation[];
};

function report(ctx: Ctx, file: string, line: number, message: string) {
	ctx.violations.push({ file: relative(ctx.root, file), line, message });
}

function checkPath(
	ctx: Ctx,
	file: string,
	base: string,
	spec: string,
	line: number,
	what: string,
) {
	const clean = spec.replace(/[?#].*$/, "");
	// A glob or a pattern only counts up to its first wildcard.
	const literal = clean.split(/[*{[]/)[0];
	const target = resolve(base, literal);
	if (!inside(ctx.root, target))
		report(ctx, file, line, `${what} "${spec}" reaches outside the repository`);
}

function checkModule(
	ctx: Ctx,
	file: string,
	pkg: Pkg | undefined,
	ref: Ref,
) {
	const spec = ref.spec.replace(/[?#].*$/, "");
	if (ref.kind === "path" || /^\.\.?(?:\/|$)/.test(spec)) {
		checkPath(ctx, file, dirname(file), spec, ref.line, "Path");
		return;
	}
	if (spec.startsWith("/")) {
		// Vite resolves a root-absolute specifier against the package root.
		checkPath(ctx, file, pkg?.dir ?? ctx.root, `.${spec}`, ref.line, "Path");
		return;
	}
	if (spec === "~" || spec.startsWith("~/") || spec.startsWith("~icons/"))
		return;
	if (spec.startsWith("node:") || spec === "bun" || spec.startsWith("bun:"))
		return;
	if (ref.kind !== "types" && isBuiltin(spec)) return;
	if (/^[a-z][a-z0-9+.-]*:/i.test(spec)) {
		report(ctx, file, ref.line, `Import "${ref.spec}" is not a package or a path`);
		return;
	}
	const name = packageName(spec);
	if (pkg && name === pkg.name) return;
	if (name.startsWith("@davi/")) {
		report(
			ctx,
			file,
			ref.line,
			`"${name}" is a monorepo package; only the three kits may be imported`,
		);
		return;
	}
	const declared =
		pkg &&
		(pkg.deps.has(name) || (ref.kind === "types" && pkg.deps.has(typesName(name))));
	if (!declared) {
		report(
			ctx,
			file,
			ref.line,
			pkg
				? `"${name}" is not declared in ${relative(ctx.root, join(pkg.dir, "package.json"))}`
				: `"${name}" is imported outside any freshcoat package`,
		);
	}
}

function checkPackageJson(ctx: Ctx, pkg: Pkg, text: string) {
	const file = join(pkg.dir, "package.json");
	const json = JSON.parse(text) as {
		scripts?: Record<string, string>;
	};
	for (const [name, version] of pkg.deps) {
		const line = lineOf(text, `"${name}"`);
		if (version.startsWith("workspace:")) {
			if (!ctx.freshcoatPackages.has(name) && !isKit(name))
				report(
					ctx,
					file,
					line,
				`"${name}" is a workspace package outside this repository`,
				);
		} else if (/^(?:file|link|portal):/.test(version)) {
			checkPath(ctx, file, pkg.dir, version.replace(/^\w+:/, ""), line, "Dependency");
		}
	}
	for (const [name, command] of Object.entries(json.scripts ?? {})) {
		for (const word of command.split(/[\s=]+/)) {
			if (!/^\.\.?\//.test(word)) continue;
			checkPath(ctx, file, pkg.dir, word, lineOf(text, `"${name}"`), `Script "${name}" path`);
		}
	}
}

function checkTsconfig(ctx: Ctx, file: string, pkg: Pkg | undefined) {
	const text = readFileSync(file, "utf8");
	const json = parseJsonc(text) as {
		extends?: string | string[];
		include?: string[];
		exclude?: string[];
		files?: string[];
		references?: { path: string }[];
		compilerOptions?: {
			baseUrl?: string;
			rootDir?: string;
			rootDirs?: string[];
			typeRoots?: string[];
			types?: string[];
			paths?: Record<string, string[]>;
		};
	};
	const base = dirname(file);
	const path = (spec: string, what: string) =>
		checkPath(ctx, file, base, spec, lineOf(text, JSON.stringify(spec)), what);
	for (const ext of [json.extends ?? []].flat()) {
		if (/^\.\.?\//.test(ext) || ext.startsWith("/")) path(ext, "extends");
		else
			checkModule(ctx, file, pkg, {
				spec: ext,
				line: lineOf(text, JSON.stringify(ext)),
				kind: "module",
			});
	}
	for (const spec of [
		...(json.include ?? []),
		...(json.exclude ?? []),
		...(json.files ?? []),
	])
		path(spec, "Pattern");
	for (const r of json.references ?? []) path(r.path, "Reference");
	const co = json.compilerOptions ?? {};
	for (const dir of [co.baseUrl, co.rootDir, ...(co.rootDirs ?? []), ...(co.typeRoots ?? [])])
		if (dir) path(dir, "Directory");
	const pathBase = co.baseUrl ? resolve(base, co.baseUrl) : base;
	for (const targets of Object.values(co.paths ?? {}))
		for (const t of targets)
			checkPath(ctx, file, pathBase, t, lineOf(text, JSON.stringify(t)), "Path mapping");
	for (const t of co.types ?? [])
		checkModule(ctx, file, pkg, {
			spec: t,
			line: lineOf(text, JSON.stringify(t)),
			kind: "types",
		});
}

function checkBiome(ctx: Ctx, file: string, pkg: Pkg | undefined) {
	const text = readFileSync(file, "utf8");
	const json = parseJsonc(text) as { extends?: string | string[] };
	for (const ext of [json.extends ?? []].flat()) {
		const line = lineOf(text, JSON.stringify(ext));
		if (ext === "//") {
			// "//" is the enclosing root config, which must then be freshcoat's.
			if (!existsSync(join(ctx.root, "biome.json")) && !existsSync(join(ctx.root, "biome.jsonc")))
				report(ctx, file, line, `extends "//" reaches the monorepo's root config`);
		} else if (/^\.\.?\//.test(ext) || ext.startsWith("/"))
			checkPath(ctx, file, dirname(file), ext, line, "extends");
		else checkModule(ctx, file, pkg, { spec: ext, line, kind: "module" });
	}
}

// ── Walk ─────────────────────────────────────────────────────────────────────

function lineOf(text: string, needle: string): number {
	const at = text.indexOf(needle);
	return at === -1 ? 1 : text.slice(0, at).split("\n").length;
}

export function parseJsonc(text: string): unknown {
	let out = "";
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === '"') {
			let j = i + 1;
			while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
			out += text.slice(i, j + 1);
			i = j;
		} else if (c === "/" && text[i + 1] === "/") {
			while (i < text.length && text[i] !== "\n") i++;
			out += "\n";
		} else if (c === "/" && text[i + 1] === "*") {
			const end = text.indexOf("*/", i + 2);
			out += text.slice(i, end + 2).replace(/[^\n]/g, " ");
			i = end + 1;
		} else out += c;
	}
	return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

function* walk(dir: string): Generator<string> {
	for (const entry of readdirSync(dir)) {
		if (SKIP_DIRS.has(entry)) continue;
		const full = join(dir, entry);
		const st = statSync(full);
		if (st.isDirectory()) yield* walk(full);
		else yield full;
	}
}

function readPkg(dir: string): Pkg {
	const json = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
		name?: string;
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
		peerDependencies?: Record<string, string>;
		optionalDependencies?: Record<string, string>;
	};
	const deps = new Map<string, string>();
	for (const field of [
		json.peerDependencies,
		json.optionalDependencies,
		json.devDependencies,
		json.dependencies,
	])
		for (const [k, v] of Object.entries(field ?? {})) deps.set(k, v);
	return { dir, name: json.name, deps };
}

export function checkBoundaries(rootDir: string): Violation[] {
	const root = resolve(rootDir);
	const files = [...walk(root)];
	const pkgs = files
		.filter((f) => f.endsWith(`${sep}package.json`))
		.map((f) => readPkg(dirname(f)))
		.sort((a, b) => b.dir.length - a.dir.length);
	const ctx: Ctx = {
		root,
		freshcoatPackages: new Set(pkgs.flatMap((p) => (p.name ? [p.name] : []))),
		violations: [],
	};
	const owner = (file: string) =>
		pkgs.find((p) => inside(p.dir, file) && p.dir !== root) ??
		pkgs.find((p) => p.dir === root);

	for (const pkg of pkgs)
		checkPackageJson(ctx, pkg, readFileSync(join(pkg.dir, "package.json"), "utf8"));

	for (const file of files) {
		const pkg = owner(file);
		const base = file.slice(dirname(file).length + 1);
		if (/^tsconfig(?:\..+)?\.json$/.test(base)) {
			checkTsconfig(ctx, file, pkg);
			continue;
		}
		if (base === "biome.json" || base === "biome.jsonc") {
			checkBiome(ctx, file, pkg);
			continue;
		}
		let refs: Ref[];
		if (CODE.test(file) && !file.endsWith(".d.ts.map")) {
			const src = readFileSync(file, "utf8");
			refs = scriptRefs(src);
			if (CONFIG.test(file)) refs.push(...configPathRefs(src));
		} else if (file.endsWith(".css")) refs = cssRefs(readFileSync(file, "utf8"));
		else if (file.endsWith(".html")) {
			refs = htmlRefs(readFileSync(file, "utf8"));
			for (const ref of refs)
				checkModule(ctx, file, pkg, {
					...ref,
					spec: /^\.{0,2}\//.test(ref.spec) ? ref.spec : `./${ref.spec}`,
					kind: "module",
				});
			continue;
		} else continue;
		for (const ref of refs) checkModule(ctx, file, pkg, ref);
	}
	return ctx.violations.sort(
		(a, b) => a.file.localeCompare(b.file) || a.line - b.line,
	);
}

if (import.meta.main) {
	const root = resolve(process.argv[2] ?? join(import.meta.dir, ".."));
	const violations = checkBoundaries(root);
	for (const v of violations) console.error(`${v.file}:${v.line}: ${v.message}`);
	if (violations.length) {
		console.error(
			`\n${violations.length} boundary violation${violations.length === 1 ? "" : "s"} in ${root}`,
		);
		process.exit(1);
	}
	console.log(`Boundaries OK: nothing in ${basename(root)}/ reaches outside it`);
}
