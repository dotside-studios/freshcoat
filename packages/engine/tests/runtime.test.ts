import { describe, expect, test } from "vitest";
import { applyDisposePolicy } from "../src/runtime";
import type { CanvasLike, PaintOutput } from "../src/types";

const fakeCanvas = (): CanvasLike => ({
	width: 2,
	height: 2,
	getContext: () => null,
});

function fakeOutput(spy: { encoded: number; disposed: number }): PaintOutput {
	return {
		canvas: fakeCanvas(),
		warnings: [],
		encode: async () => {
			spy.encoded++;
			return { bytes: new Uint8Array([1, 2, 3]), format: "png" as const };
		},
		dispose: () => {
			spy.disposed++;
		},
	};
}

describe("applyDisposePolicy", () => {
	test("encode policy encodes + disposes, returns the bytes and their format", async () => {
		const spy = { encoded: 0, disposed: 0 };
		const r = await applyDisposePolicy(fakeOutput(spy), "encode");
		expect(spy.encoded).toBe(1);
		expect(spy.disposed).toBe(1);
		expect("bytes" in r && r.bytes).toEqual(new Uint8Array([1, 2, 3]));
		// The encoder says what it produced; nothing echoes the request back.
		expect("format" in r && r.format).toBe("png");
		expect("canvas" in r).toBe(false);
	});

	test("keep policy returns live canvas, does not encode/dispose", async () => {
		const spy = { encoded: 0, disposed: 0 };
		const r = await applyDisposePolicy(fakeOutput(spy), "keep");
		expect(spy.encoded).toBe(0);
		expect(spy.disposed).toBe(0);
		expect("canvas" in r && r.canvas.width).toBe(2);
		expect(typeof (r as { dispose: unknown }).dispose).toBe("function");
	});
});
