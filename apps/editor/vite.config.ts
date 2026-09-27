import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import Icons from "unplugin-icons/vite";
import { defineConfig } from "vite";

// Serve canvaskit-wasm's bin assets at /canvaskit/* so the browser CanvasKit
// backend can load them (see src/render/canvaskit.ts, which script-tags the loader
// rather than importing the package). canvaskit-wasm itself stays out of the
// module graph — the .wasm would choke the dep optimizer parsing it as source.
// The `full` build, at /canvaskit/full/*, is the export workers': only it has
// the JPEG and WebP encoders.
function canvasKitAssets() {
	const binDir = dirname(
		createRequire(import.meta.url).resolve("canvaskit-wasm"),
	);
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
				const f = files.find((n) => req.url === `/canvaskit/${n}`);
				if (!f) return next();
				res.setHeader("Content-Type", contentType(f));
				res.end(readFileSync(join(binDir, f)));
			});
		},
		generateBundle(this: {
			emitFile(f: { type: "asset"; fileName: string; source: Buffer }): void;
		}) {
			for (const f of files)
				this.emitFile({
					type: "asset",
					fileName: `canvaskit/${f}`,
					source: readFileSync(join(binDir, f)),
				});
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
	],
}));
