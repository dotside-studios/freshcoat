export type TextCase = "upper" | "lower" | "title";

export type ApplyCaseOptions = {
	/** Keep a character as is when its cased form has a different length,
	 *  so every index still points at the same character. */
	preserveLength?: boolean;
};

const WORD_CHAR = /[\p{L}\p{N}_]/u;

export function isTextCase(mode: unknown): mode is TextCase {
	return mode === "upper" || mode === "lower" || mode === "title";
}

/** The last code point of `text`, or "" when it is empty. */
export function lastChar(text: string): string {
	const end = text.length;
	if (end === 0) return "";
	const code = text.charCodeAt(end - 1);
	return code >= 0xdc00 && code <= 0xdfff && end > 1
		? text.slice(end - 2)
		: text.slice(end - 1);
}

/**
 * Applies a text case. Title case capitalises a letter whose preceding
 * character is not a Unicode letter, number or underscore; `prevChar` is the
 * character before `text`, so a word split across spans keeps one capital.
 */
export function applyCase(
	text: string,
	mode: unknown,
	prevChar = "",
	options: ApplyCaseOptions = {},
): string {
	if (!isTextCase(mode)) return text;
	if (!options.preserveLength && mode !== "title") {
		return mode === "upper" ? text.toUpperCase() : text.toLowerCase();
	}
	let out = "";
	let prev = prevChar;
	for (const ch of text) {
		const word = mode === "title" && !WORD_CHAR.test(prev);
		const next =
			mode === "upper" || word
				? ch.toUpperCase()
				: mode === "lower"
					? ch.toLowerCase()
					: ch;
		out += options.preserveLength && next.length !== ch.length ? ch : next;
		prev = ch;
	}
	return out;
}
