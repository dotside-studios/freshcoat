import { describe, expect, it } from "vitest";
import {
	exactSizeCheck,
	fromDesignSize,
	SizeMismatchError,
	sizesAgree,
} from "~/lib/figma/transpiler/exact-size";

const PRODUCT = { width: 1013, height: 638 };

describe("exactSizeCheck", () => {
	it("accepts an exact landscape frame and returns canonical landscape dims", () => {
		const r = exactSizeCheck(1013, 638, PRODUCT);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.orientation).toBe("landscape");
			expect(r.width).toBe(1013);
			expect(r.height).toBe(638);
		}
	});

	it("accepts an exact portrait frame and returns transposed canonical dims", () => {
		const r = exactSizeCheck(638, 1013, PRODUCT);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.orientation).toBe("portrait");
			expect(r.width).toBe(638);
			expect(r.height).toBe(1013);
		}
	});

	it("accepts sub-pixel measurements within ±1px", () => {
		const r = exactSizeCheck(1012.6, 638.4, PRODUCT);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.width).toBe(1013);
	});

	it("rejects an off-size frame and suggests the nearest orientation's dims", () => {
		const r = exactSizeCheck(1000, 630, PRODUCT);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			// wider than tall → suggest landscape canonical
			expect(r.suggestedWidth).toBe(1013);
			expect(r.suggestedHeight).toBe(638);
		}
	});

	it("suggests portrait canonical for an off-size taller-than-wide frame", () => {
		const r = exactSizeCheck(630, 1000, PRODUCT);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.suggestedWidth).toBe(638);
			expect(r.suggestedHeight).toBe(1013);
		}
	});
});

describe("fromDesignSize", () => {
	it("takes the frame's own measurement, whatever it is", () => {
		// A4 portrait at 300 DPI — nothing a product catalog would ever declare.
		const r = fromDesignSize(2480, 3508);
		expect(r.width).toBe(2480);
		expect(r.height).toBe(3508);
		expect(r.orientation).toBe("portrait");
	});

	it("rounds sub-pixel bounds to the integers coatfile requires", () => {
		const r = fromDesignSize(2479.6, 3507.4);
		expect(r.width).toBe(2480);
		expect(r.height).toBe(3507);
	});

	it("calls a square canvas landscape", () => {
		expect(fromDesignSize(1000, 1000).orientation).toBe("landscape");
	});
});

describe("SizeMismatchError", () => {
	const issue = (slot: string, width: number, height: number) => ({
		slot,
		nodeId: `id-${slot}`,
		nodeName: slot,
		width,
		height,
		expectedWidth: 1013,
		expectedHeight: 638,
	});

	it("names every offending frame and its target size", () => {
		const err = new SizeMismatchError("exact_size", [
			issue("front", 1000, 630),
			issue("back", 638, 1013),
		]);
		expect(err.message).toBe(
			"exact_size: 'front' is 1000×630 — resize to 1013×638; 'back' is 638×1013 — resize to 1013×638.",
		);
		expect(err.issues).toHaveLength(2);
	});

	it("is catchable as an Error and carries its code", () => {
		const err = new SizeMismatchError("size_mismatch", [issue("x", 1, 1)]);
		expect(err).toBeInstanceOf(Error);
		expect(err.code).toBe("size_mismatch");
	});
});

describe("sizesAgree", () => {
	const a = { orientation: "landscape" as const, width: 2480, height: 1748 };

	it("accepts a sub-pixel difference", () => {
		expect(
			sizesAgree(a, { orientation: "landscape", width: 2481, height: 1747 }),
		).toBe(true);
	});

	it("rejects a real difference", () => {
		expect(
			sizesAgree(a, { orientation: "landscape", width: 2400, height: 1748 }),
		).toBe(false);
	});
});
