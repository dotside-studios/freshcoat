import { correction, generate, mode } from "lean-qr";
import type {
	ECLevel,
	QrFinderInner,
	QrFinderOuter,
	QrModuleShape,
} from "./types";

// ISO-8859-1 is left out so Latin-1 text is sent as UTF-8, as before.
const MODES = [mode.numeric, mode.alphaNumeric, mode.ascii, mode.utf8];

// Byte budgets, so a run of version-40 symbols (177 modules a side) can't
// grow the memo past a few MB.
export const MATRIX_CACHE_BYTES = 2 * 1024 * 1024;
export const PATH_CACHE_BYTES = 16 * 1024 * 1024;

// A symbol's modules, one byte each (1 set, 0 clear), row-major.
interface Modules {
	size: number;
	bits: Uint8Array;
}

class ByteLru<T> {
	private readonly map = new Map<string, { value: T; bytes: number }>();
	bytes = 0;

	constructor(
		private readonly budget: number,
		private readonly weigh: (value: T) => number,
	) {}

	get(key: string): T | undefined {
		const hit = this.map.get(key);
		if (!hit) return undefined;
		this.map.delete(key);
		this.map.set(key, hit);
		return hit.value;
	}

	set(key: string, value: T): void {
		const bytes = this.weigh(value);
		if (bytes > this.budget) return;
		this.bytes += bytes;
		this.map.set(key, { value, bytes });
		for (const [k, entry] of this.map) {
			if (this.bytes <= this.budget) break;
			this.map.delete(k);
			this.bytes -= entry.bytes;
		}
	}
}

const matrices = new ByteLru<Modules>(MATRIX_CACHE_BYTES, (m) => m.bits.length);
const paths = new ByteLru<string>(PATH_CACHE_BYTES, (d) => d.length * 2);

export function qrCacheBytes(): { matrices: number; paths: number } {
	return { matrices: matrices.bytes, paths: paths.bytes };
}

export function generateMatrix(value: string, ec: ECLevel = "M"): boolean[][] {
	const { size, bits } = modules(value, ec);
	const matrix: boolean[][] = [];
	for (let y = 0; y < size; y++) {
		const row: boolean[] = [];
		for (let x = 0; x < size; x++) row.push(bits[y * size + x] === 1);
		matrix.push(row);
	}
	return matrix;
}

export type QrStyle = {
	moduleShape: QrModuleShape;
	finderOuter: QrFinderOuter;
	finderInner: QrFinderInner;
	quietZone: number;
	// Requested logo side as a fraction of the symbol's, 0 for none.
	logoSize: number;
	// Modules cleared around the logo.
	logoPadding: number;
};

export const DEFAULT_QR_STYLE: QrStyle = {
	moduleShape: "square",
	finderOuter: "square",
	finderInner: "square",
	quietZone: 0,
	logoSize: 0,
	logoPadding: 1,
};

// The largest logo side, as a fraction of the symbol's, before it is reduced.
export const MAX_QR_LOGO_SIZE = 0.3;
// Above this share of the symbol cleared for a logo, H is used instead of Q.
export const QR_LOGO_H_COVERAGE = 0.15;

const LEVELS: ECLevel[] = ["L", "M", "Q", "H"];
const atLeast = (ec: ECLevel, min: ECLevel): ECLevel =>
	LEVELS.indexOf(ec) >= LEVELS.indexOf(min) ? ec : min;

export type QrSymbol = {
	// Modules a side, without the quiet zone. 0 for an empty value.
	size: number;
	ec: ECLevel;
	// Modules a side, quiet zone included: the path's coordinate box.
	grid: number;
	// The symbol in grid units, filled even-odd.
	d: string;
	// The logo's box in grid units, absent without one.
	logo?: { x: number; y: number; side: number };
	// Share of the symbol's modules cleared for the logo.
	coverage: number;
};

/** A styled symbol as one path. A logo raises error correction to Q, or to H
 *  once it clears more than QR_LOGO_H_COVERAGE of the symbol, and is reduced
 *  to MAX_QR_LOGO_SIZE and to the space between the finder patterns. */
