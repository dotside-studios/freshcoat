// Single home for the field-binding grammar and inference. The same functions
// run at harvest time (write pluginData) and at export time (live fallback), so
// the marker grammar lives in exactly one place.

import type { Symbology } from "@freshcoat-js/coatfile";
import { parseBarcodeLayerName } from "./transpiler/barcode-name";
import {
	extractTokens,
	isWholeMustacheToken,
	titleCase,
} from "./transpiler/fields";
import type { FigmaNode } from "./types";

/** Schema format a field lowers to (coatfile). */
export type FieldFormat =
	| "text"
	| "longText"
	| "image"
	| "color"
	| "url"
	| "boolean";

/** What on a node a template drives. The layer-name marker seeds one; the
 * plugin may add extras (e.g. `textColor` alongside `text`). */
export type BindProperty =
	| "text"
	| "textColor"
	| "fill"
	| "image"
	| "qr"
	| "barcode";

/** What the author writes as a `kind:` prefix. */
export type MarkerKind = "text" | "image" | "qr" | "barcode" | "color";

/** Every marker kind, in the order a person would reach for them. */
export const MARKER_KINDS: readonly MarkerKind[] = [
	"text",
	"image",
	"qr",
	"barcode",
	"color",
];

/** The field widget a property asks for beyond its format: a barcode's value
 *  is text, entered and previewed as a barcode. */
export type FieldWidget = "barcode";

/** A parsed marker/name value: one whole token, or a multi-part template. */
export type ParsedValue =
	| { mode: "token"; id: string }
	| { mode: "template"; template: string; ids: string[] };

export type ParsedMarker = {
	kind: MarkerKind;
	value: ParsedValue;
	opts: Record<string, string>;
};

/** A field a node introduces, before per-field metadata is attached. */
export type FieldDraft = {
	id: string;
	format: FieldFormat;
	widget?: FieldWidget;
	default?: string;
	imageAspect?: [number, number];
};

/** The result of inferring a node: which properties bind to which template,
 * plus the fields those templates reference. */
export type NodeBinding = {
	bind: Partial<Record<BindProperty, string>>;
	fields: FieldDraft[];
	/** qr option string from the marker (ec/fg/bg/margin), when present. */
	qrOpts?: Record<string, string>;
	/** The symbology a `barcode:` marker names, when it names one coatfile
	 *  draws. */
	symbology?: Symbology;
};

/** Template-global per-field metadata (stored on the slot frame). */
export type FieldMeta = {
	id: string;
	format: FieldFormat;
	widget?: FieldWidget;
	title: string;
	required: boolean;
	source: "user" | "system" | "order";
	default?: string;
	description?: string;
	imageAspect?: [number, number];
	/** Set once the author edits this field in the plugin; harvest then refreshes
	 * only non-identity fields and flags format changes instead of clobbering. */
	overridden?: boolean;
};

const MARKER_KIND_SET: ReadonlySet<string> = new Set(MARKER_KINDS);

function dedupe(ids: string[]): string[] {
	return [...new Set(ids)];
}

/**
 * Parse a value slot (after `kind:`, or a whole unmarked name):
 *  - bare `{{id}}` (inner/outer whitespace trimmed) → token
 *  - `"…{{a}}…{{b}}…"` (quoted) → template; literals/multiple tokens allowed
 * Bare content with spaces (`{{a}} {{b}}`) is ambiguous → null.
 */
export function parseValue(raw: string): ParsedValue | null {
	const s = raw.trim();
	if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
		const inner = s.slice(1, -1);
		const ids = extractTokens(inner);
		if (ids.length === 0) return null;
		return { mode: "template", template: inner, ids: dedupe(ids) };
	}
	const m = isWholeMustacheToken(s);
	if (m.ok) return { mode: "token", id: m.id };
	return null;
}

/** Split on `sep` at the top level only (ignoring separators inside quotes). */
function splitTopLevel(s: string, sep: string): string[] {
	const out: string[] = [];
	let buf = "";
	let inQuotes = false;
	for (const ch of s) {
		if (ch === '"') inQuotes = !inQuotes;
		if (ch === sep && !inQuotes) {
			out.push(buf);
			buf = "";
		} else {
			buf += ch;
		}
	}
	out.push(buf);
	return out;
}

