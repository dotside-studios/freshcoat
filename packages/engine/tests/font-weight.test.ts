// Weight on a VARIABLE face. `fontStyle.weight` only picks among the faces a
// family registered, and a variable font registers as one face at its default
// instance — which is how Google Fonts serves a browser (one woff2 per subset,
// reused across every weight row of the stylesheet). Without the `wght` axis a
// 700 span therefore matches that 400 face and gets Skia's synthetic bold: 400's
// advances, so text that is both too light and wrapped as if it were regular.
import { readFileSync } from "node:fs";
import { loadCanvasKit, testFontPath } from "@freshcoat-js/test-utils";
import { describe, expect, test } from "vitest";
import { createParagraphEngine } from "../src/paragraph-layout";

const VARIABLE = testFontPath("VendSans-Variable-latin.woff2");
const STATIC = testFontPath("Geist-Regular.ttf");

const SAMPLE = "Certificate of Appreciation";

const measure = (
	engine: ReturnType<typeof createParagraphEngine>,
	family: string,
	weight: number,
	variations?: Record<string, number>,
) =>
	engine.measureText(
		SAMPLE,
		{ family, weight, style: "normal", size: 29, lineHeight: 1.2, variations },
		null,
	).width;

describe("variable font weights", () => {
	test("a 700 span is heavier — and wider — than 400 from the same variable face", async () => {
		const ck = await loadCanvasKit();
		const bytes = new Uint8Array(readFileSync(VARIABLE));
		const engine = createParagraphEngine(ck, new Map([["Vend Sans", [bytes]]]));
		try {
			const regular = measure(engine, "Vend Sans", 400);
			const bold = measure(engine, "Vend Sans", 700);
			// Instancing the axis widens the advances. Matching widths would mean
			// both weights resolved to the default instance — the bug this guards.
			expect(regular).toBeGreaterThan(0);
			expect(bold).toBeGreaterThan(regular + 1);
		} finally {
			engine.dispose();
		}
	});

	test("a static face ignores the axis rather than distorting", async () => {
		const ck = await loadCanvasKit();
		const bytes = new Uint8Array(readFileSync(STATIC));
		const engine = createParagraphEngine(ck, new Map([["Geist", [bytes]]]));
		try {
			// One registered face, no `wght` axis: 400 and 700 both resolve to it and
			// measure the same. (Synthetic bold is Skia's business; what matters is
			// that setting the axis doesn't corrupt a non-variable family.)
			expect(measure(engine, "Geist", 700)).toBe(measure(engine, "Geist", 400));
		} finally {
			engine.dispose();
		}
	});

	test("a light weight is lighter, and narrower, than regular", async () => {
		const ck = await loadCanvasKit();
		const bytes = new Uint8Array(readFileSync(VARIABLE));
		const engine = createParagraphEngine(ck, new Map([["Vend Sans", [bytes]]]));
		try {
			expect(measure(engine, "Vend Sans", 300)).toBeLessThan(
				measure(engine, "Vend Sans", 400) - 1,
			);
		} finally {
			engine.dispose();
		}
	});

	test("a wght variation overrides the weight step", async () => {
		const ck = await loadCanvasKit();
		const bytes = new Uint8Array(readFileSync(VARIABLE));
		const engine = createParagraphEngine(ck, new Map([["Vend Sans", [bytes]]]));
		try {
			const bold = measure(engine, "Vend Sans", 700);
			expect(measure(engine, "Vend Sans", 400, { wght: 700 })).toBe(bold);
			const between = measure(engine, "Vend Sans", 500, { wght: 550 });
			expect(between).toBeGreaterThan(measure(engine, "Vend Sans", 500));
			expect(between).toBeLessThan(measure(engine, "Vend Sans", 600));
		} finally {
			engine.dispose();
		}
	});
});
