import type { FontDescriptor } from "@freshcoat-js/coatfile";
import { bytesToBase64 } from "@freshcoat-js/coatfile/assets";
import { once } from "~/app/lazy";
import url from "./fonts/VendSans-Variable-latin.woff2?url";

export const VEND_SANS_FAMILY = "Vend Sans";

/** `VEND_SANS`, fetched on first use. */
export const loadVendSans = once(async (): Promise<FontDescriptor> => {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
	const bytes = new Uint8Array(await res.arrayBuffer());
	return {
		kind: "local",
		family: VEND_SANS_FAMILY,
		files: [
			{ weight: 400, src: `data:font/woff2;base64,${bytesToBase64(bytes)}` },
		],
	};
});
