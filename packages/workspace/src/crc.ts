// Slicing-by-8: table k holds the CRC of a byte followed by k zero bytes, so
// eight bytes fold in with eight lookups and no per-byte shift chain.
const CRC_TABLE = (() => {
	const table = new Int32Array(256 * 8);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c;
	}
	for (let n = 0; n < 256; n++)
		for (let t = 1; t < 8; t++) {
			const prev = table[(t - 1) * 256 + n] as number;
			table[t * 256 + n] = (table[prev & 0xff] as number) ^ (prev >>> 8);
		}
	return table;
})();

export function crcUpdate(crc: number, bytes: Uint8Array): number {
	const t = CRC_TABLE;
	const b = bytes;
	let c = crc;
	let i = 0;
	for (const n = b.length - 8; i <= n; i += 8) {
		const lo =
			c ^
			((b[i] as number) |
				((b[i + 1] as number) << 8) |
				((b[i + 2] as number) << 16) |
				((b[i + 3] as number) << 24));
		c =
			(t[1792 + (lo & 0xff)] as number) ^
			(t[1536 + ((lo >>> 8) & 0xff)] as number) ^
			(t[1280 + ((lo >>> 16) & 0xff)] as number) ^
			(t[1024 + (lo >>> 24)] as number) ^
			(t[768 + (b[i + 4] as number)] as number) ^
			(t[512 + (b[i + 5] as number)] as number) ^
			(t[256 + (b[i + 6] as number)] as number) ^
			(t[b[i + 7] as number] as number);
	}
	for (; i < b.length; i++)
		c = (t[(c ^ (b[i] as number)) & 0xff] as number) ^ (c >>> 8);
	return c;
}

export function crc32(bytes: Uint8Array): number {
	return (crcUpdate(-1, bytes) ^ -1) >>> 0;
}
