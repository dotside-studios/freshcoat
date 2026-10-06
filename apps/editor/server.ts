import { join, normalize } from "node:path";

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

function resolveAsset(dist: string, pathname: string): string | null {
	let decoded: string;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		return null; // malformed percent-encoding
	}
	const full = normalize(join(dist, decoded));
	// normalize() collapses `..`; anything that escaped dist/ is not ours to serve.
	return full.startsWith(dist) ? full : null;
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

export function createHandler(dist: string) {
	return async (req: Request): Promise<Response> => {
		const url = new URL(req.url);
		if (url.pathname === "/healthz") {
			return new Response("ok", {
				headers: { "content-type": "text/plain; charset=utf-8" },
			});
		}

		const assetPath = resolveAsset(dist, url.pathname);
		if (assetPath && (await Bun.file(assetPath).exists())) {
			return serveFile(req, assetPath, {
				"cache-control": FINGERPRINTED.test(url.pathname)
					? "public, max-age=31536000, immutable"
					: "no-cache",
			});
		}

		// SPA fallback: the router owns every path that isn't a file on disk.
		return serveFile(req, join(dist, "index.html"), {
			"content-type": "text/html; charset=utf-8",
			"cache-control": "no-cache",
		});
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
