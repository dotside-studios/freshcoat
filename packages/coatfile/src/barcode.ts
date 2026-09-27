// `@freshcoat-js/coatfile/barcode`: the bwip-js encoder behind `setBarcodeEncoder`.
// A subpath of its own so that bwip-js stays out of every bundle that only
// imports the main entry; the caller that needs barcodes registers it.
import {
	azteccode,
	code39,
	code128,
	datamatrix,
	ean13,
	itf14,
	pdf417,
	upca,
} from "bwip-js/generic";
import {
	type BarcodeEncodeResult,
	type BarcodeEncoder,
	type BarcodeEncoding,
	isLinearSymbology,
} from "./barcode-encoder";
import type { Symbology } from "./types";

type Point = [number, number];

// bwip-js draws through a context it is handed. This one draws nothing: at
// scale 1 every bar and module lands on whole units, so it records where they
// go and hands back the geometry, from which the modules are read.
type Drawing = {
	width: number;
	height: number;
	// Vertical bars: left edge and width, in modules.
	bars: Array<{ left: number; width: number }>;
	// One entry per fill: the polygons it closed, filled even-odd as bwip-js's
	// own SVG output does.
	fills: Point[][][];
};

function collectingContext() {
	const drawing: Drawing = { width: 0, height: 0, bars: [], fills: [] };
	let pending: Point[][] = [];
	return {
		setopts() {},
		scale(): [number, number] {
			return [1, 1];
		},
		measure() {
			return { width: 0, ascent: 0, descent: 0 };
		},
		init(width: number, height: number) {
			drawing.width = width;
			drawing.height = height;
		},
		line(x0: number, _y0: number, x1: number, _y1: number, lw: number) {
			if (x0 !== x1) return;
			// bwip-js centres a line on its bar with the centre rounded to a whole
			// unit, so an odd-width bar's centre is half a module off its middle.
			// Flooring the left edge undoes either rounding.
			const width = Math.round(lw);
			drawing.bars.push({ left: Math.floor(x0 - lw / 2 + 1e-6), width });
		},
		polygon(pts: Point[]) {
			pending.push(pts);
		},
		hexagon(pts: Point[]) {
			pending.push(pts);
		},
		ellipse() {},
		fill() {
			if (pending.length > 0) drawing.fills.push(pending);
			pending = [];
		},
		text() {},
		end() {
			return drawing;
		},
	};
}

type Render = (opts: never, ctx: ReturnType<typeof collectingContext>) => Drawing;

const RENDERERS: Record<Symbology, { bcid: string; render: Render }> = {
	code128: { bcid: "code128", render: code128 as Render },
	ean13: { bcid: "ean13", render: ean13 as Render },
	upca: { bcid: "upca", render: upca as Render },
	code39: { bcid: "code39", render: code39 as Render },
	itf14: { bcid: "itf14", render: itf14 as Render },
	pdf417: { bcid: "pdf417", render: pdf417 as Render },
	datamatrix: { bcid: "datamatrix", render: datamatrix as Render },
	aztec: { bcid: "azteccode", render: azteccode as Render },
};

// GS1's mod-10 check digit, as EAN-13, UPC-A and ITF-14 all use it: weights
// 3 and 1 alternating from the rightmost data digit.
function gs1CheckDigit(digits: string): number {
	let sum = 0;
	for (let i = 0; i < digits.length; i++) {
		const d = digits.charCodeAt(digits.length - 1 - i) - 48;
		sum += i % 2 === 0 ? d * 3 : d;
	}
	return (10 - (sum % 10)) % 10;
}

const GS1_LENGTH: Partial<Record<Symbology, { length: number; label: string }>> =
	{
		ean13: { length: 13, label: "EAN-13" },
		upca: { length: 12, label: "UPC-A" },
		itf14: { length: 14, label: "ITF-14" },
	};

// The text bwip-js is given and the human-readable line under the bars. A GS1
// number arrives with or without its check digit and always leaves with it; a
// wrong one is refused with the digit it should have been, which bwip-js does
// not say. Anything else malformed is left to bwip-js, whose messages name the
// rule that was broken.
function prepare(
	symbology: Symbology,
	value: string,
): { ok: true; text: string } | { ok: false; message: string } {
	const gs1 = GS1_LENGTH[symbology];
	if (gs1 && /^\d+$/.test(value)) {
		if (value.length === gs1.length - 1) {
			return { ok: true, text: value + gs1CheckDigit(value) };
		}
		if (value.length === gs1.length) {
			const expected = gs1CheckDigit(value.slice(0, -1));
			if (Number(value[value.length - 1]) !== expected) {
				return {
					ok: false,
					message: `${gs1.label} check digit should be ${expected}`,
				};
			}
		}
	}
	if (symbology === "code39") return { ok: true, text: value.toUpperCase() };
	// Code 128 carries ASCII, and Latin-1 through its FNC4 shift. bwip-js would
	// encode anything past that as a byte of its own choosing, which scans as
	// some other character.
	if (
		symbology === "code128" &&
		[...value].some((c) => (c.codePointAt(0) ?? 0) > 0xff)
	) {
		return {
			ok: false,
			message: "Code 128 must contain only ASCII and Latin-1 characters",
		};
	}
	return { ok: true, text: value };
}

