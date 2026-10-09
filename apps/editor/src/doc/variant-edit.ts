// Editing inside a variant. The editor edits the working template (the base
// with the active variant applied, hidden layers kept) and folds each result
// back into the base as that variant's overrides, so every op that edits values
// works in a variant without knowing about variants.

import {
	activeVariantId,
	applyVariant,
	type Background,
	diffElement,
	type Element,
	variantDeltas as readVariantDeltas,
	type SideDeltas,
	sameJson,
	type Template,
	type TemplateFrame,
	VARIANT_SHELL_KEYS,
	type Variant,
	type VariantElementDelta,
	variantBase,
} from "@freshcoat-js/coatfile";
import type { LayerGeometry } from "./geometry";
import { childEntries, walkLayers } from "./path";

export { activeVariantId };

export type VariantOverride = Variant["overrides"][number];

// ── The working template ─────────────────────────────────────────────────────

const workingCache = new WeakMap<Template, Map<string, Template>>();

/**
 * The base with the variant applied for editing: hidden layers stay, ids,
 * paths and `variants` are unchanged. The base itself with no variant or an id
 * it lacks. Memoised, so the same base and id give the same object.
 */
export function workingTemplate(
	base: Template,
	variantId: string | undefined,
): Template {
	const id = activeVariantId(base, variantId);
	if (id === undefined) return base;
	let byId = workingCache.get(base);
	if (!byId) {
		byId = new Map();
		workingCache.set(base, byId);
	}
	let out = byId.get(id);
	if (!out) {
		out = applyVariant(base, id, { hidden: "keep" });
		byId.set(id, out);
	}
	return out;
}

// ── Reading a variant's overrides ────────────────────────────────────────────

/** `mergedElementDelta`, read through the per-template cache. */
export function mergedDelta(
	t: Template,
	variantId: string,
	sideName: string,
	elementId: string,
): VariantElementDelta | undefined {
	return variantDeltas(t, variantId).get(sideName)?.elements.get(elementId);
}

/** `sideBackground`, read through the per-template cache. */
export function overrideBackground(
	t: Template,
	variantId: string,
	sideName: string,
): Background | undefined {
	return variantDeltas(t, variantId).get(sideName)?.background;
}

/**
 * What the variant changes. With an element, its overridden `properties` keys
 * and shell fields (`pos`, `size`, `rotation`, `opacity`); `hidden` is not a
 * key here (see `isHiddenInVariant`). Without one, `["background"]` when the
 * variant replaces the side's background. These are the names `resetOverride`
 * takes.
 */
export function overriddenKeys(
	t: Template,
	variantId: string,
	sideName: string,
	elementId?: string,
): string[] {
	if (elementId === undefined)
		return overrideBackground(t, variantId, sideName) ? ["background"] : [];
	const d = mergedDelta(t, variantId, sideName, elementId);
	if (!d) return [];
	return [
		...Object.keys(d.properties).filter((k) => d.properties[k] !== undefined),
		...VARIANT_SHELL_KEYS.filter((k) => d[k] !== undefined),
	];
}

export function isHiddenInVariant(
	t: Template,
	variantId: string,
	sideName: string,
	elementId: string,
): boolean {
	return mergedDelta(t, variantId, sideName, elementId)?.hidden === true;
}

const deltasCache = new WeakMap<
	Template,
	Map<string, Map<string, SideDeltas>>
>();

function variantDeltas(
	t: Template,
	variantId: string,
): Map<string, SideDeltas> {
	let byId = deltasCache.get(t);
	if (!byId) {
		byId = new Map();
		deltasCache.set(t, byId);
	}
	let out = byId.get(variantId);
	if (!out) {
		out = readVariantDeltas(t, variantId);
		byId.set(variantId, out);
	}
	return out;
}

function deltaChanges(d: VariantElementDelta | undefined): boolean {
	if (!d) return false;
	if (d.hidden === true) return true;
	for (const k in d.properties) if (d.properties[k] !== undefined) return true;
	return VARIANT_SHELL_KEYS.some((k) => d[k] !== undefined);
}

function sideChangedKeys(
	t: Template,
	side: number,
	deltas: SideDeltas | undefined,
): string[] {
	const out: string[] = [];
	if (!t.template_data[side]) return out;
	for (const e of walkLayers(t, side)) {
		const changed =
			e.key.endsWith("/bg") && "background" in e.path
				? deltas?.background !== undefined
				: deltaChanges(deltas?.elements.get(e.element.id));
		if (changed) out.push(e.key);
	}
	return out;
}

/**
 * The layer keys on `side` the variant changes: overridden values, hidden, or
 * (for the background key) a replaced background. Orphaned deltas, whose id
 * names no layer, are not counted.
 */
export function changedLayerKeys(
	t: Template,
	variantId: string,
	side: number,
): string[] {
	const frame = t.template_data[side];
	if (!frame) return [];
	return sideChangedKeys(t, side, variantDeltas(t, variantId).get(frame.name));
}

const countCache = new WeakMap<Template, Map<string, number>>();

/** How many layers the variant changes across every side, a replaced
 *  background counting as one: "3 layers" in the Variants list. */
