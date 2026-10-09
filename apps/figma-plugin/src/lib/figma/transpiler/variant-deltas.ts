import { nestedElementArrays } from "./finalize";
import type { NodeTrace } from "./types";

export function backgroundsDiffer(a: unknown, b: unknown): boolean {
	const ap = (a as { properties?: unknown } | undefined)?.properties;
	const bp = (b as { properties?: unknown } | undefined)?.properties;
	return JSON.stringify(ap) !== JSON.stringify(bp);
}

// Flattens an element tree (frame children nested) into an id → element map,
// so a colorway instance's side can be diffed against the base BY ELEMENT ID.
// Ids are unique per side (uniquifyElementIdsDeep in finalize.ts uniquifies across
// the WHOLE tree — top-level and nested frame children), so a single flat
// map is collision-free.
export function flattenElementsById(
	elements: unknown[],
): Map<string, Record<string, unknown>> {
	const map = new Map<string, Record<string, unknown>>();
	const visit = (els: unknown[]) => {
		for (const raw of els) {
			const el = raw as Record<string, unknown>;
			if (typeof el.id === "string") map.set(el.id, el);
			for (const nested of nestedElementArrays(el)) visit(nested);
		}
	};
	visit(elements);
	return map;
}

/** The element ids each node produced on one side, from the base walk's
 *  trace. */
export function traceElementsByNode(
	trace: NodeTrace[],
	slot: string,
): Map<string, string[]> {
	const out = new Map<string, string[]>();
	for (const t of trace) {
		if (t.slot !== slot || !t.elementId) continue;
		const ids = out.get(t.nodeId);
		if (ids) ids.push(t.elementId);
		else out.set(t.nodeId, [t.elementId]);
	}
	return out;
}

// The base elements a colorway hides, from the base nodes it hides (see
// alignInstanceVisibility) and the element each produced in the base walk
// (see traceElementsByNode). `top` holds the outermost of them, which carry
// `hidden: true`; `within` holds those and everything under them, which need
// no delta of their own since hiding an element hides its subtree.
export function hiddenElements(
	elements: unknown[],
	elementsByNode: Map<string, string[]>,
	hiddenNodes: Set<string>,
): { top: Set<string>; within: Set<string> } {
	const hiddenIds = new Set<string>();
	for (const nodeId of hiddenNodes) {
		for (const id of elementsByNode.get(nodeId) ?? []) hiddenIds.add(id);
	}
	const top = new Set<string>();
	const within = new Set<string>();
	const visit = (els: unknown[], underHidden: boolean): void => {
		for (const raw of els) {
			const el = raw as Record<string, unknown>;
			const id = typeof el.id === "string" ? el.id : "";
			const isHidden = hiddenIds.has(id);
			if (isHidden && !underHidden) top.add(id);
			if (isHidden || underHidden) within.add(id);
			for (const nested of nestedElementArrays(el))
				visit(nested, underHidden || isHidden);
		}
	};
	if (hiddenIds.size > 0) visit(elements, false);
	return { top, within };
}
