import {
	FORMAT_MAJOR,
	formatMinor,
	formatVersionStatus,
} from "./format-version";
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
//   1.1  `product` and `version` optional; `$schema` kept
//   1.2  linear fill `from` / `to`; element `constraints`
//   1.3  the `barcode` element
//   1.4  variant deltas: `pos`, `size`, `rotation`, `opacity`, `hidden`
//   1.5  `grid` layout; element `adjust`; image `focus` and `crop`; template
//        `bleed` and `safeArea`; text `justify`, `start` and `end` alignment,
//        `alignLast`, `direction`, `paragraphSpacing` and font `features`;
//        per-corner frame `cornerRadius`; `linear-burn` blend mode; barcode
//        `bearerBars`
//   1.6  frame `isolate`; text `arc` and `path`; element `backdropBlur`;
//        gradient stroke `color`; variant `size`; vector `boolean`
//   1.7  rect and vector `slice`; element `hidden`; text `stroke` and
//        `pdfText`; frame `cornerSmoothing`; per-corner image `cornerRadius`
//        and image `cornerSmoothing`; rect and frame stroke `width` per side;
//        element `effects`, with `grain` and `halftone` (and its `anchor`);
//        rect and vector `spot`; QR `quietZone`, `moduleShape`, `finderOuter`,
//        `finderInner`, `gradient` and `logo`

