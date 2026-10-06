import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { createHandler } from "./server";

let dist: string;
let handle: (req: Request) => Promise<Response>;

function get(path: string, acceptEncoding?: string) {
	return handle(
		new Request(`http://localhost${path}`, {
			headers: acceptEncoding ? { "accept-encoding": acceptEncoding } : {},
		}),
	);
}

beforeAll(() => {
	dist = mkdtempSync(join(tmpdir(), "freshcoat-server-"));
	mkdirSync(join(dist, "assets"));
	mkdirSync(join(dist, "canvaskit/0.41.1"), { recursive: true });
	writeFileSync(join(dist, "index.html"), "<!doctype html>");
	writeFileSync(join(dist, "index.html.gz"), gzipSync("<!doctype html>"));
	writeFileSync(join(dist, "assets/index-AbCd1234.js"), "export {};");
	const wasm = join(dist, "canvaskit/0.41.1/canvaskit.wasm");
	writeFileSync(wasm, "wasm");
	writeFileSync(`${wasm}.br`, "br");
	writeFileSync(`${wasm}.gz`, "gz");
	handle = createHandler(dist);
});

afterAll(() => rmSync(dist, { recursive: true, force: true }));

describe("encoding negotiation", () => {
	it("prefers brotli and keeps the original content type", async () => {
		const res = await get("/canvaskit/0.41.1/canvaskit.wasm", "gzip, br");
		expect(res.headers.get("content-encoding")).toBe("br");
		expect(res.headers.get("content-type")).toBe("application/wasm");
		expect(res.headers.get("vary")).toBe("Accept-Encoding");
		expect(await res.text()).toBe("br");
	});

	it("falls back to gzip", async () => {
		const res = await get("/canvaskit/0.41.1/canvaskit.wasm", "gzip");
		expect(res.headers.get("content-encoding")).toBe("gzip");
		expect(await res.text()).toBe("gz");
	});

	it("skips encodings refused with q=0", async () => {
		const res = await get("/canvaskit/0.41.1/canvaskit.wasm", "br;q=0, gzip");
		expect(res.headers.get("content-encoding")).toBe("gzip");
	});

	it("serves the identity file without Accept-Encoding", async () => {
		const res = await get("/canvaskit/0.41.1/canvaskit.wasm");
		expect(res.headers.get("content-encoding")).toBeNull();
		expect(res.headers.get("vary")).toBe("Accept-Encoding");
		expect(await res.text()).toBe("wasm");
	});

	it("serves the identity file when no variant exists", async () => {
		const res = await get("/assets/index-AbCd1234.js", "br, gzip");
		expect(res.headers.get("content-encoding")).toBeNull();
		expect(await res.text()).toBe("export {};");
	});
});

describe("cache headers", () => {
	it("pins fingerprinted assets and versioned CanvasKit", async () => {
		for (const path of [
			"/assets/index-AbCd1234.js",
			"/canvaskit/0.41.1/canvaskit.wasm",
		])
			expect((await get(path)).headers.get("cache-control")).toBe(
				"public, max-age=31536000, immutable",
			);
	});

	it("revalidates index.html", async () => {
		const res = await get("/index.html");
		expect(res.headers.get("cache-control")).toBe("no-cache");
	});
});

describe("SPA fallback", () => {
	it("serves index.html, compressed when accepted", async () => {
		const res = await get("/w/some-workspace", "gzip");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
		expect(res.headers.get("content-encoding")).toBe("gzip");
		expect(res.headers.get("cache-control")).toBe("no-cache");
	});

	it("does not serve files outside dist", async () => {
		const res = await get("/%2e%2e/etc/passwd");
		expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
	});
});
