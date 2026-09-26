const TOKEN_GLOBAL = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
const TOKEN_WHOLE = /^\s*\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}\s*$/;

export function parseMustacheTokens(s: string): string[] {
	const out: string[] = [];
	TOKEN_GLOBAL.lastIndex = 0;
	let match: RegExpExecArray | null = TOKEN_GLOBAL.exec(s);
	while (match !== null) {
		out.push(match[1]);
		match = TOKEN_GLOBAL.exec(s);
	}
	return out;
}

export function isWholeMustacheToken(
	s: string,
): { ok: true; id: string } | { ok: false } {
	const m = TOKEN_WHOLE.exec(s);
	return m ? { ok: true, id: m[1] } : { ok: false };
}

export function kebabToSnake(s: string): string {
	return s.replace(/-/g, "_");
}

export function titleCase(id: string): string {
	return id
		.split("_")
		.filter((w) => w.length > 0)
		.map((w) => w[0].toUpperCase() + w.slice(1))
		.join(" ");
}

export type InferredField =
	| { type: "string"; title: string }
	| {
			type: "string";
			title: string;
			format: "image";
			"x-image-aspect"?: [number, number];
	  }
	| { type: "string"; title: string; "x-widget": "url" };

export function inferStringField(id: string): InferredField {
	return { type: "string", title: titleCase(id) };
}

export function inferImageField(
	id: string,
	aspect?: [number, number],
): InferredField {
	const f: InferredField = {
		type: "string",
		format: "image",
		title: titleCase(id),
	};
	if (aspect !== undefined)
		(f as { "x-image-aspect": [number, number] })["x-image-aspect"] = aspect;
	return f;
}

export function inferQrField(id: string): InferredField {
	return { type: "string", title: titleCase(id), "x-widget": "url" };
}
