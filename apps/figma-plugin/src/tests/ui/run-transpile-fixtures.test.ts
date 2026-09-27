import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	FORMAT_VERSION,
	type Template,
	validate,
} from "@freshcoat-js/coatfile";
import { base64ToBytes } from "@freshcoat-js/coatfile/assets";
import { sha256 } from "js-sha256";
import { describe, expect, it, vi } from "vitest";
import {
	type ProductRegistryEntry,
	type TranspileInput,
	transpile,
} from "~/lib/figma/transpiler";
import { fixtures } from "~/lib/figma/transpiler/fixtures";
import type { FigmaContainerNode } from "~/lib/figma/types";
import type { ReadDocumentMessage } from "~/shared/protocol";
import { ExportBlockedError, runTranspileToTemplate } from "~/ui/run-transpile";

const FIXTURES = resolve(__dirname, "../../lib/figma/transpiler/fixtures");
const EXPORT_GOLDEN = resolve(FIXTURES, "fidelity-card.export.json");

// A 2x2 PNG: the smallest raster the transpiler does not take for Figma's
// "renders nothing" answer.
const PNG = base64ToBytes(
	"iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGM4EaDxH4QZYAwAT/QI/XT94xkAAAAASUVORK5CYII=",
);

const CR80: ProductRegistryEntry = {
	sku: "card_cr80",
	displayName: "CR80 Card",
	width: 1017,
	height: 639,
	frames: [
		{ name: "front", label: "Front", required: true },
		{ name: "back", label: "Back", required: true },
	],
};

const hex = async (bytes: Uint8Array): Promise<string> => sha256(bytes);

function message(
	front: FigmaContainerNode,
	back: FigmaContainerNode,
): ReadDocumentMessage {
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
		product: CR80,
		mode: "davi",
		slots: [slot("front", front), slot("back", back)],
		colorways: [],
		rasters: [{ nodeId: "6:4", bytes: [...PNG] }],
	};
}

// The two things an export records that change from run to run.
function stable(template: Template): unknown {
	const t = structuredClone(template) as Template & {
		source: { importedAt: string; report: { durationMs: number } };
	};
	t.source.importedAt = "2026-01-01T00:00:00.000Z";
	t.source.report.durationMs = 0;
	return JSON.parse(JSON.stringify(t));
}

async function fidelityExport(): Promise<Template> {
	const { front, back } = fixtures.fidelityCard.figma;
	const { template } = await runTranspileToTemplate(message(front, back), hex, {
		name: "Fidelity Card",
		description: "Format 1.3 features",
	});
	return template;
}

describe("the fidelity card export", () => {
	it("matches its golden", async () => {
		const actual = stable(await fidelityExport());
		// UPDATE_GOLDENS=1 bun run test rewrites it after an intended change.
		if (process.env.UPDATE_GOLDENS) {
			writeFileSync(EXPORT_GOLDEN, `${JSON.stringify(actual, null, "\t")}\n`);
		}
		expect(actual).toEqual(JSON.parse(readFileSync(EXPORT_GOLDEN, "utf8")));
	});

	it("is written at coatfile's format version and carries what 1.3 adds", async () => {
		const template = await fidelityExport();
		expect(template.format_version).toBe(FORMAT_VERSION);
		const [front, back] = template.template_data;
		const byId = new Map(front.elements.map((e) => [e.id, e]));
		expect(byId.get("sheen")).toMatchObject({
			constraints: { horizontal: "stretch" },
			properties: {
				fill: { kind: "linear", from: [0.1, 0.5], to: [0.45, 0.5], angle: 0 },
			},
		});
		expect(byId.get("sku")).toMatchObject({
			type: "barcode",
			constraints: { horizontal: "end", vertical: "end" },
			properties: { value: "{{sku}}", symbology: "ean13", showText: true },
		});
		expect(byId.get("flatten_6_4")).toMatchObject({
			type: "image",
			constraints: { horizontal: "end", vertical: "end" },
		});
		expect(back.elements[0]).toMatchObject({
			type: "qr_code",
			constraints: { horizontal: "center", vertical: "center" },
		});
		expect(template.fields.properties.sku).toMatchObject({
			"x-widget": "barcode",
		});
	});
});

