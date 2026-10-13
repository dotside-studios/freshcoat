import type { Renderer } from "@freshcoat-js/engine";
import { normalizePath } from "@freshcoat-js/engine/svg";
import { extendIntoBleed, offsetElements } from "./bleed";
import type {
	Background,
	Element,
	PieceSpec,
	Sides,
	TemplateFrame,
} from "./types";
import type { ResolvedSlice } from "./slices";

type CanvasKit = Renderer["ck"];

/** Whether the outline is its box and nothing else: four axis-aligned corners. */
function isBox(slice: ResolvedSlice): boolean {
	const corners = normalizePath(slice.path)
		.flatMap((s) => (s.op === "M" || s.op === "L" ? [s] : []))
		.filter((p, i, all) => i === 0 || p.x !== all[0]?.x || p.y !== all[0]?.y);
	const { x, y, width, height } = slice.box;
	return (
		corners.length === 4 &&
		corners.every(
			(p, i) =>
				(p.x === x || p.x === x + width) &&
				(p.y === y || p.y === y + height) &&
				(p.x === corners[(i + 1) % 4]?.x || p.y === corners[(i + 1) % 4]?.y),
		)
	);
}

/** The outline grown by `by` on every side: the shape with its stroke of
 *  width twice that, joined round. Unchanged if CanvasKit cannot grow it. */
function growOutline(
	ck: CanvasKit,
	d: string,
	fillRule: "nonzero" | "evenodd",
	by: number,
): { d: string; fillRule: "nonzero" | "evenodd" } {
	const same = { d, fillRule };
	const path = ck.Path.MakeFromSVGString(d);
	if (!path || by <= 0) {
		path?.delete();
		return same;
	}
	if (fillRule === "evenodd") path.setFillType(ck.FillType.EvenOdd);
	const ring = path.makeStroked({ width: 2 * by, join: ck.StrokeJoin.Round });
	const grown = ring && ck.Path.MakeFromOp(path, ring, ck.PathOp.Union);
	const out = grown
		? { d: grown.toSVGString(), fillRule: "nonzero" as const }
		: same;
	for (const p of [path, ring, grown]) p?.delete();
	return out;
}

/** What `compile` needs to cut a slice out of a side. The mask grows the
 *  outline by the slice's widest bleed; per-side bleeds only differ in how
 *  much of the surroundings the pixels take in. */
export function pieceSpec(ck: CanvasKit, slice: ResolvedSlice): PieceSpec {
	const { bleed } = slice;
	const by = Math.max(bleed.top, bleed.right, bleed.bottom, bleed.left);
	return {
		box: slice.box,
		bleed,
		...(isBox(slice)
			? {}
			: { mask: growOutline(ck, slice.path, slice.fillRule, by) }),
	};
}

/** The size of the pixels a piece takes, in design units. */
export function pieceSize(piece: PieceSpec): { width: number; height: number } {
	return {
		width: piece.box.width + piece.bleed.left + piece.bleed.right,
		height: piece.box.height + piece.bleed.top + piece.bleed.bottom,
	};
}

/** Where the box lies in the piece. */
export function pieceBox(piece: PieceSpec): PieceSpec["box"] {
	return {
		x: piece.bleed.left,
		y: piece.bleed.top,
		width: piece.box.width,
		height: piece.box.height,
	};
}

/**
 * A side as the piece sees it: the background becomes the lowest layer so it
 * moves with the rest, art that runs to the trim runs into the template's
 * bleed, and everything shifts so the box lands at the bleed. With a `mask`
 * all of it sits in one mask element whose shape is the grown outline.
 */
export function pieceFrame(
	frame: TemplateFrame,
	elements: Element[],
	trim: { width: number; height: number },
	bleed: Sides,
	piece: PieceSpec,
): TemplateFrame {
	const layer = {
		...frame.background,
		pos: { x: 0, y: 0 },
		size: trim,
	} as Background as Element;
	const dx = piece.bleed.left - piece.box.x;
	const dy = piece.bleed.top - piece.box.y;
	const shifted = offsetElements(
		extendIntoBleed([layer, ...elements], trim, bleed),
		dx,
		dy,
	);
	const canvas = pieceSize(piece);
	const cut: Element[] = piece.mask
		? [
				{
					id: "piece-mask",
					type: "mask",
					pos: { x: 0, y: 0 },
					size: canvas,
					properties: {
						mask: {
							id: "piece-outline",
							type: "vector",
							pos: { x: dx, y: dy },
							size: canvas,
							properties: {
								d: piece.mask.d,
								fillRule: piece.mask.fillRule,
								fill: "#000000",
							},
						},
						children: shifted,
					},
				},
			]
		: shifted;
	return {
		...frame,
		background: { id: frame.background.id, type: "rect", properties: {} },
		elements: cut,
	};
}
