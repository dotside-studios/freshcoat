import { describe, expect, it } from "vitest";
import { pngSize } from "~/lib/png";

/** A PNG header: signature, then an IHDR chunk carrying width and height. */
function header(width: number, height: number): Uint8Array {
	const bytes = new Uint8Array(24);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const view = new DataView(bytes.buffer);
	view.setUint32(8, 13); // IHDR length
	bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
	view.setUint32(16, width);
	view.setUint32(20, height);
	return bytes;
}

describe("pngSize", () => {
	it("reads dimensions off the IHDR chunk", () => {
		expect(pngSize(header(2526, 1337))).toEqual({
			width: 2526,
			height: 1337,
		});
	});

	it("reads the 1x1 Figma returns for a node that renders nothing", () => {
		expect(pngSize(header(1, 1))).toEqual({ width: 1, height: 1 });
	});

	it("returns null for bytes that are not a PNG", () => {
		expect(pngSize(new Uint8Array(40))).toBeNull();
	});

	it("returns null for a file truncated before the header", () => {
		expect(pngSize(header(10, 10).slice(0, 20))).toBeNull();
	});

	it("reads from a view that does not start at offset 0", () => {
		// Bytes handed over from a message payload are commonly a slice of a
		// bigger buffer; reading from byte 0 of the underlying buffer would
		// report someone else's numbers.
		const padded = new Uint8Array(64);
		padded.set(header(300, 200), 40);
		expect(pngSize(padded.subarray(40))).toEqual({ width: 300, height: 200 });
	});
});
