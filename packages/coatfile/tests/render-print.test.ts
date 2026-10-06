// The print toggle on render(): off = passthrough; on = the frame is planned and
// the whole-frame finish is applied. Uses a near-white background so the finish's
// white-clamp is observable without needing image assets.
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { decodePixels } from "@freshcoat-js/engine";
import { createHeadlessEnv } from "@freshcoat-js/engine/headless";
import { describe, expect, test } from "vitest";
import { render } from "../src/render";
import type { Template } from "../src/types";

// A single 40×40 front with a near-white (#fafafa = 250) background.
const template = {
	format_version: "1.0",
	version: "1.0.0",
	id: "t",
	name: "T",
	description: "d",
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
				properties: { fill: "#fafafa" },
			},
			elements: [],
		},
	],
} as unknown as Template;

async function ckInit(): Promise<any> {
	return (await loadCanvasKit()) as any;
}
const centerR = (ck: any, png: Uint8Array): number => {
	const d = decodePixels(ck, png)!;
	return d.data[(20 * d.width + 20) * 4];
};

describe("render() print toggle", () => {
	test("off: near-white background is left as-is", async () => {
		const ck = await ckInit();
		const env = createHeadlessEnv();
		const [front] = await render(
			template,
			{},
			{ width: 40, height: 40 },
			{ ck, env },
		);
		expect(centerR(ck, (front as { bytes: Uint8Array }).bytes)).toBe(250);
	});

	test("on: the frame finish clamps near-white to pure white", async () => {
		const ck = await ckInit();
		const env = createHeadlessEnv();
		const [front] = await render(
			template,
			{},
			{ width: 40, height: 40, print: true },
			{ ck, env },
		);
		expect(centerR(ck, (front as { bytes: Uint8Array }).bytes)).toBe(255);
	});

	test("finish:false disables the whole-frame pass", async () => {
		const ck = await ckInit();
		const env = createHeadlessEnv();
		const [front] = await render(
			template,
			{},
			{ width: 40, height: 40, print: { finish: false } },
			{ ck, env },
		);
		// Planned, but no finish → the graphic background is untouched.
		expect(centerR(ck, (front as { bytes: Uint8Array }).bytes)).toBe(250);
	});
});