function bwipOptions(
	symbology: Symbology,
	text: string,
	errorCorrection: number | undefined,
): Record<string, unknown> {
	const opts: Record<string, unknown> = {
		bcid: RENDERERS[symbology].bcid,
		text,
		scale: 1,
		includetext: false,
	};
	// ITF-14's bearer bars are a frame around the symbol rather than modules
	// of it; the element's background and quiet zone stand in for them.
	if (symbology === "itf14") opts.showborder = false;
	if (errorCorrection !== undefined && Number.isFinite(errorCorrection)) {
		if (symbology === "pdf417") {
			opts.eclevel = Math.min(8, Math.max(0, Math.round(errorCorrection)));
		} else if (symbology === "aztec") {
			opts.eclevel = Math.min(95, Math.max(5, Math.round(errorCorrection)));
		}
	}
	return opts;
}

function linearModules(drawing: Drawing): boolean[] {
	if (drawing.bars.length === 0) return [];
	// Every linear symbology starts and ends on a bar, so the symbol is the
	// span from the first bar to the last, whatever margin bwip-js drew around it.
	let start = Number.POSITIVE_INFINITY;
	let end = Number.NEGATIVE_INFINITY;
	for (const bar of drawing.bars) {
		start = Math.min(start, bar.left);
		end = Math.max(end, bar.left + bar.width);
	}
	const modules = new Array<boolean>(end - start).fill(false);
	for (const bar of drawing.bars) {
		for (let x = bar.left; x < bar.left + bar.width; x++) {
			modules[x - start] = true;
		}
	}
	return modules;
}

// Even-odd point in polygon, sampled at the module's centre.
function inside(polys: Point[][], x: number, y: number): boolean {
	let crossings = 0;
	for (const poly of polys) {
		for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
			const [xi, yi] = poly[i];
			const [xj, yj] = poly[j];
			if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
				crossings++;
			}
		}
	}
	return crossings % 2 === 1;
}

function matrixRows(drawing: Drawing): boolean[][] {
	const cols = Math.round(drawing.width);
	const rows: boolean[][] = [];
	for (let r = 0; r < Math.round(drawing.height); r++) {
		const row = new Array<boolean>(cols).fill(false);
		for (let c = 0; c < cols; c++) {
			for (const fill of drawing.fills) {
				if (inside(fill, c + 0.5, r + 0.5)) {
					row[c] = true;
					break;
				}
			}
		}
		rows.push(row);
	}
	return rows;
}

const BWIPP_PREFIX = /^(?:Error:\s*)?bwipp\.[\w.]+#\d+:\s*/;

function encode(
	symbology: Symbology,
	value: string,
	errorCorrection: number | undefined,
): BarcodeEncodeResult {
	const renderer = RENDERERS[symbology];
	if (!renderer) return { ok: false, message: "Unknown barcode type" };
	if (value === "") return { ok: false, message: "The value is empty" };
	const prepared = prepare(symbology, value);
	if (!prepared.ok) return prepared;
	let drawing: Drawing;
	try {
		drawing = renderer.render(
			bwipOptions(symbology, prepared.text, errorCorrection) as never,
			collectingContext(),
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, message: message.replace(BWIPP_PREFIX, "") };
	}
	const encoding: BarcodeEncoding = isLinearSymbology(symbology)
		? { kind: "linear", modules: linearModules(drawing), text: prepared.text }
		: { kind: "matrix", rows: matrixRows(drawing) };
	if (
		(encoding.kind === "linear" && encoding.modules.length === 0) ||
		(encoding.kind === "matrix" && encoding.rows.length === 0)
	) {
		return { ok: false, message: "The value has no encoding" };
	}
	return { ok: true, encoding };
}

// Compile runs on every edit and every record of a batch, and the same few
// values come round again; bwip-js takes milliseconds per symbol.
const CACHE_LIMIT = 256;
const cache = new Map<string, BarcodeEncodeResult>();

export const bwipBarcodeEncoder: BarcodeEncoder = (
	symbology,
	value,
	opts,
) => {
	const key = `${symbology}\u0000${opts.errorCorrection ?? ""}\u0000${value}`;
	const hit = cache.get(key);
	if (hit) return hit;
	const result = encode(symbology, value, opts.errorCorrection);
	if (cache.size >= CACHE_LIMIT) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
	cache.set(key, result);
	return result;
};
