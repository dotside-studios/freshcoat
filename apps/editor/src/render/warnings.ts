import type { PaintWarning } from "@freshcoat-js/engine";
import type { BarcodeIssue } from "~/state/store";

const NO_WARNINGS = Object.freeze([]) as unknown as string[];

/** Barcode values the encoder refused go to the Issues list as hints, with
 *  their layer; everything else is a line under "Last render". */
export function splitWarnings(
	warnings: PaintWarning[],
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

function describeWarning(w: PaintWarning): string {
	switch (w.kind) {
		case "image_load_failed":
			return `Couldn't load image: ${w.src.startsWith("data:") ? "inline data" : w.src}`;
		case "font_load_failed":
			return `Couldn't load font: ${w.family}`;
		case "qr_generate_failed":
			return `Couldn't generate QR code: ${w.value}`;
		case "unhandled_op":
			return `Unhandled draw op: ${w.op}`;
		case "adjust_unsupported":
			return `Adjustment skipped: ${w.component}`;
		case "text_path_overflow":
			return `Text runs past the end of its path${w.layer ? `: ${w.layer}` : ""}`;
		case "pattern_unsupported":
			return `Pattern shader failed, painted solid: ${w.pattern}`;
		default:
			return w.kind;
	}
}
