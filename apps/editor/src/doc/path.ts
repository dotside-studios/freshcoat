import {
	type Background,
	childElements,
	type Element,
	type Template,
	type VectorBoolean,
	type VectorElement,
} from "@freshcoat-js/coatfile";

export type LayerPath =
	| { side: number; path: number[] }
	| { side: number; background: true };

export type Layer = Element | Background;

/** Index of a mask's source (`properties.mask`) within a path. */
export const MASK_SOURCE = -1;

export function isBackgroundPath(
	p: LayerPath,
): p is { side: number; background: true } {
	return "background" in p;
}

export function keyOf(p: LayerPath): string {
	return isBackgroundPath(p) ? `${p.side}/bg` : [p.side, ...p.path].join("/");
}

/** Inverse of `keyOf`. Returns null for a malformed key. */
export function parseKey(key: string): LayerPath | null {
	const parts = key.split("/");
	if (parts.length < 2) return null;
	const side = toIndex(parts[0]);
	if (side === null || side < 0) return null;
	if (parts.length === 2 && parts[1] === "bg")
		return { side, background: true };
	const path: number[] = [];
	for (const part of parts.slice(1)) {
		const n = toIndex(part);
		if (n === null || n < MASK_SOURCE) return null;
		path.push(n);
	}
	if (path[0] === MASK_SOURCE) return null;
	return { side, path };
}

function toIndex(s: string | undefined): number | null {
	if (s === undefined || !/^-?\d+$/.test(s)) return null;
	return Number(s);
}

export function toPath(p: LayerPath | string): LayerPath | null {
	return typeof p === "string" ? parseKey(p) : p;
}

/** The layers directly inside an element, as `[index, element]` pairs: a
 *  mask's source at -1 first, then children or boolean operands. */
export function childEntries(el: Layer): [number, Element][] {
	const first = el.type === "mask" ? MASK_SOURCE : 0;
	return childElements(el).map((c, i) => [first + i, c]);
}

/** A vector that keeps its operands. They are its only layers, at indexes
 *  from 0 in paint order. */
export type BooleanVector = VectorElement & {
	properties: { boolean: VectorBoolean };
};

/** A layer that holds other layers: a frame, a mask or a boolean vector. */
export type Container =
	| Extract<Element, { type: "frame" | "mask" }>
	| BooleanVector;

export function isBooleanVector(el: Layer | undefined): el is BooleanVector {
	return el?.type === "vector" && el.properties.boolean !== undefined;
}

export function isContainer(el: Layer | undefined): el is Container {
	return el?.type === "frame" || el?.type === "mask" || isBooleanVector(el);
}

/** Whether the layer is an operand of a boolean vector, which paints no fill,
 *  stroke or effect of its own. */
export function isOperand(t: Template, key: string): boolean {
	const parent = parentKeyOf(key);
	return parent !== null && isBooleanVector(getElement(t, parent));
}

/** A container's layers other than a mask's source: its children, or a
 *  boolean vector's operands. */
export function childrenOf(el: Container): Element[] {
	return el.type === "vector"
		? el.properties.boolean.operands
		: el.properties.children;
}

export function getElement(
	t: Template,
	p: LayerPath | string,
): Layer | undefined {
	const lp = toPath(p);
	if (!lp) return undefined;
	const frame = t.template_data[lp.side];
	if (!frame) return undefined;
	if (isBackgroundPath(lp)) return frame.background;
	let el: Element | undefined = frame.elements[lp.path[0]];
	for (const i of lp.path.slice(1)) {
		if (!el) return undefined;
		if (i === MASK_SOURCE)
			el = el.type === "mask" ? el.properties.mask : undefined;
		else el = isContainer(el) ? childrenOf(el)[i] : undefined;
	}
	return el;
}

/** The containing layer, or null for a top-level layer and the background. */
export function parentOf(p: LayerPath | string): LayerPath | null {
	const lp = toPath(p);
	if (!lp || isBackgroundPath(lp) || lp.path.length < 2) return null;
	return { side: lp.side, path: lp.path.slice(0, -1) };
}

