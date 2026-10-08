import { createRenderer, decodePixels } from "@freshcoat-js/engine";
import type { PixelData } from "@freshcoat-js/for-print";
import {
	type CalibrationBlocker,
	chartScene,
	grayBalanceChart,
	type PhotoCalibration,
} from "@freshcoat-js/for-print/calibration";
import { getCanvasKit } from "~/render/canvaskit";

export const CHART = grayBalanceChart();

export const CHART_FILE = "gray-balance-chart.png";

const PHOTO_MAX = 2400;

export async function renderChartPng(): Promise<Uint8Array> {
	const renderer = await createRenderer({
		ck: await getCanvasKit(),
		cache: false,
	});
	try {
		const out = await renderer.render(chartScene(CHART), {
			width: CHART.width,
			height: CHART.height,
		});
		return out.bytes;
	} finally {
		renderer.dispose();
	}
}

export async function decodePhoto(
	bytes: Uint8Array,
): Promise<PixelData | null> {
	return decodePixels(await getCanvasKit(), bytes, { maxDim: PHOTO_MAX });
}

export const CORNERS = [
	"top left",
	"top right",
	"bottom right",
	"bottom left",
] as const;

const BLOCKERS: Record<CalibrationBlocker, string> = {
	"stock-clipped": "The card is overexposed. Lower the exposure and retake.",
	"patches-missed": "Some patches fall outside the photo. Check the corners.",
	"uneven-lighting":
		"The light is uneven across the card. Retake in even light.",
	"uneven-print": "The print is uneven across the card. Print the chart again.",
	"not-enough-gray-steps": "Too few gray steps were read. Use the gray chart.",
};

export function calibrationError(
	result: Exclude<PhotoCalibration, { ok: true }>,
): { title: string; details: string[] } {
	switch (result.reason) {
		case "unreadable-corners":
			return {
				title: "Couldn't read the chart from those corners",
				details: [],
			};
		case "unsafe-reading":
			return {
				title: "Couldn't measure this photo",
				details: result.assessment.blockers.map((b) => BLOCKERS[b]),
			};
		case "missing-name":
			return { title: "Name the profile", details: [] };
		case "invalid-conditions":
			return {
				title: "Couldn't save the printer, ribbon or stock",
				details: [],
			};
	}
}
