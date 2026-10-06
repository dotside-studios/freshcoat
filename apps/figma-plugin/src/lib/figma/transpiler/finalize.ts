import type { VisibilityCondition } from "@freshcoat-js/coatfile";
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

// The element arrays nested inside one: a frame's children, and a mask's shape
// and the content it masks. The shape is still an array until finalizeMasks.
export function nestedElementArrays(el: Record<string, unknown>): unknown[][] {
	const props = el.properties as
		| { children?: unknown; mask?: unknown }
		| undefined;
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

// coatfile's uniquifyElementIds (@freshcoat-js/coatfile/normalize) only
// dedupes the TOP-LEVEL array — it never recurses into a frame element's
// `properties.children`. Figma auto-names layers ("Text", "Rectangle", …),
// so a nested element commonly slugs to the same id as a top-level (or
// sibling-subtree) element, e.g. two "Text" layers both → "text". That
// collision survives past uniquifyElementIds and later breaks
// flattenElementsById: its flat id→element map is last-write-wins, so one
// of the colliding elements silently disappears from the diff, and
// coatfile's `compile.applyElementOverrides` (which itself recurses
// into frame children) applies the resulting delta to BOTH elements that
// share the id — the wrong element gets recolored on the printed card, with
// no warning (the id SETS still compare equal, so variant_structure_mismatch
// never fires).
//
// Fix: assign ids that are unique across the WHOLE side element tree (top-
// level AND every nested frame.properties.children), depth-first in
// traversal order — same collision-suffix scheme as uniquifyElementIds
// (`_2`, `_3`, … skipping ids already taken), just tracked in one Set that
// spans the whole tree instead of one per array. Deliberately kept local to
// the plugin (not folded into coatfile's uniquifyElementIds) since only
// the transpiler's by-id variant diff needs global-per-side uniqueness;
// coatfile's own `validate` only enforces per-frame (top-level)
// uniqueness, so this is strictly more unique and stays valid there.
//
// Because an instance mirrors the base's structure/order, running this SAME
// deterministic walk over the base side and every variant side yields
// identical id sequences, so flattenElementsById becomes collision-free and
// the diff aligns element-for-element.
export function uniquifyElementIdsDeep(elements: unknown[]): unknown[] {
	const seen = new Set<string>();
	const walk = (els: unknown[]): void => {
		for (const raw of els) {
			const el = raw as Record<string, unknown>;
			const originalId = typeof el.id === "string" ? el.id : "";
			let id = originalId;
			if (seen.has(id)) {
				let n = 2;
				while (seen.has(`${originalId}_${n}`)) n += 1;
				id = `${originalId}_${n}`;
			}
			seen.add(id);
			el.id = id;
			for (const nested of nestedElementArrays(el)) walk(nested);
		}
	};
	walk(elements);
	return elements;
}
