import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { CanvasKit } from "canvaskit-wasm";

const require = createRequire(import.meta.url);
const BIN = dirname(require.resolve("canvaskit-wasm"));

/**
 * "default" is the build the SDK packages render with. "full" adds the JPEG
 * and WebP encoders that Studio's export worker loads.
 */
export type CanvasKitBuild = "default" | "full";

type CanvasKitInit = (options: {
	locateFile: (file: string) => string;
}) => Promise<CanvasKit>;

/** The installed canvaskit-wasm version, for reports and golden metadata. */
export const canvasKitVersion: string = require("canvaskit-wasm/package.json")
	.version;

/**
 * Loads a new CanvasKit instance from the installed canvaskit-wasm. Each call
 * returns a separate instance, so tests that need a shared one cache it.
 */
export async function loadCanvasKit(
	build: CanvasKitBuild = "default",
): Promise<CanvasKit> {
	const module =
		build === "full"
			? await import("canvaskit-wasm/full")
			: await import("canvaskit-wasm");
	const dir = build === "full" ? join(BIN, "full") : BIN;
	return (module.default as unknown as CanvasKitInit)({
		locateFile: (file) => join(dir, file),
	});
}