export function qrSymbol(
	value: string,
	ec: ECLevel,
	style: QrStyle = DEFAULT_QR_STYLE,
): QrSymbol {
	const q = style.quietZone;
	const hasLogo = style.logoSize > 0;
	let level = hasLogo ? atLeast(ec, "Q") : ec;
	let m = modules(value, level);
	let clear = clearing(m.size, style);
	if (clear && clear.coverage > QR_LOGO_H_COVERAGE && level !== "H") {
		level = "H";
		m = modules(value, level);
		clear = clearing(m.size, style);
	}
	const grid = m.size + 2 * q;
	const key = [
		level,
		style.moduleShape,
		style.finderOuter,
		style.finderInner,
		q,
		clear ? `${clear.start},${clear.side}` : "",
		value,
	].join("\u0000");
	let d = paths.get(key);
	if (d === undefined) {
		d = symbolPath(m, q, style, clear);
		paths.set(key, d);
	}
	return {
		size: m.size,
		ec: level,
		grid,
		d,
		...(clear
			? { logo: { x: q + clear.logoAt, y: q + clear.logoAt, side: clear.logo } }
			: {}),
		coverage: clear?.coverage ?? 0,
	};
}

type Clearing = {
	start: number;
	side: number;
	logo: number;
	logoAt: number;
	coverage: number;
};

// The square of modules behind the logo: centred, whole modules, and clear of
// the finder patterns, their separators and the timing patterns.
function clearing(n: number, style: QrStyle): Clearing | null {
	if (n === 0 || style.logoSize <= 0) return null;
	const pad = Math.max(0, style.logoPadding);
	const room = n - 16;
	let logo = Math.min(style.logoSize, MAX_QR_LOGO_SIZE) * n;
	logo = Math.min(logo, room - 2 * pad);
	if (logo <= 0) return null;
	let side = Math.ceil(logo + 2 * pad - 1e-9);
	if ((n - side) % 2 !== 0) side++;
	if (side > room) side -= 2;
	if (side <= 0) return null;
	logo = Math.min(logo, side - 2 * pad);
	if (logo <= 0) return null;
	return {
		start: (n - side) / 2,
		side,
		logo,
		logoAt: (n - logo) / 2,
		coverage: (side * side) / (n * n),
	};
}

const K = 0.5522847498;

const num = (v: number) => String(Math.round(v * 1000) / 1000);

// A rectangle with each corner [tl, tr, br, bl] rounded to its radius, wound
// clockwise.
function roundRect(
	x: number,
	y: number,
	w: number,
	h: number,
	[tl, tr, br, bl]: readonly [number, number, number, number],
): string {
	let d = `M${num(x + tl)} ${num(y)}H${num(x + w - tr)}`;
	if (tr)
		d += `C${num(x + w - tr + tr * K)} ${num(y)} ${num(x + w)} ${num(y + tr - tr * K)} ${num(x + w)} ${num(y + tr)}`;
	d += `V${num(y + h - br)}`;
	if (br)
		d += `C${num(x + w)} ${num(y + h - br + br * K)} ${num(x + w - br + br * K)} ${num(y + h)} ${num(x + w - br)} ${num(y + h)}`;
	d += `H${num(x + bl)}`;
	if (bl)
		d += `C${num(x + bl - bl * K)} ${num(y + h)} ${num(x)} ${num(y + h - bl + bl * K)} ${num(x)} ${num(y + h - bl)}`;
	d += `V${num(y + tl)}`;
	if (tl)
		d += `C${num(x)} ${num(y + tl - tl * K)} ${num(x + tl - tl * K)} ${num(y)} ${num(x + tl)} ${num(y)}`;
	return `${d}Z`;
}

function circle(cx: number, cy: number, r: number): string {
	return roundRect(cx - r, cy - r, 2 * r, 2 * r, [r, r, r, r]);
}

