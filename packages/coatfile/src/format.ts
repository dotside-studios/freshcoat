import type { Template } from "./types";

// The wire format's own version, as `format_version` carries it.
//
// A major version is a contract: a reader refuses one it does not know. A minor
// version only adds optional fields, so every 1.x file reads with any 1.x kit.
// What a minor version does restrict is writing. Validation strips keys it does
// not recognise, so a kit that re-saves a file from a newer minor would drop
// whatever that minor added. `formatVersionStatus` is how a writer finds out
// before it does that.
//
//   1.0  the original format
//   1.1  `product` and `version` optional; `$schema` recognised
//   1.2  linear fill `from` / `to`; element `constraints`
//   1.3  barcode element
//   1.4  variant deltas: pos, size, rotation, opacity, hidden
//   1.5  grid layout; element `adjust`; image `focus` and `crop`; template
//        `bleed` and `safeArea`; text `justify`, `start` and `end` alignment,
//        `alignLast`, `direction`, `paragraphSpacing` and font `features`;
//        per-corner frame `cornerRadius`; `linear-burn` blend mode; barcode
//        `bearerBars`
//   1.6  frame `isolate`; text `arc` and `path`; element `backdropBlur`;
//        gradient stroke `color`; variant `size`; vector `boolean`

export const FORMAT_MAJOR = 1;
export const FORMAT_MINOR = 6;

/** What a writer puts in `format_version` for a template it produced. */
export const FORMAT_VERSION = `${FORMAT_MAJOR}.${FORMAT_MINOR}`;

export type FormatVersionStatus =
	/** This kit reads and writes it without losing anything. */
	| "current"
	/** Readable, but written by a newer kit: re-saving it may drop fields. */
	| "newer"
	/** A major version, or a string, this kit does not read at all. */
	| "unsupported";

export function formatVersionStatus(
	formatVersion: unknown,
): FormatVersionStatus {
	if (typeof formatVersion !== "string") return "unsupported";
	const match = /^(\d+)(?:\.(\d+))?/.exec(formatVersion.trim());
	if (!match) return "unsupported";
	if (Number(match[1]) !== FORMAT_MAJOR) return "unsupported";
	const minor = match[2] === undefined ? 0 : Number(match[2]);
	return minor > FORMAT_MINOR ? "newer" : "current";
}

/** The lowest 1.x a reader needs to keep every field `template` uses. */
export function minimumFormatVersion(template: Template): string {
	let minor = 0;
	const need = (m: number) => {
		if (m > minor) minor = m;
	};

	if (
		template.$schema !== undefined ||
		template.product === undefined ||
		template.version === undefined
	)
		need(1);

	const frameIds = new Set<string>();
	const visit = (node: unknown): void => {
		if (Array.isArray(node)) {
			for (const item of node) visit(item);
			return;
		}
		if (node === null || typeof node !== "object") return;
		const o = node as Record<string, unknown>;
		if (o.kind === "linear" && (o.from !== undefined || o.to !== undefined))
			need(2);
		if (typeof o.id === "string" && typeof o.type === "string") {
			if (o.constraints !== undefined) need(2);
			if (o.type === "barcode") need(3);
			if (
				o.type === "barcode" &&
				(o.properties as Record<string, unknown> | undefined)?.bearerBars !==
					undefined
			)
				need(5);
			if (o.type === "text" && usesTextLayout(o.properties)) need(5);
			if (o.type === "text" && usesArc(o.properties)) need(6);
			if (o.type === "text" && usesTextPath(o.properties)) need(6);
			if (o.type === "vector" && usesBoolean(o.properties)) need(6);
			if (o.type === "frame") {
				frameIds.add(o.id);
				if (usesPerCornerRadius(o.properties)) need(5);
				if (usesIsolate(o.properties)) need(6);
			}
		}
		if (o.blendMode === "linear-burn") need(5);
		if (o.backdropBlur !== undefined) need(6);
		if (usesGradientStroke(o)) need(6);
		for (const value of Object.values(o)) visit(value);
	};
	visit(template.template_data);
	visit(template.variants);

	for (const variant of template.variants ?? []) {
		if (variant.size !== undefined) need(6);
		for (const override of variant.overrides) {
			for (const delta of override.elements ?? []) {
				if (
					delta.pos !== undefined ||
					delta.size !== undefined ||
					delta.rotation !== undefined ||
					delta.opacity !== undefined ||
					delta.hidden !== undefined
				)
					need(4);
				if (usesTextLayout(delta.properties)) need(5);
				if (usesArc(delta.properties)) need(6);
				if (usesTextPath(delta.properties)) need(6);
				if (frameIds.has(delta.id) && usesPerCornerRadius(delta.properties))
					need(5);
				if (frameIds.has(delta.id) && usesIsolate(delta.properties)) need(6);
				if (usesBoolean(delta.properties)) need(6);
			}
		}
	}

	return `${FORMAT_MAJOR}.${minor}`;
}

