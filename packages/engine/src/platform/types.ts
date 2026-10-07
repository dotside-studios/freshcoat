import type { CanvasKit } from "canvaskit-wasm";

/**
 * "default" is the build the engine renders with. "full" adds the JPEG and
 * WebP encoders.
 */
export type CanvasKitBuild = "default" | "full";

export type CanvasKitInit = (options: {
	locateFile: (file: string) => string;
}) => Promise<CanvasKit>;
