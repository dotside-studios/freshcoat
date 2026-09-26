import type { Template } from "@freshcoat/coatfile";
import type { Binding, Dataset, ExportPreset } from "@freshcoat/workspace";
import { describe, expect, test } from "vitest";
import type { LayerGeometry } from "~/doc/geometry";
import {
	addField,
	removeField,
	removeSide,
	renameElement,
	renameField,
	resizeTemplate,
	setFrameProp,
	unwrap,
	updateField,
} from "~/doc/ops";
import { produce } from "~/state/immer";
import {
	type Action,
	createEditorStore,
	type EditorState,
	isDirty,
	reduce,
} from "~/state/store";
import {
	patchBindings,
	undoDatasets,
	withRecordStatus,
	workspaceSnapshot,
} from "~/state/workspace";
import { deepFreeze, doc, frozenDoc } from "./doc-fixture";

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

const binding: Binding = { datasetId: "a", fields: {} };

/** Two templates, a dataset, a preset and a binding on the active one. */
function workspace(): EditorState {
	let s = reduce(
		createEditorStore().getState(),
		// The first template stays parked behind the second.
		{ type: "open", template: doc(), fileName: "doc.coat" },
	);
	s = reduce(s, {
		type: "open",
		template: { ...doc(), id: "other" },
		fileName: "other.coat",
	});
	const id = s.workspace?.activeTemplateId as string;
	const preset = {
		id: "p1",
		name: "All",
		templateId: id,
		records: "all",
		sides: "all",
		format: "png-zip",
		scale: 1,
		dpi: 300,
		fileName: "{{index}}",
		markExported: true,
	} as ExportPreset;
	for (const a of [
		{ type: "datasetEdit", datasets: [dataset("a", 3)] },
		{ type: "setPreset", preset },
		{ type: "setBinding", id, binding },
	] as Action[])
		s = reduce(s, a);
	return s;
}

const active = (s: EditorState) => s.workspace?.activeTemplateId as string;
const parked = (s: EditorState) =>
	s.workspace?.templates.find((t) => t.id !== active(s))?.id as string;

describe("recipes that change nothing return their base", () => {
	const noops: [string, (s: EditorState) => Action][] = [
		[
			"switchTemplate to the active one",
			(s) => ({ type: "switchTemplate", id: active(s) }),
		],
		[
			"switchTemplate to an unknown one",
			() => ({ type: "switchTemplate", id: "nope" }),
		],
		[
			"removeTemplate of an unknown one",
			() => ({ type: "removeTemplate", id: "nope" }),
		],
		[
			"renameWorkspace to its name",
			(s) => ({ type: "renameWorkspace", name: s.workspace?.name as string }),
		],
		[
			"workspaceSaved with what is saved",
			(s) => ({ type: "workspaceSaved", saved: s.workspace?.saved as never }),
		],
		[
			"renameTemplateEntry to its name",
			(s) => ({
				type: "renameTemplateEntry",
				id: active(s),
				fileName: "other.coat",
			}),
		],
		[
			"renameTemplateEntry of an unknown one",
			() => ({ type: "renameTemplateEntry", id: "nope", fileName: "x" }),
		],
		[
			"setBinding to the same binding",
			(s) => ({ type: "setBinding", id: active(s), binding }),
		],
		[
			"setBinding of an unknown template",
			() => ({ type: "setBinding", id: "nope", binding }),
		],
		[
			"setBinding to none where there is none",
			(s) => ({ type: "setBinding", id: parked(s) }),
		],
		[
			"datasetEdit with the same datasets",
			(s) => ({
				type: "datasetEdit",
				datasets: s.workspace?.datasets as Dataset[],
			}),
		],
		["datasetRedo with nothing to redo", () => ({ type: "datasetRedo" })],
		[
			"setActiveDataset to the active one",
			() => ({ type: "setActiveDataset", id: "a" }),
		],
		[
			"setRecordStatus to the status held",
			() => ({
				type: "setRecordStatus",
				datasetId: "a",
				ids: ["r_a0"],
				status: "pending",
			}),
		],
		[
			"setRecordStatus in an unknown dataset",
			() => ({
				type: "setRecordStatus",
				datasetId: "nope",
				ids: ["r_a0"],
				status: "exported",
			}),
		],
		[
			"setPreset with the same preset",
			(s) => ({
				type: "setPreset",
				preset: s.workspace?.presets[0] as ExportPreset,
			}),
		],
		[
			"removePreset of an unknown one",
			() => ({ type: "removePreset", id: "nope" }),
		],
		[
			"setActivePreset to the active one",
			() => ({ type: "setActivePreset", id: "p1" }),
		],
	];
	for (const [name, action] of noops)
		test(name, () => {
			const s = workspace();
			expect(reduce(s, action(s))).toBe(s);
		});

	test("datasetUndo with nothing to undo", () => {
		const s = reduce(createEditorStore().getState(), {
			type: "open",
			template: doc(),
			fileName: "doc.coat",
		});
		expect(reduce(s, { type: "datasetUndo" })).toBe(s);
		const ws = s.workspace;
		if (!ws) throw new Error("no workspace");
		expect(undoDatasets(ws)).toBe(ws);
	});

	test("removeTemplate of the last one", () => {
		const s = reduce(createEditorStore().getState(), {
			type: "open",
			template: doc(),
			fileName: "doc.coat",
		});
		expect(
			reduce(s, {
				type: "removeTemplate",
				id: active(s),
			}),
		).toBe(s);
	});

	test("withRecordStatus and patchBindings", () => {
		const datasets = [dataset("a", 3)];
		expect(withRecordStatus(datasets, "a", ["r_a1"], "pending")).toBe(datasets);
		expect(withRecordStatus(datasets, "b", ["r_a1"], "failed")).toBe(datasets);
		const templates = workspace().workspace?.templates ?? [];
		const bound = templates.find((t) => t.binding);
		expect(
			patchBindings(templates, { [bound?.id as string]: binding }).templates,
		).toBe(templates);
	});

	test("the template ops", () => {
		const t = frozenDoc();
		const same = (r: ReturnType<typeof updateField>) => unwrap(r).template;
		expect(same(updateField(t, "name", t.fields.properties.name))).toBe(t);
		expect(same(resizeTemplate(t, t.width, t.height))).toBe(t);
		expect(same(renameField(t, "name", "name"))).toBe(t);
		expect(same(renameElement(t, "0/0", "a"))).toBe(t);
		expect(same(setFrameProp(t, 0, { name: "front" }))).toBe(t);
	});
});

