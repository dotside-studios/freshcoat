const TOKEN_GLOBAL = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
const TOKEN_WHOLE = /^\s*\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}\s*$/;

/** Ordered token ids inside a string (may repeat). */
export function extractTokens(s: string): string[] {
	const out: string[] = [];
	TOKEN_GLOBAL.lastIndex = 0;
	let m = TOKEN_GLOBAL.exec(s);
	while (m !== null) {
		out.push(m[1]);
		m = TOKEN_GLOBAL.exec(s);
	}
	return out;
}

export function isWholeMustacheToken(
	s: string,
): { ok: true; id: string } | { ok: false } {
	const m = TOKEN_WHOLE.exec(s);
	return m ? { ok: true, id: m[1] } : { ok: false };
}

export function titleCase(id: string): string {
	return id
		.split("_")
		.filter((w) => w.length > 0)
		.map((w) => w[0].toUpperCase() + w.slice(1))
		.join(" ");
}
