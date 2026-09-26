// Canvas sizing for the transpiler, in two modes.
//
// EXACT (product export): a product declares an EXACT print size (e.g. CR80 at
// ~300 DPI = 1013×638). A card side frame must measure that size in either
// orientation, within ±1px (sub-pixel rounding). Order-site prints at the
// template's native width/height, so the emitted dims must equal the product's
// exact pixels — no ratio math, no resolution flexibility, no scaling.
//
// FROM-DESIGN (custom export): there is no product and nothing downstream
// pinning a print size, so the picked frame IS the canvas — see fromDesignSize.

export const SIZE_TOLERANCE = 1; // px

export type CanvasSize = {
	orientation: "landscape" | "portrait";
	width: number;
	height: number;
};

export type ExactSizeResult =
	| ({ ok: true } & CanvasSize)
	| { ok: false; suggestedWidth: number; suggestedHeight: number };

function near(a: number, b: number): boolean {
	return Math.abs(Math.round(a) - b) <= SIZE_TOLERANCE;
}

export function exactSizeCheck(
	fw: number,
	fh: number,
	product: { width: number; height: number },
): ExactSizeResult {
	const { width: W, height: H } = product;
	if (near(fw, W) && near(fh, H)) {
		return { ok: true, orientation: "landscape", width: W, height: H };
	}
	if (near(fw, H) && near(fh, W)) {
		return { ok: true, orientation: "portrait", width: H, height: W };
	}
	// Off-size: suggest the canonical dims for the orientation the frame leans to.
	const landscape = fw >= fh;
	return {
		ok: false,
		suggestedWidth: landscape ? W : H,
		suggestedHeight: landscape ? H : W,
	};
}

/** Custom export: the design is the spec, so the frame's own measurement is the
 *  canvas. Rounded to integers because coatfile's schema rejects fractional
 *  width/height, and Figma reports sub-pixel bounds for hand-drawn frames. */
export function fromDesignSize(fw: number, fh: number): CanvasSize {
	const width = Math.round(fw);
	const height = Math.round(fh);
	return {
		orientation: width >= height ? "landscape" : "portrait",
		width,
		height,
	};
}

/** Whether two slot canvases are the same, within the sub-pixel tolerance. A
 *  template has ONE width/height for every frame in it, so multi-frame custom
 *  exports have to agree. */
export function sizesAgree(a: CanvasSize, b: CanvasSize): boolean {
	return (
		Math.abs(a.width - b.width) <= SIZE_TOLERANCE &&
		Math.abs(a.height - b.height) <= SIZE_TOLERANCE
	);
}

/** One frame that doesn't measure the template's canvas, with everything a
 *  caller needs to fix it in place: which node, what it is, what it must be. */
export type SizeIssue = {
	slot: string;
	nodeId: string;
	nodeName: string;
	width: number;
	height: number;
	expectedWidth: number;
	expectedHeight: number;
};

/** Thrown when any slot frame is off-canvas. Carries EVERY offending frame,
 *  not just the first: sizing is checked for all slots up front so an author
 *  fixes them in one pass instead of discovering them one export at a time.
 *  `code` distinguishes the two sizing modes for callers that key off it. */
export class SizeMismatchError extends Error {
	readonly code: "exact_size" | "size_mismatch";
	readonly issues: SizeIssue[];

	constructor(code: "exact_size" | "size_mismatch", issues: SizeIssue[]) {
		const detail = issues
			.map(
				(i) =>
					`'${i.slot}' is ${i.width}×${i.height} — resize to ${i.expectedWidth}×${i.expectedHeight}`,
			)
			.join("; ");
		super(`${code}: ${detail}.`);
		this.name = "SizeMismatchError";
		this.code = code;
		this.issues = issues;
	}
}
