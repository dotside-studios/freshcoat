import { compile, FORMAT_VERSION, validate } from "@freshcoat/coatfile";
import { collectAssetRefs, readAssets } from "@freshcoat/coatfile/assets";
import { describe, expect, it } from "vitest";
import type { FigmaContainerNode } from "~/lib/figma/types";
import type { ReadDocumentMessage } from "~/shared/protocol";
import { runTranspileToTemplate } from "~/ui/run-transpile";

const base = {
	visible: true,
	opacity: 1,
	blendMode: "NORMAL" as const,
	effects: [],
};
const bbox = { x: 0, y: 0, width: 1013, height: 638 };

function hexToRgba(hex: string): {
	r: number;
	g: number;
	b: number;
	a: number;
} {
	const h = hex.replace("#", "");
	return {
		r: Number.parseInt(h.slice(0, 2), 16) / 255,
		g: Number.parseInt(h.slice(2, 4), 16) / 255,
		b: Number.parseInt(h.slice(4, 6), 16) / 255,
		a: 1,
	};
}

function rectFrame(fill: string): FigmaContainerNode {
	return {
		id: `swatch-${fill}`,
		name: "swatch",
		type: "FRAME",
		visible: true,
		opacity: 1,
		blendMode: "NORMAL",
		absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
		children: [],
		fills: [{ type: "SOLID", color: hexToRgba(fill) }],
	};
}

const msg: ReadDocumentMessage = {
	type: "read-document",
	product: {
		sku: "card_cr80",
		displayName: "CR80 Card",
		width: 1013,
		height: 638,
		frames: [
			{ name: "front", label: "Front", required: true },
			{ name: "back", label: "Back", required: true },
		],
	},
	mode: "davi",
	rasters: [],
	colorways: [],
	slots: [
		{
			slot: "front",
			nodeId: "1:0",
			nodeName: "Front",
			width: 1013,
			height: 638,
			tree: {
				...base,
				id: "1:0",
				name: "front",
				type: "FRAME",
				absoluteBoundingBox: bbox,
				clipsContent: false,
				fills: [
					{
						type: "SOLID",
						color: { r: 1, g: 1, b: 1, a: 1 },
						opacity: 1,
						visible: true,
					},
				],
				children: [],
			} as never,
		},
		{
			slot: "back",
			nodeId: "1:9",
			nodeName: "Back",
			width: 1013,
			height: 638,
			tree: {
				...base,
				id: "1:9",
				name: "back",
				type: "FRAME",
				absoluteBoundingBox: bbox,
				clipsContent: false,
				fills: [
					{
						type: "SOLID",
						color: { r: 1, g: 1, b: 1, a: 1 },
						opacity: 1,
						visible: true,
					},
				],
				children: [],
			} as never,
		},
	],
};

describe("runTranspileToTemplate", () => {
	it("produces a valid template with both slots in template_data", async () => {
		const { template } = await runTranspileToTemplate(
			msg,
			async () => "deadbeef",
			{
				name: "Aurora Member Card",
			},
		);
		expect(template.template_data.map((f) => f.name)).toEqual([
			"front",
			"back",
		]);
		expect(template.source.kind).toBe("figma");
		expect(template.format_version).toBe(FORMAT_VERSION);
		expect(template.source.picks.front.nodeId).toBe("1:0");
	});

	it("emits a template the kit validates and compiles without conversion", async () => {
		const { template } = await runTranspileToTemplate(
			msg,
			async () => "deadbeef",
			{
				name: "Aurora Member Card",
			},
		);

		const result = validate(template);
		expect(
			result.ok,
			result.ok ? "" : JSON.stringify(result.errors.slice(0, 3)),
		).toBe(true);

		// Every raster the design flattened is referenced by hash and carried in
		// `assets`, so compile resolves them itself — no upload, no pre-pass.
		for (const sha of collectAssetRefs(template)) {
			expect(
				(template.assets ?? []).some((a) => a.sha256 === sha),
				`asset ${sha} is carried`,
			).toBe(true);
		}
		const compiled = compile(template, {}, { width: 1013, height: 638 });
		for (const frame of compiled.frames) {
			for (const src of frame.assets.images) {
				expect(src.startsWith("asset:")).toBe(false);
			}
		}
	});

	it("carries the flattened rasters as decodable bytes", async () => {
		const { template } = await runTranspileToTemplate(
			msg,
			async () => "deadbeef",
			{
				name: "Aurora Member Card",
			},
		);
		for (const asset of readAssets(template)) {
			expect(asset.blob.size).toBeGreaterThan(0);
			expect(asset.contentType).toBe("image/png");
		}
	});

	it("carries author metadata into the template (id slugified from name)", async () => {
		const { template } = await runTranspileToTemplate(
			msg,
			async () => "deadbeef",
			{
				name: "Aurora Member Card",
				description: "A member card",
				mood: "premium",
			},
		);
		const t = template as unknown as {
			id: string;
			name: string;
			description?: string;
			mood?: string;
		};
		expect(t.id).toBe("aurora-member-card");
		expect(t.name).toBe("Aurora Member Card");
		expect(t.description).toBe("A member card");
		expect(t.mood).toBe("premium");
	});

	it("threads colorways into template variants", async () => {
		const msgWithColorways: ReadDocumentMessage = {
			...msg,
			colorways: [
				{
					instanceId: "I9:9",
					label: "Amber",
					perSide: {
						front: rectFrame("#ffbf00"),
						back: rectFrame("#ffbf00"),
					},
				},
			],
		};
		const { template } = await runTranspileToTemplate(
			msgWithColorways,
			async () => "deadbeef",
			{
				name: "Aurora",
			},
		);
		const t = template as unknown as {
			variants?: Array<{ id: string }>;
			width: number;
		};
		expect(t.width).toBe(1013);
		expect(t.variants?.map((v) => v.id)).toEqual(["default", "amber"]);
	});

	it("records which figma instance each variant came from", async () => {
		const msgWithColorways: ReadDocumentMessage = {
			...msg,
			colorways: [
				{
					instanceId: "I9:9",
					label: "Amber",
					perSide: {
						front: rectFrame("#ffbf00"),
						back: rectFrame("#ffbf00"),
					},
				},
			],
		};
		const { template } = await runTranspileToTemplate(
			msgWithColorways,
			async () => "deadbeef",
			{ name: "Aurora" },
		);

		expect(template.source.variants).toEqual({
			amber: { instanceId: "I9:9", label: "Amber" },
		});
		// Every keyed variant exists in the template, and the synthesized "default"
		// has no instance behind it so it is deliberately absent.
		const ids = (template.variants ?? []).map((v) => v.id);
		for (const id of Object.keys(template.source.variants ?? {})) {
			expect(ids).toContain(id);
		}
		expect(template.source.variants).not.toHaveProperty("default");
	});

	it("omits source.variants for a card with no colorways", async () => {
		const { template } = await runTranspileToTemplate(
			msg,
			async () => "deadbeef",
			{
				name: "Aurora",
			},
		);
		expect(template.variants).toBeUndefined();
		expect(template.source.variants).toBeUndefined();
	});
});
