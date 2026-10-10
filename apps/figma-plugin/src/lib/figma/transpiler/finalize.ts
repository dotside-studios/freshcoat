import type { VisibilityCondition } from "@freshcoat-js/coatfile";
import { uniquifyElementIdsDeep as uniquifyIdsDeep } from "@freshcoat-js/coatfile/normalize";
import type { FigmaNode } from "../types";

// Figma masks the layers ABOVE a mask layer in the same parent, up to the next
// mask layer. A hidden mask masks nothing, so it is walked (and skipped) like any
// hidden layer.
export function maskRuns(
	children: FigmaNode[],
): Array<{ node: FigmaNode; masked?: FigmaNode[] }> {
	const runs: Array<{ node: FigmaNode; masked?: FigmaNode[] }> = [];
	let current: FigmaNode[] | undefined;
	for (const child of children) {
		if (child.isMask && child.visible !== false) {
			current = [];
			runs.push({ node: child, masked: current });
		} else if (current) current.push(child);
		else runs.push({ node: child });
	}
	return runs;
}

// The element arrays nested inside one: a frame's children, a mask's shape
// and the content it masks, and a boolean vector's operands. The shape is still
// an array until finalizeMasks.
export function nestedElementArrays(el: Record<string, unknown>): unknown[][] {
	const props = el.properties as
		| { children?: unknown; mask?: unknown; boolean?: { operands?: unknown } }
		| undefined;
	if (el.type === "vector")
		return Array.isArray(props?.boolean?.operands)
			? [props.boolean.operands]
			: [];
	if (el.type !== "frame" && el.type !== "mask") return [];
	const out: unknown[][] = [];
	if (el.type === "mask" && props?.mask)
		out.push(Array.isArray(props.mask) ? props.mask : [props.mask]);
	if (Array.isArray(props?.children)) out.push(props.children);
	return out;
}

// Settle each mask's shape now that every raster has landed: one element as is,
// several wrapped in a frame over the mask's box, none (every part of it was
// hidden or failed to export) and the mask shows nothing, so it goes.
export function finalizeMasks(elements: unknown[]): unknown[] {
	const out: unknown[] = [];
	for (const raw of elements) {
		const el = raw as Record<string, unknown>;
		const props = el.properties as
			| { children?: unknown[]; mask?: unknown }
			| undefined;
		if (Array.isArray(props?.children))
			props.children = finalizeMasks(props.children);
		if (el.type === "mask" && props && Array.isArray(props.mask)) {
			const shape = finalizeMasks(dropUnfilledSlots(props.mask as unknown[]));
			if (shape.length === 0) continue;
			props.mask =
				shape.length === 1
					? shape[0]
					: {
							id: `${el.id}_shape`,
							type: "frame",
							pos: { x: 0, y: 0 },
							size: el.size,
							properties: { children: shape },
						};
		}
		out.push(el);
	}
	return out;
}

// Nested `if:` layers stack: an element inside two shows only while both hold.
export function addVisibility(
	el: Record<string, unknown>,
	cond: VisibilityCondition,
): void {
	const cur = el.visibleWhen as
		| VisibilityCondition
		| VisibilityCondition[]
		| undefined;
	el.visibleWhen = cur ? [...(Array.isArray(cur) ? cur : [cur]), cond] : cond;
}

// Remove the z-order placeholders no raster ever landed in — a marker whose
// bytes were never exported, or one dropped for covering no area. They exist
// only to hold a position during the walk and are not template elements, so
// they must not reach the emitted side. Recurses frame children, since a
// placeholder is reserved in whichever array its node was being walked into.
export function dropUnfilledSlots(elements: unknown[]): unknown[] {
	const walk = (els: unknown[]): void => {
		for (let i = els.length - 1; i >= 0; i--) {
			const el = els[i] as Record<string, unknown>;
			if ((el as { __rasterSlot?: boolean }).__rasterSlot === true) {
				els.splice(i, 1);
				continue;
			}
			for (const nested of nestedElementArrays(el)) walk(nested);
		}
	};
	walk(elements);
	return elements;
}

// Element ids unique across the whole side tree, not only per array as
// `validate` asks: the variant diff flattens a side by id, so a nested repeat
// would drop an element from the diff and apply its delta to both. An
// instance mirrors its base's structure and order, so this deterministic walk
// gives the base side and every variant side the same ids and the diff aligns
// element for element. In place, since trace entries hold the elements.
export function uniquifyElementIdsDeep(elements: unknown[]): unknown[] {
	return uniquifyIdsDeep(elements as { id: string }[], {
		inPlace: true,
		nested: (el) =>
			nestedElementArrays(el as Record<string, unknown>) as { id: string }[][],
	});
}
