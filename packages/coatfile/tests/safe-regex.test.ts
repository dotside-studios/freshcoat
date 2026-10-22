import { describe, expect, test } from "bun:test";
import {
	PATTERN_GUARDED_INPUT_MAX_LENGTH,
	PATTERN_INPUT_MAX_LENGTH,
	patternInputMaxLength,
	unsafePatternReason,
} from "../src/safe-regex";
import { compiledPattern, textRuleBreaks } from "../src/text-rules";

const TIME_LIMIT_MS = 100;

function timeMatch(pattern: string, input: string): number {
	const re = compiledPattern(pattern) as RegExp;
	const started = performance.now();
	re.test(input);
	return performance.now() - started;
}

describe("catastrophic patterns are refused", () => {
	const unsafe: [string, string, string][] = [
		["^(\\w|\\d)*$", `${"1".repeat(28)}!`, "nested_quantifier"],
		["^(.|a)*$", `${"a".repeat(29)}\n`, "nested_quantifier"],
		["^([a-z]|a)*$", `${"a".repeat(29)}!`, "nested_quantifier"],
		["^(.*a){20}$", "a".repeat(41), "nested_quantifier"],
		["^\\d*\\d*\\d*\\d*\\d*x$", "1".repeat(300), "adjacent_quantifiers"],
		["^(a+)+$", `${"a".repeat(40)}!`, "nested_quantifier"],
		["^(a|aa)+$", `${"a".repeat(40)}!`, "nested_quantifier"],
		["^(?:\\d+\\s?)*$", `${"1".repeat(40)}!`, "nested_quantifier"],
		["^(a?){25}a{25}$", "a".repeat(25), "nested_quantifier"],
		["^(\\d{1,3}){3,}$", `${"1".repeat(40)}!`, "nested_quantifier"],
		[".*.*=.*", "x".repeat(5_000), "adjacent_quantifiers"],
		["^.*a.*a.*a.*$", `${"a".repeat(2_000)}\n`, "adjacent_quantifiers"],
		["^\\S+@\\S+\\.\\S+$", `a@${".".repeat(5_000)}`, "adjacent_quantifiers"],
		["^[a-z]+[a-c]+$", `${"a".repeat(5_000)}!`, "adjacent_quantifiers"],
		[`^${"(?:.|a)".repeat(30)}$`, "a".repeat(31), "ambiguous_alternatives"],
		[`^${"(?:\\d|\\w)".repeat(30)}$`, "1".repeat(31), "ambiguous_alternatives"],
		[`^${"(?:.|a){5}".repeat(6)}$`, "a".repeat(31), "ambiguous_alternatives"],
		["^(?i:a|A)*$", `${"a".repeat(40)}!`, "modifier_group"],
		["^(?-i:a|.)*$", `${"a".repeat(40)}!`, "modifier_group"],
		["^(?ims:x)$", "x", "modifier_group"],
	];

	test.each(unsafe)("%p", (pattern, input, reason) => {
		expect<string | null>(unsafePatternReason(pattern)).toBe(reason);
		expect(compiledPattern(pattern)).toBeNull();
		const started = performance.now();
		expect(textRuleBreaks({ pattern }, input)).toEqual([]);
		expect(performance.now() - started).toBeLessThan(TIME_LIMIT_MS);
	});
});

describe("common safe patterns are accepted", () => {
	const safe: [string, string][] = [
		["^[A-Z]{2}\\d{4}$", `AB${"1".repeat(9_000)}!`],
		["^\\p{L}+$", `${"a".repeat(9_000)}1`],
		["^(\\d{1,3}\\.){3}\\d{1,3}$", `${"1.".repeat(120)}x`],
		["^(png|jpg|gif)$", "png".repeat(3_000)],
		["^(a|b)+$", `${"ab".repeat(4_500)}!`],
		[
			"^[\\w-.]+@[\\w-]+\\.[a-z]{2,}$",
			`${"a".repeat(4_000)}@${"b".repeat(4_000)}!`,
		],
		["^(?:foo|bar)?baz$", "foo".repeat(3_000)],
		["^(?:\\d+(?:\\.\\d+)?|\\.\\d+)fr$", `${"1".repeat(9_000)}.f`],
		["^-?\\d+(\\.\\d+)?%$", `-${"1".repeat(9_000)}.`],
		["^[A-Za-z0-9 ]{4}$", "a".repeat(9_000)],
		["^[A-Z]+$", `${"A".repeat(9_000)}a`],
		["^(?=.*\\d)(?=.*[a-z]).{8,}$", "A".repeat(9_000)],
		["^\\d{5}(-\\d{4})?$", `12345-${"1".repeat(9_000)}`],
		["^#[0-9a-fA-F]{6}$", `#${"a".repeat(9_000)}`],
		["^\\+?[0-9 ()-]{7,20}$", `+${"1".repeat(9_000)}`],
		["^https?://\\S+$", `http://${"a".repeat(9_000)} `],
		["^\\d{4}-\\d{2}-\\d{2}$", `${"1".repeat(9_000)}-`],
		["^\\w+\\s\\w+$", `${"a".repeat(9_000)} !`],
		["^[a-z]+\\d+$", `${"a".repeat(4_500)}${"1".repeat(4_500)}!`],
		[`^${"(?:.|a)".repeat(10)}.*$`, `${"a".repeat(9_000)}\n`],
		["^[^\\s@]+@[^\\s@]+\\.[^\\s@.]+$", `a@${".".repeat(9_000)}`],
		["^\\d+\\.\\d+\\.\\d+\\.\\d+$", `${"1.".repeat(4_500)}x`],
	];

	test.each(safe)("%p", (pattern, input) => {
		expect(unsafePatternReason(pattern)).toBeNull();
		expect(compiledPattern(pattern)).not.toBeNull();
		const limit = patternInputMaxLength(pattern);
		expect(timeMatch(pattern, input.slice(0, limit))).toBeLessThan(
			TIME_LIMIT_MS,
		);
	});
});

describe("guarded input cap", () => {
	test("bounded nested repeats get the lower cap", () => {
		const ip = "^(\\d{1,3}\\.){3}\\d{1,3}$";
		expect(patternInputMaxLength(ip)).toBe(PATTERN_GUARDED_INPUT_MAX_LENGTH);
		expect(patternInputMaxLength("^[A-Z]+$")).toBe(PATTERN_INPUT_MAX_LENGTH);
	});

	test("values past the guarded cap never match", () => {
		const pattern = "^([a-z]|\\d){4}.*$";
		expect(patternInputMaxLength(pattern)).toBe(
			PATTERN_GUARDED_INPUT_MAX_LENGTH,
		);
		const long = `abcd${"x".repeat(PATTERN_GUARDED_INPUT_MAX_LENGTH)}`;
		expect(textRuleBreaks({ pattern }, long)).toEqual(["pattern_mismatch"]);
		expect(textRuleBreaks({ pattern }, "abcdx")).toEqual([]);
	});
});
