export type Tables = Map<string, Uint8Array>;

function table(tables: Tables, tag: string): Uint8Array {
	const bytes = tables.get(tag);
	if (!bytes) throw new Error(`no ${tag}`);
	return bytes;
}

function checksum(b: Uint8Array): number {
	const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
	let sum = 0;
	const whole = b.length & ~3;
	for (let o = 0; o < whole; o += 4) sum = (sum + dv.getUint32(o)) >>> 0;
	for (let i = whole; i < b.length; i++)
		sum = (sum + ((b[i] ?? 0) << (24 - 8 * (i - whole)))) >>> 0;
	return sum;
}

// The sfnt of `tables`, with the directory, table padding, checksums and the
// head checksum adjustment a font file needs.
export function assemble(version: string, tables: Tables): Uint8Array {
	const tags = [...tables.keys()].sort();
	const head = table(tables, "head").slice();
	new DataView(head.buffer).setUint32(8, 0);
	tables.set("head", head);
	let size = 12 + 16 * tags.length;
	const starts = tags.map((tag) => {
		const at = size;
		size += (table(tables, tag).length + 3) & ~3;
		return at;
	});
	const out = new Uint8Array(size);
	const dv = new DataView(out.buffer);
	for (let i = 0; i < 4; i++) out[i] = version.charCodeAt(i);
	const entry = Math.floor(Math.log2(tags.length));
	dv.setUint16(4, tags.length);
	dv.setUint16(6, 16 << entry);
	dv.setUint16(8, entry);
	dv.setUint16(10, 16 * tags.length - (16 << entry));
	tags.forEach((tag, i) => {
		const bytes = table(tables, tag);
		const o = 12 + 16 * i;
		for (let k = 0; k < 4; k++) out[o + k] = tag.charCodeAt(k);
		dv.setUint32(o + 4, checksum(bytes));
		dv.setUint32(o + 8, starts[i] as number);
		dv.setUint32(o + 12, bytes.length);
		out.set(bytes, starts[i]);
	});
	const at = starts[tags.indexOf("head")] as number;
	dv.setUint32(at + 8, (0xb1b0afba - checksum(out)) >>> 0);
	return out;
}
