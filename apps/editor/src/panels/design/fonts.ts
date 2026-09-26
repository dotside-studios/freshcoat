import type { FontDescriptor, Template } from "@freshcoat/coatfile";

export const WEIGHTS: [number, string][] = [
	[100, "Thin"],
	[200, "Extra light"],
	[300, "Light"],
	[400, "Regular"],
	[500, "Medium"],
	[600, "Semibold"],
	[700, "Bold"],
	[800, "Extra bold"],
	[900, "Black"],
];

const CSS2 = "https://fonts.googleapis.com/css2?family=";

export function googleFontUrls(family: string): [string, string] {
	const name = family.trim().replace(/\s+/g, "+");
	return [
		`${CSS2}${name}:wght@400;700&display=swap`,
		`${CSS2}${name}&display=swap`,
	];
}

export function isDeclared(t: Template, family: string): boolean {
	return !!t.fonts?.some((f) => f.family === family);
}

/**
 * A `google` descriptor for a family, once its stylesheet answers: first with
 * the regular and bold weights, then with whatever the family has. Null when
 * neither answers.
 */
export async function verifyGoogleFamily(
	family: string,
	fetcher: (url: string) => Promise<{ ok: boolean }> = (u) => fetch(u),
): Promise<FontDescriptor | null> {
	for (const url of googleFontUrls(family)) {
		try {
			const res = await fetcher(url);
			if (res.ok) return { kind: "google", family, url };
		} catch {
			// Offline or blocked: try the next form, then give up.
		}
	}
	return null;
}
