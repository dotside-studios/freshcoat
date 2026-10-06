import { describe, expect, it, vi } from "vitest";
import { fixtures } from "~/lib/figma/transpiler/fixtures";
import type { ReadDocumentMessage } from "~/shared/protocol";
import { runTranspileToTemplate } from "~/ui/run-transpile";

// The transpiler emits neither delta, so a variant carrying both is added on
// the way out.
vi.mock("~/lib/figma/transpiler", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("~/lib/figma/transpiler")>();
	return {
		...actual,
		transpile: async (
			...args: Parameters<typeof actual.transpile>
		): ReturnType<typeof actual.transpile> => {
			const out = await actual.transpile(...args);
			const t = out.template as {
				template_data: Array<{ elements: Array<{ id: string }> }>;
				variants?: unknown[];
			};
			t.variants = [
				{
					id: "night",
					label: "Night",
					overrides: [
						{
							name: "front",
							elements: [
								{ id: "missing", properties: { fill: "#000000" } },
								{ id: t.template_data[0].elements[0].id, properties: {} },
							],
						},
					],
				},
			];
			return out;
		},
	};
});

function message(): ReadDocumentMessage {
	const { front, back } = fixtures.fidelityCard.figma;
	const slot = (name: string, tree: typeof front) => ({
		slot: name,
		nodeId: tree.id,
		nodeName: tree.name,
		width: 1017,
		height: 639,
		tree,
	});
	return {
		type: "read-document",
		product: {
			sku: "card_cr80",
			displayName: "CR80 Card",
			width: 1017,
			height: 639,
			frames: [
				{ name: "front", label: "Front", required: true },
				{ name: "back", label: "Back", required: true },
			],
		},
		mode: "davi",
		slots: [slot("front", front), slot("back", back)],
		colorways: [],
		rasters: [],
	};
}

describe("runTranspileToTemplate (variants)", () => {
	it("lists checkVariants findings as warnings", async () => {
		const { template, trace } = await runTranspileToTemplate(
			message(),
			async () => "deadbeef",
			{ name: "Night" },
			{ proceed: true },
		);
		const firstId = template.template_data[0].elements[0].id;
		const firstNode = trace.find(
			(t) => t.slot === "front" && t.elementId === firstId,
		)?.nodeId;
		expect(firstNode).toBeDefined();

		expect(
			template.warnings?.filter((w) => w.code.startsWith("variant_")),
		).toEqual([
			{
				severity: "warn",
				code: "variant_orphan_override",
				message: expect.stringContaining('"missing"'),
				slot: "front",
			},
			{
				severity: "warn",
				code: "variant_empty_override",
				message: expect.stringContaining(`"${firstId}"`),
				slot: "front",
				nodeId: firstNode,
			},
		]);
	});
});
