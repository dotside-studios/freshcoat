export const PATTERN_MAX_LENGTH = 512;
export const PATTERN_INPUT_MAX_LENGTH = 10_000;
export const PATTERN_GUARDED_INPUT_MAX_LENGTH = 256;

export type UnsafePatternReason =
	| "too_long"
	| "nested_quantifier"
	| "adjacent_quantifiers"
	| "backreference";

export const UNSAFE_PATTERN_MESSAGES: Record<UnsafePatternReason, string> = {
	too_long: `Longer than ${PATTERN_MAX_LENGTH} characters`,
	nested_quantifier: "Repeats a group that already repeats",
	adjacent_quantifiers: "Repeats the same characters twice in a row",
	backreference: "Uses a backreference",
};

// How many ways a repeated group may split its input before it is refused.
const SPLIT_BUDGET = 1024;

type Node =
	| { kind: "atom"; raw: string }
	| { kind: "assertion" }
	| { kind: "group"; alts: Node[][]; lookaround: boolean }
	| { kind: "repeat"; node: Node; min: number; max: number };

type Info = {
	chars: bigint;
	first: bigint;
	last: bigint;
	pass: bigint;
	lead: bigint;
	trail: bigint;
	nullable: boolean;
	unbounded: boolean;
	factor: number;
	guarded: boolean;
};

class Unsafe {
	constructor(readonly reason: UnsafePatternReason) {}
}

const QUANTIFIER = /^(?:([*+?])|\{(\d+)(?:(,)(\d*))?\})\??/;
const GROUP_PREFIX = /^\?(?:[:=!]|<[=!]|<[^>]*>)/;
const ESCAPE_TAIL = /^(?:u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|c[A-Za-z])/;
const PLAIN = /^[^\\.[\]()|*+?{}^$]$/u;

function parse(pattern: string): Node[][] {
	let i = 0;
	const alternatives = (depth: number): Node[][] => {
		const alts: Node[][] = [[]];
		while (i < pattern.length) {
			const ch = pattern[i] as string;
			if (ch === ")") {
				if (depth > 0) return alts;
				i++;
				continue;
			}
			if (ch === "|") {
				alts.push([]);
				i++;
				continue;
			}
			const seq = alts[alts.length - 1] as Node[];
			const q = QUANTIFIER.exec(pattern.slice(i));
			if (q && !(ch === "{" && seq.length === 0)) {
				i += q[0].length;
				const prev = seq.pop();
				if (!prev) continue;
				const min = q[1] ? (q[1] === "+" ? 1 : 0) : Number(q[2]);
				const max = q[1]
					? q[1] === "?"
						? 1
						: Number.POSITIVE_INFINITY
					: q[3] === undefined
						? min
						: q[4] === ""
							? Number.POSITIVE_INFINITY
							: Number(q[4]);
				seq.push({ kind: "repeat", node: prev, min, max });
				continue;
			}
			seq.push(item(depth));
		}
		return alts;
	};
	const item = (depth: number): Node => {
		const start = i;
		const ch = pattern[i] as string;
		if (ch === "\\") {
			const next = pattern[i + 1] ?? "";
			if (/[1-9]/.test(next) || (next === "k" && pattern[i + 2] === "<"))
				throw new Unsafe("backreference");
			if (next === "b" || next === "B") {
				i += 2;
				return { kind: "assertion" };
			}
			if (/[pPu]/.test(next) && pattern[i + 2] === "{") {
				const end = pattern.indexOf("}", i + 2);
				i = end === -1 ? pattern.length : end + 1;
			} else i += (ESCAPE_TAIL.exec(pattern.slice(i + 1))?.[0].length ?? 1) + 1;
			return { kind: "atom", raw: pattern.slice(start, i) };
		}
		if (ch === "[") {
			i++;
			while (i < pattern.length && pattern[i] !== "]") {
				if (pattern[i] === "\\") i++;
				i++;
			}
			i++;
			return { kind: "atom", raw: pattern.slice(start, i) };
		}
		if (ch === "(") {
			i++;
			const prefix = GROUP_PREFIX.exec(pattern.slice(i));
			const lookaround =
				prefix !== null && /^\?<?[=!]/.test(prefix[0] as string);
			if (prefix) i += prefix[0].length;
			const alts = alternatives(depth + 1);
			i++;
			return { kind: "group", alts, lookaround };
		}
		if (ch === "^" || ch === "$") {
			i++;
			return { kind: "assertion" };
		}
		i += (pattern.codePointAt(i) as number) > 0xffff ? 2 : 1;
		return { kind: "atom", raw: pattern.slice(start, i) };
	};
	return alternatives(0);
}

