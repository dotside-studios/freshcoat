// Throughput of the state layer, comparing Immer with manual updates. Run with
// `bunx vitest bench --run src/tests/perf`; `bun run test` leaves it out.
import type { Template } from "@freshcoat/coatfile";
import type { Dataset, ExportPreset, Workspace } from "@freshcoat/workspace";
import { bench, describe } from "vitest";
import { translateLayers } from "~/doc/geometry";
import {
	addField,
	renameField,
	resizeTemplate,
	unwrap,
	updateElement,
	updateField,
} from "~/doc/ops";
import { membershipCard } from "~/samples/membership-card";
import { type Action, initialState, reduce } from "~/state/store";
import {
	commitDatasets,
	withRecordStatus,
	workspaceState,
} from "~/state/workspace";
import { geometryOf } from "../doc-fixture";

function dataset(id: string, rows: number): Dataset {
	return {
		id,
		name: id,
		columns: [{ key: "name", type: "text" }],
		records: Array.from({ length: rows }, (_, i) => ({
			id: `r_${i}`,
			values: { name: `N${i}` },
			status: "pending" as const,
		})),
		assets: [],
	};
}

const big = [dataset("a", 10_000)];
const allIds = big[0].records.map((r) => r.id);
const someIds = allIds.filter((_, i) => i % 100 === 0);

describe("withRecordStatus, 10k records", () => {
	bench("all exported", () => {
		withRecordStatus(big, "a", allIds, "exported", {
			exportedAt: "2026-09-25T00:00:00.000Z",
		});
	});
	bench("100 failed", () => {
		withRecordStatus(big, "a", someIds, "failed", {
			errors: Object.fromEntries(someIds.map((id) => [id, "boom"])),
		});
	});
	bench("no change", () => {
		withRecordStatus(big, "a", someIds, "pending");
	});
});

const card = membershipCard();
const wsBase: Workspace = {
	formatVersion: "1.0",
	name: "Bench",
	templates: [
		{ id: "t1", fileName: "a.coat", template: card },
		{ id: "t2", fileName: "b.coat", template: card },
	],
	datasets: big,
	presets: [],
};

// Each list keeps the records array, so the figure is commitDatasets' own.
const lists = Array.from({ length: 1000 }, (_, i) => [
	{ ...big[0], name: `a${i}` },
]);

describe("commitDatasets", () => {
	bench("1,000 commits, alternating merge keys", () => {
		let ws = workspaceState(wsBase, "bench.coatworkspace");
		for (let i = 0; i < 1000; i++)
			ws = commitDatasets(ws, lists[i], {
				mergeKey: i % 3 === 0 ? undefined : `cell:${i % 2}`,
				now: i * 400,
				bindings:
					i % 10 === 0 ? { t1: { datasetId: "a", fields: {} } } : undefined,
			});
	});
});

function reducerSequence(): void {
	let s = reduce(initialState(), {
		type: "openWorkspace",
		workspace: { ...wsBase, datasets: [dataset("a", 200)] },
		fileName: "bench.coatworkspace",
	});
	const preset = {
		id: "p1",
		name: "All",
		templateId: "t1",
		records: "all",
		sides: "all",
		format: "png-zip",
		scale: 1,
		dpi: 300,
		fileName: "{{index}}",
		markExported: true,
	} as ExportPreset;
	const actions: Action[] = [
		{ type: "select", keys: ["0/0"] },
		{ type: "setPreset", preset },
		{ type: "setPreset", preset: { ...preset, name: "Renamed" } },
		{
			type: "setBinding",
			id: "t1",
			binding: { datasetId: "a", fields: {} },
		},
		{ type: "datasetEdit", datasets: [dataset("a", 201)] },
		{ type: "datasetUndo" },
		{ type: "datasetRedo" },
		{
			type: "setRecordStatus",
			datasetId: "a",
			ids: ["r_1", "r_2"],
			status: "exported",
			exportedAt: "2026-09-25T00:00:00.000Z",
		},
		{ type: "renameTemplateEntry", id: "t1", fileName: "c.coat" },
		{ type: "switchTemplate", id: "t2" },
		{ type: "switchTemplate", id: "t1" },
		{ type: "removePreset", id: "p1" },
		{ type: "setBinding", id: "t1" },
	];
	for (let round = 0; round < 20; round++) {
		for (const a of actions) s = reduce(s, a);
		const t = s.doc?.history.present as Template;
		const edits = [
			unwrap(addField(t, `f${round}`, { type: "string" })).template,
			unwrap(
				updateField(t, "display_name", { type: "string", title: `N${round}` }),
			).template,
			unwrap(resizeTemplate(t, 1012 + (round % 2), 638)).template,
		];
		for (const next of edits) s = reduce(s, { type: "commit", next });
		s = reduce(s, { type: "undo" });
		s = reduce(s, { type: "redo" });
	}
}

describe("reducer", () => {
	bench("workspace and template sequence x20", reducerSequence);
});

const fieldKey = Object.keys(card.fields.properties)[0] as string;
describe("ops", () => {
	bench("addField + updateField + resizeTemplate", () => {
		unwrap(addField(card, "extra", { type: "string" }));
		unwrap(updateField(card, fieldKey, { type: "string", title: "T" }));
		unwrap(resizeTemplate(card, 1000, 600));
	});
	bench("renameField", () => {
		unwrap(renameField(card, fieldKey, "renamed"));
	});
});

// The drag path: `translateLayers` and `updateElement` both run through
// doc/tree.ts on every frame.
const geometry = geometryOf(card);
const dragKey = [...geometry.keys()]
	.filter((k) => /^0\/\d+\/\d+$/.test(k))
	.at(0) as string;
describe("tree", () => {
	bench("90 drag frames", () => {
		for (let i = 0; i < 90; i++)
			translateLayers(card, [dragKey], i % 40, -(i % 30), geometry);
	});
	bench("20 typed characters", () => {
		let t = card;
		for (let i = 0; i < 20; i++)
			t = unwrap(
				updateElement(t, dragKey, (el) => ({ ...el, id: `${el.id}x` })),
			).template;
	});
});
