// Whether a chart reading is evidence good enough to turn into a printer
// correction. This is deliberately library policy rather than a UI convention:
// callers other than the chart tool must not be able to save a confident-looking
// profile from a blown-out or uneven photograph.

import { type ChartReading, repeatSpread } from "./measure";

export type CalibrationBlocker =
	| "stock-clipped"
	| "patches-missed"
	| "uneven-lighting"
	| "uneven-print"
	| "not-enough-gray-steps";

export type CalibrationAssessment = {
	usable: boolean;
	blockers: CalibrationBlocker[];
	metrics: {
		graySteps: number;
		missedPatches: number;
		lightSpread: number;
		repeatSpread: number;
	};
};

const MIN_GRAY_STEPS = 4;
const MAX_REPEAT_SPREAD = 4;

// Assess a chart independently of any particular UI. A little stock variation
// is normal camera noise; when it is both material and comparable to the
// repeated-patch variation, it means the light—not the printer—accounts for the
// measurement. A steady light with wide repeated-patch variation is instead a
// printer consistency problem. Neither should become a profile.
export function assessCalibration(
	reading: ChartReading,
): CalibrationAssessment {
	const graySteps = new Set(
		reading.patches
			.filter(
				(p) =>
					p.role === "measure" &&
					p.sent[0] === p.sent[1] &&
					p.sent[1] === p.sent[2],
			)
			.map((p) => p.sent[0]),
	).size;
	const spread = repeatSpread(reading);
	const lightBound = reading.lightSpread >= Math.max(2, spread * 0.6);
	const blockers: CalibrationBlocker[] = [];
	if (reading.stockClipped) blockers.push("stock-clipped");
	if (reading.missed.length > 0) blockers.push("patches-missed");
	if (graySteps < MIN_GRAY_STEPS) blockers.push("not-enough-gray-steps");
	if (lightBound) blockers.push("uneven-lighting");
	else if (spread >= MAX_REPEAT_SPREAD) blockers.push("uneven-print");

	return {
		usable: blockers.length === 0,
		blockers,
		metrics: {
			graySteps,
			missedPatches: reading.missed.length,
			lightSpread: reading.lightSpread,
			repeatSpread: spread,
		},
	};
}
