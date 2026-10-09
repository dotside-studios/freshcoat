// A linear gradient is placed either by `angle` alone, through the centre of
// the box and reaching its edges along that direction, or by explicit `from`
// and `to` points. Both are in fractions of the drawable's box, with angle 0
// pointing right and 90 down. These convert one to the other, so a writer that
// sets points can keep `angle` saying the same thing to a reader without them.

type Point = [number, number];

/** The points an `angle`-only linear fill resolves to. */
export function linearGradientPoints(angle: number): { from: Point; to: Point } {
	const rad = (angle * Math.PI) / 180;
	const dx = Math.cos(rad) * 0.5;
	const dy = Math.sin(rad) * 0.5;
	return { from: [0.5 - dx, 0.5 - dy], to: [0.5 + dx, 0.5 + dy] };
}

/** The `angle` that points along `to - from` in box space, in [0, 360). */
export function linearGradientAngle(from: Point, to: Point): number {
	const deg =
		(Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI;
	return deg < 0 ? deg + 360 : deg;
}
