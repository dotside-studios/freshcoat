import { readdirSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import zlib from "node:zlib";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import Icons from "unplugin-icons/vite";
import { defineConfig } from "vite";
import { CANVASKIT_BASE, canvasKitBinDir } from "./canvaskit-assets";

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

// Serve canvaskit-wasm's bin assets at /canvaskit/<version>/* so the browser
// CanvasKit backend can load them (see src/render/canvaskit.ts, which script-tags
// the loader rather than importing the package). canvaskit-wasm itself stays out
// of the module graph: the .wasm would choke the dep optimizer parsing it as
// source. The `full` build, at /canvaskit/<version>/full/*, is the export
// workers': only it has the JPEG and WebP encoders.
function canvasKitAssets() {
	const files = [
		"canvaskit.js",
		"canvaskit.wasm",
		"full/canvaskit.js",
		"full/canvaskit.wasm",
	] as const;
	const contentType = (f: string) =>
		f.endsWith(".wasm") ? "application/wasm" : "text/javascript";
	return {
		name: "canvaskit-assets",
		configureServer(server: {
			middlewares: {
				use(
					fn: (
						req: { url?: string },
						res: {
							setHeader(k: string, v: string): void;
							end(b: Buffer): void;
						},
						next: () => void,
					) => void,
				): void;
			};
		}) {
			server.middlewares.use((req, res, next) => {
				const f = files.find((n) => req.url === `${CANVASKIT_BASE}/${n}`);
				if (!f) return next();
				res.setHeader("Content-Type", contentType(f));
				res.end(readFileSync(join(canvasKitBinDir, f)));
			});
		},
		transformIndexHtml() {
			return [
				{
					tag: "link",
					attrs: {
						rel: "preload",
						href: `${CANVASKIT_BASE}/canvaskit.js`,
						as: "script",
					},
					injectTo: "head" as const,
				},
				{
					tag: "link",
					attrs: {
						rel: "preload",
						href: `${CANVASKIT_BASE}/canvaskit.wasm`,
						as: "fetch",
						crossorigin: true,
					},
					injectTo: "head" as const,
				},
			];
		},
		generateBundle(this: {
			emitFile(f: { type: "asset"; fileName: string; source: Buffer }): void;
		}) {
			for (const f of files)
				this.emitFile({
					type: "asset",
					fileName: `${CANVASKIT_BASE.slice(1)}/${f}`,
					source: readFileSync(join(canvasKitBinDir, f)),
				});
		},
	};
}

// Writes the .br and .gz siblings server.ts negotiates by Accept-Encoding.
function precompress() {
	const COMPRESSIBLE = /\.(wasm|js|css|html|svg|json)$/;
	const MIN_BYTES = 1024;
	let outDir = "";
	return {
		name: "precompress",
		apply: "build" as const,
		configResolved(config: { root: string; build: { outDir: string } }) {
			outDir = resolve(config.root, config.build.outDir);
		},
		async closeBundle() {
			const files = readdirSync(outDir, { recursive: true, encoding: "utf8" })
				.filter((f) => COMPRESSIBLE.test(f))
				.map((f) => join(outDir, f));
			await Promise.all(
				files.map(async (file) => {
					const source = await readFile(file);
					if (source.length < MIN_BYTES) return;
					const [br, gz] = await Promise.all([
						brotli(source, {
							params: {
								[zlib.constants.BROTLI_PARAM_QUALITY]:
									zlib.constants.BROTLI_MAX_QUALITY,
								[zlib.constants.BROTLI_PARAM_SIZE_HINT]: source.length,
							},
						}),
						gzip(source, { level: zlib.constants.Z_BEST_COMPRESSION }),
					]);
					await Promise.all([
						br.length < source.length && writeFile(`${file}.br`, br),
						gz.length < source.length && writeFile(`${file}.gz`, gz),
					]);
				}),
			);
		},
	};
}

// `vite build --mode e2e` is the production build plus the e2e probes, each
// emitted as e2e/probes/<name>.js with its exports kept, so the bench can
// drive the export engine as the production bundle builds it.
function e2eProbes(mode: string) {
	if (mode !== "e2e") return undefined;
	const dir = fileURLToPath(new URL("./e2e/probes", import.meta.url));
	const probes = readdirSync(dir).filter((f) => f.endsWith("-probe.ts"));
	return {
		rollupOptions: {
			input: {
				index: fileURLToPath(new URL("./index.html", import.meta.url)),
				...Object.fromEntries(
					probes.map((f) => [
						`e2e/probes/${f.replace(/\.ts$/, "")}`,
						join(dir, f),
					]),
				),
			},
			preserveEntrySignatures: "exports-only" as const,
			output: {
				entryFileNames: (chunk: { name: string }) =>
					chunk.name.startsWith("e2e/")
						? "[name].js"
						: "assets/[name]-[hash].js",
			},
		},
	};
}

export default defineConfig(({ mode }) => ({
	build: e2eProbes(mode),
	define: { __CANVASKIT_BASE__: JSON.stringify(CANVASKIT_BASE) },
	resolve: {
		alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) },
	},
	optimizeDeps: {
		entries: ["index.html", "e2e/probes/*.ts"],
		exclude: ["canvaskit-wasm"],
		// qrcode, xlsx and zod are found by the scan of the entries above. They
		// are not named here: the editor reaches them only through a kit or
		// @freshcoat-js/workspace, so from here they resolve only when hoisted.
		include: ["react-aria-components", "fflate"],
	},
	plugins: [
		canvasKitAssets(),
		tailwindcss(),
		Icons({ compiler: "jsx", jsx: "react", defaultClass: "" }),
		viteReact(),
		precompress(),
	],
}));
