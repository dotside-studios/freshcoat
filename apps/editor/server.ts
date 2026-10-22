import { extname, join, normalize, resolve, sep } from "node:path";

// Static file server for the built SPA. No framework and no node_modules: the
// production image ships `dist/` plus this file, and Bun serves it directly.

// Vite fingerprints everything under assets/, and the CanvasKit payload lives
// under its package version, so both are safe to pin forever. index.html must
// revalidate on every deploy.
const FINGERPRINTED =
	/^\/(assets\/.+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+|canvaskit\/\d+\.\d+\.\d+[^/]*\/.+)$/;

const ENCODINGS = [
	["br", ".br"],
	["gzip", ".gz"],
] as const;

const SECURITY_HEADERS = {
	"x-content-type-options": "nosniff",
	"referrer-policy": "strict-origin-when-cross-origin",
	"x-frame-options": "DENY",
	"cross-origin-opener-policy": "same-origin-allow-popups",
} as const;

// Script and connect sources are the app's own plus what it fetches at runtime:
// Google Fonts stylesheets and files, and user-supplied https image URLs. Style
// attributes come from React. Render workers load canvaskit.js through an
// indirect eval, and a worker is governed by the policy of its own script
// response, so only JavaScript responses allow 'unsafe-eval'; documents do not.
function contentSecurityPolicy(unsafeEval: boolean, inlineScripts: string[]) {
	const script = ["'self'", "'wasm-unsafe-eval'", ...inlineScripts];
	if (unsafeEval) script.push("'unsafe-eval'");
	return [
		"default-src 'self'",
		`script-src ${script.join(" ")}`,
		"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
		"img-src 'self' data: blob:",
		"font-src 'self' data: blob: https://fonts.gstatic.com",
		"connect-src 'self' data: blob: https:",
		"worker-src 'self' blob:",
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'self'",
		"frame-ancestors 'none'",
	].join("; ");
}

async function inlineScriptHashes(dist: string): Promise<string[]> {
	const file = Bun.file(join(dist, "index.html"));
	if (!(await file.exists())) return [];
	const html = await file.text();
	const out: string[] = [];
	for (const m of html.matchAll(
		/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi,
	)) {
		const hash = new Bun.CryptoHasher("sha256")
			.update(m[1] ?? "")
			.digest("base64");
		out.push(`'sha256-${hash}'`);
	}
	return out;
}

export function resolveAsset(dist: string, pathname: string): string | null {
	let decoded: string;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		return null; // malformed percent-encoding
	}
	for (const ch of decoded) {
		const code = ch.charCodeAt(0);
		if (code < 0x20 || code === 0x7f) return null;
	}
	const full = normalize(join(dist, decoded));
	// normalize() collapses `..`; anything that escaped dist/ is not ours to serve.
	return (full + sep).startsWith(dist + sep) ? full : null;
}

function accepted(header: string | null): Set<string> {
	const out = new Set<string>();
	for (const part of (header ?? "").split(",")) {
		const [name, ...params] = part.trim().toLowerCase().split(";");
		const q = params.find((p) => p.trim().startsWith("q="));
		if (name && (!q || Number(q.trim().slice(2)) > 0)) out.add(name);
	}
	return out;
}

async function serveFile(
	req: Request,
	path: string,
	headers: Record<string, string>,
): Promise<Response> {
	const file = Bun.file(path);
	const base = {
		...headers,
		"content-type": headers["content-type"] ?? file.type,
		vary: "Accept-Encoding",
	};
	const acceptEncoding = accepted(req.headers.get("accept-encoding"));
	for (const [encoding, ext] of ENCODINGS) {
		if (!acceptEncoding.has(encoding)) continue;
		const variant = Bun.file(path + ext);
		if (await variant.exists())
			return new Response(variant, {
				headers: { ...base, "content-encoding": encoding },
			});
	}
	return new Response(file, { headers: base });
}

function notFound(): Response {
	return new Response("not found", {
		status: 404,
		headers: { "content-type": "text/plain; charset=utf-8" },
	});
}

function internalError(): Response {
	return new Response("internal server error", {
		status: 500,
		headers: { "content-type": "text/plain; charset=utf-8" },
	});
}

export function createHandler(distDir: string) {
	const dist = resolve(distDir);
	let scripts: Promise<string[]> | undefined;

	async function route(req: Request): Promise<Response> {
		if (req.method !== "GET" && req.method !== "HEAD")
			return new Response("method not allowed", {
				status: 405,
				headers: {
					allow: "GET, HEAD",
					"content-type": "text/plain; charset=utf-8",
				},
			});

		const url = new URL(req.url);
		if (url.pathname === "/healthz") {
			return new Response("ok", {
				headers: { "content-type": "text/plain; charset=utf-8" },
			});
		}

		const assetPath = resolveAsset(dist, url.pathname);
		if (assetPath === null) return notFound();
		const relative = assetPath.slice(dist.length + 1).split(sep);
		if (relative.some((segment) => segment.startsWith("."))) return notFound();

		if (await Bun.file(assetPath).exists()) {
			return serveFile(req, assetPath, {
				"cache-control": FINGERPRINTED.test(url.pathname)
					? "public, max-age=31536000, immutable"
					: "no-cache",
			});
		}

		const last = url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
		if (url.pathname.startsWith("/assets/") || extname(last) !== "")
			return notFound();

		// SPA fallback: the router owns every path that isn't a file on disk.
		return serveFile(req, join(dist, "index.html"), {
			"content-type": "text/html; charset=utf-8",
			"cache-control": "no-cache",
		});
	}

	async function secure(res: Response): Promise<Response> {
		const type = res.headers.get("content-type") ?? "";
		scripts ??= inlineScriptHashes(dist);
		const csp = contentSecurityPolicy(
			type.includes("javascript"),
			type.startsWith("text/html") ? await scripts : [],
		);
		for (const [name, value] of Object.entries(SECURITY_HEADERS))
			res.headers.set(name, value);
		res.headers.set("content-security-policy", csp);
		return res;
	}

	return async (req: Request): Promise<Response> => {
		try {
			return await secure(await route(req));
		} catch (e) {
			const reason = e instanceof Error ? e.message : String(e);
			console.error(`${req.method} ${req.url} failed: ${reason}`);
			return secure(internalError());
		}
	};
}

if (import.meta.main) {
	const server = Bun.serve({
		port: Number(process.env.PORT ?? 3000),
		idleTimeout: 30,
		fetch: createHandler(join(import.meta.dir, "dist")),
	});
	console.log(`freshcoat editor listening on http://localhost:${server.port}`);
}