export function changedLayerCount(t: Template, variantId: string): number {
	let byId = countCache.get(t);
	if (!byId) {
		byId = new Map();
		countCache.set(t, byId);
	}
	const cached = byId.get(variantId);
	if (cached !== undefined) return cached;
	const deltas = variantDeltas(t, variantId);
	let n = 0;
	t.template_data.forEach((frame, side) => {
		const d = deltas.get(frame.name);
		if (d) n += sideChangedKeys(t, side, d).length;
	});
	byId.set(variantId, n);
	return n;
}

// ── Folding an edit into the base ────────────────────────────────────────────

/**
 * Whether `next` changed the working template's structure: its sides (count
 * or names), its size, or any side's tree (ids, types or where they sit).
 * Everything else is a value edit, which a variant can hold.
 */
export function isStructuralEdit(working: Template, next: Template): boolean {
	if (next === working) return false;
	if (next.width !== working.width || next.height !== working.height)
		return true;
	if (next.template_data === working.template_data) return false;
	if (next.template_data.length !== working.template_data.length) return true;
	return next.template_data.some((f, i) => {
		const w = working.template_data[i] as TemplateFrame;
		return (
			f.name !== w.name ||
			(f.elements !== w.elements && !sameTree(f.elements, w.elements))
		);
	});
}

function sameTree(a: Element[], b: Element[]): boolean {
	return (
		a.length === b.length &&
		a.every((el, i) => {
			const o = b[i] as Element;
			if (el === o) return true;
			if (el.id !== o.id || el.type !== o.type) return false;
			const ca = childEntries(el);
			const cb = childEntries(o);
			return (
				ca.length === cb.length &&
				ca.every(
					([j, c], n) =>
						cb[n]?.[0] === j && sameTree([c], [cb[n]?.[1] as Element]),
				)
			);
		})
	);
}

/**
 * Folds `next`, an edit of the working template for `variantId`, back into
 * `base`. A value edit recomputes the variant's overrides from `next` against
 * the base, so a value set back to the base's stops being an
 * override. A structural edit keeps `next`'s structure with every layer the
 * base has restored to the base's values; ops that change structure run on
 * the base (`scope: "base"`), so only a mistake reaches it.
 */
export function foldVariantEdit(
	base: Template,
	variantId: string,
	next: Template,
): Template {
	const id = activeVariantId(base, variantId);
	if (id === undefined) return next;
	const working = workingTemplate(base, id);
	if (next === working) return base;
	if (isStructuralEdit(working, next)) return foldStructural(base, id, next);

	const variant = base.variants?.find((v) => v.id === id) as Variant;
	const overrides = recomputeOverrides(
		base,
		variantBase(base, id),
		variant,
		working,
		next,
	);
	const variants = (next.variants ?? base.variants ?? []).map((v) =>
		v.id !== id
			? v
			: sameJson(v.overrides, overrides)
				? v
				: { ...v, overrides },
	);
	const out: Template = {
		...next,
		width: base.width,
		height: base.height,
		template_data: base.template_data,
		variants,
	};
	return shallowSame(out, base) ? base : out;
}

function shallowSame(a: Template, b: Template): boolean {
	const ra = a as Record<string, unknown>;
	const rb = b as Record<string, unknown>;
	const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
	for (const k of keys) {
		if (ra[k] === rb[k]) continue;
		if (k === "variants" && sameJson(ra[k], rb[k])) continue;
		return false;
	}
	return true;
}

function recomputeOverrides(
	base: Template,
	laid: Template,
	variant: Variant,
	working: Template,
	next: Template,
): VariantOverride[] {
	const sideNames = new Set(base.template_data.map((f) => f.name));
	// A side the edit left alone keeps its overrides exactly as they were.
	const untouched = new Set<string>();
	const computed = new Map<string, VariantOverride | null>();
	base.template_data.forEach((frame, side) => {
		if (computed.has(frame.name) || untouched.has(frame.name)) return;
		const n = next.template_data[side] as TemplateFrame;
		const w = working.template_data[side] as TemplateFrame;
		if (n === w) untouched.add(frame.name);
		else
			computed.set(frame.name, sideOverride(base, laid, variant, side, w, n));
	});

	const out: VariantOverride[] = [];
	const placed = new Set<string>();
	for (const ov of variant.overrides) {
		if (!sideNames.has(ov.name) || untouched.has(ov.name)) {
			out.push(ov);
			continue;
		}
		if (placed.has(ov.name)) continue;
		placed.add(ov.name);
		const fresh = computed.get(ov.name);
		if (fresh) out.push(sameJson(fresh, ov) ? ov : fresh);
	}
	for (const [name, ov] of computed) if (ov && !placed.has(name)) out.push(ov);
	return out;
}

