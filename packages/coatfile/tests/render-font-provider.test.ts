// A paint cache over an env that holds the fonts map: records that hide a field
// set in its own family keep the font provider, and paint what an uncached
// render does.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import CanvasKitInit from "canvaskit-wasm";
import { createPaintCache, type PaintCache } from "@freshcoat-js/engine";
import { createHeadlessEnv } from "@freshcoat-js/engine/headless";
import { describe, expect, test } from "vitest";
import { type EncodedPaintedFrame, render } from "../src/render";
import type { Template } from "../src/types";

const CK_BIN = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	"node_modules",
	"canvaskit-wasm",
	"bin",
);
const GEIST = new Uint8Array(
	readFileSync(
		fileURLToPath(
			new URL("../../engine/tests/fonts/Geist-Regular.ttf", import.meta.url),
		),
	),
);

let ck: any;
async function ckInit(): Promise<any> {
	ck ??= await (CanvasKitInit as (o: unknown) => Promise<unknown>)({
		locateFile: (f: string) => join(CK_BIN, f),
	});
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

async function renderAll(paintCache?: PaintCache) {
	const ck = await ckInit();
	const fonts = new Map([
		["Geist", [GEIST]],
		["Badge", [GEIST.slice()]],
	]);
	const env = createHeadlessEnv({ fonts });
	const out: Uint8Array[] = [];
	for (const values of RECORDS) {
		const [frame] = (await render(
			template,
			values,
			{ width: 64, height: 24 },
			{ ck, env, fonts, paintCache },
		)) as EncodedPaintedFrame[];
		expect(frame?.warnings).toEqual([]);
		out.push(frame?.bytes as Uint8Array);
	}
	return out;
}

describe("render() font provider with a paint cache", () => {
	test("records that hide a uniquely-fonted field keep the provider", async () => {
		const cache = createPaintCache();
		const cached = await renderAll(cache);
		expect(cache.stats()).toMatchObject({ paints: 4, fontProviderBuilds: 1 });
		cache.dispose();
		expect(cached).toEqual(await renderAll());
	});
});
