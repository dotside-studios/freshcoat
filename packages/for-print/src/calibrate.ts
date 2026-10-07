import { type ChartSpec, grayBalanceChart, type Point } from "./chart";
import { type ChartReading, readChart } from "./measure";
import {
	createPrintProfile,
	type PrintProfileCreation,
	type PrintProfileDetails,
} from "./profile";
import type { PixelData } from "./types";

export type PhotoCalibration =
	| (PrintProfileCreation & { reading: ChartReading })
	| { ok: false; reason: "unreadable-corners" };

// A photo of a printed gray balance chart to a profile, in one call. `corners`
// are the four fiducial centers picked in the photo, clockwise from top-left.
// `spec` must be the chart that was printed.
export function profileFromPhoto(
	photo: PixelData,
	corners: [Point, Point, Point, Point],
	details: PrintProfileDetails,
	spec: ChartSpec = grayBalanceChart(),
): PhotoCalibration {
	const reading = readChart(photo, spec, corners);
	if (!reading) return { ok: false, reason: "unreadable-corners" };
	return { ...createPrintProfile(reading, details), reading };
}
