import { describe, expect, test, vi } from "vitest";
import { paintScene } from "../src/canvaskit";
import type { Command, PaintRuntime } from "../src/types";

// A single empty scene — enough to drive makeSurface + the dispose closure without
// needing the full drawing API on the fake CanvasKit.
const commands: Command[] = [
	{ op: "createCanvas", width: 4, height: 4 },
] as unknown as Command[];

// A fake CanvasKit whose surface factories are individually controllable so we can
// assert the dispose() closure only loses a context on the WebGL-backed path.
function fakeCk(surface: { dispose: () => void }): {
	ck: unknown;
	makeWebGL: ReturnType<typeof vi.fn>;
	makeSW: ReturnType<typeof vi.fn>;
} {
	const skCanvas = { clear: vi.fn() };
	const surf = {
		getCanvas: () => skCanvas,
		flush: vi.fn(),
		makeImageSnapshot: () => ({
			encodeToBytes: () => new Uint8Array(),
			delete: vi.fn(),
		}),
		...surface,
	};
	const makeWebGL = vi.fn(() => surf);
	const makeSW = vi.fn(() => surf);
	const ck = {
		TRANSPARENT: 0,
		TypefaceFontProvider: {
			Make: () => ({ registerFont: vi.fn(), delete: vi.fn() }),
		},
		MakeWebGLCanvasSurface: makeWebGL,
		MakeSWCanvasSurface: makeSW,
		MakeSurface: vi.fn(() => surf),
	};
	return { ck, makeWebGL, makeSW };
}

// An rt whose canvas element records the WEBGL_lose_context call so we can prove the
// context is dropped exactly once, on dispose — not before.
function fakeRt(loseContext: () => void): {
	rt: PaintRuntime;
	getContext: ReturnType<typeof vi.fn>;
} {
	const gl = {
		getExtension: (name: string) =>
			name === "WEBGL_lose_context" ? { loseContext } : null,
	};
	const getContext = vi.fn((type: string) => (type === "webgl2" ? gl : null));
	const el = { width: 0, height: 0, getContext };
	const rt = {
		canvas: {
			createCanvas: () => el,
		},
		resolveFont: () => ({ kind: "none" }),
		loadBytes: async () => new Uint8Array(),
		paint: async () => ({}),
	} as unknown as PaintRuntime;
	return { rt, getContext };
}

describe("paintScene dispose() releases the WebGL context", () => {
	test("WebGL-backed surface: dispose() frees the surface AND loses the GL context", async () => {
		const disposeSurface = vi.fn();
		const loseContext = vi.fn();
		const { ck } = fakeCk({ dispose: disposeSurface });
		const { rt } = fakeRt(loseContext);

		const out = await paintScene(ck, commands, rt);
		// Nothing is released until the caller disposes.
		expect(disposeSurface).not.toHaveBeenCalled();
		expect(loseContext).not.toHaveBeenCalled();

		out.dispose();
		expect(disposeSurface).toHaveBeenCalledTimes(1);
		expect(loseContext).toHaveBeenCalledTimes(1);
	});

	test("SW-backed surface (WebGL unavailable): dispose() does not touch a GL context", async () => {
		const disposeSurface = vi.fn();
		const loseContext = vi.fn();
		const { ck, makeWebGL } = fakeCk({ dispose: disposeSurface });
		makeWebGL.mockReturnValue(null); // WebGL binding fails -> SW fallback
		const { rt } = fakeRt(loseContext);

		const out = await paintScene(ck, commands, rt);
		out.dispose();
		expect(disposeSurface).toHaveBeenCalledTimes(1);
		expect(loseContext).not.toHaveBeenCalled();
	});
});
