export type TextRules = {
	minLength?: number;
	maxLength?: number;
	pattern?: string;
};

export type TextRuleBreak = "too_short" | "too_long" | "pattern_mismatch";

const patterns = new Map<string, RegExp | null>();
export const PATTERN_CACHE_MAX = 256;
const UNICODE_ESCAPE = /\\[pPu]\{/;

/** Field patterns compile with the `u` flag, falling back to no flags for
 *  patterns that only parse without it, such as `^\#\d+$`. A pattern
 *  invalid in both modes, or one using `\p{`, `\P{` or `\u{` that fails
 *  under `u`, is `null` and imposes no constraint. */
export function compiledPattern(pattern: string): RegExp | null {
	let re = patterns.get(pattern);
	if (re !== undefined) {
		patterns.delete(pattern);
		patterns.set(pattern, re);
		return re;
	}
	re =
		compile(pattern, "u") ??
		(UNICODE_ESCAPE.test(pattern) ? null : compile(pattern, ""));
	patterns.set(pattern, re);
	if (patterns.size > PATTERN_CACHE_MAX)
		patterns.delete(patterns.keys().next().value as string);
	return re;
}

function compile(pattern: string, flags: string): RegExp | null {
	try {
		return new RegExp(pattern, flags);
	} catch {
		return null;
	}
}

export function textRuleBreaks(rules: TextRules, value: string): TextRuleBreak[] {
	const breaks: TextRuleBreak[] = [];
	if (rules.minLength !== undefined && value.length < rules.minLength) {
		breaks.push("too_short");
	}
	if (rules.maxLength !== undefined && value.length > rules.maxLength) {
		breaks.push("too_long");
	}
	if (rules.pattern !== undefined) {
		const re = compiledPattern(rules.pattern);
		if (re !== null && !re.test(value)) breaks.push("pattern_mismatch");
	}
	return breaks;
}
