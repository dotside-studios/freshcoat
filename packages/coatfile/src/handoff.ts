// The `#coat=` hand-off link: template JSON, raw-deflated at level 9 and
// base64url-encoded without padding, carried in the fragment of
// `<address>/edit#coat=<data>` so it never reaches a server.

import { deflateSync, Inflate, strFromU8, strToU8 } from "fflate";
import { base64ToBytes, bytesToBase64 } from "./assets";

/** The longest `coat` value sent as a link. Chromium accepts URLs up to 2 MB;
 *  this leaves room for the address and for browsers that allow less. */
export const HANDOFF_MAX_CHARS = 1_500_000;

/** The most inflated JSON a link may carry. A link holds about a megabyte of
 *  compressed data; this refuses the few bytes that inflate to gigabytes. */
export const HANDOFF_MAX_JSON_BYTES = 64 * 1024 * 1024;

export type HandoffDecode =
	| { ok: true; json: string }
	| { ok: false; reason: string };

const DAMAGED = "the link is incomplete or damaged";

/** Template JSON as the `coat` fragment value. */
export function encodeHandoff(json: string): string {
	const deflated = deflateSync(strToU8(json), { level: 9 });
	return bytesToBase64(deflated)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

/** The template JSON a `coat` value carries, refusing more than
 *  `HANDOFF_MAX_JSON_BYTES` once inflated. */
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

const LOOPBACK = new Set(["localhost", "127.0.0.1"]);

export function isLoopbackHost(hostname: string): boolean {
	return LOOPBACK.has(hostname);
}

/** Whether `url` may send or receive a hand-off: https anywhere, or http on
 *  this machine, with no sign-in in the address. */
export function isHandoffOrigin(url: string | URL): boolean {
	let parsed: URL;
	try {
		parsed = typeof url === "string" ? new URL(url) : url;
	} catch {
		return false;
	}
	if (parsed.username || parsed.password) return false;
	return (
		parsed.protocol === "https:" ||
		(parsed.protocol === "http:" && isLoopbackHost(parsed.hostname))
	);
}