export function parentKeyOf(key: string): string | null {
	const p = parentOf(key);
	return p ? keyOf(p) : null;
}

/** Whether `a` is a strict ancestor of `b`. */
export function isAncestor(
	a: LayerPath | string,
	b: LayerPath | string,
): boolean {
	const pa = toPath(a);
	const pb = toPath(b);
	if (!pa || !pb || isBackgroundPath(pa) || isBackgroundPath(pb)) return false;
	if (pa.side !== pb.side || pa.path.length >= pb.path.length) return false;
	return pa.path.every((v, i) => pb.path[i] === v);
}

/** Every layer in the list that holds `p`, `p` included. A mask source and the
 *  background are alone in theirs. A boolean vector's operands are a list. */
export function siblingsOf(t: Template, p: LayerPath | string): LayerPath[] {
	const lp = toPath(p);
	if (!lp || !getElement(t, lp)) return [];
	if (isBackgroundPath(lp) || lp.path.at(-1) === MASK_SOURCE) return [lp];
	const parent = parentOf(lp);
	const list = parent
		? childEntries(getElement(t, parent) as Element).filter(
				([i]) => i !== MASK_SOURCE,
			)
		: t.template_data[lp.side].elements.map((e, i) => [i, e] as const);
	const base = parent && !isBackgroundPath(parent) ? parent.path : [];
	return list.map(([i]) => ({ side: lp.side, path: [...base, i] }));
}

/** The layers directly inside `p`: a mask's source first, then children. */
export function childPaths(t: Template, p: LayerPath | string): LayerPath[] {
	const lp = toPath(p);
	if (!lp || isBackgroundPath(lp)) return [];
	const el = getElement(t, lp);
	if (!el) return [];
	return childEntries(el).map(([i]) => ({
		side: lp.side,
		path: [...lp.path, i],
	}));
}

export type LayerEntry = {
	key: string;
	path: LayerPath;
	element: Layer;
	parentKey: string | null;
	depth: number;
};

/** Every layer on a side, depth-first with parents before children: the
 *  background first, then elements in paint order, each mask's source before
 *  what it masks. */
export function* walkLayers(t: Template, side: number): Generator<LayerEntry> {
	const frame = t.template_data[side];
	if (!frame) return;
	const bg: LayerPath = { side, background: true };
	yield {
		key: keyOf(bg),
		path: bg,
		element: frame.background,
		parentKey: null,
		depth: 0,
	};
	function* visit(
		el: Element,
		path: number[],
		parentKey: string | null,
	): Generator<LayerEntry> {
		const p: LayerPath = { side, path };
		const key = keyOf(p);
		yield { key, path: p, element: el, parentKey, depth: path.length - 1 };
		for (const [i, child] of childEntries(el))
			yield* visit(child, [...path, i], key);
	}
	for (const [i, el] of frame.elements.entries()) yield* visit(el, [i], null);
}

/** Keys that still resolve in `t`. */
export function resolvableKeys(t: Template, keys: Iterable<string>): string[] {
	return [...keys].filter((k) => getElement(t, k) !== undefined);
}

/**
 * Carries layer keys from `before` to `after`. Tried in order: the same
 * element object (operations share untouched subtrees), the same key still
 * holding an element with the same id and type, then the only element on the
 * side with that id and type. Keys that match none of these are dropped.
 */
export function remapKeys(
	before: Template,
	after: Template,
	keys: Iterable<string>,
): string[] {
	return keyRemapper(before, after)(keys);
}

/** `remapKeys` for several key sets, building the lookups over `after` once,
 *  on the first set that needs them. */
