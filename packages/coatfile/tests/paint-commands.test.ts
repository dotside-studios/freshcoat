import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { createRenderer } from "@freshcoat-js/engine";
import { describe, expect, test } from "vitest";
import type { Template } from "../src/types";

const frameTemplate = {
	format_version: "1.0",
	version: "1.0.0",
	id: "test-card",
	name: "T",
	description: "Test template",
	product: "test",
	width: 40,
	height: 40,
	fields: { type: "object", properties: {} },
	template_data: [
		{
			name: "front",
			background: {
				id: "bg",
				type: "rect",
				pos: { x: 0, y: 0 },
				size: { width: 40, height: 40 },
				properties: { fill: "#ff0000" },
			},
			elements: [],
		},
	],
} as unknown as Template;

describe("renderer.paint", () => {
	test("paints compiled frame commands offscreen to PNG", async () => {
		const ck = await loadCanvasKit();
		const { compileToCommands } = await import("./helpers/compile-commands");
		const frames = compileToCommands(frameTemplate, {}, { width: 40, height: 40 });
		const renderer = await createRenderer({ ck });
		const result = await renderer.paint(frames[0]?.commands ?? []);
		// PNG magic number.
		expect(Array.from(result.bytes.slice(0, 4))).toEqual([137, 80, 78, 71]);
		renderer.dispose();
	});
});
