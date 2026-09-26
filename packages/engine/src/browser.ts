import { resolveFontRequest } from "./font-bytes";
import type { PaintCache } from "./paint-cache";
import { makeRuntime } from "./runtime";
import type { CanvasLike, ImageLike, PaintRuntime } from "./types";

async function fetchBytes(url: string): Promise<Uint8Array> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
	return new Uint8Array(await res.arrayBuffer());
}

const injectedStylesheets = new Set<string>();

// The browser runtime: font resolution + fetch image I/O + a DOM Canvas2D host +
// a native font registry (the DOM's own font loading) under a keep-alive policy
// (the live <canvas> stays mounted; nothing is auto-disposed).
export function createBrowserEnv(opts?: {
	fonts?: Map<string, Uint8Array[]>;
	images?: Map<string, Uint8Array>;
	cache?: PaintCache;
}): PaintRuntime {
	return makeRuntime(
		{
			cache: opts?.cache,
			resolveFont(req) {
				return resolveFontRequest(req, opts?.fonts);
			},
			async loadImageBytes(src) {
				return opts?.images?.get(src) ?? fetchBytes(src);
			},
			// The browser loads fonts natively — no byte fetch. Google/fontsource
			// inject a stylesheet the DOM fetches; local files + pre-supplied bytes
			// become FontFaces. All land in document.fonts for the 2D ctx to resolve.
			async registerFont(family, res) {
				if (res.kind === "none") return;
				if (res.kind === "bytes") {
					await Promise.all(
						res.bytes.map((bytes) =>
							addFace(family, bytes as unknown as ArrayBuffer),
						),
					);
					return;
				}
				const d = res.descriptor;
				if (d.kind === "local") {
					await Promise.all(
						d.files.map((f) => addFace(family, `url(${f.src})`)),
					);
					return;
				}
				await injectStylesheet(d.url);
			},
			canvas: {
				createCanvas(w, h) {
					const c = document.createElement("canvas");
					c.width = w;
					c.height = h;
					return c as unknown as CanvasLike;
				},
				async decodeImage(bytes) {
					const bmp = await createImageBitmap(
						new Blob([bytes as unknown as BlobPart]),
					);
					return bmp as unknown as ImageLike;
				},
				encode(canvas) {
					// The keep-alive path never encodes server-side; this is a
					// best-effort sync fallback for callers that want bytes.
					const url = (
						canvas as unknown as { toDataURL(t: string): string }
					).toDataURL("image/png");
					const b64 = url.slice(url.indexOf(",") + 1);
					return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
				},
			},
		},
		"keep",
	);
}

async function addFace(
	family: string,
	source: string | ArrayBuffer,
): Promise<void> {
	const face = new FontFace(family, source);
	await face.load();
	document.fonts.add(face);
}

async function injectStylesheet(url: string): Promise<void> {
	if (!injectedStylesheets.has(url)) {
		injectedStylesheets.add(url);
		await new Promise<void>((resolve) => {
			const link = document.createElement("link");
			link.rel = "stylesheet";
			link.href = url;
			const done = () => resolve();
			link.onload = done;
			link.onerror = done;
			document.head.appendChild(link);
		});
	}
	await document.fonts.ready;
}
