const ELLIPSE =
	/^M\s*(\S+)[\s,]+(\S+)\s*A\s*(\S+)[\s,]+(\S+)[\s,]+0[\s,]+1[\s,]+0[\s,]+(\S+)[\s,]+(\S+)\s*A\s*(\S+)[\s,]+(\S+)[\s,]+0[\s,]+1[\s,]+0[\s,]+(\S+)[\s,]+(\S+)\s*Z$/i;

/** Whether `d` is the two-arc ellipse across a `width` by `height` box, as
 *  Studio draws an ellipse. */
export function isEllipsePath(
	d: string,
	width: number,
	height: number,
): boolean {
	const m = ELLIPSE.exec(d.trim());
	if (!m) return false;
	const n = m.slice(1).map(Number);
	const w = width;
	const h = height;
	const want = [0, h / 2, w / 2, h / 2, w, h / 2, w / 2, h / 2, 0, h / 2];
	return want.every((v, i) => Math.abs((n[i] as number) - v) < 0.01);
}
