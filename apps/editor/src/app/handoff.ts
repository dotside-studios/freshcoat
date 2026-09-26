// A template handed over in the link, as the Figma plugin sends it:
// `/edit#coat=<data>`, where `data` is the template JSON, raw-deflated and
// base64url-encoded without padding. It travels in the fragment because the
// browser never sends that to a server. The plugin's encoder lives in its own
// package; the two are held together by the checked-in fixtures in
// `tests/fixtures/handoff-*`, which each side decodes.

import type { Template } from "@freshcoat/coatfile";
import { base64ToBytes } from "@freshcoat/coatfile/assets";
import { COAT_EXTENSION } from "@freshcoat/coatfile/coat";
import { Inflate, strFromU8 } from "fflate";
import { openFile, saveFileName } from "~/doc/io";
import { NEWER_FORMAT } from "./controller";

/** The most inflated JSON a link may carry. A link holds about a megabyte of
 *  compressed data; this refuses the few bytes that inflate to gigabytes. */
export const HANDOFF_MAX_JSON_BYTES = 64 * 1024 * 1024;

export type HandoffDecode =
	| { ok: true; json: string }
	| { ok: false; reason: string };

const DAMAGED = "the link is incomplete or damaged";

/** The template JSON a `coat` value carries. */
export function decodeHandoff(data: string): HandoffDecode {
	if (!/^[A-Za-z0-9_-]+$/.test(data)) return { ok: false, reason: DAMAGED };
	let bytes: Uint8Array;
	try {
		const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
		bytes = base64ToBytes(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
	} catch {
		return { ok: false, reason: DAMAGED };
	}
	const chunks: Uint8Array[] = [];
	let total = 0;
	let ended = false;
	let tooLarge = false;
	const inflate = new Inflate((chunk, final) => {
		total += chunk.length;
		if (total > HANDOFF_MAX_JSON_BYTES) {
			tooLarge = true;
			throw new Error("too large");
		}
		chunks.push(chunk);
		if (final) ended = true;
	});
	try {
		inflate.push(bytes, true);
	} catch {
		return {
			ok: false,
			reason: tooLarge ? "it is too large to open from a link" : DAMAGED,
		};
	}
	if (!ended) return { ok: false, reason: DAMAGED };
	const out = new Uint8Array(total);
	let at = 0;
	for (const chunk of chunks) {
		out.set(chunk, at);
		at += chunk.length;
	}
	return { ok: true, json: strFromU8(out) };
}

export type HandoffTemplate =
	| { ok: true; template: Template; fileName: string; notices: string[] }
	| { ok: false; reason: string };

/** Decodes, parses and validates a `coat` value, healing duplicate layer ids
 *  as opening a file does. */
export async function readHandoff(data: string): Promise<HandoffTemplate> {
	const decoded = decodeHandoff(data);
	if (!decoded.ok) return decoded;
	const outcome = await openFile(decoded.json, "");
	if (outcome.kind === "unreadable")
		return { ok: false, reason: "it isn't template JSON" };
	if (outcome.kind === "invalid") {
		const first = outcome.errors[0];
		return {
			ok: false,
			reason: first
				? `${first.message}${first.path ? ` at ${first.path}` : ""}`
				: "it isn't a valid template",
		};
	}
	const notices: string[] = [];
	if (outcome.healed.length)
		notices.push(`Renamed duplicate layer ids: ${outcome.healed.join(", ")}`);
	if (outcome.newerFormat) notices.push(NEWER_FORMAT);
	return {
		ok: true,
		template: outcome.template,
		fileName: saveFileName(outcome.template, COAT_EXTENSION),
		notices,
	};
}
