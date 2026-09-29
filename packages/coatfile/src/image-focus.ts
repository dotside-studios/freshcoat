import type { Vec2 } from "./types";

const PAIR =
	/^\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+))\s*[,\s]\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+))\s*$/;

/** An image's `focus` as fractions of the image, or undefined for the centre.
 *  Takes the [x, y] pair or its "x,y" string form, as a field value supplies
 *  it; a string that is not a pair, or a point outside [0, 1], is undefined. */
export function parseImageFocus(value: unknown): Vec2 | undefined {
	let x: number;
	let y: number;
	if (Array.isArray(value) && value.length === 2) {
		[x, y] = value as [number, number];
	} else if (typeof value === "string") {
		const m = PAIR.exec(value);
		if (!m) return undefined;
		x = Number(m[1]);
		y = Number(m[2]);
	} else {
		return undefined;
	}
	const inRange = (v: number) =>
		typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
	return inRange(x) && inRange(y) ? { x, y } : undefined;
}

/** The "x,y" string form of a focal point, rounded to thousandths. */
export function formatImageFocus(focus: Vec2): string {
	const r = (v: number) => String(Math.round(v * 1000) / 1000);
	return `${r(focus.x)},${r(focus.y)}`;
}