function symbolPath(
	{ size: n, bits }: Modules,
	q: number,
	style: QrStyle,
	clear: Clearing | null,
): string {
	if (n === 0) return "";
	const finder = (x: number, y: number) =>
		(x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
	const cleared = (x: number, y: number) =>
		clear !== null &&
		x >= clear.start &&
		x < clear.start + clear.side &&
		y >= clear.start &&
		y < clear.start + clear.side;
	const on = (x: number, y: number) =>
		x >= 0 &&
		y >= 0 &&
		x < n &&
		y < n &&
		bits[y * n + x] === 1 &&
		!finder(x, y) &&
		!cleared(x, y);

	const parts: string[] = [];
	for (let y = 0; y < n; y++) {
		for (let x = 0; x < n; x++) {
			if (!on(x, y)) continue;
			const px = x + q;
			const py = y + q;
			if (style.moduleShape === "square") {
				const from = x;
				while (on(x + 1, y)) x++;
				parts.push(`M${from + q} ${py}H${x + 1 + q}V${py + 1}H${from + q}Z`);
				continue;
			}
			if (style.moduleShape === "dot") {
				parts.push(circle(px + 0.5, py + 0.5, 0.5));
				continue;
			}
			const top = on(x, y - 1);
			const right = on(x + 1, y);
			const bottom = on(x, y + 1);
			const left = on(x - 1, y);
			const r = 0.5;
			const tl = !top && !left ? r : 0;
			const br = !bottom && !right ? r : 0;
			const corners: [number, number, number, number] =
				style.moduleShape === "rounded"
					? [tl, !top && !right ? r : 0, br, !bottom && !left ? r : 0]
					: [tl, 0, br, 0];
			parts.push(roundRect(px, py, 1, 1, corners));
		}
	}
	for (const [fx, fy] of [
		[0, 0],
		[n - 7, 0],
		[0, n - 7],
	] as const) {
		const x = fx + q;
		const y = fy + q;
		parts.push(finderOuter(x, y, style.finderOuter));
		parts.push(finderInner(x + 2, y + 2, style.finderInner));
	}
	return parts.join("");
}

// The finder's ring: its outline and its hole, which even-odd leaves empty.
function finderOuter(x: number, y: number, shape: QrFinderOuter): string {
	if (shape === "circle")
		return circle(x + 3.5, y + 3.5, 3.5) + circle(x + 3.5, y + 3.5, 2.5);
	const [r, h] = shape === "rounded" ? [2, 1] : [0, 0];
	return (
		roundRect(x, y, 7, 7, [r, r, r, r]) +
		roundRect(x + 1, y + 1, 5, 5, [h, h, h, h])
	);
}

function finderInner(x: number, y: number, shape: QrFinderInner): string {
	if (shape === "dot") return circle(x + 1.5, y + 1.5, 1.5);
	const r = shape === "rounded" ? 1 : 0;
	return roundRect(x, y, 3, 3, [r, r, r, r]);
}

function modules(value: string, ec: ECLevel): Modules {
	// An empty payload has no QR encoding. That state is legitimate during
	// design/preview, where a QR bound to an unfilled field compiles with an empty
	// value; return an empty matrix so the QR renders blank (painters treat
	// length 0 as "draw only the background") instead of taking down the whole
	// compile.
	if (!value) return { size: 0, bits: new Uint8Array(0) };
	const key = `${ec}:${value}`;
	const hit = matrices.get(key);
	if (hit) return hit;
	const m = encode(value, ec);
	matrices.set(key, m);
	return m;
}

function encode(value: string, ec: ECLevel): Modules {
	// Pinning both bounds stops lean-qr from raising the level to fill spare
	// capacity.
	const code = generate(value, {
		minCorrectionLevel: correction[ec],
		maxCorrectionLevel: correction[ec],
		modes: MODES,
	});
	const size = code.size;
	const bits = new Uint8Array(size * size);
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) bits[y * size + x] = code.get(x, y) ? 1 : 0;
	return { size, bits };
}
