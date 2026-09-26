const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// signature (8) + IHDR length/type (8) + width (4) + height (4)
const HEADER_BYTES = 24;

/** Pixel dimensions of a PNG, read straight off its IHDR chunk — the first
 *  thing in the file, so nothing has to be decoded. Returns null for anything
 *  that isn't a PNG or is truncated before the header.
 *
 *  Used to tell an exported bitmap that has content from one that doesn't:
 *  Figma answers an export of a node that renders nothing with a 1×1
 *  transparent pixel rather than an error. */
export function pngSize(
	bytes: Uint8Array,
): { width: number; height: number } | null {
	if (bytes.length < HEADER_BYTES) return null;
	for (let i = 0; i < SIGNATURE.length; i++) {
		if (bytes[i] !== SIGNATURE[i]) return null;
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return { width: view.getUint32(16), height: view.getUint32(20) };
}
