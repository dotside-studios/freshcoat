import { base64ToBytes } from "@freshcoat-js/coatfile/assets";
import { sha256 } from "js-sha256";
import { describe, expect, it } from "vitest";
import { fixtures } from "~/lib/figma/transpiler/fixtures";
import type { FigmaContainerNode, FigmaNode } from "~/lib/figma/types";
import type { ReadDocumentMessage } from "~/shared/protocol";
import { runTranspileToTemplate } from "~/ui/run-transpile";

const PNG = base64ToBytes(
	"iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGM4EaDxH4QZYAwAT/QI/XT94xkAAAAASUVORK5CYII=",
);

const NIGHT = { type: "SOLID" as const, color: { r: 0, g: 0, b: 0.2, a: 1 } };

function recolor(tree: FigmaContainerNode, ids: string[]): FigmaContainerNode {
	const copy = structuredClone(tree);
	copy.fills = [NIGHT];
	for (const child of copy.children as FigmaNode[])
		if (ids.includes(child.id)) Object.assign(child, { fills: [NIGHT] });
	return copy;
}

function message(): ReadDocumentMessage {
	const { front, back } = fixtures.fidelityCard.figma;
	const slot = (name: string, tree: FigmaContainerNode) => ({
		slot: name,
		nodeId: tree.id,
		nodeName: tree.name,
		width: tree.absoluteBoundingBox.width,
		height: tree.absoluteBoundingBox.height,
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
		colorways: [
			{
				instanceId: "I9:1",
				label: "Night",
				perSide: {
					front: recolor(front, ["6:3"]),
					back: recolor(back, []),
				},
			},
		],
		rasters: [{ nodeId: "6:4", bytes: PNG }],
	};
}

describe("runTranspileToTemplate (colorway of the fixtures)", () => {
	it("exports the variant with no variant_* warnings", async () => {
		const { template } = await runTranspileToTemplate(
			message(),
			async (bytes) => sha256(bytes),
			{ name: "Fidelity Card" },
		);
		const night = template.variants?.find((v) => v.label === "Night");
		expect(night?.overrides.length).toBeGreaterThan(0);
		expect(
			(template.warnings ?? []).filter((w) => w.code.startsWith("variant_")),
		).toEqual([]);
	});
});
