import type { CanvasKit } from "canvaskit-wasm";

export type { CanvasKit };

/**
 * "default" is the build the SDK renders with. "full" adds the JPEG and WebP
 * encoders.
 */
export type CanvasKitBuild = "default" | "full";

export type CanvasKitInit = (options: {
	locateFile: (file: string) => string;
}) => Promise<CanvasKit>;
