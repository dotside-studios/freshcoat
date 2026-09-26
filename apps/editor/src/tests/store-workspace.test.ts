import type { Template } from "@freshcoat/coatfile";
import type { Dataset, ExportPreset } from "@freshcoat/workspace";
import { describe, expect, test } from "vitest";
import { unwrap, updateElement } from "~/doc/ops";
import { createEditorStore, isDirty } from "~/state/store";
import { workspaceSnapshot } from "~/state/workspace";
import { doc } from "./doc-fixture";

function other(): Template {
	const t = doc();
	return { ...t, id: "other", name: "Other" };
}

function dataset(id: string, rows: number): Dataset {
	return {
		id,
		name: id,
		columns: [{ key: "name", type: "text" }],
		records: Array.from({ length: rows }, (_, i) => ({
			id: `r_${id}${i}`,
			values: { name: `N${i}` },
			status: "pending" as const,
		})),
		assets: [],
	};
}

function opened() {
	const store = createEditorStore();
	store.dispatch({ type: "open", template: doc(), fileName: "doc.coat" });
	return store;
}

const s = (store: ReturnType<typeof opened>) => store.getState();
const ws = (store: ReturnType<typeof opened>) => {
	const w = store.getState().workspace;
	if (!w) throw new Error("no workspace");
	return w;
};