export {
	FORMAT_HISTORY,
	FORMAT_MAJOR,
	FORMAT_MINOR,
	FORMAT_VERSION,
	type FormatVersionStatus,
	formatMinor,
	formatVersionStatus,
} from "./format-version";

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
	if (template.bleed !== undefined || template.safeArea !== undefined) need(5);

	const barcodeIds = new Set<string>();
	const frameIds = new Set<string>();
	const imageIds = new Set<string>();
	const textIds = new Set<string>();
	const qrIds = new Set<string>();
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
			if (o.adjust !== undefined) need(5);
			if (usesGridPlacement(o.layoutChild)) need(5);
			if (o.hidden !== undefined) need(7);
			if (o.effects !== undefined) need(7);
			if (o.type === "barcode") {
				barcodeIds.add(o.id);
				need(3);
				if (usesBearerBars(o.properties)) need(5);
			}
			if (o.type === "text") textIds.add(o.id);
			if (o.type === "qr_code") {
				qrIds.add(o.id);
				if (usesQrStyle(o.properties)) need(7);
			}
			if (usesSlice(o.properties)) need(7);
			if (usesSpot(o.properties)) need(7);
			if (usesSideStroke(o.properties)) need(7);
			if (o.type === "text" && usesTextLayout(o.properties)) need(5);
			if (o.type === "text" && usesArc(o.properties)) need(6);
			if (o.type === "text" && usesTextPath(o.properties)) need(6);
			if (o.type === "text" && usesTextStroke(o.properties)) need(7);
			if (o.type === "text" && usesPdfText(o.properties)) need(7);
			if (o.type === "vector" && usesBoolean(o.properties)) need(6);
			if (o.type === "frame") {
				frameIds.add(o.id);
				if (usesPerCornerRadius(o.properties)) need(5);
				if (usesGridLayout(o.properties)) need(5);
				if (usesIsolate(o.properties)) need(6);
				if (usesCornerSmoothing(o.properties)) need(7);
			}
			if (o.type === "image") {
				imageIds.add(o.id);
				if (usesImageFraming(o.properties)) need(5);
				if (usesImageCorners(o.properties)) need(7);
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
				if (textIds.has(delta.id) && usesTextLayout(delta.properties)) need(5);
				if (usesArc(delta.properties)) need(6);
				if (usesTextPath(delta.properties)) need(6);
				if (frameIds.has(delta.id) && usesPerCornerRadius(delta.properties))
					need(5);
				if (frameIds.has(delta.id) && usesGridLayout(delta.properties)) need(5);
				if (imageIds.has(delta.id) && usesImageFraming(delta.properties))
					need(5);
				if (barcodeIds.has(delta.id) && usesBearerBars(delta.properties))
					need(5);
				if (frameIds.has(delta.id) && usesIsolate(delta.properties)) need(6);
				if (frameIds.has(delta.id) && usesCornerSmoothing(delta.properties))
					need(7);
				if (imageIds.has(delta.id) && usesImageCorners(delta.properties))
					need(7);
				if (usesBoolean(delta.properties)) need(6);
				if (usesSlice(delta.properties)) need(7);
				if (usesSpot(delta.properties)) need(7);
				if (textIds.has(delta.id) && usesTextStroke(delta.properties)) need(7);
				if (textIds.has(delta.id) && usesPdfText(delta.properties)) need(7);
				if (usesSideStroke(delta.properties)) need(7);
				if (qrIds.has(delta.id) && usesQrStyle(delta.properties)) need(7);
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

function usesGridLayout(properties: unknown): boolean {
	if (properties === null || typeof properties !== "object") return false;
	const layout = (properties as Record<string, unknown>).layout;
	return (
		layout !== null &&
		typeof layout === "object" &&
		(layout as Record<string, unknown>).type === "grid"
	);
}

function usesGridPlacement(layoutChild: unknown): boolean {
	if (layoutChild === null || typeof layoutChild !== "object") return false;
	const lc = layoutChild as Record<string, unknown>;
	return lc.column !== undefined || lc.row !== undefined;
}

function usesImageFraming(properties: unknown): boolean {
	if (properties === null || typeof properties !== "object") return false;
	const p = properties as Record<string, unknown>;
	return p.focus !== undefined || p.crop !== undefined;
}

function usesBearerBars(properties: unknown): boolean {
	return (
		properties !== null &&
		typeof properties === "object" &&
		(properties as Record<string, unknown>).bearerBars !== undefined
	);
}

function usesPerCornerRadius(properties: unknown): boolean {
	return (
		properties !== null &&
		typeof properties === "object" &&
		Array.isArray((properties as Record<string, unknown>).cornerRadius)
	);
}

function usesCornerSmoothing(properties: unknown): boolean {
	return (
		properties !== null &&
		typeof properties === "object" &&
		(properties as Record<string, unknown>).cornerSmoothing !== undefined
	);
}

function usesImageCorners(properties: unknown): boolean {
	return usesPerCornerRadius(properties) || usesCornerSmoothing(properties);
}

function usesBoolean(properties: unknown): boolean {
	return (
		properties !== null &&
		typeof properties === "object" &&
		(properties as Record<string, unknown>).boolean !== undefined
	);
}

function usesSlice(properties: unknown): boolean {
	return (
		properties !== null &&
		typeof properties === "object" &&
		(properties as Record<string, unknown>).slice !== undefined
	);
}

function usesSpot(properties: unknown): boolean {
	return (
		properties !== null &&
		typeof properties === "object" &&
		(properties as Record<string, unknown>).spot !== undefined
	);
}

function usesTextStroke(properties: unknown): boolean {
	return (
		properties !== null &&
		typeof properties === "object" &&
		(properties as Record<string, unknown>).stroke !== undefined
	);
}

function usesPdfText(properties: unknown): boolean {
	return (
		properties !== null &&
		typeof properties === "object" &&
		(properties as Record<string, unknown>).pdfText !== undefined
	);
}

function usesSideStroke(properties: unknown): boolean {
	if (properties === null || typeof properties !== "object") return false;
	const stroke = (properties as Record<string, unknown>).stroke;
	if (stroke === null || typeof stroke !== "object") return false;
	const width = (stroke as Record<string, unknown>).width;
	return width !== null && typeof width === "object";
}

const QR_STYLE_1_7 = [
	"quietZone",
	"moduleShape",
	"finderOuter",
	"finderInner",
	"gradient",
	"logo",
];

function usesQrStyle(properties: unknown): boolean {
	if (properties === null || typeof properties !== "object") return false;
	const p = properties as Record<string, unknown>;
	return QR_STYLE_1_7.some((key) => p[key] !== undefined);
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
