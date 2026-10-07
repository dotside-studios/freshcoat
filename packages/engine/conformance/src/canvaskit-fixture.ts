// The CanvasKit fixture the corpus was authored against: the reference backend,
// the vendored OFL font, and the deterministic test images. Shared by the golden
// generator and freshcoat's own conformance test so the two cannot drift.
import {
	canvasKitVersion,
	loadCanvasKit,
	testFontBytes,
} from "@freshcoat-js/test-utils";
import { readFontMetrics } from "../../src/font-metrics";
import { createParagraphEngine } from "../../src/paragraph-layout";
import { paintCanvasKit } from "../../src/runtime";
import type { Painter } from "../../src/runtime-types";
import type { FontVMetrics } from "../../src/types";
import { conformanceImages } from "./assets";

export const FAMILY = "ConformanceFont";

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
	const ck = await loadCanvasKit();

	const bytes = testFontBytes("Geist-Regular.ttf");
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
