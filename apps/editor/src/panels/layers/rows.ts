import type { Element, Template } from "@freshcoat-js/coatfile";
import { hasToken } from "@freshcoat-js/coatfile/tokens";
import { childEntries, keyOf, type Layer, MASK_SOURCE } from "~/doc/path";

export type RowKind = "layer" | "background" | "maskSource";

export type LayerRow = {
	key: string;
	/** The element id, which is the layer's name. */
	id: string;
	kind: RowKind;
	element: Layer;
	/** Reads a field through a token in its own properties, or has `visibleWhen`. */
	bound: boolean;
	/** A frame or mask, which accepts a drop "on" it. */
	container: boolean;
	/** Topmost first, a mask's source last. */
	children: LayerRow[];
};

/** Whether the layer itself (not what it holds) depends on a field. */
export function isBound(layer: Layer): boolean {
	if ("visibleWhen" in layer && layer.visibleWhen) return true;
	const {
		children: _c,
		mask: _m,
		...own
	} = (layer.properties ?? {}) as Record<string, unknown>;
	return hasToken(own);
}

// Rows are reused while their element object and key are unchanged, since
// operations share untouched subtrees.
const cache = new WeakMap<object, LayerRow>();

function rowFor(
	element: Layer,
	key: string,
	kind: RowKind,
	children: () => LayerRow[],
): LayerRow {
	const hit = cache.get(element);
	if (hit && hit.key === key && hit.kind === kind) return hit;
	const container =
		kind === "layer" && (element.type === "frame" || element.type === "mask");
	const row: LayerRow = {
		key,
		id: element.id,
		kind,
		element,
		bound: isBound(element),
		container,
		children: children(),
	};
	cache.set(element, row);
	return row;
}

function elementRow(el: Element, side: number, path: number[]): LayerRow {
	const key = keyOf({ side, path });
	const kind: RowKind = path.at(-1) === MASK_SOURCE ? "maskSource" : "layer";
	return rowFor(el, key, kind, () => {
		const entries = childEntries(el);
		const source = entries.filter(([i]) => i === MASK_SOURCE);
		const kids = entries.filter(([i]) => i !== MASK_SOURCE).reverse();
		return [...kids, ...source].map(([i, c]) =>
			elementRow(c, side, [...path, i]),
		);
	});
}

/** The tree for one side as the panel shows it: the topmost layer first and
 *  the background last. */
export function buildLayerRows(t: Template, side: number): LayerRow[] {
	const frame = t.template_data[side];
	if (!frame) return [];
	const rows = frame.elements
		.map((el, i) => elementRow(el, side, [i]))
		.reverse();
	rows.push(
		rowFor(
			frame.background,
			keyOf({ side, background: true }),
			"background",
			() => [],
		),
	);
	return rows;
}

/** Every row key, depth first in display order. */
export function flattenRows(rows: LayerRow[]): string[] {
	const out: string[] = [];
	const visit = (list: LayerRow[]) => {
		for (const r of list) {
			out.push(r.key);
			visit(r.children);
		}
	};
	visit(rows);
	return out;
}
