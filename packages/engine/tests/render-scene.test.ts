// deriveFontMetrics + renderSceneToPng: the one-call headless path.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import CanvasKitInit from "canvaskit-wasm";
import { describe, expect, test } from "vitest";
import { renderSceneToPng } from "../src/headless";
import {
	createFrame,
	createRect,
	createText,
	deriveFontMetrics,
} from "../src/index";

const CK_BIN = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	"node_modules",
	"canvaskit-wasm",
	"bin",
);
const FONT = fileURLToPath(
	new URL("./fonts/Geist-Regular.ttf", import.meta.url),
);

describe("deriveFontMetrics", () => {
	test("reads metrics for each family's first face; skips empty", () => {
		const bytes = new Uint8Array(readFileSync(FONT));
		const m = deriveFontMetrics(
			new Map([
				["Geist", [bytes]],
				["Empty", []],
			]),
		);
		expect(m.Geist.ascent).toBeGreaterThan(0);
		expect(m.Empty).toBeUndefined();
	});
});

describe("renderSceneToPng", () => {
	test("compiles + paints a text scene to PNG in one call", async () => {
		const bytes = new Uint8Array(readFileSync(FONT));
		const ck = await (CanvasKitInit as (o: unknown) => Promise<unknown>)({
			locateFile: (f: string) => join(CK_BIN, f),
		});
		const scene = createFrame({
			pos: { x: 0, y: 0 },
			size: { width: 120, height: 60 },
			background: createRect({
				pos: { x: 0, y: 0 },
				size: { width: 120, height: 60 },
				fills: [{ kind: "solid", color: "#ffffff" }],
			}),
			children: [
				createText({
					pos: { x: 8, y: 8 },
					size: { width: 104, height: 44 },
					text: "hi",
					font: {
						family: "Geist",
						weight: 400,
						style: "normal",
						size: 24,
						lineHeight: 1.2,
					},
					color: "#101828",
				}),
			],
		});
		const result = await renderSceneToPng(scene, {
			width: 120,
			height: 60,
			ck,
			fonts: new Map([["Geist", [bytes]]]),
		});
		expect([
			result.bytes[0],
			result.bytes[1],
			result.bytes[2],
			result.bytes[3],
		]).toEqual([137, 80, 78, 71]);
		expect(result.warnings.some((w) => w.kind === "font_load_failed")).toBe(
			false,
		);
	});
});