describe("recipes share what they did not change", () => {
	test("field ops copy only the fields", () => {
		const t = frozenDoc();
		const withExtra = deepFreeze({
			...doc(),
			fields: {
				...doc().fields,
				properties: { ...doc().fields.properties, extra: { type: "string" } },
				required: ["name", "extra", "title"],
			},
		} as Template);
		for (const [base, next] of [
			[t, unwrap(addField(t, "extra", { type: "string" })).template],
			[
				t,
				unwrap(updateField(t, "title", { type: "string", title: "T" }))
					.template,
			],
			[withExtra, unwrap(removeField(withExtra, "extra")).template],
		] as const) {
			expect(next).not.toBe(base);
			expect(next.template_data).toBe(base.template_data);
			expect(next.variants).toBe(base.variants);
			expect(next.fonts).toBe(base.fonts);
		}
		expect(
			unwrap(removeField(withExtra, "extra")).template.fields.required,
		).toEqual(["name", "title"]);
	});

	test("renaming a field copies only the layers that name it", () => {
		const t = frozenDoc();
		const next = unwrap(renameField(t, "show", "visible")).template;
		expect(next.template_data[1]).toBe(t.template_data[1]);
		expect(next.template_data[0]?.elements[0]).toBe(
			t.template_data[0]?.elements[0],
		);
		expect(next.template_data[0]?.elements[4]?.visibleWhen).toMatchObject({
			field: "visible",
		});
	});

	test("resizing copies only the backgrounds with a size", () => {
		const t = frozenDoc();
		const next = unwrap(resizeTemplate(t, 800, 500)).template;
		expect(next.template_data[0]?.background.size).toEqual({
			width: 800,
			height: 500,
		});
		expect(next.template_data[0]?.elements).toBe(t.template_data[0]?.elements);
		expect(next.template_data[1]).toBe(t.template_data[1]);
		expect(next.variants).toBe(t.variants);
	});

	test("removing a side drops its overrides and keeps the rest", () => {
		const t = frozenDoc();
		const next = unwrap(removeSide(t, 1)).template;
		expect(next.variants?.[0]?.overrides.map((o) => o.name)).toEqual(["front"]);
		expect(next.variants?.[0]?.overrides[0]).toBe(
			t.variants?.[0]?.overrides[0],
		);
	});
});

