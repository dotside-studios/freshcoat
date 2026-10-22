import { expect, test } from "bun:test";
import { patternInputMaxLength, unsafePatternReason } from "../src/safe-regex";
import { compiledPattern } from "../src/text-rules";

const SEED = 0x5afe;
const PATTERNS = 2_000;
const TIME_LIMIT_MS = 100;

const ATOMS = ["a", "1", ".", "\\w", "\\d", "\\S", "[a-c]", "[^b]"];
const AMBIGUOUS = [
	"(?:.|a)",
	"(?:\\d|\\w)",
	"(?:a|a)",
	"(?:[a-c]|\\S)",
	"(?:a|1|\\w)",
	"(?i:a|A)",
	"(?-i:a|.)",
];
const QUANTIFIERS = ["", "", "?", "*", "+", "{2}", "{1,3}", "{3,}"];
const FILLERS = ["a", "1", "!", "\n", "\t"];

function rng(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function generate(next: () => number): string {
	const pick = <T>(list: T[]): T => list[Math.floor(next() * list.length)] as T;
	const node = (depth: number): string => {
		const roll = next();
		if (roll < 0.1) return pick(AMBIGUOUS).repeat(2 + Math.floor(next() * 10));
		if (roll < 0.3)
			return pick(AMBIGUOUS) + (next() < 0.8 ? "" : pick(QUANTIFIERS));
		if (depth > 2 || roll < 0.6) return pick(ATOMS) + pick(QUANTIFIERS);
		const alts = Array.from({ length: 1 + Math.floor(next() * 3) }, () =>
			seq(depth + 1),
		);
		return `(?:${alts.join("|")})${pick(QUANTIFIERS)}`;
	};
	const seq = (depth: number): string =>
		Array.from({ length: 1 + Math.floor(next() * 4) }, () => node(depth)).join(
			"",
		);
	const body = (max: number): string =>
		Array.from({ length: 1 + Math.floor(next() * max) }, () => node(0)).join(
			"",
		);
	const prefix = pick([
		".*",
		"\\w*",
		"[a-z]+",
		`\\w{0,${1 + Math.floor(next() * 60)}}`,
	]);
	const tail = pick(["", "b", "!", "$"]);
	const shapes = [
		() => `^(?:${body(12)})$`,
		() => `${body(4)}${tail}`,
		() => `${prefix}${body(4)}${tail}`,
		() => `${body(3)}.*${body(3)}${tail}`,
		() => `^${prefix}${body(4)}${tail}`,
	];
	return pick(shapes)();
}

function adversarial(next: () => number, length: number): string[] {
	const pick = <T>(list: T[]): T => list[Math.floor(next() * list.length)] as T;
	return [
		`${"a".repeat(length)}!`,
		`${"1".repeat(length)}!`,
		`${"a1".repeat(length / 2)}\n`,
		Array.from({ length }, () => pick(FILLERS)).join(""),
	];
}

// Unanchored patterns retry from every offset, so even `.*x` is quadratic.
// Anything slower than a few times that is a blowup the check missed.
const baselines = new Map<number, number>();
function quadraticBaseline(length: number): number {
	let ms = baselines.get(length);
	if (ms !== undefined) return ms;
	const re = /.*x/u;
	const input = `${"a".repeat(length)}!`;
	re.test(input);
	const started = performance.now();
	re.test(input);
	ms = performance.now() - started;
	baselines.set(length, ms);
	return ms;
}

test("accepted random patterns finish on adversarial input", () => {
	const next = rng(SEED);
	let accepted = 0;
	for (let n = 0; n < PATTERNS; n++) {
		const pattern = generate(next);
		if (unsafePatternReason(pattern) !== null) continue;
		const re = compiledPattern(pattern);
		if (!re) continue;
		accepted++;
		const limit = patternInputMaxLength(pattern);
		for (const length of [32, limit])
			for (const input of adversarial(next, length)) {
				const bound = Math.max(TIME_LIMIT_MS, 4 * quadraticBaseline(length));
				const started = performance.now();
				re.test(input);
				const elapsed = performance.now() - started;
				if (elapsed >= bound)
					throw new Error(
						`${pattern} took ${elapsed} ms on ${input.length} chars`,
					);
			}
	}
	expect(accepted).toBeGreaterThan(PATTERNS / 100);
}, 60_000);
