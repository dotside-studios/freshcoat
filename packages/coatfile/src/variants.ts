import { resizeFrames } from "./relayout";
import { allElements } from "./tree";
import type {
	Background,
	Element,
	Size,
	Template,
	TemplateFrame,
	Variant,
} from "./types";

/** The id export file names, bindings and pickers use for Default. No
 *  variant may take it. */
export const DEFAULT_VARIANT_ID = "default";

/** A variant id from a label: accents stripped, lowercase, `-` between words,
 *  `variant` when nothing is left, then `-2`, `-3` until it is neither in
 *  `taken` nor `DEFAULT_VARIANT_ID`. */
export function variantIdFor(label: string, taken: Iterable<string>): string {
	const slug =
		label
			.normalize("NFKD")
			.replace(/[\u0300-\u036f]/g, "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "variant";
	const used = new Set(taken);
	used.add(DEFAULT_VARIANT_ID);
	if (!used.has(slug)) return slug;
	let n = 2;
	while (used.has(`${slug}-${n}`)) n++;
	return `${slug}-${n}`;
}

/** One element delta in a variant override. */
export type VariantElementDelta = NonNullable<
	Variant["overrides"][number]["elements"]
>[number];

/** The shell fields a delta can carry. Each replaces the element's own. */
export const VARIANT_SHELL_KEYS = [
	"pos",
	"size",
	"rotation",
	"opacity",
] as const;
export type VariantShellKey = (typeof VARIANT_SHELL_KEYS)[number];

/** What a variant sets on one side, every override naming it merged in
 *  order: the last background, and one delta per element id. */
export type SideDeltas = {
	background: Background | undefined;
	elements: Map<string, VariantElementDelta>;
};

/**
 * Two deltas for one element as one, `b` applied after `a`: its `properties`
 * merge over `a`'s, a shell field it sets replaces `a`'s, and the element is
 * hidden when either hides it. A later `hidden: false` does not show an
 * element an earlier delta hides.
 */
function mergeDelta(
	a: VariantElementDelta,
	b: VariantElementDelta,
): VariantElementDelta {
	const out: VariantElementDelta = {
		...a,
		properties: { ...a.properties, ...b.properties },
	};
	for (const k of VARIANT_SHELL_KEYS)
		if (b[k] !== undefined) (out as Record<string, unknown>)[k] = b[k];
	if (b.hidden !== undefined && a.hidden !== true) out.hidden = b.hidden;
	return out;
}

/** Every side a variant overrides, by frame name, with its overrides merged
 *  as `applyVariant` applies them. Empty for an absent or unknown id. */
export function variantDeltas(
	t: Pick<Template, "variants">,
	variantId: string | undefined,
): Map<string, SideDeltas> {
	return collectDeltas(t, variantId);
}

function collectDeltas(
	t: Pick<Template, "variants">,
	variantId: string | undefined,
	sideName?: string,
): Map<string, SideDeltas> {
	const out = new Map<string, SideDeltas>();
	const variant =
		variantId === undefined
			? undefined
			: t.variants?.find((v) => v.id === variantId);
	for (const ov of variant?.overrides ?? []) {
		if (sideName !== undefined && ov.name !== sideName) continue;
		let side = out.get(ov.name);
		if (!side) {
			side = { background: undefined, elements: new Map() };
			out.set(ov.name, side);
		}
		if (ov.background) side.background = ov.background;
		for (const d of ov.elements ?? []) {
			const prev = side.elements.get(d.id);
			side.elements.set(d.id, prev ? mergeDelta(prev, d) : d);
		}
	}
	return out;
}

/** What a variant sets on the side called `sideName`. */
export function sideDeltas(
	t: Pick<Template, "variants">,
	variantId: string | undefined,
	sideName: string,
): SideDeltas {
	return (
		collectDeltas(t, variantId, sideName).get(sideName) ?? {
			background: undefined,
			elements: new Map(),
		}
	);
}

/** Every delta a variant has for one element on one side, merged. */
export function mergedElementDelta(
	t: Pick<Template, "variants">,
	variantId: string | undefined,
	sideName: string,
	elementId: string,
): VariantElementDelta | undefined {
	return sideDeltas(t, variantId, sideName).elements.get(elementId);
}

/** Ids of the elements on a side a variant hides: any of its deltas for the
 *  element says `hidden: true`. */
export function hiddenElementIds(
	t: Pick<Template, "variants">,
	variantId: string | undefined,
	sideName: string,
): Set<string> {
	const out = new Set<string>();
	for (const [id, d] of sideDeltas(t, variantId, sideName).elements)
		if (d.hidden === true) out.add(id);
	return out;
}

/** The background a variant sets on a side, when it sets one. */
export function sideBackground(
	t: Pick<Template, "variants">,
	variantId: string | undefined,
	sideName: string,
): Background | undefined {
	return sideDeltas(t, variantId, sideName).background;
}

export type ApplyVariantOptions = {
	/**
	 * What happens to an element a delta marks `hidden`. `"drop"` (the default)
	 * removes it and its subtree, which is what rendering wants. `"keep"` leaves
	 * it in place, so an editor can still list and select it; the delta's own
	 * `hidden` is then the only record of it.
	 */
	hidden?: "drop" | "keep";
};

/** The size a variant is drawn at: its own `size`, else the template's. An
 *  absent or unknown id is the template's size. */
export function variantSize(
	t: Pick<Template, "width" | "height" | "variants">,
	variantId?: string,
): Size {
	const size =
		variantId === undefined
			? undefined
			: t.variants?.find((v) => v.id === variantId)?.size;
	return size
		? { width: size.width, height: size.height }
		: { width: t.width, height: t.height };
}

/** The base design as a variant starts from: laid out by its constraints at
 *  the variant's `size`, or the template itself when it has none. */
export function variantBase(t: Template, variantId: string): Template {
	const size = t.variants?.find((v) => v.id === variantId)?.size;
	if (!size || (size.width === t.width && size.height === t.height)) return t;
	return resizeFrames(t, size.width, size.height);
}

// Returns `t` with one variant's overrides applied: each override replaces the
// background of the first frame with its name and applies its element deltas by
// id. Overrides naming no frame are skipped, and several naming the same frame
// apply in order, merged as `variantDeltas` merges them. A variant with a `size` starts from the base laid out at that
// size (`variantBase`), and its deltas are in that size's units. The input is
// not mutated; frames and elements an override does not reach are shared with
// it. `variants` is kept.
export function applyVariant(
	t: Template,
	variantId: string,
	opts: ApplyVariantOptions = {},
): Template {
	const variant = t.variants?.find((v) => v.id === variantId);
	if (!variant) throw new Error(`unknown_variant: ${variantId}`);
	const dropHidden = (opts.hidden ?? "drop") === "drop";
	const base = variantBase(t, variantId);

	const frames = [...base.template_data];
	for (const [name, side] of variantDeltas(t, variantId)) {
		const at = frames.findIndex((f) => f.name === name);
		if (at < 0) continue;
		let next = frames[at] as TemplateFrame;
		if (side.background) next = { ...next, background: side.background };
		if (side.elements.size > 0) {
			next = {
				...next,
				elements: applyElementDeltas(next.elements, side.elements, dropHidden),
			};
		}
		frames[at] = next;
	}
	return { ...base, template_data: frames };
}

// Applies element deltas by id, recursing into frame children and a mask's
// `mask` and `children` so nested elements are reachable. Shell fields in a
// delta replace the element's own and `properties` merge into its own. A
// mask's shape is never drawn itself, so `hidden` on it is ignored: dropping
// it would leave the mask without the shape it clips to. Every element on a
// frame, mask or overridden path is a fresh object, so the input's elements are
// never written to.
function applyElementDeltas(
	elements: Element[],
	byId: Map<string, VariantElementDelta>,
	dropHidden: boolean,
): Element[] {
	const isHidden = (el: Element) => byId.get(el.id)?.hidden === true;
	const one = (el: Element): Element => {
		const d = byId.get(el.id);
		let next = d ? applyDelta(el, d) : el;
		if (next.type === "frame") {
			next = {
				...next,
				properties: {
					...next.properties,
					children: walk(next.properties.children),
				},
			} as Element;
		}
		if (next.type === "mask") {
			next = {
				...next,
				properties: {
					...next.properties,
					mask: one(next.properties.mask),
					children: walk(next.properties.children),
				},
			} as Element;
		}
		return next;
	};
	const walk = (els: Element[]): Element[] =>
		(dropHidden ? els.filter((el) => !isHidden(el)) : els).map(one);
	return walk(elements);
}

function applyDelta(el: Element, d: VariantElementDelta): Element {
	return {
		...el,
		...(d.pos !== undefined ? { pos: d.pos } : {}),
		...(d.size !== undefined ? { size: d.size } : {}),
		...(d.rotation !== undefined ? { rotation: d.rotation } : {}),
		...(d.opacity !== undefined ? { opacity: d.opacity } : {}),
		properties: { ...el.properties, ...d.properties },
	} as Element;
}

export type SameJsonOptions = {
	/** Numbers this close are equal. Default 0, exact. */
	epsilon?: number;
};

/** Deep equality for template JSON: key order is ignored, a missing key
 *  equals one set to `undefined`, and numbers within `epsilon` are equal. */
export function sameJson(
	a: unknown,
	b: unknown,
	opts: SameJsonOptions = {},
): boolean {
	const epsilon = opts.epsilon ?? 0;
	const same = (a: unknown, b: unknown): boolean => {
		if (Object.is(a, b)) return true;
		if (typeof a === "number" && typeof b === "number")
			return Math.abs(a - b) < epsilon;
		if (typeof a !== "object" || typeof b !== "object" || !a || !b)
			return false;
		if (Array.isArray(a) !== Array.isArray(b)) return false;
		if (Array.isArray(a)) {
			const bb = b as unknown[];
			return a.length === bb.length && a.every((v, i) => same(v, bb[i]));
		}
		const ra = a as Record<string, unknown>;
		const rb = b as Record<string, unknown>;
		for (const k of Object.keys(ra)) if (!same(ra[k], rb[k])) return false;
		for (const k of Object.keys(rb))
			if (!(k in ra) && rb[k] !== undefined) return false;
		return true;
	};
	return same(a, b);
}

export type DiffElementOptions = SameJsonOptions;

/** The value an element that omits a shell field draws with. */
const SHELL_DEFAULT: Record<VariantShellKey, unknown> = {
	pos: { x: 0, y: 0 },
	size: undefined,
	rotation: 0,
	opacity: 1,
};

/**
 * The delta that turns `base` into `next`, two versions of one element, or
 * undefined when they draw the same. `properties` holds each key `next` sets
 * to a different value; a key it removes cannot be written as a delta, so it
 * is left out. A frame's `children` and a mask's `mask` and `children` are
 * structure, never a delta: each element inside gets its own. A shell field
 * `next` sets is kept where it differs from `base`'s, an omitted one read as
 * what compile draws (`pos` `{x:0,y:0}`, `rotation` 0, `opacity` 1). Values
 * compare as `sameJson` does, within `epsilon`. `hidden` is never set.
 */
export function diffElement(
	base: Element,
	next: Element,
	opts: DiffElementOptions = {},
): VariantElementDelta | undefined {
	const skip = new Set<string>();
	if (base.type === "frame" || next.type === "frame") skip.add("children");
	if (base.type === "mask" || next.type === "mask") {
		skip.add("children");
		skip.add("mask");
	}
	const bp = (base.properties ?? {}) as Record<string, unknown>;
	const np = (next.properties ?? {}) as Record<string, unknown>;
	const properties: Record<string, unknown> = {};
	for (const k of Object.keys(np)) {
		if (skip.has(k) || np[k] === undefined) continue;
		if (!sameJson(np[k], bp[k], opts)) properties[k] = np[k];
	}
	const d: VariantElementDelta = { id: base.id, properties };
	let changed = Object.keys(properties).length > 0;
	for (const k of VARIANT_SHELL_KEYS) {
		const nv = next[k] ?? SHELL_DEFAULT[k];
		const bv = base[k] ?? SHELL_DEFAULT[k];
		if (nv === undefined || sameJson(nv, bv, opts)) continue;
		(d as Record<string, unknown>)[k] = nv;
		changed = true;
	}
	return changed ? d : undefined;
}

/** The colour a background suggests as a variant's swatch: a rect's fill, its
 *  first gradient stop or pattern colour. Undefined for an image background,
 *  a missing fill, or a colour read from a field. */
export function backgroundSwatch(
	bg: Background | undefined,
): string | undefined {
	if (bg?.type !== "rect") return undefined;
	const fills = bg.properties.fill;
	const fill = Array.isArray(fills) ? fills[0] : fills;
	const colour =
		typeof fill === "string"
			? fill
			: fill?.kind === "pattern"
				? fill.colors?.[0]
				: fill?.stops?.[0]?.color;
	return colour && !colour.includes("{{") ? colour : undefined;
}

/** What `checkVariants` reports. */
export type VariantIssue = {
	code: "variant_orphan_override" | "variant_empty_override";
	variantId: string;
	/** The override's frame name. */
	side: string;
	elementId?: string;
	/** From the template root, e.g. `["variants", 0, "overrides", 1, "elements", 2]`. */
	path: (string | number)[];
	message: string;
};

/**
 * Lints variant deltas without failing validation: a delta whose id names no
 * element on its side (`variant_orphan_override`, skipped when rendering), and
 * one that changes nothing (`variant_empty_override`). An override naming a
 * frame the template does not have is `validate`'s to report, not this.
 */
export function checkVariants(t: Template): VariantIssue[] {
	const issues: VariantIssue[] = [];
	// Editors run this on templates that failed validation too, so a missing
	// `overrides` or `properties` is read as empty rather than trusted.
	(t.variants ?? []).forEach((v, vi) => {
		(v.overrides ?? []).forEach((ov, oi) => {
			const frame = t.template_data.find((f) => f.name === ov.name);
			const ids = frame ? elementIds(frame.elements) : undefined;
			(ov.elements ?? []).forEach((d, di) => {
				const path = ["variants", vi, "overrides", oi, "elements", di];
				if (ids && !ids.has(d.id)) {
					issues.push({
						code: "variant_orphan_override",
						variantId: v.id,
						side: ov.name,
						elementId: d.id,
						path,
						message: `variant "${v.id}" changes "${d.id}", which is not on side "${ov.name}"`,
					});
				}
				if (isEmptyDelta(d)) {
					issues.push({
						code: "variant_empty_override",
						variantId: v.id,
						side: ov.name,
						elementId: d.id,
						path,
						message: `variant "${v.id}" has a change to "${d.id}" that changes nothing`,
					});
				}
			});
		});
	});
	return issues;
}

/** Whether a delta carries nothing beyond its id: no `properties` key, no
 *  shell field and no `hidden`. */
export function isEmptyDelta(d: VariantElementDelta): boolean {
	return (
		Object.keys(d.properties ?? {}).length === 0 &&
		VARIANT_SHELL_KEYS.every((k) => d[k] === undefined) &&
		d.hidden === undefined
	);
}

function elementIds(elements: Element[]): Set<string> {
	return new Set(allElements(elements).map((el) => el.id));
}

/** Whether a variant's size differs in aspect from the template's. */
export function hasShapedVariants(template: Template): boolean {
	const aspect = template.width / template.height;
	return (template.variants ?? []).some(
		(v) =>
			v.size !== undefined &&
			Math.abs(v.size.width / v.size.height - aspect) > 1e-6,
	);
}

/** The variant, or undefined for Default, whose size is closest to
 *  `aspect`. Default wins a tie, then the first in list order. */
export function closestVariant(
	template: Template,
	aspect: number,
): string | undefined {
	const distance = (id?: string) => {
		const size = variantSize(template, id);
		return Math.abs(Math.log(size.width / size.height / aspect));
	};
	let best: string | undefined;
	let bestDistance = distance(undefined);
	for (const v of template.variants ?? []) {
		const d = distance(v.id);
		if (d < bestDistance - 1e-9) {
			best = v.id;
			bestDistance = d;
		}
	}
	return best;
}

/** Whether a variant renders exactly as Default: no override replaces a
 *  background, and no element delta carries anything beyond its id and an
 *  empty `properties`. */
export function isEmptyVariant(variant: Variant): boolean {
	return variant.overrides.every(
		(override) =>
			override.background === undefined &&
			(override.elements ?? []).every((delta) =>
				Object.entries(delta).every(
					([key, value]) =>
						key === "id" ||
						value === undefined ||
						(key === "properties" &&
							Object.values(value as Record<string, unknown>).every(
								(v) => v === undefined,
							)),
				),
			),
	);
}
