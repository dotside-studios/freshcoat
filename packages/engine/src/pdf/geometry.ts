import type { CanvasKit, Path } from "canvaskit-wasm";
import { boxPath, type OutlineGeometry } from "../outline";
import { num } from "./writer";

export type Matrix = [number, number, number, number, number, number];

export function cm(m: Matrix): string {
	return `${m.map(num).join(" ")} cm\n`;
}

export function rotateAbout(degrees: number, cx: number, cy: number): Matrix {
	const t = (degrees * Math.PI) / 180;
	const c = Math.cos(t);
	const s = Math.sin(t);
	return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
}

// The path as construction operators, curves as cubics. A conic becomes the
// cubic that matches it at its ends and midpoint, which is exact to well under
// a hundredth of a unit for the quarter arcs Skia builds circles from.
export function pathOps(ck: CanvasKit, path: Path, m?: Matrix): string {
	const cmds = path.toCmds();
	const out: string[] = [];
	const pt = (x: number, y: number) => {
		if (!m) return `${num(x)} ${num(y)}`;
		return `${num(m[0] * x + m[2] * y + m[4])} ${num(m[1] * x + m[3] * y + m[5])}`;
	};
	let cx = 0;
	let cy = 0;
	let i = 0;
	while (i < cmds.length) {
		const verb = cmds[i++];
		if (verb === ck.MOVE_VERB) {
			cx = cmds[i++] as number;
			cy = cmds[i++] as number;
			out.push(`${pt(cx, cy)} m`);
		} else if (verb === ck.LINE_VERB) {
			cx = cmds[i++] as number;
			cy = cmds[i++] as number;
			out.push(`${pt(cx, cy)} l`);
		} else if (verb === ck.QUAD_VERB || verb === ck.CONIC_VERB) {
			const x1 = cmds[i++] as number;
			const y1 = cmds[i++] as number;
			const x2 = cmds[i++] as number;
			const y2 = cmds[i++] as number;
			const w = verb === ck.CONIC_VERB ? (cmds[i++] as number) : 1;
			const k = (4 * w) / (3 * (1 + w));
			out.push(
				`${pt(cx + k * (x1 - cx), cy + k * (y1 - cy))} ${pt(x2 + k * (x1 - x2), y2 + k * (y1 - y2))} ${pt(x2, y2)} c`,
			);
			cx = x2;
			cy = y2;
		} else if (verb === ck.CUBIC_VERB) {
			const p = cmds.slice(i, i + 6);
			i += 6;
			out.push(
				`${pt(p[0] as number, p[1] as number)} ${pt(p[2] as number, p[3] as number)} ${pt(p[4] as number, p[5] as number)} c`,
			);
			cx = p[4] as number;
			cy = p[5] as number;
		} else if (verb === ck.CLOSE_VERB) out.push("h");
		else break;
	}
	return out.length ? `${out.join("\n")}\n` : "";
}

// An outline's construction operators and whether it fills even-odd.
export function outlineOps(
	ck: CanvasKit,
	g: OutlineGeometry,
): { ops: string; evenOdd: boolean } {
	if (g.kind === "rect") {
		const [l, t, r, b] = g.ltrb;
		return {
			ops: `${num(l)} ${num(t)} ${num(r - l)} ${num(b - t)} re\n`,
			evenOdd: false,
		};
	}
	const path =
		g.kind === "rrect"
			? boxPath(ck, g.ltrb, g.radii)
			: ck.Path.MakeFromSVGString(g.d);
	if (!path) return { ops: "", evenOdd: false };
	try {
		return {
			ops: pathOps(ck, path),
			evenOdd: path.getFillType() === ck.FillType.EvenOdd,
		};
	} finally {
		path.delete();
	}
}
