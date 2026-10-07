const PROLOG =
	/^﻿?(?:\s+|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^[>]*(?:\[[\s\S]*?\])?\s*>)*<svg[\s/>]/i;

/** Whether text or bytes look like an SVG document, for sniffing sources. */
export function isSvg(input: string | Uint8Array): boolean {
	const text =
		typeof input === "string"
			? input
			: new TextDecoder().decode(input.subarray(0, 65536));
	return PROLOG.test(text);
}
