// Hand-off to the Freshcoat editor. A plugin can open a URL in the system
// browser but gets no window back, so the template travels in the URL itself:
// its JSON, raw-deflated and base64url-encoded, in the fragment of
// `<address>/edit#coat=<data>`. The fragment never reaches a server. A template
// too large for a link is downloaded as a `.coat` instead, and Freshcoat opens
// on `#open=1`, pointing at its "Open file…" button for that file.
//
// The editor decodes this format with its own copy of the inverse (Freshcoat
// cannot import from here); the two are held together by checked-in fixtures
// each side decodes.

import type { Template } from "@freshcoat-js/coatfile";
import { base64ToBytes, bytesToBase64 } from "@freshcoat-js/coatfile/assets";
import { COAT_MEDIA_TYPE, packTemplate } from "@freshcoat-js/coatfile/coat";
import { deflateSync, inflateSync, strFromU8, strToU8 } from "fflate";
// js-sha256 because crypto.subtle is unavailable in the plugin iframe (non-secure context).
import { sha256 } from "js-sha256";
import type { UiToMain } from "~/shared/protocol";

/** The longest `coat` value sent as a link. Chromium accepts URLs up to 2 MB;
 *  this leaves room for the address and for browsers that allow less. */
export const HANDOFF_MAX_CHARS = 1_500_000;

export const TOO_LARGE_MESSAGE =
	"Too large for a link. Open the downloaded file in Freshcoat";

/** Template JSON as the `coat` fragment value: raw deflate at level 9, then
 *  base64url without padding. */
export function encodeHandoff(json: string): string {
	const deflated = deflateSync(strToU8(json), { level: 9 });
	return bytesToBase64(deflated)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

/** The inverse of `encodeHandoff`. The editor has its own; this one exists so
 *  the plugin's tests can prove the encoder alone. */
export function decodeHandoff(data: string): string {
	const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
	const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
	return strFromU8(inflateSync(base64ToBytes(padded)));
}

export type AddressCheck =
	| { ok: true; base: string }
	| { ok: false; reason: string };

const LOOPBACK = new Set(["localhost", "127.0.0.1"]);

/**
 * Checks a Freshcoat address and returns it as the base the editor paths hang
 * off: https anywhere, or http on this machine for a local editor. The query,
 * the fragment, trailing slashes and a trailing `/edit` are dropped, so a
 * pasted editor link works as well as the bare address.
 */
export function checkFreshcoatAddress(address: string): AddressCheck {
	const trimmed = address.trim();
	if (!trimmed) return { ok: false, reason: "Enter the Freshcoat address" };
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		return { ok: false, reason: "Not a web address" };
	}
	const local = LOOPBACK.has(url.hostname);
	if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
		return {
			ok: false,
			reason: local ? "Use an http or https address" : "Use an https address",
		};
	}
	if (url.username || url.password) {
		return { ok: false, reason: "Leave the sign-in out of the address" };
	}
	const path = url.pathname.replace(/\/+$/, "").replace(/\/edit$/, "");
	return { ok: true, base: `${url.origin}${path}` };
}

/** `<base>/edit#coat=<data>`, the link that opens a template in Freshcoat. */
export function handoffUrl(base: string, data: string): string {
	return `${base}/edit#coat=${data}`;
}

/** `<base>/edit#open=1`, Freshcoat pointing at "Open file…" for the
 *  downloaded template. */
export function openFileUrl(base: string): string {
	return `${base}/edit#open=1`;
}

export type HandoffIo = {
	/** Sends a message to the main thread, which opens the URL. */
	post(message: UiToMain): void;
	/** Hands a file to the browser, as the export does. */
	download(fileName: string, file: Blob): void;
};

export type HandoffOutcome =
	/** No address is set: show Settings. */
	| { kind: "no-address" }
	/** The address is set but unusable; `reason` is the message to show. */
	| { kind: "bad-address"; reason: string }
	/** Freshcoat was opened with the template in the link. */
	| { kind: "link"; url: string }
	/** The template was downloaded and Freshcoat opened, asking for it;
	 *  `message` says so. */
	| { kind: "file"; url: string; fileName: string; message: string };

/**
 * Opens `template` in Freshcoat: as a link when it fits in
 * `HANDOFF_MAX_CHARS`, otherwise as a downloaded `.coat` (named `fileName`)
 * and a link that asks Freshcoat to open it. Call it from the click, as the download needs
 * the gesture.
 */
export async function openInFreshcoat(
	template: Template,
	options: { address: string; fileName: string },
	io: HandoffIo,
): Promise<HandoffOutcome> {
	if (!options.address.trim()) return { kind: "no-address" };
	const address = checkFreshcoatAddress(options.address);
	if (!address.ok) return { kind: "bad-address", reason: address.reason };

	const data = encodeHandoff(JSON.stringify(template));
	if (data.length <= HANDOFF_MAX_CHARS) {
		const url = handoffUrl(address.base, data);
		io.post({ type: "open-external", url });
		return { kind: "link", url };
	}

	const packed = await packTemplate(template, {
		sha256: async (bytes) => sha256(bytes),
	});
	io.download(
		options.fileName,
		new Blob([packed as Uint8Array<ArrayBuffer>], { type: COAT_MEDIA_TYPE }),
	);
	const url = openFileUrl(address.base);
	io.post({ type: "open-external", url });
	return {
		kind: "file",
		url,
		fileName: options.fileName,
		message: TOO_LARGE_MESSAGE,
	};
}
