/** An affine transform [a, b, c, d, e, f], as in SVG's `matrix()`. */
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `m` applied after `n`: multiply(m, n) maps p to m(n(p)). */
export function multiply(m: Matrix, n: Matrix): Matrix {
	return [
		m[0] * n[0] + m[2] * n[1],
		m[1] * n[0] + m[3] * n[1],
		m[0] * n[2] + m[2] * n[3],
		m[1] * n[2] + m[3] * n[3],
		m[0] * n[4] + m[2] * n[5] + m[4],
		m[1] * n[4] + m[3] * n[5] + m[5],
	];
}

export function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
	return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export const translate = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];
export const scale = (x: number, y = x): Matrix => [x, 0, 0, y, 0, 0];

export function isIdentity(m: Matrix): boolean {
	return m.every((v, i) => v === IDENTITY[i]);
}

/** The factor a length scales by, for strokes: the square root of the area
 *  scale, which is exact for similarity transforms. */
export function lengthScale(m: Matrix): number {
	return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

const FN = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Reads a transform list. An unreadable list is the identity, as in browsers. */
export function parseTransform(src: string): Matrix {
	let m = IDENTITY;
	let consumed = "";
	for (const [whole, name, body] of src.matchAll(FN)) {
		consumed += whole;
		const a = (body ?? "")
			.trim()
			.split(/[\s,]+/)
			.filter(Boolean)
			.map(Number);
		if (a.some((n) => !Number.isFinite(n))) return IDENTITY;
		const [p = 0, q, r] = a;
		let t: Matrix;
		switch (name) {
			case "matrix":
				if (a.length !== 6) return IDENTITY;
				t = a as Matrix;
				break;
			case "translate":
				t = translate(p, q ?? 0);
				break;
			case "scale":
				t = scale(p, q ?? p);
				break;
			case "rotate": {
				const c = Math.cos(rad(p));
				const s = Math.sin(rad(p));
				t = [c, s, -s, c, 0, 0];
				if (q !== undefined && r !== undefined)
					t = multiply(translate(q, r), multiply(t, translate(-q, -r)));
				break;
			}
			case "skewX":
				t = [1, 0, Math.tan(rad(p)), 1, 0, 0];
				break;
			case "skewY":
				t = [1, Math.tan(rad(p)), 0, 1, 0, 0];
				break;
			default:
				return IDENTITY;
		}
		m = multiply(m, t);
	}
	if (src.replace(/[\s,]/g, "").length !== consumed.replace(/[\s,]/g, "").length)
		return IDENTITY;
	return m;
}
