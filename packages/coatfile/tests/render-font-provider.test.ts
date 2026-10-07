// A renderer that holds the fonts map, with a paint cache: records that hide a field
// set in its own family keep the font provider, and paint what an uncached
// render does.
import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import { createRenderer, type PaintCacheOptions } from "@freshcoat-js/engine";
import { describe, expect, test } from "vitest";
import { renderTemplate } from "../src/render";
import type { Template } from "../src/types";

const GEIST = testFontBytes("Geist-Regular.ttf");

let ck: any;
async function ckInit(): Promise<any> {
	ck ??= await loadCanvasKit();
	return ck;
}

const text = (id: string, y: number, family: string, extra = {}) => ({
	id,
	type: "text",
	pos: { x: 2, y },
	size: { width: 60, height: 10 },
	properties: { value: `{{${id}}}`, font: { family, size: 8 } },
	...extra,
});

const template = {
	format_version: "1.0",
	version: "1.0.0",
	id: "t",
	name: "T",
	product: "test",
	width: 64,
	height: 24,
	fields: {
		type: "object",
		properties: { name: { type: "string" }, badge: { type: "string" } },
	},
	template_data: [
		{
			name: "front",
			background: {
				id: "bg",
				type: "rect",
				pos: { x: 0, y: 0 },
				size: { width: 64, height: 24 },
				properties: { fill: "#ffffff" },
			},
			elements: [
				text("name", 2, "Geist"),
				text("badge", 12, "Badge", { visibleWhen: { field: "badge" } }),
			],
		},
	],
} as unknown as Template;

const RECORDS = [
	{ name: "Ana", badge: "Gold" },
	{ name: "Bo" },
	{ name: "Cy", badge: "Gold" },
	{ name: "Di" },
];

async function renderAll(cache: PaintCacheOptions | false) {
	const ck = await ckInit();
	const renderer = await createRenderer({
		ck,
		cache,
		fonts: { Geist: [GEIST], Badge: [GEIST.slice()] },
	});
	const out: Uint8Array[] = [];
	for (const values of RECORDS) {
		const [frame] = await renderTemplate(renderer, template, values, {
			width: 64,
			height: 24,
		});
		expect(frame?.warnings).toEqual([]);
		out.push(frame?.bytes as Uint8Array);
	}
	const stats = renderer.stats().paintCache;
	renderer.dispose();
	return { out, stats };
}

describe("renderTemplate() font provider with a paint cache", () => {
	test("records that hide a uniquely-fonted field keep the provider", async () => {
		const cached = await renderAll({});
		expect(cached.stats).toMatchObject({ paints: 4, fontProviderBuilds: 1 });
		expect(cached.out).toEqual((await renderAll(false)).out);
	});
});
