// The print toggle on renderTemplate(): off = passthrough; on = the frame is
// planned and the whole-frame finish is applied. Uses a near-white background so the finish's
// white-clamp is observable without needing image assets.
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { createRenderer, decodePixels } from "@freshcoat-js/engine";
import { describe, expect, test } from "vitest";
import { renderTemplate } from "../src/render";
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

describe("renderTemplate() print toggle", () => {
	test("off: near-white background is left as-is", async () => {
		const ck = await ckInit();
		const [front] = await renderTemplate(
			await createRenderer({ ck, cache: false }),
			template,
			{},
			{ width: 40, height: 40 },
		);
		expect(centerR(ck, front.bytes)).toBe(250);
	});

	test("on: the frame finish clamps near-white to pure white", async () => {
		const ck = await ckInit();
		const [front] = await renderTemplate(
			await createRenderer({ ck, cache: false }),
			template,
			{},
			{ width: 40, height: 40, print: true },
		);
		expect(centerR(ck, front.bytes)).toBe(255);
	});

	test("finish:false disables the whole-frame pass", async () => {
		const ck = await ckInit();
		const [front] = await renderTemplate(
			await createRenderer({ ck, cache: false }),
			template,
			{},
			{ width: 40, height: 40, print: { finish: false } },
		);
		// Planned, but no finish → the graphic background is untouched.
		expect(centerR(ck, front.bytes)).toBe(250);
	});

	test("balance curves the frame even without the finish", async () => {
		const ck = await ckInit();
		const [front] = await renderTemplate(
			await createRenderer({ ck, cache: false }),
			template,
			{},
			{
				width: 40,
				height: 40,
				print: { finish: false, balance: { r: 2, g: 1, b: 1 } },
			},
		);
		const d = decodePixels(ck, front.bytes)!;
		const at = (20 * d.width + 20) * 4;
		expect([...d.data.slice(at, at + 3)]).toEqual([245, 250, 250]);
	});
});
