import {
	NO_BLEED,
	type PathOp,
	type ResolvedSlice,
	resolveSlices,
	type Sides,
	type Template,
	variantSize,
} from "@freshcoat-js/coatfile";
import {
	normalizePath,
	parseTransform,
	serializePath,
	transformPath,
} from "@freshcoat-js/engine/svg";
import type { ExportItem } from "./types";

/** The edges a cutter acts on; a slice with edge `none` has no line. */
export type CutKind = Exclude<ResolvedSlice["edge"], "none">;

/** The kinds in the order files list them. */
export const CUT_KINDS: readonly CutKind[] = [
	"through",
	"kiss",
	"score",
	"perforate",
];

/** How each kind shows in a file: SVG and PDF strokes, and DXF layers. */
export const CUT_STYLES: Record<
	CutKind,
	{ color: string; rgb: [number, number, number]; layer: string; aci: number }
> = {
	through: { color: "#FF0000", rgb: [1, 0, 0], layer: "THROUGH", aci: 1 },
	kiss: { color: "#FF00FF", rgb: [1, 0, 1], layer: "KISS", aci: 6 },
	score: { color: "#0000FF", rgb: [0, 0, 1], layer: "SCORE", aci: 5 },
	perforate: {
		color: "#00A000",
		rgb: [0, 0.627, 0],
		layer: "PERFORATE",
		aci: 3,
	},
};

export type CutLine = {
	kind: CutKind;
	/** the slice's name */
	name: string;
	/** SVG path data in the item's own coordinates */
	path: string;
	fillRule: "nonzero" | "evenodd";
};

/** An export item's cut lines. The coordinates are design units with the
 *  origin at the item image's top-left corner. */
export type ItemCuts = {
	/** the item image's size, bleed included */
	width: number;
	height: number;
	lines: CutLine[];
};

export type ItemCutsOptions = {
	/** the bleed the whole-side image includes; a piece has its own */
	bleed?: Sides;
	/** the side is laid out at this size first, as the render does */
	resize?: { width: number; height: number };
	/** recomputes live booleans, as the render does */
	pathOp?: PathOp;
};

const EPSILON = 1e-6;

type CutItem = Pick<ExportItem, "values" | "variantId" | "piece"> &
	Partial<Pick<ExportItem, "side">>;

const line = (slice: ResolvedSlice, path: string): CutLine => ({
	kind: slice.edge as CutKind,
	name: slice.name,
	path,
	fillRule: slice.fillRule,
});

function shifted(path: string, dx: number, dy: number): string {
	if (dx === 0 && dy === 0) return path;
	return serializePath(
		transformPath(
			normalizePath(path),
			parseTransform(`translate(${dx} ${dy})`),
		),
	);
}

const inside = (inner: ResolvedSlice["box"], outer: ResolvedSlice["box"]) =>
	inner.x >= outer.x - EPSILON &&
	inner.y >= outer.y - EPSILON &&
	inner.x + inner.width <= outer.x + outer.width + EPSILON &&
	inner.y + inner.height <= outer.y + outer.height + EPSILON;

/**
 * The cut lines of one export item, for the slices a render of it would
 * resolve (its values, variant and layout).
 *
 * A whole side has a line for every shown slice whose edge is not none,
 * moved by `options.bleed` when the image includes it. A piece has its own
 * outline when its edge is not none, moved so its box sits at the slice's
 * bleed, and the lines of the `output: none` slices that lie wholly inside
 * its box; one that only crosses the box is left out, not clipped.
 */
export function itemCuts(
	template: Template,
	item: CutItem,
	options: ItemCutsOptions = {},
): ItemCuts {
	const frameName = item.side ?? template.template_data[0]?.name;
	const slices = resolveSlices(template, {
		...(frameName !== undefined ? { frameName } : {}),
		values: item.values,
		...(item.variantId !== undefined ? { variantId: item.variantId } : {}),
		...(options.resize ? { resize: options.resize } : {}),
		...(options.pathOp ? { pathOp: options.pathOp } : {}),
	});
	if (item.piece === undefined) {
		const bleed = options.bleed ?? NO_BLEED;
		const trim = options.resize ?? variantSize(template, item.variantId);
		return {
			width: trim.width + bleed.left + bleed.right,
			height: trim.height + bleed.top + bleed.bottom,
			lines: slices
				.filter((s) => s.edge !== "none")
				.map((s) => line(s, shifted(s.path, bleed.left, bleed.top))),
		};
	}
	const piece = slices.find((s) => s.name === item.piece);
	if (!piece) throw new Error(`no slice "${item.piece}" on this side`);
	const { box, bleed } = piece;
	const dx = bleed.left - box.x;
	const dy = bleed.top - box.y;
	const own = piece.edge === "none" ? [] : [piece];
	const inner = slices.filter(
		(s) =>
			s !== piece &&
			s.output === "none" &&
			s.edge !== "none" &&
			inside(s.box, box),
	);
	return {
		width: box.width + bleed.left + bleed.right,
		height: box.height + bleed.top + bleed.bottom,
		lines: [...own, ...inner].map((s) => line(s, shifted(s.path, dx, dy))),
	};
}
