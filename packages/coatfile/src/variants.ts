import { resizeFrames } from "./relayout";
import type { Element, Size, Template, TemplateFrame, Variant } from "./types";

/** One element delta in a variant override. */
export type VariantElementDelta = NonNullable<
	Variant["overrides"][number]["elements"]
>[number];

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
// apply in order. A variant with a `size` starts from the base laid out at that
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
	for (const ov of variant.overrides) {
		const target = frames.find((f) => f.name === ov.name);
		if (!target) continue;
		let next: TemplateFrame = target;
		if (ov.background) next = { ...next, background: ov.background };
		if (ov.elements && ov.elements.length > 0) {
			next = {
				...next,
				elements: applyElementDeltas(next.elements, ov.elements, dropHidden),
			};
		}
		frames[frames.indexOf(target)] = next;
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
	deltas: VariantElementDelta[],
	dropHidden: boolean,
): Element[] {
	const byId = new Map<string, VariantElementDelta[]>();
	for (const d of deltas) {
		const list = byId.get(d.id);
		if (list) list.push(d);
		else byId.set(d.id, [d]);
	}
	const isHidden = (el: Element) =>
		byId.get(el.id)?.some((d) => d.hidden === true) ?? false;
	const one = (el: Element): Element => {
		let next = el;
		for (const d of byId.get(el.id) ?? []) next = applyDelta(next, d);
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

function isEmptyDelta(d: VariantElementDelta): boolean {
	return (
		Object.keys(d.properties ?? {}).length === 0 &&
		d.pos === undefined &&
		d.size === undefined &&
		d.rotation === undefined &&
		d.opacity === undefined &&
		d.hidden === undefined
	);
}

function elementIds(elements: Element[]): Set<string> {
	const ids = new Set<string>();
	const walk = (el: Element) => {
		ids.add(el.id);
		if (el.type === "frame") el.properties.children.forEach(walk);
		if (el.type === "mask") {
			walk(el.properties.mask);
			el.properties.children.forEach(walk);
		}
	};
	elements.forEach(walk);
	return ids;
}
