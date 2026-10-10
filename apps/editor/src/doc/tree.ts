// Structural-sharing edits on a template's layer tree. Only the spine from the
// side down to the edited layer is copied; everything else keeps its identity.

import type {
	Background,
	BooleanOperandElement,
	Element,
	Template,
	TemplateFrame,
} from "@freshcoat-js/coatfile";
import {
	type Container,
	childrenOf,
	getElement,
	isContainer,
	MASK_SOURCE,
} from "./path";

export function updateSide(
	t: Template,
	side: number,
	fn: (frame: TemplateFrame) => TemplateFrame,
): Template {
	const frame = t.template_data[side];
	const next = fn(frame);
	if (next === frame) return t;
	const template_data = t.template_data.slice();
	template_data[side] = next;
	return { ...t, template_data };
}

export function updateBackground(
	t: Template,
	side: number,
	fn: (bg: Background) => Background,
): Template {
	return updateSide(t, side, (f) => {
		const bg = fn(f.background);
		return bg === f.background ? f : { ...f, background: bg };
	});
}

/** Replaces the element at `path` (non-empty) with `fn(element)`. */
export function updateAt(
	t: Template,
	side: number,
	path: number[],
	fn: (el: Element) => Element,
): Template {
	return updateSide(t, side, (f) => {
		const elements = replaceIn(f.elements, path, fn);
		return elements === f.elements ? f : { ...f, elements };
	});
}

function replaceIn(
	list: Element[],
	path: number[],
	fn: (el: Element) => Element,
): Element[] {
	const [i, ...rest] = path;
	const el = list[i];
	if (!el) throw new Error(`no layer at index ${i}`);
	const next = rest.length === 0 ? fn(el) : replaceInside(el, rest, fn);
	if (next === el) return list;
	const copy = list.slice();
	copy[i] = next;
	return copy;
}

function replaceInside(
	el: Element,
	rest: number[],
	fn: (el: Element) => Element,
): Element {
	if (!isContainer(el)) throw new Error(`${el.id} has no children`);
	const [j, ...more] = rest;
	if (j === MASK_SOURCE) {
		if (el.type !== "mask") throw new Error(`${el.id} is not a mask`);
		const src = el.properties.mask;
		const next = more.length === 0 ? fn(src) : replaceInside(src, more, fn);
		return next === src
			? el
			: { ...el, properties: { ...el.properties, mask: next } };
	}
	const children = replaceIn(childrenOf(el), rest, fn);
	return withChildren(el, children);
}

export function withChildren(el: Container, children: Element[]): Container {
	if (children === childrenOf(el)) return el;
	if (el.type === "vector")
		return {
			...el,
			properties: {
				...el.properties,
				boolean: {
					...el.properties.boolean,
					operands: children as BooleanOperandElement[],
				},
			},
		};
	return { ...el, properties: { ...el.properties, children } } as Container;
}

/** Edits the list at `parentPath`: `[]` is the side's top level, otherwise a
 *  frame's or mask's children or a boolean vector's operands. */
export function updateList(
	t: Template,
	side: number,
	parentPath: number[],
	fn: (list: Element[]) => Element[],
): Template {
	if (parentPath.length === 0) {
		return updateSide(t, side, (f) => {
			const elements = fn(f.elements);
			return elements === f.elements ? f : { ...f, elements };
		});
	}
	return updateAt(t, side, parentPath, (el) => {
		if (!isContainer(el)) throw new Error(`${el.id} has no children`);
		return withChildren(el, fn(childrenOf(el)));
	});
}

export function listAt(
	t: Template,
	side: number,
	parentPath: number[],
): Element[] | undefined {
	if (parentPath.length === 0) return t.template_data[side]?.elements;
	const el = getElement(t, { side, path: parentPath });
	return isContainer(el) ? childrenOf(el) : undefined;
}

/** Returns a copy of `obj` with `patch` merged in; a key set to `undefined` in
 *  the patch is removed. */
export function mergeDefined<T extends object>(obj: T, patch: object): T {
	const out = { ...obj } as Record<string, unknown>;
	for (const [k, v] of Object.entries(patch)) {
		if (v === undefined) delete out[k];
		else out[k] = v;
	}
	return out as T;
}