// A `barcode:` marker as a ParsedMarker. Its value may be preceded by a
// symbology (`barcode:ean13:{{id}}`), which rides in `opts.symbology`; a
// literal value binds no field, so it is not a marker in this sense.
function parseBarcodeMarker(layerName: string): ParsedMarker | null {
	const parsed = parseBarcodeLayerName(layerName.trim());
	if (!parsed || parsed.mode === "literal") return null;
	const value: ParsedValue =
		parsed.mode === "token"
			? { mode: "token", id: parsed.ids[0] }
			: { mode: "template", template: parsed.value, ids: parsed.ids };
	return {
		kind: "barcode",
		value,
		opts: parsed.symbology ? { symbology: parsed.symbology } : {},
	};
}

/** Parse a layer name as `kind:value[;k=v…]`, or null if it isn't a marker. */
export function parseMarker(layerName: string): ParsedMarker | null {
	const trimmed = layerName.trim();
	const colon = trimmed.indexOf(":");
	if (colon <= 0) return null;
	const kind = trimmed.slice(0, colon);
	if (!MARKER_KIND_SET.has(kind)) return null;
	if (kind === "barcode") return parseBarcodeMarker(trimmed);

	const parts = splitTopLevel(trimmed.slice(colon + 1), ";");
	const value = parseValue(parts[0]);
	if (!value) return null;

	const opts: Record<string, string> = {};
	for (const part of parts.slice(1)) {
		const eq = part.indexOf("=");
		if (eq > 0) {
			const k = part.slice(0, eq).trim();
			const v = part.slice(eq + 1).trim();
			opts[k] = v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v;
		}
	}
	return { kind: kind as MarkerKind, value, opts };
}

/** The element property a marker kind drives, given the node it sits on. */
export function propertyForKind(
	kind: MarkerKind,
	node: FigmaNode,
): BindProperty {
	if (kind === "text") return "text";
	if (kind === "image") return "image";
	if (kind === "qr") return "qr";
	if (kind === "barcode") return "barcode";
	return node.type === "TEXT" ? "textColor" : "fill"; // color
}

/** The schema format a bound property lowers to. */
export function formatForProperty(property: BindProperty): FieldFormat {
	if (property === "text" || property === "barcode") return "text";
	if (property === "image") return "image";
	if (property === "qr") return "url";
	return "color"; // fill | textColor
}

/** The widget a bound property's field asks for, when it asks for one. */
export function widgetForProperty(
	property: BindProperty,
): FieldWidget | undefined {
	return property === "barcode" ? "barcode" : undefined;
}

/** The formats a field may take, given the property it drives. Keeps a text
 *  field from being switched to an image, which would write a wrong schema. */
export function formatsForProperty(property: BindProperty): FieldFormat[] {
	if (property === "text") return ["text", "longText"];
	if (property === "image") return ["image"];
	if (property === "qr") return ["url", "text"];
	if (property === "barcode") return ["text"];
	return ["color"]; // textColor | fill
}

/** Properties a layer's name decides, so binding one writes its marker. The
 *  rest live in plugin data alone. */
export const NAME_MARKED_PROPERTIES: ReadonlySet<BindProperty> = new Set([
	"image",
	"qr",
	"barcode",
]);

/** The layer name that marks a layer as `kind`, bound to field `id`:
 *  `qr:{{id}}`, `barcode:{{id}}`, or `barcode:ean13:{{id}}` with a symbology.
 *  Code 128 is a barcode's default, so it is not written out. */
export function markerName(
	kind: MarkerKind,
	id: string,
	opts: { symbology?: Symbology } = {},
): string {
	if (kind === "barcode" && opts.symbology && opts.symbology !== "code128") {
		return `barcode:${opts.symbology}:{{${id}}}`;
	}
	return `${kind}:{{${id}}}`;
}

function templateString(value: ParsedValue): string {
	return value.mode === "token" ? `{{${value.id}}}` : value.template;
}

function valueIds(value: ParsedValue): string[] {
	return value.mode === "token" ? [value.id] : value.ids;
}

function hasSingleImageFill(node: FigmaNode): boolean {
	if (!("fills" in node) || !Array.isArray(node.fills)) return false;
	const visible = node.fills.filter((f) => f.visible !== false);
	return visible.length === 1 && visible[0].type === "IMAGE";
}

