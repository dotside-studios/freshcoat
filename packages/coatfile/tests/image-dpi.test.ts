import { createRenderer } from "@freshcoat-js/engine";
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test } from "vitest";
import { compile } from "../src/compile";
import {
	describeWarning,
	renderCompiledPdf,
	renderTemplate,
} from "../src/render";
import type { Template } from "../src/types";

let ck: any;

function png(width: number, height: number): Uint8Array {
	const surface = ck.MakeSurface(width, height);
	surface.getCanvas().clear(ck.Color(200, 40, 40, 255));
	const img = surface.makeImageSnapshot();
	const bytes = img.encodeToBytes() as Uint8Array;
	img.delete();
	surface.delete();
	return bytes;
}

const template = {
	format_version: "1.0",
	id: "t",
	name: "T",
	width: 1012,
	height: 638,
	fields: {
		type: "object",
		properties: { photo: { type: "string", format: "image" } },
	},
	template_data: [
		{
			name: "front",
			background: { id: "bg", type: "rect", properties: { fill: "#fff" } },
			elements: [
				{
					id: "photo",
					type: "image",
					pos: { x: 0, y: 0 },
					size: { width: 900, height: 600 },
					properties: { src: "{{photo}}", fit: "fill" },
				},
			],
		},
	],
} as unknown as Template;

describe("image DPI at render time", () => {
	beforeAll(async () => {
		ck = await loadCanvasKit();
	});

	test("warns for a field's image below the minimum", async () => {
		const renderer = await createRenderer({ ck, cache: false });
		const images = new Map([["ws:small", png(600, 400)]]);
		const [frame] = await renderTemplate(
			renderer,
			template,
			{ photo: "ws:small" },
			{ images, imageDpi: { dpi: 300 } },
		);
		const low = frame?.warnings.filter((w) => w.kind === "image_low_dpi");
		expect(low).toEqual([
			{
				kind: "image_low_dpi",
				layer: "photo",
				src: "ws:small",
				dpi: 200,
				min: 300,
			},
		]);
		expect(describeWarning(low![0]!)).toBe(
			"Image prints at 200 DPI, under 300: photo",
		);
	});

	test("says nothing for one that is sharp enough, or without the check", async () => {
		const renderer = await createRenderer({ ck, cache: false });
		const images = new Map([["ws:big", png(900, 600)]]);
		const values = { photo: "ws:big" };
		const [sharp] = await renderTemplate(renderer, template, values, {
			images,
			imageDpi: { dpi: 300 },
		});
		expect(sharp?.warnings.some((w) => w.kind === "image_low_dpi")).toBe(false);
		const [low] = await renderTemplate(renderer, template, values, {
			images,
			imageDpi: { dpi: 300, min: 400 },
		});
		expect(low?.warnings.some((w) => w.kind === "image_low_dpi")).toBe(true);
		const [unchecked] = await renderTemplate(renderer, template, values, {
			images,
		});
		expect(unchecked?.warnings.some((w) => w.kind === "image_low_dpi")).toBe(
			false,
		);
	});

	test("reads an image the renderer loads once across renders", async () => {
		const fixed = {
			...template,
			template_data: template.template_data.map((f) => ({
				...f,
				elements: f.elements.map((el) =>
					el.type === "image"
						? { ...el, properties: { ...el.properties, src: "logo.png" } }
						: el,
				),
			})),
		} as Template;
		const loads = async (imageDpi?: { dpi: number }) => {
			let count = 0;
			const bytes = png(600, 400);
			const renderer = await createRenderer({
				ck,
				cache: false,
				load: async () => {
					count++;
					return bytes;
				},
			});
			for (let i = 0; i < 3; i++)
				await renderTemplate(renderer, fixed, {}, imageDpi ? { imageDpi } : {});
			return count;
		};
		expect(await loads({ dpi: 300 })).toBe((await loads()) + 1);
	});

	test("checks a vector PDF page too", async () => {
		const renderer = await createRenderer({ ck, cache: false });
		const images = new Map([["ws:small", png(600, 400)]]);
		const compiled = compile(
			template,
			{ photo: "ws:small" },
			{
				width: 1012,
				height: 638,
			},
		);
		const [page] = await renderCompiledPdf(renderer, compiled, {
			images,
			dpi: 300,
			imageDpi: { dpi: 300 },
		});
		expect(
			page?.warnings
				.filter((w) => w.kind === "image_low_dpi")
				.map((w) => w.dpi),
		).toEqual([200]);
	});
});
