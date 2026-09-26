import type { Template } from "@freshcoat/coatfile";
import type {
	Binding,
	DataRecord,
	Dataset,
	ExportPreset,
	RecordStatus,
	TemplateEntry,
	Workspace,
} from "@freshcoat/workspace";
import type { LayerGeometry } from "~/doc/geometry";
import { produce, produceAt } from "./immer";
import type { DocState, EditorState } from "./store";

export type Section = "edit" | "data" | "export";

/** An inactive template's editor, kept so switching back restores its undo
 *  history, side, preview values and view. */
export type ParkedEditor = Pick<
	EditorState,
	"side" | "variantId" | "values" | "hidden" | "locked" | "view"
> & { doc: DocState };

export type TemplateSlot = {
	id: string;
	fileName: string;
	binding?: Binding;
	/** The template as last parked. Stale for the active slot, whose live
	 *  state is `EditorState.doc`. */
	template: Template;
	parked?: ParkedEditor;
};

/** The bindings a step changed, as they were before it; a template missing
 *  from the map was not touched. */
export type BindingPatch = Record<string, Binding | undefined>;

export type DatasetStep = { datasets: Dataset[]; bindings?: BindingPatch };

export type DatasetHistory = {
	past: DatasetStep[];
	future: DatasetStep[];
	merge?: { key: string; at: number };
};

export type WorkspaceState = {
	name: string;
	fileName: string;
	templates: TemplateSlot[];
	activeTemplateId: string;
	datasets: Dataset[];
	datasetHistory: DatasetHistory;
	activeDatasetId: string | null;
	presets: ExportPreset[];
	activePresetId: string | null;
	/** What was last opened or saved; dirty is a comparison with it. */
	saved: Workspace;
};

export const DATASET_HISTORY_CAP = 100;
const MERGE_WINDOW_MS = 1000;

export function newId(prefix: string): string {
	const hex =
		typeof crypto !== "undefined" && "randomUUID" in crypto
			? crypto.randomUUID().replace(/-/g, "")
			: Math.random().toString(16).slice(2).padEnd(8, "0");
	return `${prefix}_${hex.slice(0, 8)}`;
}

export function workspaceState(
	ws: Workspace,
	fileName: string,
): WorkspaceState {
	return {
		name: ws.name,
		fileName,
		templates: ws.templates.map((e) => ({
			id: e.id,
			fileName: e.fileName,
			binding: e.binding,
			template: e.template,
		})),
		activeTemplateId: ws.templates[0]?.id ?? "",
		datasets: ws.datasets,
		datasetHistory: { past: [], future: [] },
		activeDatasetId: ws.datasets[0]?.id ?? null,
		presets: ws.presets,
		activePresetId: ws.presets[0]?.id ?? null,
		saved: ws,
	};
}

export function singleTemplateWorkspace(
	template: Template,
	fileName: string,
): Workspace {
	return {
		formatVersion: "1.0",
		name: template.name || "Untitled",
		templates: [{ id: newId("t"), fileName, template }],
		datasets: [],
		presets: [],
	};
}

/** The workspace as it stands, the active template read from its editor. */
export function workspaceSnapshot(state: EditorState): Workspace | null {
	const ws = state.workspace;
	if (!ws) return null;
	const live = state.doc?.history.present;
	return {
		formatVersion: "1.0",
		name: ws.name,
		templates: ws.templates.map(
			(s): TemplateEntry => ({
				id: s.id,
				fileName: s.fileName,
				template:
					s.id === ws.activeTemplateId && live
						? live
						: (s.parked?.doc.history.present ?? s.template),
				...(s.binding ? { binding: s.binding } : {}),
			}),
		),
		datasets: ws.datasets,
		presets: ws.presets,
	};
}

/** Unsaved when anything differs by identity from what was opened or saved,
 *  so undoing back to the saved state is clean again. */
export function workspaceDirty(state: EditorState): boolean {
	const now = workspaceSnapshot(state);
	const saved = state.workspace?.saved;
	if (!now || !saved) return false;
	if (now.name !== saved.name) return true;
	if (now.datasets !== saved.datasets || now.presets !== saved.presets)
		return true;
	if (now.templates.length !== saved.templates.length) return true;
	return now.templates.some((t, i) => {
		const s = saved.templates[i];
		return (
			!s ||
			s.id !== t.id ||
			s.fileName !== t.fileName ||
			s.template !== t.template ||
			s.binding !== t.binding
		);
	});
}

export function activeSlot(state: EditorState): TemplateSlot | undefined {
	const ws = state.workspace;
	return ws?.templates.find((s) => s.id === ws.activeTemplateId);
}

export function activeDataset(state: EditorState): Dataset | undefined {
	const ws = state.workspace;
	return ws?.datasets.find((d) => d.id === ws.activeDatasetId);
}

/** Moves the current editor into its slot and brings `id`'s out. */
export function switchTo(
	state: EditorState,
	id: string,
	fresh: (template: Template, fileName: string) => ParkedEditor,
): EditorState {
	const ws = state.workspace;
	if (!ws || ws.activeTemplateId === id) return state;
	const to = ws.templates.findIndex((s) => s.id === id);
	const target = ws.templates[to];
	if (!target) return state;
	const from = ws.templates.findIndex((s) => s.id === ws.activeTemplateId);
	const doc = state.doc;
	let templates = ws.templates;
	if (doc)
		templates = produceAt(templates, from, (slot) => {
			slot.template = doc.history.present;
			slot.parked = {
				doc,
				side: state.side,
				variantId: state.variantId,
				values: state.values,
				hidden: state.hidden,
				locked: state.locked,
				view: state.view,
			};
		});
	templates = produceAt(templates, to, (slot) => {
		delete slot.parked;
	});
	const next = target.parked ?? fresh(target.template, target.fileName);
	return {
		...state,
		...next,
		workspace: produce(ws, (w) => {
			w.templates = templates;
			w.activeTemplateId = id;
		}),
		selection: [],
		hover: null,
		geometry: new Map() as LayerGeometry,
		previewRecordId: null,
		variantBeforeRecord: undefined,
	};
}

