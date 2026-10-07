import type { PrintProfile } from "@freshcoat-js/for-print";
import { formatDate } from "~/app/format";

/** The preview's line under a printer file. for-print reports from 2%. */
export function printerFileNote(percent: number): string {
	const base = "Printer file, not a proof of the printed card";
	return percent >= 2
		? `${base} · ${percent}% of photo color pulled into printer range`
		: base;
}

/** The profile row's text: its name and the day it was measured. */
export function profileLabel(profile: PrintProfile): {
	name: string;
	date: string | null;
} {
	const at = profile.measuredAt ? new Date(profile.measuredAt) : null;
	const date =
		at && !Number.isNaN(at.getTime())
			? formatDate(at, {
					year: "numeric",
					month: "short",
					day: "numeric",
				})
			: null;
	return { name: profile.name, date };
}
