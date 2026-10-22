export type ZipDirectory = { entries: number; uncompressedBytes: number };

const EOCD = 0x06054b50;
const ZIP64_EOCD = 0x06064b50;
const ZIP64_LOCATOR = 0x07064b50;
const CENTRAL = 0x02014b50;
const EOCD_SIZE = 22;
const MAX_COMMENT = 0xffff;
const SATURATED_16 = 0xffff;
const SATURATED_32 = 0xffffffff;

function uint64(view: DataView, at: number): number | null {
	if (at < 0 || at + 8 > view.byteLength) return null;
	const value = view.getBigUint64(at, true);
	return value > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(value);
}

/**
 * What a zip's central directory declares: its entry count and the sum of its
 * entries' uncompressed sizes, read without inflating anything. The directory
 * is found the way hucre finds it, from the end record's entry count and
 * offset, or the zip64 record's when those are saturated; the declared
 * directory size is ignored, as hucre ignores it. An entry size that is
 * saturated counts as its saturated value, a lower bound that is already past
 * any sensible cap. Returns null when the bytes have no readable directory.
 */
export function readZipDirectory(bytes: Uint8Array): ZipDirectory | null {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const lowest = Math.max(0, bytes.length - EOCD_SIZE - MAX_COMMENT);
	let eocd = -1;
	for (let at = bytes.length - EOCD_SIZE; at >= lowest; at--) {
		if (view.getUint32(at, true) === EOCD) {
			eocd = at;
			break;
		}
	}
	if (eocd === -1) return null;
	let entries: number | null = view.getUint16(eocd + 10, true);
	let start: number | null = view.getUint32(eocd + 16, true);
	if (
		entries === SATURATED_16 ||
		start === SATURATED_32 ||
		view.getUint32(eocd + 12, true) === SATURATED_32
	) {
		const locator = eocd - 20;
		if (locator < 0 || view.getUint32(locator, true) !== ZIP64_LOCATOR) {
			return null;
		}
		const record = uint64(view, locator + 8);
		if (
			record === null ||
			record + 56 > bytes.length ||
			view.getUint32(record, true) !== ZIP64_EOCD
		) {
			return null;
		}
		entries = uint64(view, record + 32);
		start = uint64(view, record + 48);
		if (entries === null || start === null) return null;
	}
	let uncompressedBytes = 0;
	let at = start;
	for (let i = 0; i < entries; i++) {
		if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL) {
			return null;
		}
		uncompressedBytes += view.getUint32(at + 24, true);
		at +=
			46 +
			view.getUint16(at + 28, true) +
			view.getUint16(at + 30, true) +
			view.getUint16(at + 32, true);
	}
	return { entries, uncompressedBytes };
}
