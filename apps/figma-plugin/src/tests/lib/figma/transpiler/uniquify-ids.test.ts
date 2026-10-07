import { describe, expect, it } from "vitest";
import {
	nestedElementArrays,
	uniquifyElementIdsDeep,
} from "~/lib/figma/transpiler/finalize";

function uniquifyElementIdsDeepReference(elements: unknown[]): unknown[] {
	const seen = new Set<string>();
	const walk = (els: unknown[]): void => {
		for (const raw of els) {
			const el = raw as Record<string, unknown>;
			const originalId = typeof el.id === "string" ? el.id : "";
			let id = originalId;
			if (seen.has(id)) {
				let n = 2;
				while (seen.has(`${originalId}_${n}`)) n += 1;
				id = `${originalId}_${n}`;
			}
			seen.add(id);
			el.id = id;
			for (const nested of nestedElementArrays(el)) walk(nested);
		}
	};
	walk(elements);
	return elements;
}

type El = { id?: unknown; type: string; properties?: Record<string, unknown> };

const rect = (id: unknown): El => ({ id, type: "rect" });
const frame = (id: string, children: El[]): El => ({
	id,
	type: "frame",
	properties: { children },
});
const mask = (id: string, maskEl: El | El[], children: El[]): El => ({
	id,
	type: "mask",
	properties: { mask: maskEl, children },
});

function ids(elements: unknown[]): string[] {
	const out: string[] = [];
	const walk = (els: unknown[]): void => {
		for (const raw of els) {
			const el = raw as Record<string, unknown>;
			out.push(el.id as string);
			for (const nested of nestedElementArrays(el)) walk(nested);
		}
	};
	walk(elements);
	return out;
}

function expectSameAsReference(build: () => El[]): string[] {
	const actual = ids(uniquifyElementIdsDeep(build()));
	expect(actual).toEqual(ids(uniquifyElementIdsDeepReference(build())));
	expect(new Set(actual).size).toBe(actual.length);
	return actual;
}

describe("uniquifyElementIdsDeep", () => {
	it("matches the reference on many duplicates", () => {
		const actual = expectSameAsReference(() =>
			Array.from({ length: 50 }, (_, i) =>
				rect(["Rectangle", "Frame", "Text"][i % 3]),
			),
		);
		expect(actual.slice(0, 6)).toEqual([
			"Rectangle",
			"Frame",
			"Text",
			"Rectangle_2",
			"Frame_2",
			"Text_2",
		]);
	});

	it("matches the reference when names already carry _N suffixes", () => {
		const actual = expectSameAsReference(() => [
			rect("Rectangle_3"),
			rect("Rectangle"),
			rect("Rectangle"),
			rect("Rectangle"),
			rect("Rectangle_2"),
			rect("Rectangle"),
			rect("Rectangle_2"),
			rect("Rectangle_2"),
			rect("Rectangle_2_2"),
			rect("Rectangle"),
			rect("Rectangle_5"),
			rect("Rectangle"),
		]);
		expect(actual).toEqual([
			"Rectangle_3",
			"Rectangle",
			"Rectangle_2",
			"Rectangle_4",
			"Rectangle_2_2",
			"Rectangle_5",
			"Rectangle_2_3",
			"Rectangle_2_4",
			"Rectangle_2_2_2",
			"Rectangle_6",
			"Rectangle_5_2",
			"Rectangle_7",
		]);
	});

	it("matches the reference on nested duplicates", () => {
		expectSameAsReference(() => [
			rect("Text"),
			frame("Frame", [
				rect("Text"),
				rect("Text_2"),
				frame("Frame", [rect("Text"), rect("Text_3"), rect("Frame_2")]),
			]),
			mask("Mask", [rect("Text"), rect("Mask")], [rect("Text"), rect(42)]),
			mask("Mask", rect("Frame"), [frame("Frame", [rect("Text")])]),
			rect(undefined),
			rect("Text"),
		]);
	});

	it("matches the reference on random inputs", () => {
		let seed = 1;
		const rand = (n: number): number => {
			seed = (seed * 1103515245 + 12345) % 2 ** 31;
			return seed % n;
		};
		const names = ["A", "A_2", "A_3", "A_2_2", "B", "B_10", "", "_2"];
		for (let round = 0; round < 50; round++) {
			const snapshot = seed;
			const build = (): El[] => {
				seed = snapshot;
				const gen = (depth: number): El[] =>
					Array.from({ length: 1 + rand(8) }, () =>
						depth < 3 && rand(4) === 0
							? frame(names[rand(names.length)], gen(depth + 1))
							: rect(names[rand(names.length)]),
					);
				return gen(0);
			};
			expectSameAsReference(build);
		}
	});

	it("dedupes 10k same-named nodes quickly", () => {
		const elements = Array.from({ length: 10_000 }, () => rect("Rectangle"));
		const start = performance.now();
		uniquifyElementIdsDeep(elements);
		const elapsed = performance.now() - start;
		expect(ids(elements).at(-1)).toBe("Rectangle_10000");
		expect(elapsed).toBeLessThan(200);
	});
});
