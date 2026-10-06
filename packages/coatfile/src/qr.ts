import { encode } from "uqr";
import type { ECLevel } from "./types";

export function generateMatrix(value: string, ec: ECLevel = "M"): boolean[][] {
	// An empty payload has no QR encoding. That state is legitimate during
	// design/preview, where a QR bound to an unfilled field compiles with an empty
	// value; return an empty matrix so the QR renders blank (painters treat
	// length 0 as "draw only the background") instead of taking down the whole
	// compile.
	if (!value) return [];
	return encode(value, { ecc: ec, border: 0 }).data;
}
