import { describe, expect, test, vi } from "vitest";
import { paintScene } from "../src/canvaskit";
import type { Command, PaintRuntime } from "../src/types";

const commands: Command[] = [
	{ op: "createCanvas", width: 4, height: 4 },
] as unknown as Command[];

function fakeCk(webglThrows: () => never) {
	const surf = {
		getCanvas: () => ({ clear: vi.fn() }),
		flush: vi.fn(),
		dispose: vi.fn(),
		makeImageSnapshot: () => ({
			encodeToBytes: () => new Uint8Array(),
			delete: vi.fn(),
		}),
	};
	const makeWebGL = vi.fn(webglThrows);
	const makeSW = vi.fn(() => surf);
	const makeSurface = vi.fn(() => surf);
	const ck = {
		TRANSPARENT: 0,
		TypefaceFontProvider: {
			Make: () => ({ registerFont: vi.fn(), delete: vi.fn() }),
		},
		MakeWebGLCanvasSurface: makeWebGL,
		MakeSWCanvasSurface: makeSW,
		MakeSurface: makeSurface,
	};
	return { ck, makeWebGL, makeSW, makeSurface };
}

function fakeRt(gl: unknown) {
	const loseContext = vi.fn();
	const getContext = vi.fn((type: string) =>
		type === "webgl2" && gl
			? {
					getExtension: (name: string) =>
						name === "WEBGL_lose_context" ? { loseContext } : null,
				}
			: null,
	);
	const el = { width: 4, height: 4, getContext };
	const rt = {
		canvas: {
			createCanvas: () => el,
			decodeImage: async () => ({}),
			encode: () => new Uint8Array(),
		},
		resolveFont: () => ({ kind: "none" }),
		loadImageBytes: async () => new Uint8Array(),
		paint: async () => ({}),
	} as unknown as PaintRuntime;
	return { rt, el, loseContext };
}

describe("makeSurface falls back to SW when MakeWebGLCanvasSurface throws", () => {
	test("WebGL context creation throws", async () => {
		const { ck, makeWebGL, makeSW, makeSurface } = fakeCk(() => {
			throw "failed to create webgl context: err 0";
		});
		const { rt, el, loseContext } = fakeRt(false);

		const out = await paintScene(ck, commands, rt);

		expect(makeWebGL).toHaveBeenCalledWith(el);
		expect(makeSW).toHaveBeenCalledWith(el);
		expect(makeSurface).not.toHaveBeenCalled();
		expect(out.canvas).toBe(el);
		expect(loseContext).not.toHaveBeenCalled();
	});

	test("WebGL context created, then the DOM node swap throws", async () => {
		const { ck, makeWebGL, makeSW, makeSurface } = fakeCk(() => {
			throw new TypeError("D.cloneNode is not a function");
		});
		const { rt, el, loseContext } = fakeRt(true);

		const out = await paintScene(ck, commands, rt);

		expect(makeWebGL).toHaveBeenCalledWith(el);
		expect(loseContext).toHaveBeenCalledTimes(1);
		expect(makeSW).toHaveBeenCalledWith(el);
		expect(makeSurface).not.toHaveBeenCalled();
		expect(out.canvas).toBe(el);

		out.dispose();
		expect(loseContext).toHaveBeenCalledTimes(1);
	});
});
