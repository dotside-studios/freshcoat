import {
	outlineGeometry,
	outlineSvg,
	rectShape,
	roundCorners,
} from "@freshcoat-js/engine";
import {
	normalizePath,
	parseTransform,
	pathBounds,
	serializePath,
	transformPath,
} from "@freshcoat-js/engine/svg";
import { resolveInsets, rotatedBox } from "./bleed";
import { applyBooleans, type PathOp } from "./boolean";
import { CoatError } from "./errors";
import { fieldContext, prepareTemplate } from "./prepare";
import { allElements } from "./tree";
import type { Element, Sides, Template } from "./types";
import { pruneHiddenElements } from "./visibility";

export type ResolveSlicesOptions = {
	/** The side to read. Default: the first. */
	frameName?: string;
	values?: Record<string, unknown>;
	variantId?: string;
	/** Lay the design out at this size first, as `compile` does. */
	resize?: { width: number; height: number };
	/** Recomputes a vector's live `boolean`, as `compile`'s does. Without it
	 *  the cached `d` is the outline. */
	pathOp?: PathOp;
};

export type ResolvedSlice = {
	id: string;
	name: string;
	/** The axis-aligned bounds of the outline, in trim coordinates. */
	box: { x: number; y: number; width: number; height: number };
	/** The outline of the shape, in trim coordinates. A subpath the shape
	 *  leaves open stays open. */
	path: string;
	fillRule: "nonzero" | "evenodd";
	/** `none` for an open path, whatever the modifier says: a cut line is
	 *  never a piece. */
	output: "piece" | "none";
	edge: "none" | "through" | "kiss" | "score" | "perforate";
	bleed: Sides;
	/** `slice.order`, or the shape's index among the side's elements. */
	order: number;
};

type Sliced = Extract<Element, { type: "rect" | "vector" }>;

/** Whether any subpath of the path data is left open. */
export function hasOpenSubpath(d: string): boolean {
	let drawing = false;
	for (const s of normalizePath(d)) {
		if (s.op === "M") {
			if (drawing) return true;
		} else if (s.op === "Z") drawing = false;
		else drawing = true;
	}
	return drawing;
}

/** Whether the element is a vector with an open subpath. A live `boolean`
 *  is not read: its outline is computed. */
export function isOpenVector(el: Element): boolean {
	return (
		el.type === "vector" &&
		el.properties.boolean === undefined &&
		typeof el.properties.d === "string" &&
		hasOpenSubpath(el.properties.d)
	);
}

const isSliced = (el: Element): el is Sliced =>
	(el.type === "rect" || el.type === "vector") &&
	el.properties.slice !== undefined;

/**
 * The shown slices of one side, as a render would resolve them: the top-level
 * rects and vectors that carry a `slice` modifier, after the variant,
 * `resize`, and the values' visibility conditions. Sorted by `order`, then
 * document order.
 */
export function resolveSlices(
	template: Template,
	options: ResolveSlicesOptions = {},
): ResolvedSlice[] {
	const { frame, elements } = shownElements(template, options);
	const index = new Map(frame.elements.map((el, i) => [el.id, i]));
	return elements
		.filter(isSliced)
		.map((el) => resolveSlice(el, index.get(el.id) ?? 0))
		.sort((a, b) => a.order - b.order || a.index - b.index)
		.map(({ index: _index, ...slice }) => slice);
}

/**
 * The ids of the layers a slice's piece shows: each shown top-level layer
 * whose box meets the slice's box grown by its bleed, with every layer inside
 * it. A layer without a size is counted in. Undefined when the side has no
 * such slice.
 */
export function sliceLayers(
	template: Template,
	name: string,
	options: ResolveSlicesOptions = {},
): Set<string> | undefined {
	const slice = resolveSlices(template, options).find((s) => s.name === name);
	if (!slice) return undefined;
	const { box, bleed } = slice;
	const left = box.x - bleed.left;
	const top = box.y - bleed.top;
	const right = box.x + box.width + bleed.right;
	const bottom = box.y + box.height + bleed.bottom;
	const out = new Set<string>();
	for (const el of shownElements(template, options).elements) {
		const b = rotatedBox(el);
		if (b && (b[0] >= right || b[2] <= left || b[1] >= bottom || b[3] <= top))
			continue;
		for (const child of allElements([el])) out.add(child.id);
	}
	return out;
}

function shownElements(template: Template, options: ResolveSlicesOptions) {
	const prepared = prepareTemplate(template, {
		variantId: options.variantId,
		resize: options.resize,
	});
	const frame =
		options.frameName === undefined
			? prepared.template_data[0]
			: prepared.template_data.find((f) => f.name === options.frameName);
	if (!frame)
		throw new CoatError("unknown_side", `no side named "${options.frameName}"`);

	const shown = pruneHiddenElements(
		frame.elements,
		fieldContext(prepared, options.values ?? {}),
		prepared.fields.properties,
	);
	const elements = options.pathOp
		? applyBooleans(shown, options.pathOp)
		: shown;
	return { frame, elements };
}

function resolveSlice(
	el: Sliced,
	index: number,
): ResolvedSlice & { index: number } {
	const slice = el.properties.slice ?? {};
	const x = el.pos?.x ?? 0;
	const y = el.pos?.y ?? 0;
	const width = el.size?.width ?? 0;
	const height = el.size?.height ?? 0;
	const d = outlineOf(el, width, height);
	const segments = transformPath(
		normalizePath(d),
		parseTransform(
			`translate(${x + width / 2} ${y + height / 2}) rotate(${el.rotation ?? 0}) translate(${-width / 2} ${-height / 2})`,
		),
	);
	return {
		id: el.id,
		name: slice.name ?? el.id,
		box: pathBounds(segments) ?? { x, y, width, height },
		path: serializePath(segments),
		fillRule:
			el.type === "vector" && el.properties.fillRule === "evenodd"
				? "evenodd"
				: "nonzero",
		output: isOpenVector(el) ? "none" : (slice.output ?? "piece"),
		edge: slice.edge ?? "none",
		bleed: resolveInsets(slice.bleed),
		order: slice.order ?? index,
		index,
	};
}

// The outline over the box (0, 0, width, height), as the shape paints it.
function outlineOf(el: Sliced, width: number, height: number): string {
	if (el.type === "vector")
		return roundCorners(el.properties.d, el.properties.cornerRadius ?? 0);
	const geometry = outlineGeometry(
		rectShape(el.properties.cornerRadius, el.properties.cornerSmoothing),
		0,
		0,
		width,
		height,
	);
	return geometry ? outlineSvg(geometry) : "";
}
