import {
	type CoatErrorCode,
	decodeTemplate,
	type UnpackOptions,
} from "./coat";
import { healElementIds } from "./normalize";
import type { Template, ValidationError } from "./types";
import { validate } from "./validate";

export type LoadTemplateResult =
	| {
			ok: true;
			template: Template;
			/** Whether duplicate element ids had to be renamed to validate. */
			healed: boolean;
			/** The element ids healing renamed, as they now read. */
			renamedIds: string[];
			/** Whether it arrived as a `.coat` rather than as JSON. */
			packaged: boolean;
	  }
	/** Unreadable bytes, malformed JSON, or a broken package. */
	| { ok: false; reason: "unreadable"; code: CoatErrorCode; message: string }
	/** Read, but it does not validate, healed or not. The errors are the file's
	 *  as written. */
	| { ok: false; reason: "invalid"; errors: ValidationError[] };

/**
 * Reads a template in: `decodeTemplate`, then `validate`. A file that
 * validates as written is taken as written; otherwise its duplicate element
 * ids are healed and it is validated again.
 */
export async function loadTemplate(
	input: Uint8Array | string,
	options: UnpackOptions = {},
): Promise<LoadTemplateResult> {
	const decoded = await decodeTemplate(input, options);
	if (!decoded.ok)
		return {
			ok: false,
			reason: "unreadable",
			code: decoded.code,
			message: decoded.message,
		};
	const raw = decoded.document;
	const packaged = decoded.packaged;
	const asWritten = validate(raw);
	if (asWritten.ok)
		return {
			ok: true,
			template: asWritten.value,
			healed: false,
			renamedIds: [],
			packaged,
		};
	const healed = validate(healElementIds(raw));
	if (!healed.ok)
		return { ok: false, reason: "invalid", errors: asWritten.errors };
	return {
		ok: true,
		template: healed.value,
		healed: true,
		renamedIds: renamedIds(raw, healed.value),
		packaged,
	};
}

function renamedIds(raw: unknown, healed: Template): string[] {
	const before = frameElementIds(raw);
	const after = frameElementIds(healed);
	return after.filter((id, i) => before[i] !== undefined && before[i] !== id);
}

function frameElementIds(template: unknown): string[] {
	const frames = (template as { template_data?: unknown }).template_data;
	if (!Array.isArray(frames)) return [];
	return frames.flatMap((frame) => {
		const elements = (frame as { elements?: unknown }).elements;
		return Array.isArray(elements)
			? elements.map((el) => String((el as { id?: unknown }).id))
			: [];
	});
}
