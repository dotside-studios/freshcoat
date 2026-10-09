import type { Template, ValidationError } from "@freshcoat-js/coatfile";
import {
	formatVersionStatus,
	loadTemplate,
	raiseFormatVersion,
	validate,
	verifyAssets,
} from "@freshcoat-js/coatfile";
import {
	type COAT_EXTENSION,
	type COAT_JSON_EXTENSION,
	CoatError,
	packTemplate,
	pruneUnusedAssets,
	serializeTemplate,
} from "@freshcoat-js/coatfile/coat";

export type LoadOutcome =
	| {
			kind: "ok";
			fileName: string;
			template: Template;
			/** Element ids that had to be renamed to make the file loadable. */
			healed: string[];
			/** Written by a newer 1.x kit, so fields it added were dropped. */
			newerFormat: boolean;
			/** Asset keys that are not the sha256 of the bytes they name. */
			misKeyedAssets: string[];
	  }
	/** Parsed, but the kit rejected it. */
	| { kind: "invalid"; fileName: string; errors: ValidationError[] }
	/** Unreadable bytes, malformed JSON, or a broken package. */
	| { kind: "unreadable"; fileName: string; message: string };

/** A `.coat` or `.tkit` package, template JSON bytes, or JSON text. The file is taken as
 *  written when it validates; only otherwise are duplicate ids healed. */
export async function openFile(
	input: Uint8Array | string,
	fileName: string,
): Promise<LoadOutcome> {
	try {
		const loaded = await loadTemplate(input);
		if (!loaded.ok)
			return loaded.reason === "unreadable"
				? { kind: "unreadable", fileName, message: loaded.message }
				: { kind: "invalid", fileName, errors: loaded.errors };
		const { template } = loaded;
		return {
			kind: "ok",
			fileName,
			template,
			healed: loaded.renamedIds,
			newerFormat: formatVersionStatus(template.format_version) === "newer",
			misKeyedAssets: (await verifyAssets(template)).map((m) => m.declared),
		};
	} catch (err) {
		return { kind: "unreadable", fileName, message: String(err) };
	}
}

export type SaveResult<T> =
	| { ok: true; data: T }
	| { ok: false; errors: ValidationError[] };

/** Unused assets pruned, `format_version` raised to cover the fields used. */
function writable(t: Template): Template {
	return raiseFormatVersion(pruneUnusedAssets(t));
}

/** The `.coat` package bytes. */
export async function saveCoat(t: Template): Promise<SaveResult<Uint8Array>> {
	const pruned = writable(t);
	const v = validate(pruned);
	if (!v.ok) return { ok: false, errors: v.errors };
	try {
		return { ok: true, data: await packTemplate(pruned) };
	} catch (err) {
		return { ok: false, errors: [writeError(err)] };
	}
}

/** The template as it would be saved. */
export function sendableTemplate(t: Template): SaveResult<Template> {
	const pruned = writable(t);
	const v = validate(pruned);
	return v.ok ? { ok: true, data: pruned } : { ok: false, errors: v.errors };
}

/** The `.coat.json` text. */
export function saveJson(t: Template): SaveResult<string> {
	const pruned = writable(t);
	const v = validate(pruned);
	if (!v.ok) return { ok: false, errors: v.errors };
	try {
		return { ok: true, data: serializeTemplate(pruned) };
	} catch (err) {
		return { ok: false, errors: [writeError(err)] };
	}
}

function writeError(err: unknown): ValidationError {
	return {
		path: "/format_version",
		code: err instanceof CoatError ? err.code : "write_failed",
		message: err instanceof Error ? err.message : String(err),
	};
}

/** `<id>-<side>[-<variant>][@<n>x].png`. */
export function exportFileName(
	templateId: string,
	sideName: string,
	variantId?: string,
	scale = 1,
): string {
	const variant = variantId ? `-${variantId}` : "";
	const density = scale === 1 ? "" : `@${scale}x`;
	return `${templateId}-${sideName}${variant}${density}.png`;
}

/** A download name for the document: its id, with the given extension. */
export function saveFileName(
	t: Template,
	ext: typeof COAT_EXTENSION | typeof COAT_JSON_EXTENSION,
): string {
	const base =
		t.id.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "template";
	return `${base}${ext}`;
}
