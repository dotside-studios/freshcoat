// `lineHeight: "auto"` — a template saying "the font decides", the way a design
// tool's Auto does. compile() marks the node and keeps a usable fallback; the
// render resolves it against the family's real metrics.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import CanvasKitInit from "canvaskit-wasm";
import { createParagraphEngine, FALLBACK_LINE_HEIGHT } from "@freshcoat-js/engine";
import { describe, expect, test } from "vitest";
import { compile } from "../src/compile";
import type { DrawTextCommand, Node, Template, TextNode } from "../src/types";
import { validate } from "../src/validate";
import { compileToCommands } from "./helpers/compile-commands";

const CK_BIN = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	"node_modules",
	"canvaskit-wasm",
	"bin",
);
const VEND_SANS = fileURLToPath(
	new URL(
		"../../engine/tests/fonts/VendSans-Variable-latin.woff2",
		import.meta.url,
	),
);
// Vend Sans' own line box: typo ascent 1.09 + descent 0.39.
const VEND_SANS_AUTO = 1.48;
const SIZE = 40;

const template = (lineHeight: number | "auto") =>
	({
		format_version: "1.0",
		version: "1.0.0",
		id: "t",
		name: "T",
		description: "d",
		product: "test",
		width: 400,
		height: 200,
		fields: { type: "object", properties: {} },
		template_data: [
			{
				name: "front",
				background: {
					id: "bg",
					type: "rect",
					pos: { x: 0, y: 0 },
					size: { width: 400, height: 200 },
					properties: { fill: "#ffffff" },
				},
				elements: [
					{
						id: "body",
						type: "text",
						pos: { x: 0, y: 0 },
						size: { width: 400, height: 200 },
						properties: {
							value: "one two three four five six seven eight nine",
							font: { family: "Vend Sans", size: SIZE, lineHeight },
							color: "#000000",
						},
					},
				],
			},
		],
	}) as unknown as Template;

// The frame's only text node — the root group also carries the background rect.
const compiledText = (compiled: ReturnType<typeof compile>): TextNode => {
	const children = (compiled.frames[0].root as unknown as { children: Node[] })
		.children;
	const text = children.find((c) => c.kind === "text");
	if (!text) throw new Error("no text node compiled");
	return text as TextNode;
};

describe('lineHeight: "auto"', () => {
	test("validates, and compiles to a marked font with the old number as fallback", () => {
		expect(validate(template("auto")).ok).toBe(true);
		const text = compiledText(
			compile(template("auto"), {}, { width: 400, height: 200 }),
		);
		expect(text.font.autoLineHeight).toBe(true);
		// The number a consumer that ignores the flag would use — what coatfile
		// wrote for AUTO before it could say "auto".
		expect(text.font.lineHeight).toBe(FALLBACK_LINE_HEIGHT);
	});

	test("an explicit number carries no flag", () => {
		const text = compiledText(
			compile(template(1.5), {}, { width: 400, height: 200 }),
		);
		expect(text.font.lineHeight).toBe(1.5);
		expect(text.font.autoLineHeight).toBeUndefined();
	});

	test("the render lays the lines out at the font's line box", async () => {
		const ck = await (CanvasKitInit as (o: unknown) => Promise<unknown>)({
			locateFile: (f: string) => join(CK_BIN, f),
		});
		const fonts = new Map([
			["Vend Sans", [new Uint8Array(readFileSync(VEND_SANS))]],
		]);
		const textEngine = createParagraphEngine(ck, fonts);
		const advance = (lineHeight: number | "auto") => {
			const [frame] = compileToCommands(
				template(lineHeight),
				{},
				{
					width: 400,
					height: 200,
					textEngine,
				},
			);
			const text = frame.commands.find(
				(c) => "op" in c && c.op === "drawText",
			) as DrawTextCommand;
			const [a, b] = text.layout.lines;
			if (!a?.baseline || !b?.baseline) throw new Error("expected a wrap");
			return b.baseline - a.baseline;
		};
		try {
			// bakeText advances by whole pixels, so compare against the rounded box.
			expect(advance("auto")).toBeCloseTo(Math.round(SIZE * VEND_SANS_AUTO), 3);
			expect(advance(1.2)).toBeCloseTo(Math.round(SIZE * 1.2), 3);
		} finally {
			textEngine.dispose();
		}
	});
});