/** Sets or, with `undefined`, removes the bindings in `patch`, returning the
 *  ones they replaced. */
export function patchBindings(
	templates: TemplateSlot[],
	patch: BindingPatch,
): { templates: TemplateSlot[]; before: BindingPatch } {
	// Spreads rather than recipes, since commitDatasets runs this: two
	// produce calls a slot would double the cost of a commit that patches one.
	const before: BindingPatch = {};
	let changed = false;
	const next = templates.map((s) => {
		if (!(s.id in patch)) return s;
		before[s.id] = s.binding;
		const binding = patch[s.id];
		if (binding === s.binding) return s;
		changed = true;
		const { binding: _b, ...rest } = s;
		return binding ? { ...rest, binding } : rest;
	});
	return { templates: changed ? next : templates, before };
}

/** Commits a new dataset list as one undo step, with any bindings that change
 *  alongside it; the same `mergeKey` within a second replaces the previous
 *  step instead, as template edits do. */
export function commitDatasets(
	ws: WorkspaceState,
	next: Dataset[],
	opts: {
		mergeKey?: string;
		now?: number;
		record?: boolean;
		bindings?: BindingPatch;
	} = {},
): WorkspaceState {
	const patch = opts.bindings && Object.keys(opts.bindings).length > 0;
	if (next === ws.datasets && !patch) return ws;
	const { templates, before } = patch
		? patchBindings(ws.templates, opts.bindings ?? {})
		: { templates: ws.templates, before: undefined };
	// Spreads rather than a recipe: a commit costs about 0.3 µs, and produce's
	// fixed cost per call would make it ten times that.
	if (opts.record === false) return { ...ws, templates, datasets: next };
	const now = opts.now ?? Date.now();
	const h = ws.datasetHistory;
	const last = h.past.at(-1);
	const merging =
		opts.mergeKey !== undefined &&
		h.merge?.key === opts.mergeKey &&
		now - h.merge.at < MERGE_WINDOW_MS &&
		last !== undefined;
	const step: DatasetStep = merging
		? before
			? { ...last, bindings: { ...before, ...last.bindings } }
			: last
		: { datasets: ws.datasets, ...(before ? { bindings: before } : {}) };
	return {
		...ws,
		templates,
		datasets: next,
		datasetHistory: {
			past: merging
				? [...h.past.slice(0, -1), step]
				: [...h.past, step].slice(-DATASET_HISTORY_CAP),
			future: [],
			...(opts.mergeKey ? { merge: { key: opts.mergeKey, at: now } } : {}),
		},
	};
}

/** Restores `step`; `history` is given the step that would bring back what
 *  it replaced. */
function restore(
	ws: WorkspaceState,
	step: DatasetStep,
	history: (inverse: DatasetStep) => DatasetHistory,
): WorkspaceState {
	const { templates, before } = step.bindings
		? patchBindings(ws.templates, step.bindings)
		: { templates: ws.templates, before: undefined };
	return produce(ws, (w) => {
		w.templates = templates;
		w.datasets = step.datasets;
		w.activeDatasetId = keepActive(ws.activeDatasetId, step.datasets);
		w.datasetHistory = history({
			datasets: ws.datasets,
			...(before ? { bindings: before } : {}),
		});
	});
}

export function undoDatasets(ws: WorkspaceState): WorkspaceState {
	const { past, future } = ws.datasetHistory;
	const step = past.at(-1);
	if (!step) return ws;
	return restore(ws, step, (inverse) => ({
		past: past.slice(0, -1),
		future: [inverse, ...future],
	}));
}

export function redoDatasets(ws: WorkspaceState): WorkspaceState {
	const [step, ...rest] = ws.datasetHistory.future;
	if (!step) return ws;
	return restore(ws, step, (inverse) => ({
		past: [...ws.datasetHistory.past, inverse],
		future: rest,
	}));
}

function keepActive(id: string | null, list: Dataset[]): string | null {
	return list.some((d) => d.id === id) ? id : (list[0]?.id ?? null);
}

/** Sets the status of some records; export results carry a time or an error. */
export function withRecordStatus(
	datasets: Dataset[],
	datasetId: string,
	ids: readonly string[],
	status: RecordStatus,
	extra: { exportedAt?: string; errors?: Record<string, string> } = {},
): Dataset[] {
	const wanted = new Set(ids);
	const at = datasets.findIndex((d) => d.id === datasetId);
	return produceAt(datasets, at, (d, base) => {
		// A draft of the records list costs about ten times this map at 10k
		// records, so the list is built here and assigned whole.
		let changed = false;
		const records = base.records.map((r): DataRecord => {
			if (!wanted.has(r.id)) return r;
			const error = extra.errors?.[r.id];
			if (
				r.status === status &&
				!extra.exportedAt &&
				(error ?? undefined) === r.error
			)
				return r;
			changed = true;
			const { error: _e, ...rest } = r;
			return {
				...rest,
				status,
				...(status === "exported" && extra.exportedAt
					? { exportedAt: extra.exportedAt }
					: r.exportedAt
						? { exportedAt: r.exportedAt }
						: {}),
				...(error ? { error } : {}),
			};
		});
		if (changed) d.records = records;
	});
}
