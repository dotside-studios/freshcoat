import { parseAssetUri } from "@freshcoat-js/coatfile/assets";
import { nestedElementArrays } from "./finalize";
import type { NodeTrace } from "./types";

// Fill string of a background rect, when it's a plain solid (not a gradient).
export function fillOf(bg: unknown): string | undefined {
	const b = bg as { properties?: { fill?: unknown } } | undefined;
	return typeof b?.properties?.fill === "string"
		? (b.properties.fill as string)
		: undefined;
}

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

// Shallow per-key diff of two elements' `properties` — collects only the keys
// whose (serialized) value differs, so an unchanged nested object (e.g. the
// same `font` re-produced by a fresh buildSideElements call) doesn't
// spuriously show up as a delta.
//
// A `frame` element's `properties.children` is EXCLUDED from this diff: every
// descendant is its own entry in flattenElementsById and gets its own,
// correctly-scoped delta from its own call to diffElementProperties. If we
// compared `children` here too, any single descendant change would make the
// whole subtree "differ" on the ancestor frame's key as well — duplicating
// the real per-descendant delta and bloating the emitted override with a
// full-subtree copy that applyElementOverrides doesn't even need (it already
// recurses into frame children independently).
export function diffElementProperties(
	base: Record<string, unknown>,
	variant: Record<string, unknown>,
): Record<string, unknown> {
	const baseProps = (base.properties ?? {}) as Record<string, unknown>;
	const variantProps = (variant.properties ?? {}) as Record<string, unknown>;
	const isFrame = base.type === "frame" || variant.type === "frame";
	const isMask = base.type === "mask" || variant.type === "mask";
	const changed: Record<string, unknown> = {};
	for (const key of new Set([
		...Object.keys(baseProps),
		...Object.keys(variantProps),
	])) {
		if ((isFrame || isMask) && key === "children") continue;
		// A mask's shape is its own entry too, diffed by its own id.
		if (isMask && key === "mask") continue;
		if (JSON.stringify(baseProps[key]) !== JSON.stringify(variantProps[key])) {
			changed[key] = variantProps[key];
		}
	}
	return changed;
}

export type ElementDelta = {
	id: string;
	properties: Record<string, unknown>;
	pos?: unknown;
	size?: unknown;
	rotation?: number;
	opacity?: number;
	hidden?: boolean;
};

// The base elements a colorway hides, from the base nodes it hides (see
// alignInstanceVisibility) and the element each produced in the base walk.
// `top` holds the outermost of them, which carry `hidden: true`; `within`
// holds those and everything under them, which need no delta of their own
// since hiding an element hides its subtree.
export function hiddenElements(
	elements: unknown[],
	trace: NodeTrace[],
	slot: string,
	hiddenNodes: Set<string>,
): { top: Set<string>; within: Set<string> } {
	const hiddenIds = new Set<string>();
	for (const t of trace) {
		if (t.slot === slot && t.elementId && hiddenNodes.has(t.nodeId))
			hiddenIds.add(t.elementId);
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

// The shell fields a variant delta can carry besides `properties`, each with
// the value an element that omits it has.
const SHELL_DEFAULTS = {
	pos: undefined,
	size: undefined,
	rotation: 0,
	opacity: 1,
} as const;

type ShellDelta = Omit<ElementDelta, "id" | "properties" | "hidden">;

// Two walks of the same layer can differ in the last bits of a float (the
// instance sits elsewhere on the page), which is not a change.
function sameValue(a: unknown, b: unknown): boolean {
	if (typeof a === "number" && typeof b === "number")
		return Math.abs(a - b) < 1e-6;
	if (a && b && typeof a === "object" && typeof b === "object") {
		const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
		for (const k of keys) {
			if (
				!sameValue(
					(a as Record<string, unknown>)[k],
					(b as Record<string, unknown>)[k],
				)
			)
				return false;
		}
		return true;
	}
	return a === b;
}

// The element's `pos`, `size`, `rotation` and `opacity` where the variant's
// differ from the base's. A frame child's position is its own: when a
// colorway resizes a frame, each child it moved differs here too, so it gets
// its own delta and nothing is re-placed from the parent's size.
export function diffElementShell(
	base: Record<string, unknown>,
	variant: Record<string, unknown>,
): ShellDelta {
	const changed: Record<string, unknown> = {};
	for (const [key, fallback] of Object.entries(SHELL_DEFAULTS)) {
		const b = base[key] ?? fallback;
		const v = variant[key] ?? fallback;
		if (v !== undefined && !sameValue(b, v)) changed[key] = v;
	}
	return changed as ShellDelta;
}

// Recursively collects every `asset:` reference reachable inside a value (an
// emitted variant override, typically a `src` on a repainted raster image
// element). The kit's collectAssetRefs walks a whole template; this one walks
// an arbitrary override delta, to pin down exactly which of a variant side's
// rasterized assets must ride along in the bundle.
export function collectAssetRefsDeep(value: unknown, out: Set<string>): void {
	if (typeof value === "string") {
		const sha = parseAssetUri(value);
		if (sha !== null) out.add(sha);
		return;
	}
	if (Array.isArray(value)) {
		for (const v of value) collectAssetRefsDeep(v, out);
		return;
	}
	if (value && typeof value === "object") {
		for (const v of Object.values(value)) collectAssetRefsDeep(v, out);
	}
}
