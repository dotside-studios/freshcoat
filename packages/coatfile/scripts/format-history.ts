import { FORMAT_HISTORY } from "../src/format-version";

const COMMENT_WIDTH = 80;
const COMMENT_HEAD = (minor: number) => `//   1.${minor}  `;
const COMMENT_CONT = `//${" ".repeat(8)}`;

/** The history comment in format.ts: one wrapped entry per minor. */
export function renderHistoryComment(
	history: readonly string[] = FORMAT_HISTORY,
): string[] {
	const lines: string[] = [];
	history.forEach((text, minor) => {
		let prefix = COMMENT_HEAD(minor);
		let line = "";
		for (const word of text.split(" ")) {
			if (
				line &&
				prefix.length + line.length + 1 + word.length > COMMENT_WIDTH
			) {
				lines.push(prefix + line);
				prefix = COMMENT_CONT;
				line = word;
			} else {
				line = line ? `${line} ${word}` : word;
			}
		}
		lines.push(prefix + line);
	});
	return lines;
}

/** The rows of the README's "Format versions" table. */
export function renderHistoryTable(
	history: readonly string[] = FORMAT_HISTORY,
): string[] {
	return history.map((text, minor) => `| 1.${minor} | ${text} |`);
}

function splice(
	source: string,
	what: string,
	isStart: (line: string) => boolean,
	isMore: (line: string) => boolean,
	replacement: string[],
): string {
	const lines = source.split("\n");
	const start = lines.findIndex(isStart);
	if (start === -1) throw new Error(`${what}: block not found`);
	let end = start + 1;
	while (end < lines.length && isMore(lines[end] as string)) end++;
	lines.splice(start, end - start, ...replacement);
	return lines.join("\n");
}

/** `format.ts` source with its history comment regenerated. */
export function spliceHistoryComment(
	source: string,
	history: readonly string[] = FORMAT_HISTORY,
): string {
	return splice(
		source,
		"src/format.ts history comment",
		(line) => line.startsWith(COMMENT_HEAD(0)),
		(line) => /^\/\/ {3}1\.\d+ {2}/.test(line) || line.startsWith(COMMENT_CONT),
		renderHistoryComment(history),
	);
}

/** README source with its "Format versions" table rows regenerated. */
export function spliceHistoryTable(
	source: string,
	history: readonly string[] = FORMAT_HISTORY,
): string {
	return splice(
		source,
		"README.md format versions table",
		(line) => line.startsWith("| 1.0 |"),
		(line) => /^\| 1\.\d+ \| /.test(line),
		renderHistoryTable(history),
	);
}