describe("golden fixtures", () => {
	const single = (sku: string, width: number, height: number) => ({
		sku,
		displayName: sku,
		width,
		height,
		frames: [{ name: "front", label: "Front", required: true as const }],
	});
	const pick = (tree: FigmaContainerNode) => ({
		fileKey: "FK",
		nodeId: tree.id,
		nodeName: tree.name,
		width: tree.absoluteBoundingBox.width,
		height: tree.absoluteBoundingBox.height,
	});
	const run = async (
		input: Pick<TranspileInput, "product" | "picks"> & {
			trees: FigmaContainerNode[];
			sizeMode?: TranspileInput["sizeMode"];
		},
	): Promise<unknown> => {
		const result = await transpile({
			...input,
			metadata: {
				id: "t",
				name: "T",
				version: "1.0.0",
				formatVersion: FORMAT_VERSION,
			},
			fetchNodeTree: async (_k, id) => {
				const tree = input.trees.find((t) => t.id === id);
				if (!tree) throw new Error(`no tree ${id}`);
				return tree;
			},
			renderImage: vi.fn().mockResolvedValue({
				blob: new Blob([PNG as Uint8Array<ArrayBuffer>], { type: "image/png" }),
				sha256: "RASTER_SHA",
				width: 2,
				height: 2,
			}),
		});
		return result.template;
	};

	const cases: Array<[string, () => Promise<unknown>]> = [
		[
			"minimal card",
			() => {
				const { front, back } = fixtures.minimalCard.figma;
				return run({
					product: { ...CR80, width: 1017, height: 639 },
					picks: { front: pick(front), back: pick(back) },
					trees: [front, back],
				});
			},
		],
		[
			"full card",
			() => {
				const { front } = fixtures.fullCard.figma;
				return run({
					product: single("card_cr80", 1017, 639),
					picks: { front: pick(front) },
					trees: [front],
				});
			},
		],
		[
			"pinned logo",
			() => {
				const { front } = fixtures.pinnedLogo.figma;
				return run({
					product: single("custom", 1000, 600),
					sizeMode: "from-design",
					picks: { front: pick(front) },
					trees: [front],
				});
			},
		],
		["fidelity card", fidelityExport],
		["minimal card golden", async () => fixtures.minimalCard.expected],
		["full card golden", async () => fixtures.fullCard.expected],
		["pinned logo golden", async () => fixtures.pinnedLogo.expected],
		[
			"fidelity card export golden",
			async () => JSON.parse(readFileSync(EXPORT_GOLDEN, "utf8")),
		],
	];

	it.each(cases)("%s validates", async (_name, produce) => {
		const result = validate(await produce());
		expect(result.ok, JSON.stringify(!result.ok && result.errors)).toBe(true);
	});
});

describe("runTranspileToTemplate (barcode placeholders)", () => {
	const withBadBarcode = (): ReadDocumentMessage => {
		const { front, back } = fixtures.fidelityCard.figma;
		const edited = structuredClone(front);
		const barcode = edited.children.find((c) => c.id === "6:6");
		if (!barcode) throw new Error("fixture changed");
		barcode.name = "barcode:ean13:5901234123458";
		return message(edited, back);
	};

	it("stops the export, naming the layer, until the author proceeds", async () => {
		const error = await runTranspileToTemplate(withBadBarcode(), hex, {
			name: "Bad",
		}).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ExportBlockedError);
		const blocked = error as ExportBlockedError;
		expect(blocked.canProceed).toBe(true);
		expect(blocked.issues).toEqual([
			{
				severity: "error",
				code: "barcode_invalid_value",
				message:
					'Barcode layer "barcode:ean13:5901234123458": EAN-13 check digit should be 7',
				nodeId: "6:6",
			},
		]);
	});

	it("exports the placeholder, with its warning, once the author proceeds", async () => {
		const { template } = await runTranspileToTemplate(
			withBadBarcode(),
			hex,
			{ name: "Bad" },
			{ proceed: true },
		);
		expect(validate(template).ok).toBe(true);
		expect(template.warnings).toContainEqual(
			expect.objectContaining({ code: "barcode_invalid_value", nodeId: "6:6" }),
		);
	});
});
