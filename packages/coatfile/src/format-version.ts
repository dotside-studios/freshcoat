import { z } from "zod";

/**
 * What each 1.x minor added, indexed by minor. Every backticked name is a
 * feature `formatHistory` tags in the schema. `bun run schema` writes this into
 * the history comment in format.ts and the README's "Format versions" table.
 */
export const FORMAT_HISTORY = [
	"the original format",
	"`product` and `version` optional; `$schema` kept",
	"linear fill `from` / `to`; element `constraints`",
	"the `barcode` element",
	"variant deltas: `pos`, `size`, `rotation`, `opacity`, `hidden`",
	"`grid` layout; element `adjust`; image `focus` and `crop`; template `bleed` and `safeArea`; text `justify`, `start` and `end` alignment, `alignLast`, `direction`, `paragraphSpacing` and font `features`; per-corner frame `cornerRadius`; `linear-burn` blend mode; barcode `bearerBars`",
	"frame `isolate`; text `arc` and `path`; element `backdropBlur`; gradient stroke `color`; variant `size`; vector `boolean`",
	"rect and vector `slice`; element `hidden`; text `stroke` and `pdfText`; frame `cornerSmoothing`; per-corner image `cornerRadius` and image `cornerSmoothing`; rect and frame stroke `width` per side; element `effects`, with `grain` and `halftone` (and its `anchor`); rect and vector `spot`; QR `quietZone`, `moduleShape`, `finderOuter`, `finderInner`, `gradient` and `logo`",
] as const;

export const FORMAT_MAJOR = 1;
export const FORMAT_MINOR = FORMAT_HISTORY.length - 1;

/** What a writer puts in `format_version` for a template it produced. */
export const FORMAT_VERSION = `${FORMAT_MAJOR}.${FORMAT_MINOR}`;

export type FormatVersion = `${typeof FORMAT_MAJOR}.${number}`;

export type FormatVersionTag = {
	/** The minor that added this field, union member or schema. */
	since?: FormatVersion;
	/** The name FORMAT_HISTORY lists it under, when not its key or tag. */
	feature?: string;
	/** Enum or literal values added after the schema itself. */
	values?: Record<string, FormatVersion>;
};

/**
 * Which minor added each part of the template schema. `minimumFormatVersion`
 * reads it. A registry of its own rather than `.meta()`, so the tags stay out
 * of the generated JSON Schema.
 */
export const formatHistory = z.registry<FormatVersionTag>();

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
	const match = /^(\d+)(?:\.(\d+))?$/.exec(formatVersion.trim());
	if (!match) return "unsupported";
	if (Number(match[1]) !== FORMAT_MAJOR) return "unsupported";
	const minor = match[2] === undefined ? 0 : Number(match[2]);
	return minor > FORMAT_MINOR ? "newer" : "current";
}

/** The minor of a `1.x` version; 0 when there is none. */
export function formatMinor(formatVersion: string): number {
	const minor = /^\d+\.(\d+)$/.exec(formatVersion.trim())?.[1];
	return minor === undefined ? 0 : Number(minor);
}
