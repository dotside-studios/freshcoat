import { describe, expect, test, vi } from "vitest";
import { paintScene } from "../src/canvaskit";
import type { PaintRuntime } from "../src/runtime-types";
import type { Command } from "../src/types";

// A single empty scene — enough to drive makeSurface + the dispose closure without
// needing the full drawing API on the fake CanvasKit.
const commands: Command[] = [
	{ op: "createCanvas", width: 4, height: 4 },
] as unknown as Command[];

// A fake CanvasKit whose surface factories are individually controllable so we can
// assert the dispose() closure only loses a context on the WebGL-backed path.
function fakeCk(surface: { dispose: () => void; flush?: () => void }): {
	ck: unknown;
	getWebGL: ReturnType<typeof vi.fn>;
	makeSW: ReturnType<typeof vi.fn>;
	deleteContext: ReturnType<typeof vi.fn>;
	grDelete: ReturnType<typeof vi.fn>;
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
	const getWebGL = vi.fn(() => 1);
	const grDelete = vi.fn();
	const deleteContext = vi.fn();
	const makeSW = vi.fn(() => surf);
	const ck = {
		TRANSPARENT: 0,
		TypefaceFontProvider: {
			Make: () => ({ registerFont: vi.fn(), delete: vi.fn() }),
		},
		GetWebGLContext: getWebGL,
		MakeWebGLContext: () => ({ delete: grDelete }),
		MakeOnScreenGLSurface: () => surf,
		deleteContext,
		MakeSWCanvasSurface: makeSW,
		MakeSurface: vi.fn(() => surf),
	};
	return { ck, getWebGL, makeSW, deleteContext, grDelete };
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
		const { ck, deleteContext, grDelete } = fakeCk({ dispose: disposeSurface });
		const { rt } = fakeRt(loseContext);

		const out = await paintScene(ck, commands, rt);
		// Nothing is released until the caller disposes.
		expect(disposeSurface).not.toHaveBeenCalled();
		expect(grDelete).not.toHaveBeenCalled();
		expect(deleteContext).not.toHaveBeenCalled();
		expect(loseContext).not.toHaveBeenCalled();

		out.dispose();
		expect(disposeSurface).toHaveBeenCalledTimes(1);
		expect(grDelete).toHaveBeenCalledTimes(1);
		expect(deleteContext).toHaveBeenCalledWith(1);
		expect(loseContext).toHaveBeenCalledTimes(1);
	});

	test("SW-backed surface (WebGL unavailable): dispose() does not touch a GL context", async () => {
		const disposeSurface = vi.fn();
		const loseContext = vi.fn();
		const { ck, getWebGL } = fakeCk({ dispose: disposeSurface });
		getWebGL.mockReturnValue(0); // WebGL binding fails -> SW fallback
		const { rt } = fakeRt(loseContext);

		const out = await paintScene(ck, commands, rt);
		out.dispose();
		expect(disposeSurface).toHaveBeenCalledTimes(1);
		expect(loseContext).not.toHaveBeenCalled();
	});
});

describe("paintScene frees what it made when the paint throws", () => {
	test("the uncached surface, provider and images are freed", async () => {
		const disposeSurface = vi.fn();
		const { ck } = fakeCk({
			dispose: disposeSurface,
			flush: () => {
				throw new Error("flush failed");
			},
		});
		const providerDelete = vi.fn();
		(ck as { TypefaceFontProvider: { Make: unknown } }).TypefaceFontProvider.Make =
			() => ({ registerFont: vi.fn(), delete: providerDelete });
		const imageDelete = vi.fn();
		(ck as { MakeImageFromEncoded: unknown }).MakeImageFromEncoded = () => ({
			delete: imageDelete,
		});
		const rt = {
			resolveFont: () => ({ kind: "none" }),
			loadBytes: async () => new Uint8Array(),
		} as unknown as PaintRuntime;
		const scene = [
			...commands,
			{ op: "loadImages", srcs: ["a.png"] },
		] as unknown as Command[];

		await expect(paintScene(ck, scene, rt)).rejects.toThrow("flush failed");
		expect(disposeSurface).toHaveBeenCalledTimes(1);
		expect(providerDelete).toHaveBeenCalledTimes(1);
		expect(imageDelete).toHaveBeenCalledTimes(1);
	});

	test("a scene without createCanvas loads nothing", async () => {
		const { ck } = fakeCk({ dispose: vi.fn() });
		const loadBytes = vi.fn(async () => new Uint8Array());
		const resolveFont = vi.fn(() => ({ kind: "none" }));
		const rt = { resolveFont, loadBytes } as unknown as PaintRuntime;
		const scene = [
			{ op: "loadImages", srcs: ["a.png"] },
			{ op: "loadFonts", requests: [{ family: "X" }] },
		] as unknown as Command[];

		await expect(paintScene(ck, scene, rt)).rejects.toThrow("createCanvas");
		expect(loadBytes).not.toHaveBeenCalled();
		expect(resolveFont).not.toHaveBeenCalled();
	});
});
