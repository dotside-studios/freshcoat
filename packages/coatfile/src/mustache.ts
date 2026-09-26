const TOKEN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

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
	return s.replace(TOKEN, (_match, id: string) => {
		const v = ctx[id];
		return v == null ? "" : String(v);
	});
}
