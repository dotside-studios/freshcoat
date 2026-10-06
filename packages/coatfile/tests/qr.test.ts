import { describe, expect, test } from "vitest";
import { generateMatrix } from "../src/qr";
import type { Command, DrawCommand, Template } from "../src/types";
import { compileToCommands } from "./helpers/compile-commands";

// Recursively find the first draw command matching `op` (QR lowers to a bitmap
// nested in a group).
function findDraw(commands: Command[], op: string): DrawCommand | undefined {
	for (const c of commands) {
		if ("op" in c && c.op === op) return c as DrawCommand;
		if ("op" in c && c.op === "drawGroup") {
			const hit = findDraw((c as { children: DrawCommand[] }).children, op);
			if (hit) return hit;
		}
	}
	return undefined;
}

describe("generateMatrix", () => {
	test("empty payload yields an empty matrix instead of throwing", () => {
		// The unfilled-field state must degrade to a blank QR, not a crash.
		expect(generateMatrix("")).toEqual([]);
	});

	test("non-empty payload yields a square boolean matrix", () => {
		const m = generateMatrix("https://example.com/c/abc123");
		expect(m.length).toBeGreaterThan(0);
		expect(m.every((row) => row.length === m.length)).toBe(true);
	});
});

// A QR bound to a field that resolves empty (e.g. the skeleton/preview pass that
// compiles with no customizations) must not take down the whole compile.
const qrTemplate: Template = {
	format_version: "1.0",
	version: "1.0.0",
	id: "qr",
	name: "QR",
	product: "card_cr80",
	width: 100,
	height: 100,
	fields: { type: "object", properties: { card_url: { type: "string" } } },
	template_data: [
		{
			name: "front",
			background: {
				id: "bg",
				type: "rect",
				pos: { x: 0, y: 0 },
				size: { width: 100, height: 100 },
				properties: { fill: "#ffffff" },
			},
			elements: [
				{
					id: "card_url",
					type: "qr_code",
					pos: { x: 10, y: 10 },
					size: { width: 80, height: 80 },
					properties: { value: "{{card_url}}" },
				},
			],
		},
	],
} as unknown as Template;

describe("compile with an empty QR value", () => {
	test("does not throw and emits a QR bitmap with no modules", () => {
		const [front] = compileToCommands(
			qrTemplate,
			{},
			{ width: 100, height: 100 },
		);
		const bmp = findDraw(front.commands, "drawBitmap");
		expect(bmp).toBeDefined();
		// empty matrix → 0×0 bitmap
		expect((bmp as { pixelWidth: number }).pixelWidth).toBe(0);
	});

	test("emits real modules once the value is filled", () => {
		const [front] = compileToCommands(
			qrTemplate,
			{ card_url: "https://example.com/c/abc123" },
			{ width: 100, height: 100 },
		);
		const bmp = findDraw(front.commands, "drawBitmap");
		expect(bmp).toBeDefined();
		expect((bmp as { pixelWidth: number }).pixelWidth).toBeGreaterThan(0);
	});
});
