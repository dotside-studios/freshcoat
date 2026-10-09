import { googleCss2Url } from "@freshcoat-js/coatfile";

/** The css2 stylesheet URLs to try for a family: 400 and 700 first, then
 *  whatever weights the family has (for single-weight families). */
export function googleFontUrls(family: string): string[] {
	return [googleCss2Url(family, [400, 700]), googleCss2Url(family)];
}

/** The first URL that serves a stylesheet with a face in it, or null. */
export async function verifyGoogleFont(
	family: string,
	fetcher: typeof fetch = fetch,
): Promise<string | null> {
	for (const url of googleFontUrls(family)) {
		try {
			const res = await fetcher(url);
			if (res.ok && (await res.text()).includes("@font-face")) return url;
		} catch {
			// Offline or blocked: try the next form, then report failure.
		}
	}
	return null;
}
