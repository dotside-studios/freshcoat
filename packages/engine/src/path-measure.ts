import type { CanvasKit, ContourMeasure, Path } from "canvaskit-wasm";
import type { PathMeasure, Pose } from "./arc-text";

// Measures `path` for the duration of `use`. Every ContourMeasure and the
// iterator are deleted before this returns, so `use` must not keep `at`.
export function withPathMeasure<T>(
	ck: CanvasKit,
	path: Path,
	use: (measure: PathMeasure) => T,
): T {
	const iter = new ck.ContourMeasureIter(path, false, 1);
	const contours: ContourMeasure[] = [];
	try {
		for (let c = iter.next(); c; c = iter.next()) contours.push(c);
		const lengths = contours.map((c) => c.length());
		const length = lengths.reduce((a, b) => a + b, 0);
		const out = new Float32Array(4);
		const at = (d: number): Pose => {
			let i = 0;
			let rest = Math.min(Math.max(d, 0), length);
			while (i < contours.length - 1 && rest > (lengths[i] as number)) {
				rest -= lengths[i] as number;
				i++;
			}
			const c = contours[i];
			if (!c) return { x: 0, y: 0, cos: 1, sin: 0 };
			c.getPosTan(rest, out);
			return {
				x: out[0] as number,
				y: out[1] as number,
				cos: out[2] as number,
				sin: out[3] as number,
			};
		};
		return use({
			length,
			closed: contours.length === 1 && !!contours[0]?.isClosed(),
			at,
		});
	} finally {
		for (const c of contours) c.delete();
		iter.delete();
	}
}
