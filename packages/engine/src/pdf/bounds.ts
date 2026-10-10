import type { CanvasKit } from "canvaskit-wasm";
import type { DrawCommand, DrawTextCommand } from "../types";

// l, t, r, b in design units.
export type Extent = [number, number, number, number];

// How far past a blur's value its tail is counted. A shadow or layer blur has a
// sigma of at most half its value, and Skia reaches three sigmas.
const BLUR_REACH = 2;
// Reach of a stroke's miter join past its half width, at Skia's miter limit.
const MITER = 4;

const union = (a: Extent, b: Extent): Extent => [
	Math.min(a[0], b[0]),
	Math.min(a[1], b[1]),
	Math.max(a[2], b[2]),
	Math.max(a[3], b[3]),
];

const grow = (e: Extent, by: number): Extent => [
	e[0] - by,
	e[1] - by,
	e[2] + by,
	e[3] + by,
];

// A box every pixel `cmd` can touch lies inside, in the scene's design units,
// shadows, blur and rotation included. Null where that is not known cheaply
// (text on a curve, an adjustment that can colour what is empty): the layer is
// then painted over the whole page.
export function drawableExtent(ck: CanvasKit, cmd: DrawCommand): Extent | null {
	if (cmd.adjust) return null;
	const { pos, size } = cmd;
	let e: Extent | null = [
		pos.x,
		pos.y,
		pos.x + size.width,
		pos.y + size.height,
	];
	switch (cmd.op) {
		case "drawText":
			e = textExtent(cmd, e);
			break;
		case "drawPath":
			e = pathExtent(ck, cmd, e);
			break;
		case "drawGroup":
		case "drawMasked":
			for (const child of cmd.children) {
				const c = drawableExtent(ck, child);
				if (!c) return null;
				e = union(e, c);
			}
			break;
		case "drawImage":
			if (cmd.stroke) e = grow(e, cmd.stroke.width * MITER);
			break;
		case "drawRect":
			if (cmd.stroke) e = grow(e, cmd.stroke.width * MITER);
			break;
	}
	if (!e) return null;
	const shadows = cmd.shadow
		? Array.isArray(cmd.shadow)
			? cmd.shadow
			: [cmd.shadow]
		: [];
	let all = e;
	for (const s of shadows) {
		if (s.inset) continue;
		const reach = Math.max(s.spread ?? 0, 0) + s.blur * BLUR_REACH;
		const g = grow(e, reach);
		all = union(all, [g[0] + s.dx, g[1] + s.dy, g[2] + s.dx, g[3] + s.dy]);
	}
	if (cmd.blur) all = grow(all, cmd.blur * BLUR_REACH);
	if (cmd.rotation) {
		// A turn about the box centre stays inside the circle through the corners.
		const cx = pos.x + size.width / 2;
		const cy = pos.y + size.height / 2;
		const r = Math.max(
			Math.hypot(all[0] - cx, all[1] - cy),
			Math.hypot(all[2] - cx, all[1] - cy),
			Math.hypot(all[0] - cx, all[3] - cy),
			Math.hypot(all[2] - cx, all[3] - cy),
		);
		all = [cx - r, cy - r, cx + r, cy + r];
	}
	return all.every(Number.isFinite) ? all : null;
}

// Lines sit where the layout put them, and a glyph reaches about an em past its
// baseline and a little over one above it.
function textExtent(cmd: DrawTextCommand, box: Extent): Extent | null {
	if (cmd.arc || cmd.path) return null;
	let e = box;
	for (const line of cmd.layout.lines) {
		const baseline = line.baseline ?? line.y;
		for (const span of line.spans) {
			const em = span.font.size;
			e = union(e, [
				span.x - em,
				Math.min(line.y, baseline - 1.5 * em),
				span.x + span.width + em,
				Math.max(line.y, baseline) + em,
			]);
		}
	}
	return e;
}

function pathExtent(
	ck: CanvasKit,
	cmd: Extract<DrawCommand, { op: "drawPath" }>,
	box: Extent,
): Extent | null {
	const vb = cmd.viewBox;
	const sx = vb && vb.width > 0 ? cmd.size.width / vb.width : 1;
	const sy = vb && vb.height > 0 ? cmd.size.height / vb.height : 1;
	let e = box;
	for (const d of [cmd.d, cmd.strokeD]) {
		if (!d) continue;
		const path = ck.Path.MakeFromSVGString(d);
		if (!path) return null;
		try {
			const [l, t, r, b] = path.getBounds();
			const ox = vb?.x ?? 0;
			const oy = vb?.y ?? 0;
			e = union(e, [
				cmd.pos.x + (l - ox) * sx,
				cmd.pos.y + (t - oy) * sy,
				cmd.pos.x + (r - ox) * sx,
				cmd.pos.y + (b - oy) * sy,
			]);
		} finally {
			path.delete();
		}
	}
	if (cmd.stroke) e = grow(e, cmd.stroke.width * MITER * Math.max(sx, sy, 1));
	return e;
}

// `cmd` moved by (dx, dy), every coordinate it carries in the scene's space.
export function shiftDrawable(
	cmd: DrawCommand,
	dx: number,
	dy: number,
): DrawCommand {
	const pos = { x: cmd.pos.x + dx, y: cmd.pos.y + dy };
	switch (cmd.op) {
		case "drawGroup":
			return {
				...cmd,
				pos,
				children: cmd.children.map((c) => shiftDrawable(c, dx, dy)),
			};
		case "drawMasked":
			return {
				...cmd,
				pos,
				mask: shiftDrawable(cmd.mask, dx, dy),
				children: cmd.children.map((c) => shiftDrawable(c, dx, dy)),
			};
		case "drawText":
			return {
				...cmd,
				pos,
				layout: {
					...cmd.layout,
					lines: cmd.layout.lines.map((line) => ({
						...line,
						y: line.y + dy,
						...(line.baseline === undefined
							? {}
							: { baseline: line.baseline + dy }),
						spans: line.spans.map((s) => ({ ...s, x: s.x + dx })),
					})),
				},
			};
		default:
			return { ...cmd, pos };
	}
}
