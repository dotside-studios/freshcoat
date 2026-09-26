import { join, normalize } from "node:path";

// Static file server for the built SPA. No framework and no node_modules: the
// production image ships `dist/` plus this file, and Bun serves it directly.
const DIST = join(import.meta.dir, "dist");
const PORT = Number(process.env.PORT ?? 3000);

// Vite fingerprints everything under assets/, so those are safe to pin forever.
// index.html and the CanvasKit payload under canvaskit/ must revalidate on
// every deploy.
const FINGERPRINTED = /^\/assets\/.+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/;

function resolveAsset(pathname: string): string | null {
	let decoded: string;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		return null; // malformed percent-encoding
	}
	const full = normalize(join(DIST, decoded));
	// normalize() collapses `..`; anything that escaped dist/ is not ours to serve.
	return full.startsWith(DIST) ? full : null;
}

const server = Bun.serve({
	port: PORT,
	idleTimeout: 30,
	async fetch(req) {
		const url = new URL(req.url);
		if (url.pathname === "/healthz") {
			return new Response("ok", {
				headers: { "content-type": "text/plain; charset=utf-8" },
			});
		}

		const assetPath = resolveAsset(url.pathname);
		if (assetPath) {
			const asset = Bun.file(assetPath);
			if (await asset.exists()) {
				return new Response(asset, {
					headers: {
						"cache-control": FINGERPRINTED.test(url.pathname)
							? "public, max-age=31536000, immutable"
							: "no-cache",
					},
				});
			}
		}

		// SPA fallback: the router owns every path that isn't a file on disk.
		return new Response(Bun.file(join(DIST, "index.html")), {
			headers: {
				"content-type": "text/html; charset=utf-8",
				"cache-control": "no-cache",
			},
		});
	},
});

console.log(`freshcoat editor listening on http://localhost:${server.port}`);
