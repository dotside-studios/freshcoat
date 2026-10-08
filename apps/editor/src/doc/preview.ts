import type {
	Background,
	Element,
	InlineAsset,
	Template,
} from "@freshcoat-js/coatfile";
import { applyVariant, base64ToBytes } from "@freshcoat-js/coatfile";
import { tokenIds } from "@freshcoat-js/coatfile/mustache";
import { childEntries, keyOf, MASK_SOURCE } from "./path";

export type PreviewOptions = {
	side: number;
	variantId?: string;
	hidden?: ReadonlySet<string>;
};

export type Preview = {
	/** One side, the variant applied, ids replaced by `k:<key>`, no assets. */
	template: Template;
	/** `k:<key>` → layer key. */
	pathIds: Map<string, string>;
	/** `asset:<sha>` → bytes, for the painter to key images by. */
	images: Map<string, Uint8Array>;
};

export const PREVIEW_ID_PREFIX = "k:";

const decoded = new WeakMap<InlineAsset, Uint8Array>();
const imageMaps = new WeakMap<InlineAsset[], Map<string, Uint8Array>>();
const NO_IMAGES = new Map<string, Uint8Array>();

let last:
	| {
			t: Template;
			side: number;
			variantId?: string;
			hidden?: ReadonlySet<string>;
			out: Preview;
	  }
	| undefined;

/**
 * What is actually rendered for one side. Pure, and memoised on the identity
 * of its inputs. An unknown variant renders the default.
 */
export function buildPreview(t: Template, opts: PreviewOptions): Preview {
	const { side, variantId, hidden } = opts;
	if (
		last &&
		last.t === t &&
		last.side === side &&
		last.variantId === variantId &&
		last.hidden === hidden
	)
		return last.out;
	const out = build(t, side, variantId, hidden ?? new Set());
	last = { t, side, variantId, hidden, out };
	return out;
}

function build(
	t: Template,
	side: number,
	variantId: string | undefined,
	hidden: ReadonlySet<string>,
): Preview {
	const frame = t.template_data[side];
	if (!frame) throw new Error(`no side ${side}`);
	const variants = t.variants
		?.map((v) => ({
			...v,
			overrides: v.overrides.filter((ov) => ov.name === frame.name),
		}))
		.filter((v) => v.overrides.length > 0 || v.size !== undefined);
	const { assets, variants: _v, ...rest } = t;
	let one: Template = {
		...rest,
		template_data: [frame],
		...(variants?.length ? { variants } : {}),
	};
	// Hidden layers stay while the variant is applied, so every layer keeps the
	// index its key is made of, and are left out below.
	const variant =
		variantId === undefined
			? undefined
			: variants?.find((v) => v.id === variantId);
	if (variant) one = applyVariant(one, variant.id, { hidden: "keep" });
	const dropped = new Set(
		variant?.overrides.flatMap((ov) =>
			(ov.elements ?? []).filter((d) => d.hidden).map((d) => d.id),
		),
	);
	const resolved = one.template_data[0];

	const pathIds = new Map<string, string>();
	const tag = <T extends Element | Background>(el: T, key: string): T => {
		const id = `${PREVIEW_ID_PREFIX}${key}`;
		pathIds.set(id, key);
		const next = { ...el, id } as T;
		return hidden.has(key) ? { ...next, opacity: 0 } : next;
	};
	const visit = (el: Element, path: number[]): Element => {
		const key = keyOf({ side, path });
		const tagged = tag(el, key);
		if (tagged.type !== "frame" && tagged.type !== "mask") return tagged;
		const kids = childEntries(tagged).map(
			([i, c]) => [i, c.id, visit(c, [...path, i])] as const,
		);
		// A mask's shape is never drawn itself, so hiding it is ignored.
		const children = kids
			.filter(([i, id]) => i !== MASK_SOURCE && !dropped.has(id))
			.map(([, , c]) => c);
		const mask = kids.find(([i]) => i === MASK_SOURCE)?.[2];
		return {
			...tagged,
			properties: { ...tagged.properties, children, ...(mask ? { mask } : {}) },
		} as Element;
	};
	const { variants: _drop, ...withoutVariants } = one;
	const template: Template = {
		...withoutVariants,
		template_data: [
			{
				...resolved,
				background: tag(resolved.background, keyOf({ side, background: true })),
				elements: resolved.elements.flatMap((el, i) =>
					dropped.has(el.id) ? [] : [visit(el, [i])],
				),
			},
		],
	};

	const images = imagesOf(assets);
	return { template: tolerate(template), pathIds, images };
}

/**
 * A document is often briefly invalid while it is edited: a `{{token}}` typed
 * before its field exists, a name cleared before a new one is typed. compile()
 * validates and would refuse the whole side, so the preview stands in for what
 * is missing (an empty field, a placeholder name) and the canvas keeps drawing.
 * The document itself is untouched, and its issues are still reported.
 */
function tolerate(t: Template): Template {
	const known = new Set(Object.keys(t.fields.properties));
	const missing = new Set<string>();
	const walk = (v: unknown) => {
		if (typeof v === "string") {
			for (const id of tokenIds(v)) if (!known.has(id)) missing.add(id);
		} else if (Array.isArray(v)) v.forEach(walk);
		else if (v && typeof v === "object") {
			for (const [k, x] of Object.entries(v)) {
				if (k === "visibleWhen") {
					for (const c of Array.isArray(x) ? x : [x])
						if (c && !known.has(c.field)) missing.add(c.field);
				} else walk(x);
			}
		}
	};
	walk(t.template_data);
	const needsName = !t.name || !t.id;
	if (missing.size === 0 && !needsName) return t;
	return {
		...t,
		id: t.id || "preview",
		name: t.name || "Preview",
		fields: {
			...t.fields,
			properties: {
				...t.fields.properties,
				...Object.fromEntries(
					[...missing].map((f) => [f, { type: "string" as const }]),
				),
			},
		},
	};
}

// Stable per `assets` array, so the render env is rebuilt only when the
// assets change; each asset is decoded once however often that happens.
function imagesOf(assets: InlineAsset[] | undefined): Map<string, Uint8Array> {
	if (!assets || assets.length === 0) return NO_IMAGES;
	const known = imageMaps.get(assets);
	if (known) return known;
	const images = new Map<string, Uint8Array>();
	for (const asset of assets) {
		let bytes = decoded.get(asset);
		if (!bytes) {
			bytes = base64ToBytes(asset.base64);
			decoded.set(asset, bytes);
		}
		images.set(`asset:${asset.sha256}`, bytes);
	}
	imageMaps.set(assets, images);
	return images;
}
