import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Vitest runs from the package directory.
const FRESHCOAT = resolve(process.cwd(), "../..");
const THEME_CSS = readFileSync(
	join(FRESHCOAT, "packages/ui/src/theme.css"),
	"utf8",
);

function block(css: string, opener: string): string {
	const start = css.indexOf(opener);
	if (start < 0) throw new Error(`${opener} not found in theme.css`);
	let depth = 0;
	for (let i = css.indexOf("{", start); i < css.length; i++) {
		if (css[i] === "{") depth++;
		else if (css[i] === "}" && --depth === 0)
			return css.slice(css.indexOf("{", start) + 1, i);
	}
	throw new Error(`${opener} is not closed`);
}

function vars(body: string): Map<string, string> {
	const out = new Map<string, string>();
	for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g))
		out.set(m[1], m[2].replace(/\s+/g, " ").trim());
	return out;
}

const themeBlock = vars(block(THEME_CSS, "@theme {"));
const rootBlock = vars(block(THEME_CSS, ":root {"));
const light = new Map([...themeBlock, ...rootBlock]);
const dark = vars(block(THEME_CSS, '[data-theme="dark"] {'));
const themed = (name: string) =>
	name.startsWith("--color-fc-") || name.startsWith("--shadow-fc-");

function luminance(hex: string): number {
	const m = /^#([0-9a-f]{6})$/i.exec(hex);
	if (!m) throw new Error(`${hex} is not #rrggbb`);
	const n = Number.parseInt(m[1], 16);
	const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((c) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

describe.each([
	["light", light],
	["dark", dark],
])("%s theme", (_name, set) => {
	const c = (token: string) => {
		const value = set.get(`--color-fc-${token}`);
		if (!value) throw new Error(`--color-fc-${token} is missing`);
		return value;
	};

	test("defines every themed token the other theme does", () => {
		const names = (m: Map<string, string>) =>
			[...m.keys()].filter(themed).sort();
		expect(names(set)).toEqual(names(light));
		expect(names(set)).toEqual(names(dark));
	});

	test.each([
		"app",
		"panel",
		"raised",
		"popover",
	])("text on %s is at least 7:1", (bg) =>
		expect(contrast(c("text"), c(bg))).toBeGreaterThanOrEqual(7));

	test.each([
		"panel",
		"raised",
		"popover",
	])("muted on %s is at least 4.5:1", (bg) =>
		expect(contrast(c("muted"), c(bg))).toBeGreaterThanOrEqual(4.5));

	test("faint on panel is at least 3:1", () =>
		expect(contrast(c("faint"), c("panel"))).toBeGreaterThanOrEqual(3));

	test("white on accent is at least 4.5:1", () =>
		expect(contrast("#ffffff", c("accent"))).toBeGreaterThanOrEqual(4.5));

	test("ruler labels, ticks and selection marks read on the ruler", () => {
		expect(contrast(c("muted"), c("panel"))).toBeGreaterThanOrEqual(4.5);
		expect(contrast(c("faint"), c("panel"))).toBeGreaterThanOrEqual(3);
		expect(contrast(c("accent"), c("panel"))).toBeGreaterThanOrEqual(3);
		expect(contrast(c("guide"), c("panel"))).toBeGreaterThanOrEqual(3);
		expect(contrast("#ffffff", c("accent"))).toBeGreaterThanOrEqual(4.5);
	});

	test("text on tooltip is at least 7:1", () =>
		expect(contrast(c("text"), c("tooltip"))).toBeGreaterThanOrEqual(7));
});

describe("colour literals", () => {
	// Data, not chrome: document defaults, samples, fixtures and demo swatches.
	const ALLOWED: { path: RegExp; line?: RegExp }[] = [
		{ path: /^packages\/ui\/src\/theme\.css$/ },
		{ path: /^packages\/ui\/src\/gallery\.tsx$/ },
		{ path: /^packages\/ui\/src\/color\.tsx$/, line: /NEUTRAL = parseColor/ },
		{ path: /^(packages\/ui|apps\/editor)\/src\/tests\// },
		{ path: /^apps\/editor\/src\/samples\// },
		{ path: /^apps\/editor\/src\/doc\// },
		{
			path: /^apps\/editor\/src\/panels\/design\/(fills\.ts|StrokeSection\.tsx|EffectsSection\.tsx|QrSection\.tsx|BarcodeSection\.tsx)$/,
		},
	];
	const LITERAL = /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?)\(/i;

	function* sources(dir: string): Generator<string> {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) yield* sources(path);
			else if (/\.(tsx?|css)$/.test(name)) yield path;
		}
	}

	test("appear only in data", () => {
		const stray: string[] = [];
		for (const root of ["packages/ui/src", "apps/editor/src"])
			for (const file of sources(join(FRESHCOAT, root))) {
				const rel = relative(FRESHCOAT, file).split("\\").join("/");
				readFileSync(file, "utf8")
					.split("\n")
					.forEach((text, i) => {
						if (!LITERAL.test(text)) return;
						const ok = ALLOWED.some(
							(a) => a.path.test(rel) && (!a.line || a.line.test(text)),
						);
						if (!ok) stray.push(`${rel}:${i + 1}: ${text.trim()}`);
					});
			}
		expect(stray).toEqual([]);
	});
});

describe("theme preference", () => {
	let prefersDark = false;
	let onChange: (() => void) | null = null;

	beforeEach(() => {
		vi.resetModules();
		localStorage.clear();
		delete document.documentElement.dataset.theme;
		prefersDark = false;
		onChange = null;
		vi.stubGlobal("matchMedia", (query: string) => ({
			get matches() {
				return query.includes("dark") && prefersDark;
			},
			addEventListener: (_: string, l: () => void) => {
				onChange = l;
			},
		}));
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		history.replaceState(null, "", "/");
	});

	test("is light by default", async () => {
		const theme = await import("~/app/theme");
		theme.initTheme();
		expect(theme.getThemePreference()).toBe("light");
		expect(document.documentElement.dataset.theme).toBe("light");
	});

	test("saves the choice", async () => {
		const theme = await import("~/app/theme");
		theme.initTheme();
		theme.setThemePreference("dark");
		expect(localStorage.getItem("freshcoat.theme")).toBe("dark");
		expect(document.documentElement.dataset.theme).toBe("dark");
	});

	test("system follows prefers-color-scheme live", async () => {
		localStorage.setItem("freshcoat.theme", "system");
		const theme = await import("~/app/theme");
		theme.initTheme();
		expect(document.documentElement.dataset.theme).toBe("light");
		prefersDark = true;
		onChange?.();
		expect(document.documentElement.dataset.theme).toBe("dark");
	});

	test("?theme= overrides without saving", async () => {
		localStorage.setItem("freshcoat.theme", "light");
		history.replaceState(null, "", "/?theme=dark");
		const theme = await import("~/app/theme");
		theme.initTheme();
		expect(document.documentElement.dataset.theme).toBe("dark");
		expect(localStorage.getItem("freshcoat.theme")).toBe("light");
	});
});
