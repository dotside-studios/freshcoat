import type { FrameWarning } from "@freshcoat-js/coatfile";
import { describeWarning } from "@freshcoat-js/coatfile/render";
import type { BarcodeIssue } from "~/state/store";

const NO_WARNINGS = Object.freeze([]) as unknown as string[];

/** Barcode values the encoder refused go to the Issues list as hints, with
 *  their layer; everything else is a line under "Last render". */
export function splitWarnings(
	warnings: FrameWarning[],
	pathIds: Map<string, string> | undefined,
): { warnings: string[]; barcodes: BarcodeIssue[] } {
	const out = { warnings: [] as string[], barcodes: [] as BarcodeIssue[] };
	for (const w of warnings) {
		if (w.kind === "barcode_invalid") {
			const key = w.layer ? pathIds?.get(w.layer) : undefined;
			out.barcodes.push({
				...(key ? { key } : {}),
				symbology: w.symbology,
				value: w.value,
				message: w.message,
			});
		} else out.warnings.push(describeWarning(w));
	}
	if (out.warnings.length === 0) out.warnings = NO_WARNINGS;
	return out;
}
