export const FIELD_ID = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** A key `FIELD_ID` accepts, made from any text: `First Name` and `firstName`
 *  give `first_name`, `Año` gives `ano`, `2nd` gives `_2nd`. `fallback` when
 *  nothing is left. */
export function fieldKeyFrom(text: string, fallback = "field"): string {
	const key = text
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
	if (key === "") return fallback;
	return /^[0-9]/.test(key) ? `_${key}` : key;
}

export type MustacheText = {
	kind: "text";
	value: string;
	start: number;
	end: number;
};

export type MustacheRef = {
	kind: "ref";
	id: string;
	raw: string;
	start: number;
	end: number;
};

export type MustacheSegment = MustacheText | MustacheRef;

const SPACE = /\s/;

function isSpace(s: string, i: number): boolean {
	const c = s.charCodeAt(i);
	if (c === 32 || (c >= 9 && c <= 13)) return true;
	return c > 127 && SPACE.test(s[i] as string);
}

function isIdStart(c: number): boolean {
	return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}

function isIdPart(c: number): boolean {
	return isIdStart(c) || (c >= 48 && c <= 57);
}

function readRef(s: string, open: number): MustacheRef | undefined {
	let i = open + 2;
	while (isSpace(s, i)) i++;
	const idStart = i;
	if (i >= s.length || !isIdStart(s.charCodeAt(i))) return undefined;
	i++;
	while (i < s.length && isIdPart(s.charCodeAt(i))) i++;
	const id = s.slice(idStart, i);
	while (isSpace(s, i)) i++;
	if (s[i] !== "}" || s[i + 1] !== "}") return undefined;
	const end = i + 2;
	return { kind: "ref", id, raw: s.slice(open, end), start: open, end };
}

function eachRef(
	s: string,
	visit: (ref: MustacheRef, textStart: number) => void,
): number {
	let textStart = 0;
	let open = s.indexOf("{{");
	while (open >= 0) {
		const ref = readRef(s, open);
		if (ref === undefined) {
			open = s.indexOf("{{", open + 1);
			continue;
		}
		visit(ref, textStart);
		textStart = ref.end;
		open = s.indexOf("{{", textStart);
	}
	return textStart;
}

function text(s: string, start: number, end: number): MustacheText {
	return { kind: "text", value: s.slice(start, end), start, end };
}

export function parseMustache(s: string): MustacheSegment[] {
	const out: MustacheSegment[] = [];
	const tail = eachRef(s, (ref, textStart) => {
		if (ref.start > textStart) out.push(text(s, textStart, ref.start));
		out.push(ref);
	});
	if (tail < s.length) out.push(text(s, tail, s.length));
	return out;
}

function refsOf(s: string): MustacheRef[] {
	if (s.indexOf("{{") < 0) return [];
	const out: MustacheRef[] = [];
	eachRef(s, (ref) => out.push(ref));
	return out;
}

export function tokenIds(s: string): string[] {
	return refsOf(s).map((ref) => ref.id);
}

export function wholeToken(s: string): string | undefined {
	if (!s.startsWith("{{")) return undefined;
	const ref = readRef(s, 0);
	return ref?.end === s.length ? ref.id : undefined;
}

export function hasToken(value: unknown): boolean {
	if (typeof value === "string") return refsOf(value).length > 0;
	if (Array.isArray(value)) return value.some(hasToken);
	if (value !== null && typeof value === "object")
		return Object.values(value).some(hasToken);
	return false;
}

function mapRefs(s: string, fn: (ref: MustacheRef) => string): string {
	if (s.indexOf("{{") < 0) return s;
	let out = "";
	const tail = eachRef(s, (ref, textStart) => {
		out += s.slice(textStart, ref.start) + fn(ref);
	});
	return tail === 0 ? s : out + s.slice(tail);
}

export function renameToken(s: string, from: string, to: string): string {
	return mapRefs(s, (ref) =>
		ref.id === from ? ref.raw.replace(ref.id, to) : ref.raw,
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
	return mapRefs(s, (ref) => {
		const v = ctx[ref.id];
		return v == null ? "" : String(v);
	});
}
