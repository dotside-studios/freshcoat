export const PATTERN_MAX_LENGTH = 512;
export const PATTERN_INPUT_MAX_LENGTH = 10_000;

export type UnsafePatternReason =
	| "too_long"
	| "nested_quantifier"
	| "backreference";

export const UNSAFE_PATTERN_MESSAGES: Record<UnsafePatternReason, string> = {
	too_long: `Longer than ${PATTERN_MAX_LENGTH} characters`,
	nested_quantifier: "Repeats a group that already repeats",
	backreference: "Uses a backreference",
};

type Group = {
	repeats: boolean;
	alternatives: string[];
	current: string;
	literal: boolean;
};

const BOUNDED_REPEAT = /^\{(\d+)(,(\d*))?\}/;

function quantifierAt(pattern: string, at: number): boolean | null {
	const ch = pattern[at];
	if (ch === "*" || ch === "+") return true;
	if (ch !== "{") return null;
	const m = BOUNDED_REPEAT.exec(pattern.slice(at));
	if (!m) return null;
	if (m[2] === undefined) return false;
	return m[3] === "" || Number(m[3]) > 1;
}

function overlappingAlternatives(alternatives: string[]): boolean {
	return alternatives.some((a, i) =>
		alternatives.some((b, j) => i !== j && a !== "" && b.startsWith(a)),
	);
}

/** Why a pattern is refused before it is compiled, or null when it is fine.
 *  A static check, not a proof: it refuses patterns that are too long, that
 *  repeat a group which itself repeats (`(a+)+`, `(a|aa)*`) and that use
 *  backreferences. */
export function unsafePatternReason(
	pattern: string,
): UnsafePatternReason | null {
	if (pattern.length > PATTERN_MAX_LENGTH) return "too_long";
	const stack: Group[] = [];
	const open = (): Group => ({
		repeats: false,
		alternatives: [],
		current: "",
		literal: true,
	});
	let top: Group = open();
	for (let i = 0; i < pattern.length; i++) {
		const ch = pattern[i] as string;
		if (ch === "\\") {
			const next = pattern[i + 1] ?? "";
			if (/[1-9]/.test(next) || (next === "k" && pattern[i + 2] === "<"))
				return "backreference";
			if (/[pPu]/.test(next) && pattern[i + 2] === "{") {
				const end = pattern.indexOf("}", i + 2);
				i = end === -1 ? pattern.length : end;
			} else i++;
			top.literal = false;
			continue;
		}
		if (ch === "[") {
			i++;
			while (i < pattern.length && pattern[i] !== "]") {
				if (pattern[i] === "\\") i++;
				i++;
			}
			top.literal = false;
			continue;
		}
		if (ch === "(") {
			top.literal = false;
			stack.push(top);
			top = open();
			if (pattern[i + 1] === "?") {
				const m = /^\?(?:[:=!]|<[=!]|<[^>]*>)/.exec(pattern.slice(i + 1));
				if (m) i += m[0].length;
			}
			continue;
		}
		if (ch === ")") {
			const parent = stack.pop();
			if (!parent) continue;
			top.alternatives.push(top.current);
			const repeats = quantifierAt(pattern, i + 1);
			if (
				repeats &&
				(top.repeats ||
					(top.literal && overlappingAlternatives(top.alternatives)))
			)
				return "nested_quantifier";
			if (repeats || top.repeats) parent.repeats = true;
			top = parent;
			continue;
		}
		if (ch === "|") {
			top.alternatives.push(top.current);
			top.current = "";
			continue;
		}
		const repeats = quantifierAt(pattern, i);
		if (repeats !== null) {
			if (repeats) top.repeats = true;
			top.literal = false;
			if (ch === "{")
				i +=
					(BOUNDED_REPEAT.exec(pattern.slice(i)) as RegExpExecArray)[0].length -
					1;
			continue;
		}
		top.current += ch;
	}
	return null;
}
