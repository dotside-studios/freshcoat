// The print-optimized render must be the SAME CARD, only corrected: a plan that
// attaches no adjust and no finish has to paint the passthrough bytes exactly.
//
// The analyze path prepares the scene before planning (it needs each layer's
// resolved box to sample it as rendered), and preparation is not idempotent — a
// second pass inside compileScene folded every nested frame's own pos into its
// children again, sliding a QR out of the box drawn for it. This pins that a
// layer nested in a positioned frame lands in the same place either way.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import CanvasKitInit from "canvaskit-wasm";
import { createHeadlessEnv } from "@freshcoat-js/engine/headless";
import { describe, expect, test } from "vitest";
import { render } from "../src/render";
import type { Template } from "../src/types";

const CK_BIN = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	"node_modules",
	"canvaskit-wasm",
	"bin",
);

async function ckInit(): Promise<any> {
	return (await (CanvasKitInit as any)({
		locateFile: (f: string) => join(CK_BIN, f),
	})) as any;
}

// A card back in miniature: a QR nested inside a positioned frame, which is the
// shape the double-fold moved (the frame's pos counted twice for its children).
const TEMPLATE = {
	format_version: "1.0",
	version: "1.0.0",
	id: "t",
	name: "T",
	description: "d",
	product: "test",
	width: 80,
	height: 50,
	fields: { type: "object", properties: {} },
	template_data: [
		{
			name: "back",
			background: {
				id: "bg",
				type: "rect",
				pos: { x: 0, y: 0 },
				size: { width: 80, height: 50 },
				properties: { fill: "#ffffff" },
			},
			elements: [
				{
					id: "qr-box",
					type: "frame",
					pos: { x: 26, y: 14 },
					size: { width: 28, height: 28 },
					properties: {
						stroke: { color: "#000000", width: 1 },
						children: [
							{
								id: "qr",
								type: "qr_code",
								pos: { x: 2, y: 2 },
								size: { width: 24, height: 24 },
								properties: { value: "https://example.com/abc123" },
							},
						],
					},
				},
			],
		},
	],
} as unknown as Template;

describe("render() print geometry", () => {
	test("a no-op print plan paints the passthrough bytes", async () => {
		const ck = await ckInit();
		const size = { width: 80, height: 50 };

		const off = await render(TEMPLATE, {}, size, {
			ck,
			env: createHeadlessEnv(),
		});
		const on = await render(
			TEMPLATE,
			{},
			{
				...size,
				// Analyze on (the order-site print path), but correcting nothing and
				// finishing nothing — so any difference in the output is geometry.
				print: { analyze: true, policy: { photo: null }, finish: false },
			},
			{ ck, env: createHeadlessEnv() },
		);

		const a = Buffer.from((off[0] as { bytes: Uint8Array }).bytes);
		const b = Buffer.from((on[0] as { bytes: Uint8Array }).bytes);
		expect(Buffer.compare(a, b)).toBe(0);
	});
});
