import type { CalibrationBlocker } from "@freshcoat-js/for-print/calibration";
import { describe, expect, test } from "vitest";
import { CORNERS, calibrationError } from "~/export/calibrate";

const assessment = (blockers: CalibrationBlocker[]) => ({
	usable: blockers.length === 0,
	blockers,
	metrics: { graySteps: 16, missedPatches: 0, lightSpread: 0, repeatSpread: 0 },
});

describe("calibrationError", () => {
	test("names each blocker in the photo", () => {
		const out = calibrationError({
			ok: false,
			reason: "unsafe-reading",
			assessment: assessment(["stock-clipped", "uneven-lighting"]),
			reading: {
				chartId: "gray-balance",
				patches: [],
				stock: [255, 255, 255],
				stockClipped: true,
				lightSpread: 0,
				missed: [],
			},
		});
		expect(out.title).toBe("Couldn't measure this photo");
		expect(out.details).toEqual([
			"The card is overexposed. Lower the exposure and retake.",
			"The light is uneven across the card. Retake in even light.",
		]);
	});

	test("says when the corners can't be read", () => {
		expect(
			calibrationError({ ok: false, reason: "unreadable-corners" }),
		).toEqual({
			title: "Couldn't read the chart from those corners",
			details: [],
		});
	});

	test("asks for the corners clockwise from top left", () => {
		expect(CORNERS).toEqual([
			"top left",
			"top right",
			"bottom right",
			"bottom left",
		]);
	});
});
