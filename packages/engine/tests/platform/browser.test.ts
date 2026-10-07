import { afterEach, describe, expect, test } from "bun:test";
import { loadCanvasKit } from "../../src/platform/browser";

type Globals = Record<string, unknown>;
const globals = globalThis as unknown as Globals;
const real = { fetch: globalThis.fetch, document: globals.document };

afterEach(() => {
	globalThis.fetch = real.fetch;
	globals.document = real.document;
	delete globals.CanvasKitInit;
});

describe("browser loader in a worker", () => {
	test("evaluates canvaskit.js and inits it against the wasm beside it", async () => {
		const fetched: string[] = [];
		globalThis.fetch = (async (url: string) => {
			fetched.push(url);
			return new Response(
				"globalThis.CanvasKitInit = async (o) => ({ wasm: o.locateFile('canvaskit.wasm') })",
			);
		}) as unknown as typeof fetch;
		const ck = await loadCanvasKit("/ck/worker/");
		expect(fetched).toEqual(["/ck/worker/canvaskit.js"]);
		expect(ck).toEqual({ wasm: "/ck/worker/canvaskit.wasm" } as never);
		expect(await loadCanvasKit("/ck/worker")).toBe(ck);
		expect(fetched).toHaveLength(1);
	});

	test("retries a base whose script failed to load", async () => {
		let status = 404;
		globalThis.fetch = (async () =>
			new Response("globalThis.CanvasKitInit = async () => ({ ok: true })", {
				status,
			})) as unknown as typeof fetch;
		await expect(loadCanvasKit("/retry")).rejects.toThrow(/404/);
		status = 200;
		expect(await loadCanvasKit("/retry")).toEqual({ ok: true } as never);
	});
});

describe("browser loader on a page", () => {
	test("adds a script tag and inits from the global it defines", async () => {
		const added: { src: string }[] = [];
		const located: string[] = [];
		globals.document = {
			createElement: () => ({}),
			head: {
				appendChild(script: { src: string; onload(): void }) {
					added.push(script);
					globals.CanvasKitInit = async (o: {
						locateFile(f: string): string;
					}) => {
						located.push(o.locateFile("canvaskit.wasm"));
						return { page: true };
					};
					script.onload();
				},
			},
		};
		expect(await loadCanvasKit("/ck/page")).toEqual({ page: true } as never);
		expect(added.map((s) => s.src)).toEqual(["/ck/page/canvaskit.js"]);
		expect(located).toEqual(["/ck/page/canvaskit.wasm"]);
	});

	test("rejects when the script does not define CanvasKitInit", async () => {
		globals.document = {
			createElement: () => ({}),
			head: { appendChild: (s: { onload(): void }) => s.onload() },
		};
		await expect(loadCanvasKit("/ck/empty")).rejects.toThrow(
			/did not define CanvasKitInit/,
		);
	});
});
