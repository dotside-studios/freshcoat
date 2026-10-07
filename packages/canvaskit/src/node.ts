import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { CanvasKit, CanvasKitBuild, CanvasKitInit } from "./index";

export type { CanvasKit, CanvasKitBuild } from "./index";

const require = createRequire(import.meta.url);
const BIN = dirname(require.resolve("canvaskit-wasm"));

/** The installed canvaskit-wasm version. */
export const canvasKitVersion: string = JSON.parse(
	readFileSync(join(BIN, "..", "package.json"), "utf8"),
).version;

/** The directory holding canvaskit.js and canvaskit.wasm for a build. */
export function canvasKitBinDir(build: CanvasKitBuild = "default"): string {
	return build === "full" ? join(BIN, "full") : BIN;
}

/** Creates a new CanvasKit instance on every call. */
export async function initCanvasKit(
	build: CanvasKitBuild = "default",
): Promise<CanvasKit> {
	const module =
		build === "full"
			? await import("canvaskit-wasm/full")
			: await import("canvaskit-wasm");
	const dir = canvasKitBinDir(build);
	return (module.default as unknown as CanvasKitInit)({
		locateFile: (file) => join(dir, file),
	});
}

const loaded = new Map<CanvasKitBuild, Promise<CanvasKit>>();

/** Shares one CanvasKit instance per build; a failed load is retried. */
export function loadCanvasKit(
	build: CanvasKitBuild = "default",
): Promise<CanvasKit> {
	let ck = loaded.get(build);
	if (!ck) {
		ck = initCanvasKit(build);
		ck.catch(() => loaded.delete(build));
		loaded.set(build, ck);
	}
	return ck;
}
