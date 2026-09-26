// Deterministic test assets the harness supplies, so a case stays pure JSON
// instead of carrying an embedded PNG. A backend under test receives these
// through the runtime exactly as it would a real image.
import { encodePng } from "../../src/png";

// A 4x4 checker of two saturated, unambiguous colors. Nearest-neighbour scaling
// keeps every block flat, so a case can sample a block centre and assert an exact
// value; a backend that resamples smoothly fails on the block, not on an edge.
export const CHECKER_SRC = "conformance:checker";
export const CHECKER_A: [number, number, number] = [220, 40, 90];
export const CHECKER_B: [number, number, number] = [30, 120, 220];

export function checkerPixels(n = 4): Uint8Array {
	const px = new Uint8Array(n * n * 4);
	for (let i = 0; i < n * n; i++) {
		const on = ((i % n) + Math.floor(i / n)) % 2 === 0;
		px.set([...(on ? CHECKER_A : CHECKER_B), 255], i * 4);
	}
	return px;
}

export async function conformanceImages(): Promise<Map<string, Uint8Array>> {
	const n = 4;
	return new Map([[CHECKER_SRC, await encodePng(checkerPixels(n), n, n)]]);
}
