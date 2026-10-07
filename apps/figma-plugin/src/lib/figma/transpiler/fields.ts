import { wholeToken } from "@freshcoat-js/coatfile/mustache";

export function isWholeMustacheToken(
	s: string,
): { ok: true; id: string } | { ok: false } {
	const id = wholeToken(s.trim());
	return id === undefined ? { ok: false } : { ok: true, id };
}

export function titleCase(id: string): string {
	return id
		.split("_")
		.filter((w) => w.length > 0)
		.map((w) => w[0].toUpperCase() + w.slice(1))
		.join(" ");
}
