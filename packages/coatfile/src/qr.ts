import { correction, generate, mode } from "lean-qr";
import type { ECLevel } from "./types";

// ISO-8859-1 is left out so Latin-1 text is sent as UTF-8, as before.
const MODES = [mode.numeric, mode.alphaNumeric, mode.ascii, mode.utf8];

// Byte budgets, so a run of version-40 symbols (177 modules a side) can't
// grow the memo past a few MB.
export const MATRIX_CACHE_BYTES = 2 * 1024 * 1024;
export const PIXEL_CACHE_BYTES = 8 * 1024 * 1024;

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
const pixelBuffers = new ByteLru<Uint8Array>(
	PIXEL_CACHE_BYTES,
	(p) => p.length,
);

export function qrCacheBytes(): { matrices: number; pixels: number } {
	return { matrices: matrices.bytes, pixels: pixelBuffers.bytes };
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

// The symbol as RGBA: the colour where a module is set, transparent elsewhere.
// The buffer is shared between calls with the same input, so callers must not
// mutate or transfer it.
export function generatePixels(
	value: string,
	ec: ECLevel,
	[r, g, b]: readonly [number, number, number],
): { size: number; pixels: Uint8Array } {
	const { size, bits } = modules(value, ec);
	const key = `${ec}:${r},${g},${b}:${value}`;
	const hit = pixelBuffers.get(key);
	if (hit) return { size, pixels: hit };
	const pixels = new Uint8Array(size * size * 4);
	for (let i = 0; i < bits.length; i++) {
		if (bits[i]) {
			pixels[i * 4] = r;
			pixels[i * 4 + 1] = g;
			pixels[i * 4 + 2] = b;
			pixels[i * 4 + 3] = 255;
		}
	}
	pixelBuffers.set(key, pixels);
	return { size, pixels };
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
