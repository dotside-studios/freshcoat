// Hand-off to the Freshcoat editor. A plugin can open a URL in the system
// browser but gets no window back, so the template travels in the URL itself:
// its JSON, raw-deflated and base64url-encoded, in the fragment of
// `<address>/edit#coat=<data>`. The fragment never reaches a server. A template
// too large for a link is downloaded as a `.coat` instead, and Freshcoat opens
// on `#open=1`, pointing at its "Open file…" button for that file.
//
// The link format itself lives in `@freshcoat-js/coatfile/handoff`.

import type { Template } from "@freshcoat-js/coatfile";
import { subtleSha256 } from "@freshcoat-js/coatfile/assets";
import { COAT_MEDIA_TYPE, packTemplate } from "@freshcoat-js/coatfile/coat";
import {
	encodeHandoff,
	HANDOFF_MAX_CHARS,
	isHandoffOrigin,
	isLoopbackHost,
} from "@freshcoat-js/coatfile/handoff";
// js-sha256 where crypto.subtle is unavailable, as in the plugin iframe (non-secure context).
import { sha256 } from "js-sha256";
import type { UiToMain } from "~/shared/protocol";

const hasSubtle =
	globalThis.isSecureContext === true &&
	globalThis.crypto?.subtle !== undefined;

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
	return hasSubtle ? subtleSha256(bytes) : sha256(bytes);
}

export function packCoat(
	template: Template,
	knownHashes?: Iterable<string>,
): Promise<Uint8Array> {
	return packTemplate(template, { sha256: sha256Hex, knownHashes });
}

export function coatBlob(bytes: Uint8Array): Blob {
	return new Blob([bytes as Uint8Array<ArrayBuffer>], {
		type: COAT_MEDIA_TYPE,
	});
}

export const TOO_LARGE_MESSAGE =
	"Too large for a link. Open the downloaded file in Freshcoat";

export type AddressCheck =
	| { ok: true; base: string }
	| { ok: false; reason: string };

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
	if (!isHandoffOrigin(url)) {
		const bare = new URL(url.href);
		bare.username = "";
		bare.password = "";
		if (isHandoffOrigin(bare))
			return { ok: false, reason: "Leave the sign-in out of the address" };
		return {
			ok: false,
			reason: isLoopbackHost(url.hostname)
				? "Use an http or https address"
				: "Use an https address",
		};
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

	io.download(options.fileName, coatBlob(await packCoat(template)));
	const url = openFileUrl(address.base);
	io.post({ type: "open-external", url });
	return {
		kind: "file",
		url,
		fileName: options.fileName,
		message: TOO_LARGE_MESSAGE,
	};
}