// Square images get [1,1]; others carry their pixel ratio (matches image.ts).
function aspectOf(node: FigmaNode): [number, number] {
	const w = Math.round(node.absoluteBoundingBox.width);
	const h = Math.round(node.absoluteBoundingBox.height);
	return w === h ? [1, 1] : [w, h];
}

function imageDraftsFor(value: ParsedValue, node: FigmaNode): FieldDraft[] {
	const aspect = aspectOf(node);
	return valueIds(value).map((id) => ({
		id,
		format: "image" as const,
		imageAspect: aspect,
	}));
}

// Seed a text field's default from the layer's visible content, but only for a
// single whole-value token whose content is literal *sample* text. If the
// content itself contains tokens (e.g. the layer is named and filled with
// `{{x}}`), it's a template, not a sample — no default.
function textDefault(node: FigmaNode, idCount: number): string | undefined {
	if (node.type !== "TEXT" || idCount !== 1) return undefined;
	const chars = node.characters;
	if (chars.length === 0 || chars.includes("{{")) return undefined;
	return chars;
}

function draftsFor(
	value: ParsedValue,
	format: FieldFormat,
	def?: string,
	widget?: FieldWidget,
): FieldDraft[] {
	return valueIds(value).map((id) => ({
		id,
		format,
		...(widget ? { widget } : {}),
		...(def !== undefined ? { default: def } : {}),
	}));
}

/**
 * Infer a node's binding from its name (marker or unmarked token) and, for
 * text, its content tokens. Precedence: explicit marker → unmarked whole-name
 * token (smart kind) → inline content tokens. Returns null if nothing binds.
 */
export function inferNodeBinding(node: FigmaNode): NodeBinding | null {
	// 1. Explicit marker.
	const marker = parseMarker(node.name);
	if (marker) {
		const property = propertyForKind(marker.kind, node);
		// A text binding only makes sense on a TEXT layer — rendering a shape as
		// text would behave oddly, so ignore it rather than promote the element.
		if (property === "text" && node.type !== "TEXT") return null;
		const format = formatForProperty(property);
		const def =
			property === "text"
				? textDefault(node, valueIds(marker.value).length)
				: undefined;
		const fields =
			property === "image"
				? imageDraftsFor(marker.value, node)
				: draftsFor(marker.value, format, def, widgetForProperty(property));
		return {
			bind: { [property]: templateString(marker.value) },
			fields,
			...(marker.kind === "qr" && Object.keys(marker.opts).length > 0
				? { qrOpts: marker.opts }
				: {}),
			...(marker.kind === "barcode" && marker.opts.symbology
				? { symbology: marker.opts.symbology as Symbology }
				: {}),
		};
	}

	// 2. Unmarked whole-name token/template → smart-infer the kind.
	const nameValue = parseValue(node.name);
	if (nameValue) {
		const tmpl = templateString(nameValue);
		if (node.type === "TEXT") {
			return {
				bind: { text: tmpl },
				fields: draftsFor(
					nameValue,
					"text",
					textDefault(node, valueIds(nameValue).length),
				),
			};
		}
		if (node.type === "RECTANGLE" && hasSingleImageFill(node)) {
			return { bind: { image: tmpl }, fields: imageDraftsFor(nameValue, node) };
		}
		// A non-text, non-image layer can't be a text/image field without odd
		// rendering — ignore the token rather than coercing the element.
		return null;
	}

	// 3. Inline content tokens (text only).
	if (node.type === "TEXT") {
		const ids = extractTokens(node.characters);
		if (ids.length > 0) {
			return {
				bind: { text: node.characters },
				fields: dedupe(ids).map((id) => ({ id, format: "text" as const })),
			};
		}
	}

	return null;
}

/** A visibility condition, as coatfile's `visibleWhen` carries it. */
export type VisibilityCondition = {
	field: string;
	equals?: string;
	not?: boolean;
};

const VISIBILITY_MARKER =
	/^\s*if:\s*(!)?\s*\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}\s*(?:=\s*(?:"([^"]*)"|(\S+)))?\s*$/;