const BASE_PROBES = [
	...Array.from({ length: 128 }, (_, c) => c),
	0xa0,
	0xdf,
	0xe9,
	0x130,
	0x17f,
	0x3b1,
	0x416,
	0x5d0,
	0x627,
	0x905,
	0xe01,
	0x1e9e,
	0x200b,
	0x2028,
	0x2029,
	0x3000,
	0x3042,
	0x4e2d,
	0xac00,
	0xfeff,
	0xff21,
	0x10400,
	0x1f600,
];

// Every code point the pattern names joins the probes, so two ranges are
// seen to overlap whenever one holds an endpoint of the other.
function probesFor(pattern: string): string[] {
	const points = new Set(BASE_PROBES);
	for (const ch of pattern) points.add(ch.codePointAt(0) as number);
	for (const m of pattern.matchAll(
		/\\(?:u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2}))/g,
	)) {
		const cp = Number.parseInt((m[1] ?? m[2] ?? m[3]) as string, 16);
		if (cp <= 0x10ffff) points.add(cp);
	}
	return [...points].map((cp) => String.fromCodePoint(cp));
}

function compile(source: string, flags: string): RegExp | null {
	try {
		return new RegExp(source, flags);
	} catch {
		return null;
	}
}

function analyze(pattern: string): { guarded: boolean } {
	const probes = probesFor(pattern);
	const ALL = (1n << BigInt(probes.length)) - 1n;
	const masks = new Map<string, bigint>();
	const maskOf = (raw: string): bigint => {
		let mask = masks.get(raw);
		if (mask !== undefined) return mask;
		const source = `^(?:${raw})$`;
		const re = compile(source, "u") ?? compile(source, "");
		if (!re) mask = ALL;
		else {
			mask = 0n;
			probes.forEach((p, n) => {
				if (re.test(p)) mask = (mask as bigint) | (1n << BigInt(n));
			});
		}
		masks.set(raw, mask);
		return mask;
	};

	const isPlain = (seq: Node[]): boolean =>
		seq.length > 0 && seq.every((n) => n.kind === "atom" && PLAIN.test(n.raw));

	const ambiguous = (alts: Node[][]): boolean => {
		if (alts.length < 2) return false;
		if (!alts.every(isPlain)) return true;
		const heads = alts.map((s) => (s[0] as { raw: string }).raw);
		return new Set(heads).size !== heads.length;
	};

	const sequence = (seq: Node[]): Info => {
		const out: Info = {
			chars: 0n,
			first: 0n,
			last: 0n,
			pass: ALL,
			lead: 0n,
			trail: 0n,
			nullable: true,
			unbounded: false,
			factor: 1,
			guarded: false,
		};
		let live = 0n;
		for (const node of seq) {
			const n = info(node);
			if ((live & n.lead) !== 0n) throw new Unsafe("adjacent_quantifiers");
			live = (live & n.pass) | n.trail;
			out.chars |= n.chars;
			if (out.nullable) out.first |= n.first;
			out.last = n.nullable ? out.last | n.last : n.last;
			out.lead |= out.pass & n.lead;
			out.trail = (out.trail & n.pass) | n.trail;
			out.pass &= n.pass;
			out.nullable &&= n.nullable;
			out.unbounded ||= n.unbounded;
			out.factor *= n.factor;
			out.guarded ||= n.guarded;
		}
		return out;
	};

	const group = (alts: Node[][]): Info => {
		const infos = alts.map(sequence);
		const out: Info = {
			chars: 0n,
			first: 0n,
			last: 0n,
			pass: 0n,
			lead: 0n,
			trail: 0n,
			nullable: false,
			unbounded: false,
			factor: 1,
			guarded: false,
		};
		for (const n of infos) {
			out.chars |= n.chars;
			out.first |= n.first;
			out.last |= n.last;
			out.pass |= n.pass;
			out.lead |= n.lead;
			out.trail |= n.trail;
			out.nullable ||= n.nullable;
			out.unbounded ||= n.unbounded;
			out.factor = Math.max(out.factor, n.factor);
			out.guarded ||= n.guarded;
		}
		if (ambiguous(alts)) out.factor *= alts.length;
		return out;
	};

	const info = (node: Node): Info => {
		if (node.kind === "atom") {
			const m = maskOf(node.raw);
			return {
				chars: m,
				first: m,
				last: m,
				pass: m,
				lead: 0n,
				trail: 0n,
				nullable: false,
				unbounded: false,
				factor: 1,
				guarded: false,
			};
		}
		if (node.kind === "assertion")
			return {
				chars: 0n,
				first: 0n,
				last: 0n,
				pass: ALL,
				lead: 0n,
				trail: 0n,
				nullable: true,
				unbounded: false,
				factor: 1,
				guarded: false,
			};
		if (node.kind === "group") {
			const g = group(node.alts);
			if (!node.lookaround) return g;
			return {
				...g,
				chars: 0n,
				first: 0n,
				last: 0n,
				pass: ALL,
				lead: 0n,
				trail: 0n,
				nullable: true,
			};
		}
		const inner = info(node.node);
		const { min, max } = node;
		const repeats = max > 1;
		const variable = max > min;
		let guarded = inner.guarded;
		if (repeats && node.node.kind === "group") {
			if (inner.unbounded) throw new Unsafe("nested_quantifier");
			if (inner.factor > 1) {
				if (inner.factor ** max > SPLIT_BUDGET)
					throw new Unsafe("nested_quantifier");
				guarded = true;
			}
			if ((inner.trail & inner.lead) !== 0n)
				throw new Unsafe("adjacent_quantifiers");
		}
		const splits = inner.factor ** Math.min(max, 64) * (max - min + 1);
		return {
			chars: inner.chars,
			first: inner.first,
			last: inner.last,
			pass: min === 0 ? ALL : inner.pass,
			lead: variable ? inner.first | inner.lead : inner.lead,
			trail: variable ? inner.last | inner.trail : inner.trail,
			nullable: min === 0 || inner.nullable,
			unbounded: inner.unbounded || max === Number.POSITIVE_INFINITY,
			factor: Number.isFinite(splits) ? splits : Number.POSITIVE_INFINITY,
			guarded,
		};
	};

	return { guarded: group(parse(pattern)).guarded };
}

