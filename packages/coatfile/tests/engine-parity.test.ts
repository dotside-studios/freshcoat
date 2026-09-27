// Compile-level guarantees for the CanvasKit Paragraph engine — the engine every
// production render path now uses. Offline + deterministic via the vendored OFL
// Geist. Structural (not pixel) so it needs no native-canvas backend: it drives
// compile with the engine and checks the laid-out text IR.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import CanvasKitInit from "canvaskit-wasm";
import {
	createParagraphEngine,
	type FontVMetrics,
	readFontMetrics,
} from "@freshcoat-js/engine";
import { beforeAll, describe, expect, test } from "vitest";
import type { DrawTextCommand, Template } from "../src/types";
import { compileToCommands } from "./helpers/compile-commands";

const CK_BIN = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	"node_modules",
	"canvaskit-wasm",
	"bin",
);
const FONT_PATH = fileURLToPath(
	new URL("../../engine/tests/fonts/Geist-Regular.ttf", import.meta.url),
);
const FAMILY = "ParityFont";
const W = 500;
const H = 300;

let ck: any;
let fonts: Map<string, Uint8Array[]>;
let fontMetrics: Record<string, FontVMetrics>;

beforeAll(async () => {
	const bytes = new Uint8Array(readFileSync(FONT_PATH));
	fonts = new Map([[FAMILY, [bytes]]]);
	ck = await (CanvasKitInit as (o: unknown) => Promise<unknown>)({
		locateFile: (f: string) => join(CK_BIN, f),
	});
	const m = readFontMetrics(bytes);
	fontMetrics = m ? { [FAMILY]: m } : {};
});

function card(properties: Record<string, unknown>): Template {
	return {
		format_version: "1.0",
		version: "1.0.0",
		id: "parity",
		name: "parity",
		product: "card_cr80",
		width: W,
		height: H,
		fields: { type: "object", properties: {} },
		template_data: [
			{
				name: "front",
				background: {
					id: "bg",
					type: "rect",
					pos: { x: 0, y: 0 },
					size: { width: W, height: H },
					properties: { fill: "#ffffff" },
				},
				elements: [
					{
						id: "t",
						type: "text",
						pos: { x: 40, y: 40 },
						size: { width: 240, height: 220 },
						properties,
					},
				],
			},
		],
	} as unknown as Template;
}

function drawText(template: Template, useEngine: boolean): DrawTextCommand {
	const engine = useEngine ? createParagraphEngine(ck, fonts) : undefined;
	const frames = compileToCommands(
		template,
		{},
		{
			width: W,
			height: H,
			fontMetrics,
			textEngine: engine,
		},
	);
	engine?.dispose();
	const cmd = frames[0]!.commands.find((c) => c.op === "drawText");
	if (!cmd || cmd.op !== "drawText") throw new Error("no drawText command");
	return cmd;
}

describe("Paragraph engine single-style layout", () => {
	test("wraps long prose into multiple in-box lines", () => {
		const cmd = drawText(
			card({
				value:
					"The quick brown fox jumps over the lazy dog near the riverbank at dawn",
				font: { family: FAMILY, size: 26, weight: 400 },
				color: "#111111",
				align: "left",
			}),
			true,
		);
		const lines = cmd.layout.lines;
		expect(lines.length).toBeGreaterThan(1); // it wrapped
		// every line fits the 240px box (with a hair of tolerance)
		for (const line of lines) {
			const right = Math.max(...line.spans.map((s) => s.x + s.width));
			expect(right).toBeLessThanOrEqual(40 + 240 + 1);
		}
	});

	test("a short string stays on one line", () => {
		const cmd = drawText(
			card({
				value: "Jane Appleseed",
				font: { family: FAMILY, size: 30, weight: 400 },
				color: "#111111",
				align: "left",
			}),
			true,
		);
		expect(cmd.layout.lines.length).toBe(1);
	});
});

describe("Paragraph engine mixed-style (inline) layout", () => {
	const mixed = () =>
		card({
			font: { family: FAMILY, size: 26, weight: 400 },
			color: "#111111",
			align: "left",
			spans: [
				{ text: "Hello ", font: { family: FAMILY, size: 26, weight: 400 } },
				{ text: "BOLD WORLD", font: { family: FAMILY, size: 26, weight: 700 } },
				{
					text: " and welcome aboard",
					font: { family: FAMILY, size: 26, weight: 400 },
				},
			],
		});

	test("engine wraps mixed-style text the default engine leaves on one line", () => {
		expect(drawText(mixed(), false).layout.lines.length).toBe(1); // approxEngine: no inline wrap
		expect(drawText(mixed(), true).layout.lines.length).toBeGreaterThan(1); // engine wraps
	});

	test("wrapped mixed-style keeps per-span weights across the split", () => {
		const cmd = drawText(mixed(), true);
		const weights = new Set(
			cmd.layout.lines.flatMap((l) => l.spans.map((s) => s.font.weight)),
		);
		expect(weights.has(400)).toBe(true);
		expect(weights.has(700)).toBe(true);
	});
});
