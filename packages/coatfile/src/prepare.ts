import { inlineAssetUrls, resolveAssetSrcs } from "./assets";
import { resizeTemplate } from "./constraints";
import type { Size, Template } from "./types";
import { validate } from "./validate";
import { applyVariant } from "./variants";

export type PrepareOptions = {
	variantId?: string;
	resize?: Size;
};

const validated = new WeakSet<Template>();
const prepared = new WeakMap<Template, Map<string, Template>>();

// The part of compile() that does not depend on values: validation, embedded
// assets, the variant and `resize`. Results are kept per template object, so a
// template must not be mutated after it is prepared.
export function prepareTemplate(
	template: Template,
	opts: PrepareOptions = {},
): Template {
	if (!validated.has(template)) {
		const v = validate(template);
		if (!v.ok) {
			throw new Error(
				`invalid template: ${v.errors.map((e) => e.code).join(", ")}`,
			);
		}
		validated.add(template);
	}

	const key = `${opts.variantId ?? ""}|${opts.resize ? `${opts.resize.width}x${opts.resize.height}` : ""}`;
	let byKey = prepared.get(template);
	const hit = byKey?.get(key);
	if (hit) return hit;

	// `asset:<sha256>` srcs address bytes the template carries in `assets`; point
	// them at data URLs so the painter loads them like any other image. A
	// template whose images already have URLs carries no assets and is untouched.
	const withAssets =
		template.assets && template.assets.length > 0
			? resolveAssetSrcs(template, inlineAssetUrls(template))
			: template;

	// The variant is applied first, so with `resize` its backgrounds and moved
	// layers are laid out with everything else.
	const resolved =
		opts.variantId === undefined
			? withAssets
			: applyVariant(withAssets, opts.variantId);

	// With `resize`, the design is then laid out at that size by its
	// constraints. `variants` are left behind first: nothing below reads them,
	// and resizing would lay out every one.
	const out = opts.resize
		? resizeTemplate(
				withoutVariants(resolved),
				opts.resize.width,
				opts.resize.height,
			)
		: resolved;

	if (!byKey) {
		byKey = new Map();
		prepared.set(template, byKey);
	}
	byKey.set(key, out);
	return out;
}

function withoutVariants(t: Template): Template {
	if (t.variants === undefined) return t;
	const { variants: _variants, ...rest } = t;
	return rest;
}