type Verdict = { reason: UnsafePatternReason | null; guarded: boolean };

const verdicts = new Map<string, Verdict>();
const VERDICT_CACHE_MAX = 256;

function verdict(pattern: string): Verdict {
	let v = verdicts.get(pattern);
	if (v) return v;
	if (pattern.length > PATTERN_MAX_LENGTH)
		v = { reason: "too_long", guarded: false };
	else {
		try {
			v = { reason: null, guarded: analyze(pattern).guarded };
		} catch (e) {
			if (!(e instanceof Unsafe)) throw e;
			v = { reason: e.reason, guarded: false };
		}
	}
	verdicts.set(pattern, v);
	if (verdicts.size > VERDICT_CACHE_MAX)
		verdicts.delete(verdicts.keys().next().value as string);
	return v;
}

/** Why a pattern is refused before it is compiled, or null when it is fine.
 *  A conservative static check, not a proof. It refuses patterns that are too
 *  long, that use backreferences, that repeat a group which itself repeats or
 *  whose alternatives may overlap (`(a+)+`, `(a|aa)*`, `(\w|\d)*`,
 *  `(.*a){20}`), and that put two variable quantifiers able to match the same
 *  character next to each other (`\d*\d*`, `.*a.*`). */
export function unsafePatternReason(
	pattern: string,
): UnsafePatternReason | null {
	return verdict(pattern).reason;
}

/** The longest value a pattern is tested against. Patterns that pass only
 *  because a bounded repeat keeps their backtracking small, such as
 *  `^(\d{1,3}\.){3}\d{1,3}$`, get the lower guarded cap. */
export function patternInputMaxLength(pattern: string): number {
	return verdict(pattern).guarded
		? PATTERN_GUARDED_INPUT_MAX_LENGTH
		: PATTERN_INPUT_MAX_LENGTH;
}
