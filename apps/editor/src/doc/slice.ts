import type { SliceModifier, Template } from "@freshcoat-js/coatfile";
import { parseVectorPath } from "./vector-edit";
import { type OpResult, ok, updateElement } from "./ops";
import { getElement, parseKey } from "./path";

/** Whether the layer can carry a `slice`: a rect or vector directly on a
 *  side, which is all the format allows. */
export function isSliceable(t: Template, key: string): boolean {
	const p = parseKey(key);
	if (!p || "background" in p || p.path.length !== 1) return false;
	const el = getElement(t, p);
	return el?.type === "rect" || el?.type === "vector";
}

export function isSlice(t: Template, key: string): boolean {
	const props = getElement(t, key)?.properties as
		| { slice?: unknown }
		| undefined;
	return props?.slice !== undefined;
}

/** Whether the layer is a vector with an open subpath, which is a cut line
 *  and cannot be a piece. A live boolean's outline is not read. */
export function hasOpenPath(t: Template, key: string): boolean {
	const el = getElement(t, key);
	if (el?.type !== "vector") return false;
	const props = el.properties as { d?: unknown; boolean?: unknown };
	return (
		props.boolean === undefined &&
		typeof props.d === "string" &&
		parseVectorPath(props.d).some((p) => !p.closed)
	);
}

/** What a layer's slice starts as: an empty modifier, or for an open path a
 *  score line that is not a piece. */
export function newSlice(t: Template, key: string): SliceModifier {
	return hasOpenPath(t, key) ? { output: "none", edge: "score" } : {};
}

/** Turns the modifier on (a new one, which keeps an existing one) or off for
 *  the layers that can carry it. */
export function setSlice(
	t: Template,
	keys: readonly string[],
	on: boolean,
): OpResult {
	let next = t;
	for (const key of keys) {
		if (!isSliceable(next, key) || isSlice(next, key) === on) continue;
		const r = updateElement(next, key, {
			properties: { slice: on ? newSlice(next, key) : undefined },
		});
		if (!r.ok) return r;
		next = r.template;
	}
	return ok(next, [...keys]);
}
