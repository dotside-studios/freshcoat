import { describe, expect, test, vi } from "vitest";
import { paintScene } from "../src/canvaskit";
import type { PaintRuntime } from "../src/runtime-types";
import type { Command } from "../src/types";

const commands: Command[] = [
	{ op: "createCanvas", width: 4, height: 4 },
] as unknown as Command[];

type FakeEl = {
	width: number;
	height: number;
	bound: string | null;
	getContext: (type: string) => unknown;
};

function fakeRt() {
	const loseContext = vi.fn();
	const spawned: string[] = [];
	const created: FakeEl[] = [];
	const createCanvas = vi.fn(() => {
		const el: FakeEl = {
			width: 4,
			height: 4,
			bound: null,
			getContext: (type: string) => {
				if (el.bound === null) {
					spawned.push(type);
					el.bound = type;
				}
				return el.bound === type
					? {
							getExtension: (name: string) =>
								name === "WEBGL_lose_context" ? { loseContext } : null,
						}
					: null;
			},
		};
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
	return { rt, created, loseContext, spawned };
}

type GLSteps = {
	bind?: string | null;
	throwOnBind?: unknown;
	grCtx?: boolean;
	surface?: "null" | "throw";
};

function fakeCk(steps: GLSteps) {
	const surf = {
		getCanvas: () => ({ clear: vi.fn() }),
		flush: vi.fn(),
		dispose: vi.fn(),
		makeImageSnapshot: () => ({
			encodeToBytes: () => new Uint8Array(),
			delete: vi.fn(),
		}),
	};
	const grDelete = vi.fn();
	const getWebGL = vi.fn((el: FakeEl) => {
		if (steps.throwOnBind) throw steps.throwOnBind;
		if (!steps.bind) return 0;
		el.bound = steps.bind;
		return 7;
	});
	const makeGr = vi.fn(() =>
		steps.grCtx === false ? null : { delete: grDelete },
	);
	const makeOnScreen = vi.fn(() => {
		if (steps.surface === "throw") throw new Error("surface failed");
		return steps.surface === "null" ? null : surf;
	});
	const deleteContext = vi.fn();
	const makeWebGLCanvas = vi.fn();
	const makeSW = vi.fn(() => surf);
	const makeSurface = vi.fn(() => surf);
	const ck = {
		TRANSPARENT: 0,
		TypefaceFontProvider: {
			Make: () => ({ registerFont: vi.fn(), delete: vi.fn() }),
		},
		GetWebGLContext: getWebGL,
		MakeWebGLContext: makeGr,
		MakeOnScreenGLSurface: makeOnScreen,
		deleteContext,
		MakeWebGLCanvasSurface: makeWebGLCanvas,
		MakeSWCanvasSurface: makeSW,
		MakeSurface: makeSurface,
	};
	return {
		ck,
		getWebGL,
		makeOnScreen,
		deleteContext,
		grDelete,
		makeWebGLCanvas,
		makeSW,
		makeSurface,
	};
}

describe("makeSurface falls back to SW when WebGL setup fails", () => {
	test("WebGL context creation throws", async () => {
		const f = fakeCk({ throwOnBind: "failed to create webgl context" });
		const { rt, created, loseContext, spawned } = fakeRt();

		const out = await paintScene(f.ck, commands, rt);

		expect(created).toHaveLength(2);
		expect(f.getWebGL).toHaveBeenCalledWith(created[0]);
		expect(f.makeSW).toHaveBeenCalledWith(created[1]);
		expect(f.makeSurface).not.toHaveBeenCalled();
		expect(out.canvas).toBe(created[1]);
		expect(f.deleteContext).not.toHaveBeenCalled();
		expect(loseContext).not.toHaveBeenCalled();
		expect(spawned).toEqual([]);
	});

	test("WebGL context creation returns no handle", async () => {
		const f = fakeCk({ bind: null });
		const { rt, created, loseContext, spawned } = fakeRt();

		const out = await paintScene(f.ck, commands, rt);

		expect(out.canvas).toBe(created[1]);
		expect(f.deleteContext).not.toHaveBeenCalled();
		expect(loseContext).not.toHaveBeenCalled();
		expect(spawned).toEqual([]);
	});

	test.each([
		["webgl2", "null"],
		["webgl", "null"],
		["webgl2", "throw"],
	] as const)(
		"%s context bound, then MakeOnScreenGLSurface fails (%s)",
		async (bind, surface) => {
			const f = fakeCk({ bind, surface });
			const { rt, created, loseContext, spawned } = fakeRt();

			const out = await paintScene(f.ck, commands, rt);

			expect(f.makeOnScreen).toHaveBeenCalledTimes(1);
			expect(f.grDelete).toHaveBeenCalledTimes(1);
			expect(f.deleteContext).toHaveBeenCalledWith(7);
			expect(f.grDelete.mock.invocationCallOrder[0]).toBeLessThan(
				f.deleteContext.mock.invocationCallOrder[0] ?? 0,
			);
			expect(loseContext).toHaveBeenCalledTimes(1);
			expect(spawned).toEqual([]);
			expect(f.makeWebGLCanvas).not.toHaveBeenCalled();
			expect(f.makeSW).toHaveBeenCalledWith(created[1]);
			expect(f.makeSurface).not.toHaveBeenCalled();
			expect(out.canvas).toBe(created[1]);

			out.dispose();
			expect(f.deleteContext).toHaveBeenCalledTimes(1);
			expect(loseContext).toHaveBeenCalledTimes(1);
		},
	);

	test("context bound, then MakeWebGLContext returns null", async () => {
		const f = fakeCk({ bind: "webgl2", grCtx: false });
		const { rt, created, loseContext, spawned } = fakeRt();

		const out = await paintScene(f.ck, commands, rt);

		expect(f.makeOnScreen).not.toHaveBeenCalled();
		expect(f.deleteContext).toHaveBeenCalledWith(7);
		expect(loseContext).toHaveBeenCalledTimes(1);
		expect(spawned).toEqual([]);
		expect(out.canvas).toBe(created[1]);
	});
});
