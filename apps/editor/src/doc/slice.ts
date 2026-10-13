import type { Template } from "@freshcoat-js/coatfile";
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

/** Turns the modifier on (an empty one, which keeps an existing one) or off
 *  for the layers that can carry it. */
export function setSlice(
	t: Template,
	keys: readonly string[],
	on: boolean,
): OpResult {
	let next = t;
	for (const key of keys) {
		if (!isSliceable(next, key) || isSlice(next, key) === on) continue;
		const r = updateElement(next, key, {
			properties: { slice: on ? {} : undefined },
		});
		if (!r.ok) return r;
		next = r.template;
	}
	return ok(next, [...keys]);
}