export function keyRemapper(
	before: Template,
	after: Template,
): (keys: Iterable<string>) => string[] {
	let lookups:
		| {
				byObject: Map<Layer, string>;
				byId: Map<string, string | null>;
				sideMap: Map<number, number>;
		  }
		| undefined;
	const index = () => {
		const byObject = new Map<Layer, string>();
		const byId = new Map<string, string | null>();
		for (let s = 0; s < after.template_data.length; s++) {
			for (const entry of walkLayers(after, s)) {
				byObject.set(entry.element, entry.key);
				const idKey = `${s}\u0000${entry.element.type}\u0000${entry.element.id}`;
				byId.set(idKey, byId.has(idKey) ? null : entry.key);
			}
		}
		return { byObject, byId, sideMap: sideRemap(before, after) };
	};
	return (keys) => {
		const list = [...keys];
		if (before === after || list.length === 0) return list;
		lookups ??= index();
		const { byObject, byId, sideMap } = lookups;
		const out: string[] = [];
		for (const key of list) {
			const old = getElement(before, key);
			const lp = parseKey(key);
			if (!old || !lp) continue;
			const found = byObject.get(old);
			if (found !== undefined) {
				out.push(found);
				continue;
			}
			const side = sideMap.get(lp.side);
			if (side === undefined) continue;
			const moved = keyOf({ ...lp, side });
			const same = getElement(after, moved);
			if (same && same.id === old.id && same.type === old.type) {
				out.push(moved);
				continue;
			}
			const unique = byId.get(`${side}\u0000${old.type}\u0000${old.id}`);
			if (unique) {
				out.push(unique);
				continue;
			}
			// An edit in place (a rename, a replaced element) keeps the position and
			// the number of siblings, which a structural edit around it would not.
			if (
				same &&
				same.type === old.type &&
				siblingCount(before, key) === siblingCount(after, moved)
			)
				out.push(moved);
		}
		return [...new Set(out)];
	};
}

/**
 * Whether every key names the same layer in `a` and `b`: the same sides, and
 * the same ids, types and nesting at every position. Shared subtrees are not
 * walked, so an edit to one layer costs its ancestors' siblings.
 */
export function sameStructure(a: Template, b: Template): boolean {
	if (a === b || a.template_data === b.template_data) return true;
	if (a.template_data.length !== b.template_data.length) return false;
	return a.template_data.every((f, i) => {
		const g = b.template_data[i];
		return (
			g !== undefined && f.name === g.name && sameLayers(f.elements, g.elements)
		);
	});
}

function sameLayers(a: readonly Element[], b: readonly Element[]): boolean {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	return a.every((x, i) => {
		const y = b[i] as Element;
		if (x === y) return true;
		if (x.id !== y.id || x.type !== y.type) return false;
		const xs = childEntries(x);
		const ys = childEntries(y);
		return (
			xs.length === ys.length &&
			sameLayers(
				xs.map(([, c]) => c),
				ys.map(([, c]) => c),
			)
		);
	});
}

function siblingCount(t: Template, key: string): number {
	const lp = parseKey(key);
	if (!lp || isBackgroundPath(lp)) return -1;
	if (lp.path.length === 1)
		return t.template_data[lp.side]?.elements.length ?? -1;
	const parent = parentKeyOf(key);
	const el = parent === null ? undefined : getElement(t, parent);
	return el ? childEntries(el).length : -1;
}

// Sides are matched by name, since a side rename changes nothing else.
function sideRemap(before: Template, after: Template): Map<number, number> {
	const out = new Map<number, number>();
	before.template_data.forEach((f, i) => {
		const j = after.template_data.findIndex((g) => g.name === f.name);
		if (j !== -1) out.set(i, j);
		else if (
			before.template_data.length === after.template_data.length &&
			after.template_data[i]
		)
			out.set(i, i);
	});
	return out;
}

/** Sorts keys in document order (side, then path, parents first). */
export function compareKeys(a: string, b: string): number {
	const pa = parseKey(a);
	const pb = parseKey(b);
	if (!pa || !pb) return a < b ? -1 : a > b ? 1 : 0;
	if (pa.side !== pb.side) return pa.side - pb.side;
	if (isBackgroundPath(pa)) return isBackgroundPath(pb) ? 0 : -1;
	if (isBackgroundPath(pb)) return 1;
	const n = Math.min(pa.path.length, pb.path.length);
	for (let i = 0; i < n; i++)
		if (pa.path[i] !== pb.path[i]) return pa.path[i] - pb.path[i];
	return pa.path.length - pb.path.length;
}
