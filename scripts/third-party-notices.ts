#!/usr/bin/env bun
/**
 * Writes THIRD_PARTY_NOTICES.md from what is installed: the production
 * dependency closure of @freshcoat/editor, @freshcoat/figma-plugin,
 * @freshcoat/ui and @freshcoat/workspace, plus the assets they bundle that npm
 * does not list.
 *
 *   bun scripts/third-party-notices.ts           write the file
 *   bun scripts/third-party-notices.ts --check   fail if the file is stale
 *
 * A package whose license is missing, or not one this script knows, fails the
 * run: a new license is a decision for a person, not something to pass over.
 */
import {
	existsSync,
	readdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const OUTPUT = join(ROOT, "THIRD_PARTY_NOTICES.md");
const PACKAGES = [
	"apps/editor",
	"apps/figma-plugin",
	"packages/ui",
	"packages/workspace",
];

/** Freshcoat's own kits: Apache-2.0 packages in the same repository, with their
 *  own LICENSE and NOTICE, so neither listed nor counted as third party. Their
 *  own dependencies are still walked, since Freshcoat's build bundles them. */
const KITS: Record<string, string> = {
	"@freshcoat/coatfile": "compiles templates, QR codes and barcodes",
	freshcoat: "the coat engine, which lays out and paints with CanvasKit",
	"@freshcoat/for-print":
		"the card printer path: photo analysis and the finish",
};
const OWN_SCOPE = "@freshcoat/";

type LicenseRule = {
	/** Whether redistribution must carry the license text or notice. */
	text: boolean;
};

/** Every license this project accepts. Anything else fails the run. */
const LICENSES: Record<string, LicenseRule> = {
	MIT: { text: true },
	ISC: { text: true },
	"BSD-2-Clause": { text: true },
	"BSD-3-Clause": { text: true },
	"Apache-2.0": { text: true },
	"OFL-1.1": { text: true },
	"BlueOak-1.0.0": { text: true },
	"Python-2.0": { text: true },
	"CC-BY-4.0": { text: true },
	Zlib: { text: true },
	"0BSD": { text: false },
	"CC0-1.0": { text: false },
	Unlicense: { text: false },
};

/**
 * Packages that ship no license file, each reviewed by hand, and the installed
 * package whose license file covers them.
 */
const LICENSE_FILE_FROM: Record<
	string,
	{ from?: string; file?: string; why: string }
> = {
	"client-only": {
		from: "react",
		why: "published by the React team from the React repository, under React's license",
	},
	"natural-compare-lite": {
		file: "legal/third-party/natural-compare-lite-LICENSE",
		why: "its 1.4.0 npm archive points to this MIT license from its README but does not include the license file",
	},
};

type Entry = {
	name: string;
	version: string;
	license: string;
	repository: string;
	/** Where it comes from, for entries that are not an npm package. */
	source?: string;
	licenseText?: string;
	/** Why the license text comes from somewhere other than the package. */
	licenseNote?: string;
	noticeText?: string;
};

/** Assets bundled from files rather than through an npm package's entry. */
const BUNDLED_ASSETS: Array<{
	name: string;
	version: string;
	license: string;
	repository: string;
	source: string;
	licenseFile: string;
}> = [
	{
		name: "Vend Sans",
		version: "variable, Latin subset",
		license: "OFL-1.1",
		repository: "https://fonts.google.com/specimen/Vend+Sans",
		source: "apps/editor/src/samples/fonts/VendSans-Variable-latin.woff2",
		licenseFile: "apps/editor/src/samples/fonts/OFL.txt",
	},
];

/** npm packages whose files are bundled as assets, named in the summary. */
const BUNDLED_PACKAGES: Record<string, string> = {
	"@fontsource-variable/inter": "Inter, the interface font",
	"@fontsource-variable/jetbrains-mono": "JetBrains Mono, for code and numbers",
	"canvaskit-wasm": "CanvasKit, Skia's WebAssembly build",
};

type PackageJson = {
	name?: string;
	version?: string;
	license?: string | { type?: string };
	licenses?: Array<{ type?: string }> | { type?: string };
	repository?: string | { url?: string };
	homepage?: string;
	dependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	peerDependenciesMeta?: Record<string, { optional?: boolean }>;
	optionalDependencies?: Record<string, string>;
};

class NoticeError extends Error {}

const LICENSE_FILE = /^(licen[cs]e|copying)(\.|-|$)/i;

function readJson(path: string): PackageJson {
	return JSON.parse(readFileSync(path, "utf8")) as PackageJson;
}

/** Node's lookup: `node_modules/<name>` in `from` and each directory above. */
function resolvePackage(name: string, from: string): string | null {
	let dir = from;
	for (;;) {
		const candidate = join(dir, "node_modules", name, "package.json");
		if (existsSync(candidate)) return realpathSync(dirname(candidate));
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

/** What a package needs at run time: its dependencies, its required peers,
 *  and the optional ones that happen to be installed. */
function runtimeDeps(
	pkg: PackageJson,
): Array<{ name: string; optional: boolean }> {
	const deps = new Map<string, boolean>();
	for (const name of Object.keys(pkg.dependencies ?? {})) deps.set(name, false);
	for (const name of Object.keys(pkg.peerDependencies ?? {}))
		if (!deps.has(name))
			deps.set(name, pkg.peerDependenciesMeta?.[name]?.optional === true);
	for (const name of Object.keys(pkg.optionalDependencies ?? {}))
		deps.set(name, true);
	return [...deps].map(([name, optional]) => ({ name, optional }));
}

function licenseOf(pkg: PackageJson): string | undefined {
	if (typeof pkg.license === "string") return pkg.license;
	if (pkg.license?.type) return pkg.license.type;
	const legacy = Array.isArray(pkg.licenses) ? pkg.licenses : [pkg.licenses];
	const types = legacy.map((l) => l?.type).filter(Boolean);
	if (types.length === 1) return types[0];
	if (types.length > 1) return `(${types.join(" OR ")})`;
	return undefined;
}

/**
 * Picks the license a package is used under. For `A OR B` that is the first
 * accepted one; for `A AND B` every part must be accepted. Returns null for
 * anything this project does not accept.
 */
function acceptedLicense(expression: string): string | null {
	const bare = expression.replace(/^\((.*)\)$/, "$1").trim();
	if (LICENSES[bare]) return bare;
	if (/\sOR\s/.test(bare)) {
		for (const part of bare.split(/\s+OR\s+/)) {
			const accepted = acceptedLicense(part);
			if (accepted) return accepted;
		}
		return null;
	}
	if (/\sAND\s/.test(bare)) {
		const parts = bare.split(/\s+AND\s+/).map(acceptedLicense);
		return parts.every(Boolean) ? parts.join(" AND ") : null;
	}
	return null;
}

function repositoryOf(pkg: PackageJson): string {
	const raw =
		typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
	if (!raw) return pkg.homepage ?? "";
	const url = raw
		.replace(/^git\+/, "")
		.replace(/^git:\/\//, "https://")
		.replace(/^ssh:\/\/git@/, "https://")
		.replace(/^git@([^:]+):/, "https://$1/")
		.replace(/\.git$/, "");
	if (/^[\w.-]+\/[\w.-]+$/.test(url)) return `https://github.com/${url}`;
	const short = url.match(/^(github|gitlab|bitbucket):(.+)$/);
	if (short)
		return `https://${short[1]}.${short[1] === "bitbucket" ? "org" : "com"}/${short[2]}`;
	return url;
}

function normalizeText(text: string): string {
	return text
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n")
		.trim();
}

function findFile(dir: string, pattern: RegExp): string | undefined {
	const names = readdirSync(dir)
		.filter((name) => pattern.test(name))
		.sort();
	const file = names.find((name) => !/\.(js|ts|json|html)$/i.test(name));
	return file
		? normalizeText(readFileSync(join(dir, file), "utf8"))
		: undefined;
}

function collect(): { entries: Entry[]; kits: string[] } {
	const seen = new Set<string>();
	const entries = new Map<string, Entry>();
	const kits = new Set<string>();
	const queue: Array<{ dir: string; via: string }> = PACKAGES.map((p) => ({
		dir: realpathSync(join(ROOT, p)),
		via: `@freshcoat/${p}`,
	}));

	while (queue.length > 0) {
		const { dir, via } = queue.shift() as { dir: string; via: string };
		if (seen.has(dir)) continue;
		seen.add(dir);
		const pkg = readJson(join(dir, "package.json"));
		for (const dep of runtimeDeps(pkg)) {
			const found = resolvePackage(dep.name, dir);
			if (!found) {
				if (dep.optional) continue;
				throw new NoticeError(
					`${dep.name} (needed by ${via}) is not installed. Run bun install first.`,
				);
			}
			if (dep.name in KITS) kits.add(dep.name);
			if (!(dep.name in KITS) && !dep.name.startsWith(OWN_SCOPE)) {
				const depPkg = readJson(join(found, "package.json"));
				const key = `${dep.name}@${depPkg.version}`;
				if (!entries.has(key))
					entries.set(key, describe(dep.name, found, depPkg));
			}
			queue.push({ dir: found, via: dep.name });
		}
	}

	const sorted = [...entries.values()].sort(
		(a, b) =>
			a.name.localeCompare(b.name, "en") ||
			a.version.localeCompare(b.version, "en"),
	);
	return { entries: sorted, kits: [...kits].sort() };
}

function describe(name: string, dir: string, pkg: PackageJson): Entry {
	const declared = licenseOf(pkg);
	if (!declared)
		throw new NoticeError(
			`${name}@${pkg.version} declares no license. Check it by hand and decide before adding it.`,
		);
	const license = acceptedLicense(declared);
	if (!license)
		throw new NoticeError(
			`${name}@${pkg.version} is under "${declared}", which this project has not accepted. ` +
				"Review it, then add it to LICENSES in scripts/third-party-notices.ts.",
		);
	let licenseText = findFile(dir, LICENSE_FILE);
	const borrowed = LICENSE_FILE_FROM[name];
	let licenseNote: string | undefined;
	if (!licenseText && borrowed) {
		if (borrowed.from) {
			const from = resolvePackage(borrowed.from, join(ROOT, "apps", "editor"));
			licenseText = from ? findFile(from, LICENSE_FILE) : undefined;
			licenseNote = `${name} ships no license file. It is ${borrowed.why}, reproduced here from ${borrowed.from}.`;
		} else if (borrowed.file) {
			const path = join(ROOT, borrowed.file);
			licenseText = existsSync(path)
				? normalizeText(readFileSync(path, "utf8"))
				: undefined;
			licenseNote = `${name} ships no license file. It is ${borrowed.why}, reproduced here from ${borrowed.file}.`;
		}
	}
	const needsText = license
		.split(" AND ")
		.some((part) => LICENSES[part]?.text && part !== "Apache-2.0");
	if (needsText && !licenseText)
		throw new NoticeError(
			`${name}@${pkg.version} is under ${license} but ships no license file to reproduce.`,
		);
	return {
		name,
		version: pkg.version ?? "",
		license,
		repository: repositoryOf(pkg),
		licenseText,
		licenseNote,
		noticeText: findFile(dir, /^notice(\.|$)/i),
	};
}

function bundledAssets(): Entry[] {
	return BUNDLED_ASSETS.map((asset) => {
		const path = join(ROOT, asset.licenseFile);
		if (!existsSync(path))
			throw new NoticeError(`${asset.licenseFile} is missing (${asset.name}).`);
		return {
			name: asset.name,
			version: asset.version,
			license: asset.license,
			repository: asset.repository,
			source: asset.source,
			licenseText: normalizeText(readFileSync(path, "utf8")),
		};
	});
}

function fence(text: string): string {
	const longest = Math.max(
		2,
		...(text.match(/`+/g) ?? []).map((m) => m.length),
	);
	const ticks = "`".repeat(longest + 1);
	return `${ticks}text\n${text}\n${ticks}`;
}

function render(entries: Entry[], assets: Entry[], kits: string[]): string {
	const byName = (name: string) => entries.find((e) => e.name === name);
	const highlights = [
		...assets.map((e) => ({ ...e, label: `${e.name}, ${e.version}` })),
		...Object.entries(BUNDLED_PACKAGES).flatMap(([name, label]) => {
			const e = byName(name);
			if (!e)
				throw new NoticeError(
					`${name} (${label}) is no longer a dependency. Update BUNDLED_PACKAGES.`,
				);
			return [
				{
					...e,
					label: `${label} (\`${e.name}\` ${e.version})`,
					source: "npm package",
				},
			];
		}),
	];
	const counts = new Map<string, number>();
	for (const e of entries)
		counts.set(e.license, (counts.get(e.license) ?? 0) + 1);

	const lines: string[] = [
		"# Third-party notices",
		"",
		"<!-- Generated by scripts/third-party-notices.ts. Do not edit by hand: run `bun run notices` in editor/. -->",
		"",
		"Freshcoat is licensed under the Apache License 2.0 (see [LICENSE](LICENSE)",
		"and [NOTICE](NOTICE)). It bundles and depends on the software below, each",
		"under its own license. The list is the production dependency closure of",
		"`@freshcoat/editor`, `@freshcoat/ui` and `@freshcoat/workspace`, as installed,",
		"including what the kits below depend on.",
		"",
		"## The kits",
		"",
		"These packages are Freshcoat's own kits: Apache-2.0 packages by Dotside",
		"Studios in the same repository, each with its own LICENSE and NOTICE, to",
		"be published separately. They are not listed below.",
		"",
		...kits.map((k) => `- \`${k}\`: ${KITS[k]}`),
		"",
		"## Bundled fonts and runtime",
		"",
		"| Asset | License | Source |",
		"|---|---|---|",
		...highlights.map(
			(e) =>
				`| ${e.label} | ${e.license} | ${e.source === "npm package" ? e.source : `\`${e.source}\``}${e.repository ? `, ${e.repository}` : ""} |`,
		),
		"",
		"## Packages",
		"",
		`${entries.length} packages: ${[...counts]
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "en"))
			.map(([license, n]) => `${n} ${license}`)
			.join(", ")}.`,
		"",
		"| Package | Version | License | Repository |",
		"|---|---|---|---|",
		...entries.map(
			(e) => `| ${e.name} | ${e.version} | ${e.license} | ${e.repository} |`,
		),
		"",
		"## License texts",
		"",
		"The Apache License 2.0 text is in [LICENSE](LICENSE); a package under it",
		"is listed here only for its NOTICE file, when it ships one.",
		"",
	];
	for (const e of [...assets, ...entries]) {
		const apacheOnly = e.license === "Apache-2.0";
		const text = apacheOnly ? undefined : e.licenseText;
		if (!text && !e.noticeText) continue;
		lines.push(`### ${e.name} ${e.version}`, "", `License: ${e.license}`, "");
		if (e.licenseNote) lines.push(e.licenseNote, "");
		if (text) lines.push(fence(text), "");
		if (e.noticeText) lines.push("NOTICE:", "", fence(e.noticeText), "");
	}
	return `${lines.join("\n").trimEnd()}\n`;
}

function main(): number {
	const check = process.argv.includes("--check");
	let output: string;
	try {
		const { entries, kits } = collect();
		output = render(entries, bundledAssets(), kits);
	} catch (e) {
		if (e instanceof NoticeError) {
			console.error(`third-party-notices: ${e.message}`);
			return 1;
		}
		throw e;
	}
	const name = relative(process.cwd(), OUTPUT) || OUTPUT;
	if (check) {
		const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, "utf8") : "";
		if (current !== output) {
			console.error(
				`third-party-notices: ${name} is out of date. Run \`bun run notices\` in apps/editor and commit it.`,
			);
			return 1;
		}
		console.log(`third-party-notices: ${name} is up to date`);
		return 0;
	}
	writeFileSync(OUTPUT, output);
	console.log(`third-party-notices: wrote ${name}`);
	return 0;
}

process.exit(main());
