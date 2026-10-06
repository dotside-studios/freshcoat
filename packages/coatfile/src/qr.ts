import { correction, generate, mode } from "lean-qr";
import type { ECLevel } from "./types";

// ISO-8859-1 is left out so Latin-1 text is sent as UTF-8, as before.
const MODES = [mode.numeric, mode.alphaNumeric, mode.ascii, mode.utf8];
export function generateMatrix(value: string, ec: ECLevel = "M"): boolean[][] {
	// An empty payload has no QR encoding. That state is legitimate during
	// design/preview, where a QR bound to an unfilled field compiles with an empty
	// value; return an empty matrix so the QR renders blank (painters treat
	// length 0 as "draw only the background") instead of taking down the whole
	// compile.
	if (!value) return [];
	return encode(value, ec);
}

function encode(value: string, ec: ECLevel): boolean[][] {
	// Pinning both bounds stops lean-qr from raising the level to fill spare
	// capacity.
	const code = generate(value, {
		minCorrectionLevel: correction[ec],
		maxCorrectionLevel: correction[ec],
		modes: MODES,
	});
	const matrix: boolean[][] = [];
	for (let y = 0; y < code.size; y++) {
		const row: boolean[] = [];
		for (let x = 0; x < code.size; x++) row.push(code.get(x, y));
		matrix.push(row);
	}
	return matrix;
}
