export type ZipDirectory = { entries: number; uncompressedBytes: number };

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const EOCD_SIZE = 22;
const MAX_COMMENT = 0xffff;
const SATURATED_16 = 0xffff;
const SATURATED_32 = 0xffffffff;

/**
 * What a zip's central directory declares: its entry count and the sum of its
 * entries' uncompressed sizes, read without inflating anything. A field that
 * is saturated, meaning the real value sits in a zip64 record, counts as its
 * saturated value, a lower bound that is already past any sensible cap.
 * Returns null when the bytes have no readable directory.
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
	const entries = view.getUint16(eocd + 10, true);
	const directorySize = view.getUint32(eocd + 12, true);
	const directoryStart = view.getUint32(eocd + 16, true);
	if (entries === SATURATED_16 || directorySize === SATURATED_32) {
		return { entries: SATURATED_16, uncompressedBytes: SATURATED_32 };
	}
	let uncompressedBytes = 0;
	let at = directoryStart;
	const end = Math.min(directoryStart + directorySize, bytes.length);
	for (let i = 0; i < entries; i++) {
		if (at + 46 > end || view.getUint32(at, true) !== CENTRAL) return null;
		uncompressedBytes += view.getUint32(at + 24, true);
		at +=
			46 +
			view.getUint16(at + 28, true) +
			view.getUint16(at + 30, true) +
			view.getUint16(at + 32, true);
	}
	return { entries, uncompressedBytes };
}