/**
 * Parse a layer name as a visibility marker: the layer (and for a group,
 * everything in it) shows only while the field is set.
 *   `if:{{show_badge}}`     shown while the field is set
 *   `if:!{{title}}`         shown while it is not
 *   `if:{{tier}}=gold`      shown while it is exactly "gold" (quotes allowed)
 */
export function parseVisibilityMarker(
	layerName: string,
): VisibilityCondition | null {
	const m = VISIBILITY_MARKER.exec(layerName);
	if (!m) return null;
	const equals = m[3] ?? m[4];
	return {
		field: m[2],
		...(equals !== undefined ? { equals } : {}),
		...(m[1] ? { not: true } : {}),
	};
}

/** Build per-field metadata from a draft, applying defaults (override later). */
export function buildFieldMeta(
	draft: FieldDraft,
	overrides: Partial<FieldMeta> = {},
): FieldMeta {
	return {
		id: draft.id,
		format: draft.format,
		title: titleCase(draft.id),
		// A toggle always has an answer (unset is its default), so it is never
		// the thing a buyer forgot to fill in.
		required: draft.format !== "boolean",
		source: "user",
		...(draft.widget ? { widget: draft.widget } : {}),
		...(draft.default !== undefined ? { default: draft.default } : {}),
		...(draft.imageAspect ? { imageAspect: draft.imageAspect } : {}),
		...overrides,
	};
}

/** Lower field metadata to the coatfile JSON-schema field shape. */
export function fieldMetaToSchema(meta: FieldMeta): Record<string, unknown> {
	const out: Record<string, unknown> = { type: "string", title: meta.title };
	if (meta.description !== undefined) out.description = meta.description;
	if (meta.format === "image") out.format = "image";
	else if (meta.format === "color") out.format = "color";
	else if (meta.format === "longText") out.format = "longText";
	else if (meta.format === "boolean") out.format = "boolean";
	else if (meta.format === "url") out["x-widget"] = "url";
	if (meta.widget && meta.format === "text") out["x-widget"] = meta.widget;
	if (meta.imageAspect) out["x-image-aspect"] = meta.imageAspect;
	if (meta.default !== undefined) out.default = meta.default;
	if (meta.source !== "user") out["x-source"] = meta.source;
	return out;
}

/** A property a node can be bound on, and the field format it implies. */
export type BindTarget = { property: BindProperty; format: FieldFormat };

/** What the selected node can be bound as — drives the Layer-tab inspector so
 * it has no per-type conditionals of its own. */
export function bindableProperties(node: FigmaNode): BindTarget[] {
	if (node.type === "TEXT") {
		return [
			{ property: "text", format: "text" },
			{ property: "textColor", format: "color" },
		];
	}
	if (node.type === "RECTANGLE") {
		// A rect already carrying an image fill is only an image.
		if (hasSingleImageFill(node))
			return [{ property: "image", format: "image" }];
		// A plain (solid-fill) rect can be a color swatch, an image placeholder
		// (the common `{{logo}}`/avatar box), a QR, or a barcode.
		return [
			{ property: "fill", format: "color" },
			{ property: "image", format: "image" },
			{ property: "qr", format: "url" },
			{ property: "barcode", format: "text" },
		];
	}
	// Frames / vectors: a solid fill, or a QR or barcode placeholder.
	return [
		{ property: "fill", format: "color" },
		{ property: "qr", format: "url" },
		{ property: "barcode", format: "text" },
	];
}

/** The per-node pluginData record: which property → which value template. */
export type StoredBinding = {
	bind: Partial<Record<BindProperty, string>>;
};

/** Expand a stored per-node record into a NodeBinding (fields re-derived from
 * the templates). Field formats come from the bound property. */
export function storedToNodeBinding(stored: StoredBinding): NodeBinding {
	const fields: FieldDraft[] = [];
	const seen = new Set<string>();
	for (const [property, tmpl] of Object.entries(stored.bind)) {
		if (tmpl === undefined) continue;
		const format = formatForProperty(property as BindProperty);
		const widget = widgetForProperty(property as BindProperty);
		for (const id of extractTokens(tmpl)) {
			if (seen.has(id)) continue;
			seen.add(id);
			fields.push({ id, format, ...(widget ? { widget } : {}) });
		}
	}
	return { bind: stored.bind, fields };
}
