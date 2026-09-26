// End-to-end: print { analyze: true } renders each image layer as-rendered,
// analyzes it, and attaches a per-image correction — so the painted image differs
// from the un-optimized render. finish:false isolates the per-layer adjust.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import CanvasKitInit from "canvaskit-wasm";
import { decodePixels } from "freshcoat";
import { createHeadlessEnv } from "freshcoat/headless";
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

// A solid-color PNG as a data URL (the headless env decodes data: URLs).
function solidPngDataUrl(
	ck: any,
	rgba: [number, number, number, number],
): string {
	const surface = ck.MakeSurface(32, 32);
	surface.getCanvas().clear(ck.Color(...rgba));
	const img = surface.makeImageSnapshot();
	const bytes = img.encodeToBytes() as Uint8Array;
	img.delete();
	surface.delete();
	const b64 = Buffer.from(bytes).toString("base64");
	return `data:image/png;base64,${b64}`;
}

function template(src: string): Template {
	return {
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
					properties: { fill: "#ffffff" },
				},
				elements: [
					{
						id: "img",
						type: "image",
						pos: { x: 8, y: 8 },
						size: { width: 24, height: 24 },
						properties: { src, fit: "cover" },
					},
				],
			},
		],
	} as unknown as Template;
}

const centerRGB = (ck: any, png: Uint8Array): [number, number, number] => {
	const d = decodePixels(ck, png)!;
	const o = (20 * d.width + 20) * 4;
	return [d.data[o], d.data[o + 1], d.data[o + 2]];
};

describe("render() print analyze path", () => {
	test("analyze:true corrects the image layer (differs from un-optimized)", async () => {
		const ck = await ckInit();
		// A moderately saturated teal — analysis yields a real (non-identity) adjust.
		const src = solidPngDataUrl(ck, [42, 157, 143, 255]);
		const tpl = template(src);

		const off = await render(
			tpl,
			{},
			{ width: 40, height: 40 },
			{ ck, env: createHeadlessEnv() },
		);
		const on = await render(
			tpl,
			{},
			{ width: 40, height: 40, print: { analyze: true, finish: false } },
			{ ck, env: createHeadlessEnv() },
		);

		const a = centerRGB(ck, (off[0] as { bytes: Uint8Array }).bytes);
		const b = centerRGB(ck, (on[0] as { bytes: Uint8Array }).bytes);
		// The corrected image is not identical to the raw one.
		const changed =
			Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
		expect(changed).toBeGreaterThan(3);
	});

	test("a correction that runs out of range reports it on the result", async () => {
		const ck = await ckInit();
		// Pale and near-neutral, so analysis prescribes its strongest boosts — which
		// this close to full scale is more range than the layer has left.
		const src = solidPngDataUrl(ck, [200, 205, 235, 255]);
		const on = await render(
			template(src),
			{},
			{ width: 40, height: 40, print: { analyze: true } },
			{ ck, env: createHeadlessEnv() },
		);

		const warning = on[0].warnings.find((w) => w.kind === "gamut_compressed");
		expect(warning).toBeDefined();
		if (warning?.kind !== "gamut_compressed") throw new Error("unreachable");
		// A solid layer: every pixel of it is over, and chroma really came back.
		expect(warning.clipped).toBeGreaterThan(0.5);
		expect(warning.pullback).toBeGreaterThan(0);
		expect(warning.layer).toBe(src);
	});

	test("a correction that fits reports nothing", async () => {
		const ck = await ckInit();
		// Mid-toned with room in every direction — the boosts land inside the range.
		const src = solidPngDataUrl(ck, [120, 130, 125, 255]);
		const on = await render(
			template(src),
			{},
			{ width: 40, height: 40, print: { analyze: true } },
			{ ck, env: createHeadlessEnv() },
		);
		expect(on[0].warnings.some((w) => w.kind === "gamut_compressed")).toBe(
			false,
		);
	});
});
