import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { gzipSync } from "node:zlib";
import { createHandler, resolveAsset } from "./server";

const INDEX =
	'<!doctype html><script>window.theme = 1;</script><script src="/a.js"></script>';

let dist: string;
let handle: (req: Request) => Promise<Response>;

function get(path: string, acceptEncoding?: string, method = "GET") {
	return handle(
		new Request(`http://localhost${path}`, {
			method,
			headers: acceptEncoding ? { "accept-encoding": acceptEncoding } : {},
		}),
	);
}

beforeAll(() => {
	dist = mkdtempSync(join(tmpdir(), "freshcoat-server-"));
	mkdirSync(join(dist, "assets"));
	mkdirSync(join(dist, "canvaskit/0.41.1"), { recursive: true });
	writeFileSync(join(dist, "index.html"), INDEX);
	writeFileSync(join(dist, ".env"), "secret");
	mkdirSync(join(dist, ".git"));
	writeFileSync(join(dist, ".git/config"), "secret");
	mkdirSync(`${dist}-old`);
	writeFileSync(join(`${dist}-old`, "secret.txt"), "secret");
	writeFileSync(join(dist, "index.html.gz"), gzipSync(INDEX));
	writeFileSync(join(dist, "assets/index-AbCd1234.js"), "export {};");
	const wasm = join(dist, "canvaskit/0.41.1/canvaskit.wasm");
	writeFileSync(wasm, "wasm");
	writeFileSync(`${wasm}.br`, "br");
	writeFileSync(`${wasm}.gz`, "gz");
	handle = createHandler(dist);
});

afterAll(() => {
	rmSync(dist, { recursive: true, force: true });
	rmSync(`${dist}-old`, { recursive: true, force: true });
});

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

describe("path handling", () => {
	it("does not serve a sibling directory sharing the dist prefix", async () => {
		const res = await get(`/..%2F${basename(dist)}-old%2Fsecret.txt`);
		expect(res.status).toBe(404);
		expect(await res.text()).not.toContain("secret");
		expect(
			resolveAsset(dist, `/../${basename(dist)}-old/secret.txt`),
		).toBeNull();
		expect(resolveAsset(dist, "/")).toBe(`${dist}/`);
		expect(resolveAsset(dist, "/assets/x.js")).toBe(join(dist, "assets/x.js"));
	});

	it("returns 404 for missing assets and files with an extension", async () => {
		expect((await get("/assets/missing.js")).status).toBe(404);
		expect((await get("/assets/deep/route")).status).toBe(404);
		expect((await get("/foo.png")).status).toBe(404);
		expect((await get("/w/abc/foo.png")).status).toBe(404);
	});

	it("keeps the SPA fallback for route paths", async () => {
		const res = await get("/w/abc");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
		expect((await get("/")).status).toBe(200);
	});

	it("returns 404 with security headers for a NUL or control character", async () => {
		for (const path of [
			"/foo%00bar",
			"/assets/a%00.js",
			"/foo%0abar",
			"/x%7f",
		]) {
			const res = await get(path);
			expect(res.status).toBe(404);
			expect(res.headers.get("x-content-type-options")).toBe("nosniff");
			expect(res.headers.get("content-security-policy")).toContain(
				"frame-ancestors 'none'",
			);
		}
		expect(resolveAsset(dist, "/foo%00bar")).toBeNull();
	});

	it("does not serve dotfiles", async () => {
		for (const path of ["/.env", "/.git/config", "/%2eenv", "/assets/.hidden"])
			expect((await get(path)).status).toBe(404);
	});
});

describe("methods", () => {
	it("rejects anything but GET and HEAD", async () => {
		for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
			const res = await get("/", undefined, method);
			expect(res.status).toBe(405);
			expect(res.headers.get("allow")).toBe("GET, HEAD");
			expect(res.headers.get("x-content-type-options")).toBe("nosniff");
		}
	});

	it("answers HEAD", async () => {
		const res = await get("/assets/index-AbCd1234.js", undefined, "HEAD");
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe(
			"public, max-age=31536000, immutable",
		);
	});
});

describe("security headers", () => {
	const paths = [
		"/",
		"/w/abc",
		"/assets/index-AbCd1234.js",
		"/canvaskit/0.41.1/canvaskit.wasm",
		"/healthz",
		"/missing.png",
	];

	it("are set on every response", async () => {
		const responses = [
			...(await Promise.all(paths.map((p) => get(p)))),
			await get("/", undefined, "POST"),
		];
		for (const res of responses) {
			expect(res.headers.get("x-content-type-options")).toBe("nosniff");
			expect(res.headers.get("referrer-policy")).toBe(
				"strict-origin-when-cross-origin",
			);
			expect(res.headers.get("x-frame-options")).toBe("DENY");
			expect(res.headers.get("cross-origin-opener-policy")).toBe(
				"same-origin-allow-popups",
			);
			expect(res.headers.get("content-security-policy")).toContain(
				"frame-ancestors 'none'",
			);
		}
	});

	it("are set on a 500 when the handler throws", async () => {
		const log = spyOn(console, "error").mockImplementation(() => {});
		try {
			const res = await handle({ method: "GET", url: "not a url" } as Request);
			expect(res.status).toBe(500);
			expect(res.headers.get("x-content-type-options")).toBe("nosniff");
			expect(res.headers.get("x-frame-options")).toBe("DENY");
			expect(res.headers.get("content-security-policy")).toContain(
				"frame-ancestors 'none'",
			);
			expect(log).toHaveBeenCalledTimes(1);
			expect(log.mock.calls[0]).toHaveLength(1);
			expect(log.mock.calls[0]?.[0]).not.toContain("\n");
		} finally {
			log.mockRestore();
		}
	});

	it("lets CanvasKit run and hashes the inline theme script", async () => {
		const csp = (await get("/")).headers.get("content-security-policy") ?? "";
		const script = csp.split("; ").find((d) => d.startsWith("script-src"));
		expect(script).toContain("'wasm-unsafe-eval'");
		expect(script).not.toContain("'unsafe-eval'");
		expect(script).toMatch(/'sha256-[A-Za-z0-9+/=]+'/);
		expect(script?.match(/sha256-/g)).toHaveLength(1);
		expect(csp).toContain("https://fonts.gstatic.com");
		expect(csp).toContain("https://fonts.googleapis.com");
	});

	it("allows eval only for scripts, which is what workers are governed by", async () => {
		const csp =
			(await get("/assets/index-AbCd1234.js")).headers.get(
				"content-security-policy",
			) ?? "";
		expect(csp).toContain("'unsafe-eval'");
	});
});
