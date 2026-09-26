import QRCode from "qrcode";
import type { ECLevel } from "./types";

export function generateMatrix(value: string, ec: ECLevel = "M"): boolean[][] {
	// An empty payload has no QR encoding — `QRCode.create("")` throws "No input
	// text". That state is legitimate during design/preview, where a QR bound to
	// an unfilled field compiles with an empty value; return an empty matrix so the
	// QR renders blank (painters treat length 0 as "draw only the background")
	// instead of taking down the whole compile.
	if (!value) return [];
	const qr = QRCode.create(value, { errorCorrectionLevel: ec });
	const size = qr.modules.size;
	const data = qr.modules.data;
	const matrix: boolean[][] = [];
	for (let y = 0; y < size; y++) {
		const row: boolean[] = [];
		for (let x = 0; x < size; x++) {
			row.push(data[y * size + x] === 1);
		}
		matrix.push(row);
	}
	return matrix;
}