function usesGradientStroke(o: Record<string, unknown>): boolean {
	const stroke = o.stroke as Record<string, unknown> | null | undefined;
	return (
		stroke !== null &&
		typeof stroke === "object" &&
		stroke.color !== null &&
		typeof stroke.color === "object"
	);
}

function usesPerCornerRadius(properties: unknown): boolean {
	return (
		properties !== null &&
		typeof properties === "object" &&
		Array.isArray((properties as Record<string, unknown>).cornerRadius)
	);
}

function usesBoolean(properties: unknown): boolean {
	return (
		properties !== null &&
		typeof properties === "object" &&
		(properties as Record<string, unknown>).boolean !== undefined
	);
}

function usesIsolate(properties: unknown): boolean {
	return (
		properties !== null &&
		typeof properties === "object" &&
		(properties as Record<string, unknown>).isolate !== undefined
	);
}

function usesArc(properties: unknown): boolean {
	return (
		properties !== null &&
		typeof properties === "object" &&
		(properties as Record<string, unknown>).arc !== undefined
	);
}

function usesTextPath(properties: unknown): boolean {
	return (
		properties !== null &&
		typeof properties === "object" &&
		(properties as Record<string, unknown>).path !== undefined
	);
}

const TEXT_ALIGN_1_5 = new Set(["justify", "start", "end"]);

// Text properties 1.5 added, on an element or a variant delta's properties.
function usesTextLayout(properties: unknown): boolean {
	if (properties === null || typeof properties !== "object") return false;
	const p = properties as Record<string, unknown>;
	const hasFeatures = (font: unknown) =>
		font !== null &&
		typeof font === "object" &&
		(font as Record<string, unknown>).features !== undefined;
	return (
		TEXT_ALIGN_1_5.has(p.align as string) ||
		p.alignLast !== undefined ||
		p.direction !== undefined ||
		p.paragraphSpacing !== undefined ||
		hasFeatures(p.font) ||
		(Array.isArray(p.spans) && p.spans.some((span) => hasFeatures(span?.font)))
	);
}

/**
 * `template` with `format_version` raised to `minimumFormatVersion`, so a kit
 * that only reads the older minor refuses to re-save it rather than dropping
 * fields. Never lowers it, and leaves a version this kit does not write alone.
 * Returns `template` itself when nothing changes.
 */
export function raiseFormatVersion<T extends Template>(template: T): T {
	if (formatVersionStatus(template.format_version) !== "current")
		return template;
	const needed = minimumFormatVersion(template);
	return formatMinor(needed) > formatMinor(template.format_version)
		? { ...template, format_version: needed }
		: template;
}

/** The minor of a `1.x` version; 0 when there is none. */
export function formatMinor(formatVersion: string): number {
	const minor = /^\d+\.(\d+)/.exec(formatVersion.trim())?.[1];
	return minor === undefined ? 0 : Number(minor);
}
