export const FIELD_ID = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const TOKEN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
const ANY_TOKEN = new RegExp(TOKEN.source);
const WHOLE_TOKEN = new RegExp(`^${TOKEN.source}$`);

export function tokenIds(s: string): string[] {
	if (s.indexOf("{{") < 0) return [];
	return Array.from(s.matchAll(TOKEN), (m) => m[1] as string);
}

export function wholeToken(s: string): string | undefined {
	return WHOLE_TOKEN.exec(s)?.[1];
}

export function hasToken(value: unknown): boolean {
	if (typeof value === "string")
		return value.indexOf("{{") >= 0 && ANY_TOKEN.test(value);
	if (Array.isArray(value)) return value.some(hasToken);
	if (value !== null && typeof value === "object")
		return Object.values(value).some(hasToken);
	return false;
}

export function renameToken(s: string, from: string, to: string): string {
	if (s.indexOf("{{") < 0) return s;
	return s.replace(TOKEN, (match, id: string) =>
		id === from ? match.replace(id, to) : match,
	);
}

export function substitute(
	value: unknown,
	ctx: Record<string, unknown>,
): unknown {
	if (typeof value === "string") return substituteString(value, ctx);
	if (Array.isArray(value)) return value.map((v) => substitute(v, ctx));
	if (value !== null && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			out[k] = substitute(v, ctx);
		}
		return out;
	}
	return value;
}

function substituteString(s: string, ctx: Record<string, unknown>): string {
	if (s.indexOf("{{") < 0) return s;
	return s.replace(TOKEN, (_match, id: string) => {
		const v = ctx[id];
		return v == null ? "" : String(v);
	});
}