// A Map or Set that throws on any change. Immer also throws on reading one
// off a draft, since the MapSet plugin is not loaded.
function sealed<C extends Map<string, unknown> | Set<string>>(c: C): C {
	for (const m of ["add", "set", "delete", "clear"])
		if (m in c)
			Object.defineProperty(c, m, {
				value: () => {
					throw new Error(`a recipe called ${m} on a state collection`);
				},
			});
	return c;
}

describe("Maps and Sets are replaced, never drafted", () => {
	test("every workspace action and template op leaves them alone", () => {
		let s = workspace();
		const hidden = sealed(new Set(["0/0"]));
		const locked = sealed(new Set(["0/1"]));
		const geometry = sealed(new Map()) as LayerGeometry;
		s = { ...s, hidden, locked, geometry };
		const first = active(s);
		const second = parked(s);
		const t = s.doc?.history.present as Template;
		const actions: Action[] = [
			{ type: "switchTemplate", id: second },
			{ type: "renameWorkspace", name: "Renamed" },
			{ type: "renameTemplateEntry", id: first, fileName: "first.coat" },
			{ type: "setBinding", id: first, binding },
			{ type: "setBinding", id: first },
			{
				type: "datasetEdit",
				datasets: [dataset("a", 4)],
				bindings: { [first]: binding },
			},
			{ type: "datasetUndo" },
			{ type: "datasetRedo" },
			{
				type: "setRecordStatus",
				datasetId: "a",
				ids: ["r_a0"],
				status: "exported",
				exportedAt: "2026-09-25T00:00:00.000Z",
			},
			{ type: "setActiveDataset", id: null },
			{ type: "removePreset", id: "p1" },
			{ type: "switchTemplate", id: first },
			{
				type: "commit",
				next: unwrap(addField(t, "x", { type: "string" })).template,
			},
			{ type: "commit", next: unwrap(resizeTemplate(t, 900, 500)).template },
			{
				type: "commit",
				next: unwrap(renameField(t, "show", "shown")).template,
			},
			{ type: "addTemplate", template: doc(), fileName: "third.coat" },
			{ type: "removeTemplate", id: second },
		];
		for (const a of actions) s = reduce(s, a);
		expect([...hidden]).toEqual(["0/0"]);
		expect([...locked]).toEqual(["0/1"]);
		expect(geometry.size).toBe(0);
		// Parked and brought back whole.
		s = reduce(s, { type: "switchTemplate", id: first });
		expect(s.hidden).toBe(hidden);
		expect(s.locked).toBe(locked);
	});

	test("reading one off a draft throws", () => {
		const s = workspace();
		expect(() =>
			produce(s, (d) => {
				d.hidden.has("0/0");
			}),
		).toThrow();
	});
});

describe("dirty after undo", () => {
	test("undo back to the saved state reads clean after recipe-written changes", () => {
		const store = createEditorStore(workspace());
		const save = () => {
			const saved = workspaceSnapshot(store.getState());
			if (saved) store.dispatch({ type: "workspaceSaved", saved });
		};
		save();
		expect(isDirty(store.getState())).toBe(false);
		const id = active(store.getState());

		store.dispatch({
			type: "setRecordStatus",
			datasetId: "a",
			ids: ["r_a0", "r_a1"],
			status: "exported",
			exportedAt: "2026-09-25T00:00:00.000Z",
		});
		expect(isDirty(store.getState())).toBe(true);
		store.dispatch({ type: "datasetUndo" });
		expect(isDirty(store.getState())).toBe(false);

		store.dispatch({
			type: "datasetEdit",
			datasets: store.getState().workspace?.datasets as Dataset[],
			bindings: { [id]: undefined },
		});
		expect(isDirty(store.getState())).toBe(true);
		store.dispatch({ type: "datasetUndo" });
		expect(isDirty(store.getState())).toBe(false);

		const t = store.getState().doc?.history.present as Template;
		store.dispatch({
			type: "commit",
			next: unwrap(resizeTemplate(t, 640, 480)).template,
		});
		store.dispatch({
			type: "commit",
			next: unwrap(
				addField(store.getState().doc?.history.present as Template, "extra", {
					type: "string",
				}),
			).template,
		});
		expect(isDirty(store.getState())).toBe(true);
		store.dispatch({ type: "undo" });
		store.dispatch({ type: "undo" });
		expect(isDirty(store.getState())).toBe(false);
	});
});
