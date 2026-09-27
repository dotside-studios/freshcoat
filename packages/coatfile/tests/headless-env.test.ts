import { join } from "node:path";
import { fileURLToPath } from "node:url";
import CanvasKitInit from "canvaskit-wasm";
import { createHeadlessEnv } from "@freshcoat-js/engine/headless";
import { describe, expect, test } from "vitest";
import type { Template } from "../src/types";

const CK_BIN = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	"node_modules",
	"canvaskit-wasm",
	"bin",
);

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

describe("createHeadlessEnv", () => {
	test("renders a frame offscreen to PNG with no canvas host", async () => {
		const ck = (await (CanvasKitInit as any)({
			locateFile: (f: string) => join(CK_BIN, f),
		})) as any;
		const { compileToCommands } = await import("./helpers/compile-commands");
		const frames = compileToCommands(
			frameTemplate,
			{},
			{
				width: 40,
				height: 40,
			},
		);
		const env = createHeadlessEnv();
		expect(env.canvas).toBeUndefined();
		const result = await env.paint(frames[0].commands, ck);
		const png = (result as { bytes: Uint8Array }).bytes;
		// PNG magic number.
		expect(Array.from(png.slice(0, 4))).toEqual([137, 80, 78, 71]);
	});
});
