const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) =>
	Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32),
);

export function md5(data: Uint8Array): Uint8Array {
	const padded = new Uint8Array((((data.length + 8) >> 6) << 6) + 64);
	padded.set(data);
	padded[data.length] = 0x80;
	const view = new DataView(padded.buffer);
	view.setUint32(padded.length - 8, (data.length << 3) >>> 0, true);
	view.setUint32(padded.length - 4, Math.floor(data.length / 2 ** 29), true);
	let a0 = 0x67452301;
	let b0 = 0xefcdab89;
	let c0 = 0x98badcfe;
	let d0 = 0x10325476;
	const m = new Uint32Array(16);
	for (let off = 0; off < padded.length; off += 64) {
		for (let i = 0; i < 16; i++) m[i] = view.getUint32(off + i * 4, true);
		let a = a0;
		let b = b0;
		let c = c0;
		let d = d0;
		for (let i = 0; i < 64; i++) {
			let f: number;
			let g: number;
			if (i < 16) {
				f = (b & c) | (~b & d);
				g = i;
			} else if (i < 32) {
				f = (d & b) | (~d & c);
				g = (5 * i + 1) & 15;
			} else if (i < 48) {
				f = b ^ c ^ d;
				g = (3 * i + 5) & 15;
			} else {
				f = c ^ (b | ~d);
				g = (7 * i) & 15;
			}
			f = (f + a + K[i] + m[g]) | 0;
			a = d;
			d = c;
			c = b;
			const s = S[((i >> 4) << 2) | (i & 3)];
			b = (b + ((f << s) | (f >>> (32 - s)))) | 0;
		}
		a0 = (a0 + a) | 0;
		b0 = (b0 + b) | 0;
		c0 = (c0 + c) | 0;
		d0 = (d0 + d) | 0;
	}
	const out = new Uint8Array(16);
	const ov = new DataView(out.buffer);
	[a0, b0, c0, d0].forEach((w, i) => {
		ov.setUint32(i * 4, w >>> 0, true);
	});
	return out;
}
