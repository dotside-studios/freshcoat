import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Fonts vendored in `fonts/`. See its README for sources and licenses. */
export type TestFont =
	| "Geist-Regular.ttf"
	| "NotoSansHebrew-Regular.ttf"
	| "VendSans-Variable-latin.woff2";

export function testFontPath(name: TestFont): string {
	return fileURLToPath(new URL(`../fonts/${name}`, import.meta.url));
}

export function testFontBytes(name: TestFont): Uint8Array {
	return new Uint8Array(readFileSync(testFontPath(name)));
}
