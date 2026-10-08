import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vitest";
import { EMPTY, KEY_RULE, plural } from "~/app/copy";

// Retired words stay out of anything a person
// reads. Code identifiers are not copy, so the scan reads only JSX text and
// string literals, and skips the places a string is a key, a class list or an
// id rather than words.

const ROOTS = [
	resolve(import.meta.dirname, ".."),
	resolve(import.meta.dirname, "../../../../packages/ui/src"),
];

// Not shipped copy: the kit gallery's demo content, the bench's report and
// the tests themselves.
const SKIP_FILES = [
	/\/tests\//,
	/\.test\.tsx?$/,
	/\/gallery\.tsx$/,
	/\/Bench\.tsx$/,
];

const NOT_COPY_ATTRS = new Set([
	"className",
	"id",
	"key",
	"data-testid",
	"testId",
	"type",
	"role",
	"href",
	"src",
	"name",
	"value",
	"variant",
	"size",
	"tone",
	"placement",
	"inputMode",
	"autoComplete",
	"accept",
	"slot",
	"form",
]);

const NOT_COPY_PROPS = new Set([
	"className",
	"id",
	"kind",
	"type",
	"key",
	"tone",
]);

// Calls whose string arguments are keys, selectors or event names.
const NOT_COPY_CALLS =
	/^(querySelector|querySelectorAll|getElementById|addEventListener|removeEventListener|startsWith|endsWith|includes|split|replace|match|test|get|set|has|delete|getItem|setItem|removeItem|postMessage|setAttribute|getAttribute|createElement|mark|measure|dispatch|matchMedia|cn)$/;

type Found = { file: string; line: number; text: string };

/** A class list or a selector: no capitals, and punctuation words lack. */
function looksLikeCode(s: string): boolean {
	if (/[A-Z]/.test(s)) return false;
	const tokens = s.split(" ");
	return (
		tokens.every((t) => /^[\w[\]=/:.&()!%#,*>~+"'-]+$/.test(t)) &&
		tokens.some((t) => /[-:/[=]/.test(t))
	);
}

function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
		else if (/\.tsx?$/.test(name) && !SKIP_FILES.some((r) => r.test(path)))
			out.push(path);
	}
	return out;
}

/** Every piece of text in a file that could reach a person. */
function copyIn(path: string): Found[] {
	const text = readFileSync(path, "utf8");
	const sf = ts.createSourceFile(
		path,
		text,
		ts.ScriptTarget.Latest,
		true,
		path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);
	const file = relative(join(import.meta.dirname, "../../.."), path);
	const out: Found[] = [];
	const add = (node: ts.Node, value: string) => {
		const words = value.replace(/\s+/g, " ").trim();
		// A lone lowercase token is an identifier, a key or a CSS value.
		if (!/[A-Za-z]{2}/.test(words) || /^[a-z][\w.:/-]*$/.test(words)) return;
		if (looksLikeCode(words)) return;
		const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
		out.push({ file, line: line + 1, text: words });
	};
	const visit = (node: ts.Node): void => {
		if (
			ts.isImportDeclaration(node) ||
			ts.isExportDeclaration(node) ||
			ts.isLiteralTypeNode(node) ||
			ts.isElementAccessExpression(node)
		)
			return;
		if (ts.isJsxAttribute(node) && NOT_COPY_ATTRS.has(node.name.getText()))
			return;
		if (
			ts.isPropertyAssignment(node) &&
			NOT_COPY_PROPS.has(node.name.getText())
		)
			return;
		if (ts.isCallExpression(node)) {
			const callee = node.expression.getText().split(".").at(-1) ?? "";
			if (NOT_COPY_CALLS.test(callee)) return;
		}
		if (ts.isJsxText(node)) add(node, node.text);
		else if (
			ts.isStringLiteral(node) ||
			ts.isNoSubstitutionTemplateLiteral(node)
		)
			add(node, node.text);
		else if (ts.isTemplateExpression(node)) {
			add(
				node,
				[node.head, ...node.templateSpans.map((s) => s.literal)]
					.map((p) => p.text)
					.join(" "),
			);
		}
		ts.forEachChild(node, visit);
	};
	visit(sf);
	return out;
}

const COPY = ROOTS.flatMap(sourceFiles).flatMap(copyIn);

// Where a forbidden word is the right one: a spreadsheet's own rows in the
// import wizard, and auto layout's row direction and grid rows.
const ALLOWED: { file: RegExp; text: RegExp }[] = [
	{
		file: /data\/ImportWizard\.tsx$/,
		text: /^(No header row|Header row|Row|row|Only rows with issues)$/,
	},
	{
		file: /panels\/design\/FrameSection\.tsx$/,
		text: /^(Row|Rows|Grid rows|Row gap)$/,
	},
	{ file: /panels\/design\/LayerSection\.tsx$/, text: /^(Row|Grid row)$/ },
];

const FORBIDDEN: { word: string; pattern: RegExp }[] = [
	{ word: "colour", pattern: /colour/i },
	{ word: "centre", pattern: /centre/i },
	{ word: "optimis", pattern: /optimis/i },
	// "ticket" is its own word, not the verb the guide retires.
	{ word: "tick", pattern: /\btick(?!et)/i },
	{ word: "row", pattern: /\brows?\b/i },
	{ word: "document", pattern: /\bdocuments?\b/i },
];

describe("copy guard", () => {
	test("finds the copy it guards", () => {
		// A scan that silently matched nothing would pass everything.
		expect(COPY.length).toBeGreaterThan(500);
		expect(COPY.some((c) => c.text === "Create designs that scale.")).toBe(
			true,
		);
	});

	for (const { word, pattern } of FORBIDDEN)
		test(`no "${word}" in user-facing strings`, () => {
			const hits = COPY.filter(
				(c) =>
					pattern.test(c.text) &&
					!ALLOWED.some((a) => a.file.test(c.file) && a.text.test(c.text)),
			).map((c) => `${c.file}:${c.line}: ${c.text}`);
			expect(hits).toEqual([]);
		});
});

describe("shared copy", () => {
	test("plural counts with grouping", () => {
		expect(plural(1, "record")).toBe("1 record");
		expect(plural(0, "record")).toBe("0 records");
		expect(plural(2400, "record")).toBe("2,400 records");
		expect(plural(2, "match", "matches")).toBe("2 matches");
	});

	test("empty-state titles are at most four words", () => {
		for (const title of Object.values(EMPTY))
			expect(title.split(" ").length).toBeLessThanOrEqual(4);
	});

	test("the key rule has no period", () => {
		expect(KEY_RULE.endsWith(".")).toBe(false);
	});
});
