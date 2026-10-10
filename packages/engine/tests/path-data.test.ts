import { describe, expect, it } from "bun:test";
import { scalePathData } from "../src/path-data";

describe("scalePathData", () => {
	it("returns the input untouched at 1x", () => {
		expect(scalePathData("M0 0L10 10Z", 1)).toBe("M0 0L10 10Z");
	});

	it("scales every coordinate of the line and curve commands", () => {
		expect(scalePathData("M1 2 L3 4 C5 6 7 8 9 10 Z", 2)).toBe(
			"M2 4 L6 8 C10 12 14 16 18 20 Z",
		);
	});

	it("scales H and V on their own axis", () => {
		expect(scalePathData("M0 0 H10 V20", 2, 3)).toBe("M0 0 H20 V60");
	});

	it("leaves an arc's rotation and flags alone", () => {
		expect(scalePathData("M0 0 A10 20 45 1 0 30 40", 2)).toBe(
			"M0 0 A20 40 45 1 0 60 80",
		);
	});

	it("reads flags written without separators", () => {
		expect(scalePathData("m0 0a1 1 0 01 5 5", 2)).toBe("m0 0a2 2 0 01 10 10");
		expect(scalePathData("a1 1 0 015 5", 2)).toBe("a2 2 0 01 10 10");
	});

	it("reads implicit repeats, signs and packed decimals", () => {
		expect(scalePathData("M0,0 L1-1 2.5.5", 2)).toBe("M0,0 L2-2 5 1");
	});

	it("keeps multiple subpaths", () => {
		expect(scalePathData("M0 0L1 0Z M2 2L3 2Z", 10)).toBe(
			"M0 0L10 0Z M20 20L30 20Z",
		);
	});

	it("throws on data it cannot read", () => {
		expect(() => scalePathData("M0 0 X5", 2)).toThrow();
		expect(() => scalePathData("M0 0 A1 1 0 2 0 5 5", 2)).toThrow();
	});

	it("matches the quadratic reference on a long path", () => {
		const arity: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, A: 7, Z: 0 };
		const axes: Record<string, (number | null)[]> = {
			M: [2, 3], L: [2, 3], H: [2], V: [3], C: [2, 3, 2, 3, 2, 3],
			A: [2, 3, null, null, null, 2, 3], Z: [],
		};
		const reference = (d: string, sx: number, sy: number): string => {
			let out = "";
			let i = 0;
			let cmd = "";
			let argIndex = 0;
			const sep = () => {
				while (i < d.length && /[\s,]/.test(d[i] as string)) out += d[i++];
			};
			sep();
			while (i < d.length) {
				const ch = d[i] as string;
				if (/[a-zA-Z]/.test(ch)) {
					cmd = ch;
					argIndex = 0;
					out += ch;
					i++;
					sep();
					continue;
				}
				const upper = cmd.toUpperCase();
				const slot = argIndex % (arity[upper] as number);
				let token: string;
				if (upper === "A" && (slot === 3 || slot === 4)) {
					token = ch;
					i++;
				} else {
					token = (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(d.slice(i)) as RegExpExecArray)[0];
					i += token.length;
				}
				const axis = (axes[upper] as (number | null)[])[slot];
				if (axis) {
					const t = String(Number.parseFloat(token) * (axis === 2 ? sx : sy));
					if (/[\d.]$/.test(out) && !/^[-+]/.test(t)) out += " ";
					out += t;
				} else out += token;
				argIndex++;
				sep();
			}
			return out;
		};
		const build = (count: number) => {
			let d = "M0 0";
			for (let i = 0; i < count; i++) {
				const n = i % 6;
				if (n === 0) d += `L${i}.5.25-3 `;
				else if (n === 1) d += "c1,2 3 4 5 6";
				else if (n === 2) d += `H${i}V-${i}.5`;
				else if (n === 3) d += "a1.5 2 30 01 5 5";
				else if (n === 4) d += "L1e2,-2.5E-1";
				else d += `Z M${i} ${i}`;
			}
			return d;
		};
		const small = build(3000);
		expect(scalePathData(small, 0.37, 1.9)).toBe(reference(small, 0.37, 1.9));
		const large = build(30_000);
		expect(scalePathData(large, 0.37, 1.9).length).toBeGreaterThan(large.length / 2);
	});
});
