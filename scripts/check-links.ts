// Fails when a relative link in the repository's Markdown points nowhere: a file
// that was moved or renamed, or a heading anchor that no longer exists. The
// docs link to each other and into the code, and a broken link is found by
// the one reader who needed it.
//
// Usage: bun scripts/check-links.ts [root]
//
// Links with a scheme (https:, mailto:) are not fetched. Code blocks and code
// spans are skipped, so an example link in a fence is not checked.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const SKIP_DIRS = new Set([
	"node_modules",
	"dist",
	"test-results",
	"screenshots",
	".git",
]);

export type BrokenLink = {
	/** the Markdown file, relative to the root */
	file: string;
	line: number;
	target: string;
	reason: string;
};

export function markdownFiles(root: string): string[] {
	const out: string[] = [];
	const walk = (dir: string) => {
		for (const name of readdirSync(dir).sort()) {
			if (SKIP_DIRS.has(name)) continue;
			const path = join(dir, name);
			if (statSync(path).isDirectory()) walk(path);
			else if (name.endsWith(".md")) out.push(path);
		}
	};
	walk(root);
	return out;
}

/** The anchor GitHub gives a heading. */
export function slugOf(heading: string): string {
	return heading
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/[`*~]/g, "")
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s_-]/gu, "")
		.replace(/\s/g, "-");
}

/** Blanks out fenced code blocks, keeping line numbers. */
function withoutFences(text: string): string[] {
	let fence: string | null = null;
	return text.split("\n").map((line) => {
		const open = line.match(/^\s*(`{3,}|~{3,})/);
		if (fence) {
			if (open && open[1][0] === fence[0] && open[1].length >= fence.length)
				fence = null;
			return "";
		}
		if (open) {
			fence = open[1];
			return "";
		}
		return line;
	});
}

const withoutSpans = (line: string) => line.replace(/(`+)[^`]*?\1/g, "");

export function anchorsOf(text: string): Set<string> {
	const anchors = new Set<string>();
	const seen = new Map<string, number>();
	for (const line of withoutFences(text)) {
		const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
		if (!heading) continue;
		const base = slugOf(heading[1] as string);
		const n = seen.get(base) ?? 0;
		seen.set(base, n + 1);
		anchors.add(n === 0 ? base : `${base}-${n}`);
	}
	return anchors;
}

type Link = { target: string; line: number };

export function linksOf(text: string): Link[] {
	const links: Link[] = [];
	withoutFences(text)
		.map(withoutSpans)
		.forEach((line, i) => {
			for (const m of line.matchAll(
				/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g,
			))
				links.push({ target: m[1], line: i + 1 });
			const def = line.match(/^\s*\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+.*)?$/);
			if (def) links.push({ target: def[1], line: i + 1 });
		});
	return links;
}

export function checkLinks(root: string): BrokenLink[] {
	const broken: BrokenLink[] = [];
	const anchorCache = new Map<string, Set<string>>();
	const anchorsAt = (path: string) => {
		let set = anchorCache.get(path);
		if (!set) {
			set = anchorsOf(readFileSync(path, "utf8"));
			anchorCache.set(path, set);
		}
		return set;
	};
	for (const file of markdownFiles(root)) {
		const text = readFileSync(file, "utf8");
		for (const { target, line } of linksOf(text)) {
			if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
			const [pathPart, anchor] = target.split("#", 2) as [string, string?];
			const path = pathPart.split("?")[0] as string;
			const resolved = path
				? resolve(dirname(file), decodeURIComponent(path))
				: file;
			const report = (reason: string) =>
				broken.push({ file: relative(root, file), line, target, reason });
			if (!existsSync(resolved)) {
				report("no such file");
				continue;
			}
			if (anchor && resolved.endsWith(".md")) {
				if (!anchorsAt(resolved).has(anchor.toLowerCase()))
					report(`no heading #${anchor}`);
			}
		}
	}
	return broken;
}

if (import.meta.main) {
	const root = resolve(process.argv[2] ?? join(import.meta.dir, ".."));
	const broken = checkLinks(root);
	for (const b of broken)
		console.error(`${b.file}:${b.line}: ${b.target} (${b.reason})`);
	if (broken.length > 0) {
		console.error(`check-links: ${broken.length} broken link(s)`);
		process.exit(1);
	}
	console.log(
		`check-links: every relative link resolves (${markdownFiles(root).length} files)`,
	);
}
