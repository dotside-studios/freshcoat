// The CanvasKit fixture the corpus was authored against: the reference backend,
// the vendored OFL font, and the deterministic test images. Shared by the golden
// generator and freshcoat's own conformance test so the two cannot drift.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFontMetrics } from "../../src/font-metrics";
import { createParagraphEngine } from "../../src/paragraph-layout";
import { paintCanvasKit } from "../../src/runtime";
import type { FontVMetrics, Painter } from "../../src/types";
import { conformanceImages } from "./assets";

export const FAMILY = "ConformanceFont";
const FONT_PATH = fileURLToPath(
	new URL("../../tests/fonts/Geist-Regular.ttf", import.meta.url),
);

export type Fixture = {
	// biome-ignore lint/suspicious/noExplicitAny: CanvasKit ambient instance
	ck: any;
	painter: Painter;
	textEngine: ReturnType<typeof createParagraphEngine>;
	fonts: Map<string, Uint8Array[]>;
	images: Map<string, Uint8Array>;
	fontMetrics: Record<string, FontVMetrics>;
	canvasKitVersion: string;
	dispose(): void;
};

export async function createFixture(): Promise<Fixture> {
	const require = createRequire(import.meta.url);
	const binDir = dirname(require.resolve("canvaskit-wasm"));
	const canvasKitVersion = JSON.parse(
		readFileSync(join(binDir, "..", "package.json"), "utf8"),
	).version as string;
	const CanvasKitInit = (await import("canvaskit-wasm")).default as (
		o: unknown,
	) => Promise<unknown>;
	const ck = await CanvasKitInit({
		locateFile: (f: string) => join(binDir, f),
	});

	const bytes = new Uint8Array(readFileSync(FONT_PATH));
	const fonts = new Map([[FAMILY, [bytes]]]);
	const metrics = readFontMetrics(bytes);
	const textEngine = createParagraphEngine(ck, fonts);

	return {
		ck,
		painter: paintCanvasKit(ck),
		textEngine,
		fonts,
		images: await conformanceImages(),
		fontMetrics: metrics ? { [FAMILY]: metrics } : {},
		canvasKitVersion,
		dispose: () => textEngine.dispose(),
	};
}
