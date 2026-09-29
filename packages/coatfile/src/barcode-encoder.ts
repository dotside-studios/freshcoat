import type { BearerBars, Symbology } from "./types";

// What an encoder hands compile: the modules of the symbol, without its quiet
// zone. A linear code is one row of bars; `text` is its human-readable line,
// check digit included. A matrix code is rows of modules, top to bottom.
export type BarcodeEncoding =
	| { kind: "linear"; modules: boolean[]; text: string }
	| { kind: "matrix"; rows: boolean[][] };

export type BarcodeEncodeResult =
	| { ok: true; encoding: BarcodeEncoding }
	| { ok: false; message: string };

export type BarcodeEncoder = (
	symbology: Symbology,
	value: string,
	opts: { errorCorrection?: number },
) => BarcodeEncodeResult;

// The encoder lives behind a registry so the main entry never imports one. The
// only implementation, `bwipBarcodeEncoder` from `@freshcoat-js/coatfile/barcode`,
// weighs ~87 KB gzipped, and most consumers compile templates without barcodes.
let registered: BarcodeEncoder | null = null;

/** Install the encoder compile uses for `barcode` elements. `null` removes it,
 *  and barcodes then draw as placeholders with a `barcode_unavailable` warning. */
export function setBarcodeEncoder(encoder: BarcodeEncoder | null): void {
	registered = encoder;
}

export function getBarcodeEncoder(): BarcodeEncoder | null {
	return registered;
}

export const SYMBOLOGIES: readonly Symbology[] = [
	"code128",
	"ean13",
	"upca",
	"code39",
	"itf14",
	"pdf417",
	"datamatrix",
	"aztec",
];

const LABELS: Record<Symbology, string> = {
	code128: "Code 128",
	ean13: "EAN-13",
	upca: "UPC-A",
	code39: "Code 39",
	itf14: "ITF-14",
	pdf417: "PDF417",
	datamatrix: "Data Matrix",
	aztec: "Aztec",
};

/** The symbology's usual name, as a person would read it. */
export function symbologyLabel(symbology: Symbology): string {
	return LABELS[symbology];
}

/** Linear codes are one row of bars; the rest are 2D. */
export function isLinearSymbology(symbology: Symbology): boolean {
	return (
		symbology === "code128" ||
		symbology === "ean13" ||
		symbology === "upca" ||
		symbology === "code39" ||
		symbology === "itf14"
	);
}

/** Codes that only read square, and so keep a square box as QR does. */
export function isSquareSymbology(symbology: Symbology): boolean {
	return symbology === "datamatrix" || symbology === "aztec";
}

// The minimum quiet zone each symbology's standard asks for, in modules. EAN-13
// asks 11 on the left and 7 on the right; one value covers both sides here, so
// it takes the larger.
const QUIET_ZONE: Record<Symbology, number> = {
	code128: 10,
	ean13: 11,
	upca: 9,
	code39: 10,
	itf14: 10,
	pdf417: 2,
	datamatrix: 1,
	aztec: 0,
};

/** The quiet zone, in modules each side, used when an element sets none. */
export function defaultQuietZone(symbology: Symbology): number {
	return QUIET_ZONE[symbology];
}

/** ITF-14's bearer bar thickness, in modules. GS1 asks for at least twice the
 *  narrow bar and recommends 4.8 mm at the nominal 1.016 mm module. */
export const BEARER_BAR_MODULES = 5;

/** The bearer bars a barcode draws: ITF-14's setting, and none elsewhere. */
export function bearerBarsOf(
	symbology: Symbology,
	bearerBars: BearerBars | undefined,
): BearerBars {
	return symbology === "itf14" ? (bearerBars ?? "none") : "none";
}

/** The range `errorCorrection` takes for a symbology, or null when it has none
 *  to set. PDF417 counts levels; Aztec a percentage of the symbol. */
export function errorCorrectionRange(
	symbology: Symbology,
): { min: number; max: number } | null {
	if (symbology === "pdf417") return { min: 0, max: 8 };
	if (symbology === "aztec") return { min: 5, max: 95 };
	return null;
}
