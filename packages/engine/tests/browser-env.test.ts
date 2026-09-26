import { afterEach, describe, expect, test } from "vitest";
import { createBrowserEnv } from "../src/browser";

// The suite runs under `bun test` (see package.json), whose vitest shim provides
// `vi.fn` but neither `vi.stubGlobal` nor `vi.unstubAllGlobals`. Swapping the
// globals by hand behaves the same under either runner.
const real = { fetch: globalThis.fetch, document: globalThis.document };

function stub(name: "fetch" | "document", value: unknown) {
	(globalThis as unknown as Record<string, unknown>)[name] = value;
}

afterEach(() => {
	stub("fetch", real.fetch);
	stub("document", real.document);
});

describe("createBrowserEnv", () => {
	test("loadImageBytes fetches encoded bytes", async () => {
		stub("fetch", async () => ({
			ok: true,
			arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
		}));
		const rt = createBrowserEnv();
		expect(Array.from(await rt.loadImageBytes("https://x/y.png"))).toEqual([
			1, 2, 3,
		]);
	});

	test("canvas host createCanvas makes a DOM canvas element", () => {
		const el = { width: 0, height: 0, getContext: () => ({}) };
		stub("document", { createElement: () => el });
		const rt = createBrowserEnv();
		const c = rt.canvas!.createCanvas(3, 4);
		expect(c.width).toBe(3);
		expect(c.height).toBe(4);
	});

	test("createBrowserEnv({fonts}) resolves pre-supplied bytes", () => {
		const bytes = new Uint8Array([1, 2, 3]);
		const rt = createBrowserEnv({ fonts: new Map([["Roboto", [bytes]]]) });
		const res = rt.resolveFont("Roboto");
		expect(res.kind).toBe("bytes");
		expect(res.kind === "bytes" && res.bytes[0]).toBe(bytes);
	});

	test("createBrowserEnv({images}) serves pre-supplied image bytes without fetch", async () => {
		const bytes = new Uint8Array([9, 9]);
		const rt = createBrowserEnv({ images: new Map([["/x.png", bytes]]) });
		expect(await rt.loadImageBytes("/x.png")).toBe(bytes);
	});
});