function sideOverride(
	base: Template,
	laid: Template,
	variant: Variant,
	side: number,
	working: TemplateFrame,
	next: TemplateFrame,
): VariantOverride | null {
	const frame = laid.template_data[side] as TemplateFrame;
	const deltas: VariantElementDelta[] = [];
	const seen = new Set<string>();
	// `w` is the layer as the working template had it: a layer the edit did
	// not reach keeps its delta as it was.
	const visit = (b: Element, w: Element, n: Element) => {
		seen.add(b.id);
		const existing = mergedDelta(base, variant.id, frame.name, b.id);
		const d = n === w ? existing : elementDelta(b, n, existing?.hidden);
		if (d) deltas.push(d);
		const cb = childEntries(b);
		const cw = childEntries(w);
		const cn = childEntries(n);
		cb.forEach(([, c], i) => {
			visit(c, cw[i]?.[1] as Element, cn[i]?.[1] as Element);
		});
	};
	frame.elements.forEach((el, i) => {
		visit(el, working.elements[i] as Element, next.elements[i] as Element);
	});
	// Deltas naming no layer on the side are kept as they are, for the Issues
	// list to report and clean up.
	for (const ov of variant.overrides)
		if (ov.name === frame.name)
			for (const d of ov.elements ?? []) if (!seen.has(d.id)) deltas.push(d);

	const background = sameJson(next.background, frame.background)
		? undefined
		: next.background;
	if (!background && deltas.length === 0) return null;
	return {
		name: frame.name,
		...(background ? { background } : {}),
		...(deltas.length ? { elements: deltas } : {}),
	};
}

function elementDelta(
	b: Element,
	n: Element,
	hidden: boolean | undefined,
): VariantElementDelta | undefined {
	const d = diffElement(b, n);
	if (hidden !== true) return d;
	return { ...(d ?? { id: b.id, properties: {} }), hidden: true };
}

function foldStructural(
	base: Template,
	variantId: string,
	next: Template,
): Template {
	const restoreSide = (f: TemplateFrame): TemplateFrame => {
		const own = base.template_data.find((b) => b.name === f.name);
		if (!own) return f;
		const byId = new Map<string, Element>();
		for (const e of walkLayers(base, base.template_data.indexOf(own)))
			if (!("background" in e.path))
				byId.set(e.element.id, e.element as Element);
		const restore = (el: Element): Element => {
			const b = byId.get(el.id);
			const own = b && b.type === el.type ? b : el;
			if (el.type !== "frame" && el.type !== "mask") return own;
			const properties: Record<string, unknown> = {
				...own.properties,
				children: el.properties.children.map(restore),
			};
			if (el.type === "mask") properties.mask = restore(el.properties.mask);
			return { ...own, properties } as Element;
		};
		return {
			...f,
			background: own.background,
			elements: f.elements.map(restore),
		};
	};
	const template_data = next.template_data.map(restoreSide);
	const size = { width: base.width, height: base.height };
	const ids = new Map<string, Set<string>>();
	template_data.forEach((f, side) => {
		const set = new Set<string>();
		for (const e of walkLayers({ ...next, template_data }, side))
			set.add(e.element.id);
		ids.set(f.name, set);
	});
	const variants = next.variants?.map((v) =>
		v.id !== variantId
			? v
			: {
					...v,
					overrides: v.overrides.map((ov) => {
						const have = ids.get(ov.name);
						if (!have || !ov.elements) return ov;
						const elements = ov.elements.filter((d) => have.has(d.id));
						return elements.length === ov.elements.length
							? ov
							: { ...ov, elements };
					}),
				},
	);
	return {
		...next,
		...size,
		template_data,
		...(variants ? { variants } : {}),
	};
}

// ── Geometry for structural ops ──────────────────────────────────────────────

/**
 * The rendered geometry, which shows the variant, made fit for an op on the
 * base: boxes of layers the variant moves, resizes or turns, and of
 * everything inside them, are left out, so the op reads those from the base
 * instead. Anything else the variant changes (a text's size, say) is kept, as
 * the nearest the base's geometry that is on hand. A variant drawn at its own
 * size lays every layer out anew, so none of its boxes are kept.
 */
export function geometryForBase(
	base: Template,
	variantId: string | undefined,
	geometry: LayerGeometry,
): LayerGeometry {
	const id = activeVariantId(base, variantId);
	if (id === undefined) return geometry;
	if (variantBase(base, id) !== base) return new Map();
	const deltas = variantDeltas(base, id);
	const moved = new Set<string>();
	base.template_data.forEach((frame, side) => {
		const elements = deltas.get(frame.name)?.elements;
		if (!elements?.size) return;
		for (const e of walkLayers(base, side)) {
			if ("background" in e.path) continue;
			const d = elements.get(e.element.id);
			if (d && VARIANT_SHELL_KEYS.some((k) => d[k] !== undefined))
				moved.add(e.key);
		}
	});
	if (moved.size === 0) return geometry;
	const out: LayerGeometry = new Map();
	for (const [key, box] of geometry)
		if (!movedOrInside(key, moved)) out.set(key, box);
	return out;
}

function movedOrInside(key: string, moved: Set<string>): boolean {
	if (moved.has(key)) return true;
	for (let i = key.lastIndexOf("/"); i > 0; i = key.lastIndexOf("/", i - 1))
		if (moved.has(key.slice(0, i))) return true;
	return false;
}
