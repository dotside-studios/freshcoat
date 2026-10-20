// The PDF object model the vector painter writes: just enough of ISO 32000 for
// one page of graphics, its resources and a cross-reference table.

import { deflate } from "../png";
import { md5 } from "./md5";

export class PdfName {
	constructor(readonly name: string) {}
}

export class PdfRef {
	constructor(readonly id: number) {}
}

export class PdfStream {
	constructor(
		readonly dict: PdfDict,
		readonly data: Uint8Array,
	) {}
}

export class PdfBytes {
	constructor(readonly bytes: Uint8Array) {}
}

export type PdfValue =
	| number
	| boolean
	| null
	| string
	| PdfName
	| PdfRef
	| PdfBytes
	| PdfValue[]
	| PdfDict;

export type PdfDict = { [key: string]: PdfValue | undefined };

export const name = (n: string): PdfName => new PdfName(n);

export function num(n: number): string {
	if (!Number.isFinite(n)) return "0";
	if (Math.abs(n) >= 1e15) return BigInt(Math.round(n)).toString();
	const fixed = (Math.round(n * 10000) / 10000).toFixed(4);
	const trimmed = fixed.replace(/\.?0+$/, "");
	return trimmed === "-0" ? "0" : trimmed;
}

// Bytes outside printable ASCII, and the delimiters, as #xx (ISO 32000 7.3.5).
export function pdfName(n: string): string {
	let out = "/";
	for (const b of new TextEncoder().encode(n))
		out +=
			b < 0x21 || b > 0x7e || "()<>[]{}/%#".includes(String.fromCharCode(b))
				? `#${b.toString(16).padStart(2, "0")}`
				: String.fromCharCode(b);
	return out;
}

const hex = (bytes: Uint8Array): string =>
	Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

// Printable ASCII stays literal; anything else is UTF-16BE with a BOM (ISO 32000 7.9.2.2).
function textString(s: string): string {
	if (/^[\x20-\x7e]*$/.test(s))
		return `(${s.replace(/[\\()]/g, (c) => `\\${c}`)})`;
	let out = "<FEFF";
	for (let i = 0; i < s.length; i++) {
		let unit = s.charCodeAt(i);
		if (unit >= 0xd800 && unit < 0xdc00) {
			const next = s.charCodeAt(i + 1);
			if (next >= 0xdc00 && next < 0xe000) {
				out += unit.toString(16).toUpperCase();
				unit = next;
				i++;
			} else unit = 0xfffd;
		} else if (unit >= 0xdc00 && unit < 0xe000) unit = 0xfffd;
		out += unit.toString(16).toUpperCase().padStart(4, "0");
	}
	return `${out}>`;
}

function serialize(v: PdfValue): string {
	if (typeof v === "number") return num(v);
	if (typeof v === "boolean") return v ? "true" : "false";
	if (v === null) return "null";
	if (typeof v === "string") return textString(v);
	if (v instanceof PdfBytes) return `<${hex(v.bytes)}>`;
	if (v instanceof PdfName) return pdfName(v.name);
	if (v instanceof PdfRef) return `${v.id} 0 R`;
	if (Array.isArray(v)) return `[${v.map(serialize).join(" ")}]`;
	const entries = Object.entries(v).filter(([, e]) => e !== undefined);
	return `<<${entries.map(([k, e]) => `/${k} ${serialize(e as PdfValue)}`).join(" ")}>>`;
}

const latin1 = (s: string): Uint8Array => {
	const out = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
	return out;
};

const join = (parts: Uint8Array[], length: number): Uint8Array => {
	const out = new Uint8Array(length);
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
};

export class PdfWriter {
	private objects: Array<PdfValue | PdfStream | undefined> = [];
	private pending: Promise<unknown>[] = [];

	reserve(): PdfRef {
		this.objects.push(undefined);
		return new PdfRef(this.objects.length);
	}

	set(ref: PdfRef, value: PdfValue | PdfStream): PdfRef {
		this.objects[ref.id - 1] = value;
		return ref;
	}

	add(value: PdfValue | PdfStream): PdfRef {
		return this.set(this.reserve(), value);
	}

	stream(dict: PdfDict, data: Uint8Array | string): PdfRef {
		return this.add(
			new PdfStream(dict, typeof data === "string" ? latin1(data) : data),
		);
	}

	// A stream compressed with FlateDecode, written once `settle` resolves.
	flate(dict: PdfDict, data: Uint8Array | string): PdfRef {
		const ref = this.reserve();
		const bytes = typeof data === "string" ? latin1(data) : data;
		this.pending.push(
			deflate(bytes).then((z) =>
				this.set(
					ref,
					new PdfStream({ ...dict, Filter: name("FlateDecode") }, z),
				),
			),
		);
		return ref;
	}

	async settle(): Promise<void> {
		await Promise.all(this.pending);
		this.pending = [];
	}

	save(root: PdfRef, info?: PdfRef): Uint8Array {
		const parts: Uint8Array[] = [];
		let length = 0;
		const push = (b: Uint8Array) => {
			parts.push(b);
			length += b.length;
		};
		push(latin1("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n"));
		const offsets: number[] = [];
		this.objects.forEach((obj, i) => {
			offsets.push(length);
			if (obj === undefined)
				throw new Error(`pdf object ${i + 1} was never set`);
			if (obj instanceof PdfStream) {
				const dict = { ...obj.dict, Length: obj.data.length };
				push(latin1(`${i + 1} 0 obj\n${serialize(dict)}\nstream\n`));
				push(obj.data);
				push(latin1("\nendstream\nendobj\n"));
			} else push(latin1(`${i + 1} 0 obj\n${serialize(obj)}\nendobj\n`));
		});
		const xref = length;
		const id = new PdfBytes(md5(join(parts, length)));
		const rows = offsets.map(
			(o) => `${String(o).padStart(10, "0")} 00000 n \n`,
		);
		push(
			latin1(
				`xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n${rows.join("")}` +
					`trailer\n${serialize({ Size: offsets.length + 1, Root: root, Info: info, ID: [id, id] })}\n` +
					`startxref\n${xref}\n%%EOF\n`,
			),
		);
		return join(parts, length);
	}
}