describe("workspace slice", () => {
	test("opening a template starts a workspace with it", () => {
		const store = opened();
		expect(ws(store).templates).toHaveLength(1);
		expect(ws(store).activeTemplateId).toBe(ws(store).templates[0]?.id);
		expect(isDirty(s(store))).toBe(false);
	});

	test("opening a second template adds it and switches to it", () => {
		const store = opened();
		store.dispatch({ type: "open", template: other(), fileName: "other.coat" });
		expect(ws(store).templates).toHaveLength(2);
		expect(s(store).doc?.history.present.id).toBe("other");
		expect(isDirty(s(store))).toBe(true);
	});

	test("switching templates keeps each one's history and view", () => {
		const store = opened();
		const first = ws(store).templates[0]?.id as string;
		const edited = unwrap(
			updateElement(s(store).doc?.history.present as Template, "0/0", {
				opacity: 0.5,
			}),
		).template;
		store.dispatch({ type: "commit", next: edited });
		store.dispatch({ type: "setSide", side: 1 });
		store.dispatch({
			type: "addTemplate",
			template: other(),
			fileName: "o.coat",
		});
		expect(s(store).doc?.history.past).toHaveLength(0);
		expect(s(store).side).toBe(0);
		store.dispatch({ type: "switchTemplate", id: first });
		expect(s(store).doc?.history.present).toBe(edited);
		expect(s(store).doc?.history.past).toHaveLength(1);
		expect(s(store).side).toBe(1);
		store.dispatch({ type: "undo" });
		expect(
			s(store).doc?.history.present.template_data[0]?.elements[0]?.opacity,
		).toBeUndefined();
	});

	test("the snapshot reads the active template live and the others parked", () => {
		const store = opened();
		const edited = unwrap(
			updateElement(s(store).doc?.history.present as Template, "0/0", {
				opacity: 0.2,
			}),
		).template;
		store.dispatch({ type: "commit", next: edited });
		store.dispatch({
			type: "addTemplate",
			template: other(),
			fileName: "o.coat",
		});
		const snap = workspaceSnapshot(s(store));
		expect(snap?.templates[0]?.template).toBe(edited);
		expect(snap?.templates[1]?.template.id).toBe("other");
	});

	test("the last template cannot be removed; removing the active one switches", () => {
		const store = opened();
		const only = ws(store).templates[0]?.id as string;
		store.dispatch({ type: "removeTemplate", id: only });
		expect(ws(store).templates).toHaveLength(1);
		store.dispatch({
			type: "addTemplate",
			template: other(),
			fileName: "o.coat",
		});
		const second = ws(store).activeTemplateId;
		store.dispatch({ type: "removeTemplate", id: second });
		expect(ws(store).templates).toHaveLength(1);
		expect(ws(store).activeTemplateId).toBe(only);
		expect(s(store).doc?.history.present.id).toBe("doc");
	});

	test("duplicate copies the live template under a new entry", () => {
		const store = opened();
		const first = ws(store).templates[0]?.id as string;
		store.dispatch({ type: "duplicateTemplate", id: first, newId: "t_copy" });
		expect(ws(store).templates.map((t) => t.id)).toEqual([first, "t_copy"]);
		expect(ws(store).templates[1]?.fileName).toBe("doc copy.coat");
		expect(ws(store).activeTemplateId).toBe("t_copy");
	});

	test("dataset edits are undoable and merge by key", () => {
		const store = opened();
		store.dispatch({ type: "datasetEdit", datasets: [dataset("a", 1)] });
		expect(ws(store).activeDatasetId).toBe("a");
		store.dispatch({
			type: "datasetEdit",
			datasets: [dataset("a", 2)],
			mergeKey: "cell",
		});
		store.dispatch({
			type: "datasetEdit",
			datasets: [dataset("a", 3)],
			mergeKey: "cell",
		});
		expect(ws(store).datasetHistory.past).toHaveLength(2);
		store.dispatch({ type: "datasetUndo" });
		expect(ws(store).datasets[0]?.records).toHaveLength(1);
		store.dispatch({ type: "datasetUndo" });
		expect(ws(store).datasets).toHaveLength(0);
		expect(ws(store).activeDatasetId).toBeNull();
		store.dispatch({ type: "datasetRedo" });
		expect(ws(store).activeDatasetId).toBe("a");
	});

	test("record status changes stamp the export time and errors", () => {
		const store = opened();
		store.dispatch({ type: "datasetEdit", datasets: [dataset("a", 3)] });
		store.dispatch({
			type: "setRecordStatus",
			datasetId: "a",
			ids: ["r_a0", "r_a1"],
			status: "exported",
			exportedAt: "2026-09-25T00:00:00.000Z",
		});
		store.dispatch({
			type: "setRecordStatus",
			datasetId: "a",
			ids: ["r_a2"],
			status: "failed",
			errors: { r_a2: "boom" },
		});
		const records = ws(store).datasets[0]?.records ?? [];
		expect(records.map((r) => r.status)).toEqual([
			"exported",
			"exported",
			"failed",
		]);
		expect(records[0]?.exportedAt).toBe("2026-09-25T00:00:00.000Z");
		expect(records[2]?.error).toBe("boom");
		store.dispatch({
			type: "setRecordStatus",
			datasetId: "a",
			ids: ["r_a2"],
			status: "pending",
		});
		expect(ws(store).datasets[0]?.records[2]?.error).toBeUndefined();
	});

	test("presets upsert, activate and go when their template goes", () => {
		const store = opened();
		store.dispatch({
			type: "addTemplate",
			template: other(),
			fileName: "o.coat",
		});
		const templateId = ws(store).activeTemplateId;
		const preset: ExportPreset = {
			id: "p1",
			name: "All",
			templateId,
			records: "all",
			sides: "all",
			format: "png-zip",
			scale: 1,
			dpi: 300,
			fileName: "{{template}}-{{index}}-{{side}}",
			markExported: true,
		};
		store.dispatch({ type: "setPreset", preset });
		expect(ws(store).activePresetId).toBe("p1");
		store.dispatch({
			type: "setPreset",
			preset: { ...preset, name: "Renamed" },
		});
		expect(ws(store).presets).toHaveLength(1);
		store.dispatch({ type: "removeTemplate", id: templateId });
		expect(ws(store).presets).toHaveLength(0);
	});

	test("saving marks the workspace clean and undo back to it stays clean", () => {
		const store = opened();
		store.dispatch({ type: "datasetEdit", datasets: [dataset("a", 1)] });
		expect(isDirty(s(store))).toBe(true);
		store.dispatch({ type: "datasetUndo" });
		expect(isDirty(s(store))).toBe(false);
	});

	test("switching templates resets the record preview and selection", () => {
		const store = opened();
		const first = ws(store).templates[0]?.id as string;
		store.dispatch({ type: "setPreviewRecord", id: "r_x" });
		store.dispatch({ type: "select", keys: ["0/0"] });
		store.dispatch({
			type: "addTemplate",
			template: other(),
			fileName: "o.coat",
		});
		expect(s(store).previewRecordId).toBeNull();
		store.dispatch({ type: "switchTemplate", id: first });
		expect(s(store).selection).toEqual([]);
	});
});
