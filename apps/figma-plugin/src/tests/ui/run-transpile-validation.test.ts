import { describe, expect, it, vi } from "vitest";
import { fixtures } from "~/lib/figma/transpiler/fixtures";
import type { ReadDocumentMessage } from "~/shared/protocol";
import { ExportBlockedError, runTranspileToTemplate } from "~/ui/run-transpile";

// The transpiler only writes what coatfile accepts, so a template that fails
// validation is made by breaking a real one on its way out: one element's
// size, one frame down inside the back, and the variant-free background.
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
				template_data: Array<{
					background: Record<string, unknown>;
					elements: Array<Record<string, unknown>>;
				}>;
			};
			t.template_data[0].elements[2].size = { width: "wide", height: 64 };
			t.template_data[1].background.properties = { fill: 7 };
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

describe("runTranspileToTemplate (validation)", () => {
	it("blocks an invalid template, listing each error against its layer", async () => {
		const error = await runTranspileToTemplate(
			message(),
			async () => "deadbeef",
			{ name: "Broken" },
			// Proceeding accepts placeholders, never an invalid template.
			{ proceed: true },
		).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ExportBlockedError);
		const blocked = error as ExportBlockedError;
		expect(blocked.canProceed).toBe(false);
		expect(blocked.message).toMatch(/^The template is not valid: /);

		// coatfile reports a bad element at the element, whichever of its keys
		// broke it. This one is display_name, read from layer 6:3 on the front.
		const size = blocked.issues.find((i) =>
			i.path?.startsWith("/template_data/0/elements/2"),
		);
		expect(size).toMatchObject({
			severity: "error",
			code: "invalid_shape",
			nodeId: "6:3",
			slot: "front",
		});
		expect(size?.message).toContain("(at /template_data/0/elements/2)");

		const background = blocked.issues.find((i) =>
			i.path?.startsWith("/template_data/1/background"),
		);
		// A background belongs to the side's own frame.
		expect(background).toMatchObject({ nodeId: "6:10", slot: "back" });
	});
});
