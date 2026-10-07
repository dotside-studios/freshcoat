import { describe, expect, test, vi } from "vitest";
import { paintScene } from "../src/canvaskit";
import type { PaintRuntime } from "../src/runtime-types";
import type { Command } from "../src/types";

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
	const created: unknown[] = [];
	const createCanvas = vi.fn(() => {
		const el = { width: 4, height: 4, getContext };
		created.push(el);
		return el;
	});
	const rt = {
		canvas: {
			createCanvas,
			decodeImage: async () => ({}),
			encode: () => new Uint8Array(),
		},
		resolveFont: () => ({ kind: "none" }),
		loadImageBytes: async () => new Uint8Array(),
		paint: async () => ({}),
	} as unknown as PaintRuntime;
	return { rt, created, loseContext };
}

describe("makeSurface falls back to SW when MakeWebGLCanvasSurface throws", () => {
	test("WebGL context creation throws", async () => {
		const { ck, makeWebGL, makeSW, makeSurface } = fakeCk(() => {
			throw "failed to create webgl context: err 0";
		});
		const { rt, created, loseContext } = fakeRt(false);

		const out = await paintScene(ck, commands, rt);

		expect(created).toHaveLength(2);
		expect(makeWebGL).toHaveBeenCalledWith(created[0]);
		expect(makeSW).toHaveBeenCalledWith(created[1]);
		expect(makeSurface).not.toHaveBeenCalled();
		expect(out.canvas).toBe(created[1]);
		expect(loseContext).not.toHaveBeenCalled();
	});

	test("WebGL context created, then the DOM node swap throws", async () => {
		const { ck, makeWebGL, makeSW, makeSurface } = fakeCk(() => {
			throw new TypeError("D.cloneNode is not a function");
		});
		const { rt, created, loseContext } = fakeRt(true);

		const out = await paintScene(ck, commands, rt);

		expect(created).toHaveLength(2);
		expect(makeWebGL).toHaveBeenCalledWith(created[0]);
		expect(loseContext).toHaveBeenCalledTimes(1);
		expect(makeSW).toHaveBeenCalledWith(created[1]);
		expect(makeSurface).not.toHaveBeenCalled();
		expect(out.canvas).toBe(created[1]);

		out.dispose();
		expect(loseContext).toHaveBeenCalledTimes(1);
	});
});
