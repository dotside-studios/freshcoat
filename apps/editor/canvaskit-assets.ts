import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export const canvasKitBinDir = dirname(
	createRequire(import.meta.url).resolve("canvaskit-wasm"),
);

const { version } = JSON.parse(
	readFileSync(join(canvasKitBinDir, "..", "package.json"), "utf8"),
) as { version: string };

export const CANVASKIT_BASE = `/canvaskit/${version}`;
