import type { Template, ValidationError } from "@freshcoat-js/coatfile";
import { validate } from "@freshcoat-js/coatfile";
import { COAT_EXTENSION, templateStem } from "@freshcoat-js/coatfile/coat";
import {
	type Binding,
	type Dataset,
	type ExportPreset,
	newId,
	type RecordStatus,
	type Workspace,
} from "@freshcoat-js/workspace";
import { type DataViewState, DEFAULT_DATA_VIEW } from "~/data/data-view";
import { type LayerGeometry, sameGeometry } from "~/doc/geometry";
import { guidesForSides, type TemplateGuides } from "~/doc/guides";
import {
	begin,
	cancel,
	commit,
	commitGuides,
	createHistory,
	end,
	type History,
	preview,
	redo,
	undo,
} from "~/doc/history";
import { getElement, keyRemapper, sameStructure } from "~/doc/path";
import { sampleValues } from "~/doc/values";
import {
	activeVariantId,
	foldVariantEdit,
	workingTemplate,
} from "~/doc/variant-edit";
import type { SchedulerStats } from "~/render/scheduler";
import type { RenderTimings } from "~/render/session";
import { type Draft, produce, produceAt } from "./immer";
import {
	activeSlot,
	type BindingPatch,
	commitDatasets,
	type ParkedEditor,
	patchBindings,
	redoDatasets,
	type Section,
	singleTemplateWorkspace,
	switchTo,
	type TemplateSlot,
	undoDatasets,
	type WorkspaceState,
	withJobStatus,
	withRecordStatus,
	workspaceDirty,
	workspaceState,
} from "./workspace";

export type Tool =
	| "move"
	| "hand"
	| "frame"
	| "rect"
	| "ellipse"
	| "text"
	| "pen"
	| "image"
	| "placeholder"
	| "qr"
	| "barcode";

export type RightTab = "design" | "content";

/** Tab ids an older build stored or dispatched, mapped to where their
 *  contents live now. */
const LEGACY_TAB: Record<string, RightTab> = {
	variables: "content",
	template: "design",
};

export type View = { x: number; y: number; zoom: number };

/** Where an edit lands while a variant is active: folded into the variant's
 *  overrides, or applied to the base, and so to every variant. */
export type EditScope = "variant" | "base";

export type DocState = {
	history: History;
	fileName: string;
	/** The template as last saved (or opened); dirty is a comparison with it. */
	saved: Template;
	issues: ValidationError[];
	/** `issues` predate `history.present`: a merging edit or a transaction
	 *  left validation for when it settles. */
	issuesStale?: boolean;
	/** The template the selection, hidden and locked keys name layers in,
	 *  when a transaction left them unmapped. Absent when it is the present. */
	keysAt?: Template;
	/** What loading had to say about the file: healed ids, a newer format. */
	notices: string[];
};

/** A barcode whose value the encoder refused in the last render. `key` is the
 *  layer, when the render could name it. */
export type BarcodeIssue = {
	key?: string;
	symbology: string;
	value: string;
	message: string;
};

export type RenderState = {
	status: "idle" | "rendering" | "ok" | "error";
	error?: string;
	timings?: RenderTimings;
	stats?: SchedulerStats;
	warnings: string[];
	barcodes?: BarcodeIssue[];
};

/** What Export shows around its preview, kept while another section shows. */
export type ExportView = {
	tab: "filmstrip" | "records";
	filter: "all" | RecordStatus;
	scope: "export" | "all" | "failed";
	/** Records chosen in the list, when the preset does not keep its own. */
	selection: string[];
	settingsTab: "content" | "output" | "print" | "files";
};

const EXPORT_VIEW: ExportView = {
	tab: "filmstrip",
	filter: "all",
	scope: "export",
	selection: [],
	settingsTab: "content",
};

export type EditorState = {
	doc: DocState | null;
	side: number;
	/** The active variant: what the canvas shows and where edits go. */
	variantId?: string;
	/** The variant that was active when a record preview began, restored when
	 *  it ends. Absent when no record preview set one. */
	variantBeforeRecord?: { variantId?: string };
	values: Record<string, string>;
	selection: string[];
	hover: string | null;
	hidden: ReadonlySet<string>;
	locked: ReadonlySet<string>;
	tool: Tool;
	view: View;
	panels: { left: boolean; right: boolean };
	rulers: boolean;
	rightTab: RightTab;
	/** Fields the Content tab is asked to expand and scroll to. */
	shownFields: string[] | null;
	geometry: LayerGeometry;
	render: RenderState;
	section: Section;
	/** Null exactly when `doc` is: the welcome screen. */
	workspace: WorkspaceState | null;
	/** The dataset record the Edit preview shows, when bound. */
	previewRecordId: string | null;
	/** The current dataset record, shared by Edit's preview, Data's focused
	 *  record and Export's preview; each shows it when its dataset has it. */
	recordId: string | null;
	exportView: ExportView;
	/** Data's search, filters, sort and selection, by dataset id. */
	dataViews: Readonly<Record<string, DataViewState>>;
	/** The gradient fill last opened in the inspector, which the canvas
	 *  handles edit while its layer is the one selected. */
	activeFill: { key: string; index: number } | null;
	/** The text layer being edited on the canvas, which the render leaves out
	 *  while its editor stands in for it. */
	textEdit: string | null;
};

export type Action =
	| {
			type: "open";
			template: Template;
			fileName: string;
			notices?: string[];
	  }
	| { type: "close" }
	| {
			type: "commit";
			next: Template;
			mergeKey?: string;
			select?: string[];
			/** Defaults to "variant": `next` is an edit of the working template. */
			scope?: EditScope;
	  }
	| { type: "txBegin" }
	| {
			type: "txPreview";
			next: Template;
			select?: string[];
			scope?: EditScope;
	  }
	| {
			type: "guides";
			guides: TemplateGuides;
			preview?: boolean;
			mergeKey?: string;
	  }
	| { type: "txEnd" }
	| { type: "validate" }
	| { type: "txCancel" }
	| { type: "undo" }
	| { type: "redo" }
	| { type: "saved"; template: Template; fileName?: string }
	| { type: "setSide"; side: number }
	| { type: "setVariant"; variantId?: string }
	| { type: "setValue"; field: string; value: string }
	| { type: "resetValues" }
	| { type: "select"; keys: string[]; mode?: "replace" | "add" | "toggle" }
	| { type: "hover"; key: string | null }
	| { type: "textEdit"; key: string | null }
	| { type: "toggleHidden"; key: string }
	| { type: "toggleLocked"; key: string }
	| { type: "setTool"; tool: Tool }
	| { type: "setView"; view: View }
	| { type: "setPanels"; panels: Partial<EditorState["panels"]> }
	| { type: "setRulers"; on: boolean }
	| { type: "setRightTab"; tab: RightTab }
	| { type: "showFields"; fields: string[] | null }
	| { type: "setActiveFill"; fill: { key: string; index: number } | null }
	| {
			type: "rendered";
			geometry: LayerGeometry;
			timings: RenderTimings;
			stats: SchedulerStats;
			warnings: string[];
			barcodes?: BarcodeIssue[];
	  }
	| { type: "renderFailed"; error: string }
	| {
			type: "openWorkspace";
			workspace: Workspace;
			fileName: string;
			notices?: string[];
	  }
	| { type: "workspaceSaved"; saved: Workspace; fileName?: string }
	| { type: "renameWorkspace"; name: string }
	| { type: "setSection"; section: Section }
	| { type: "switchTemplate"; id: string }
	| {
			type: "addTemplate";
			template: Template;
			fileName: string;
			id?: string;
			guides?: TemplateGuides;
	  }
	| { type: "removeTemplate"; id: string }
	| {
			type: "restoreTemplate";
			slot: TemplateSlot;
			index: number;
			presets: ExportPreset[];
	  }
	| { type: "renameTemplateEntry"; id: string; fileName: string }
	| { type: "duplicateTemplate"; id: string; newId?: string }
	| { type: "setBinding"; id: string; binding?: Binding }
	| {
			type: "datasetEdit";
			datasets: Dataset[];
			mergeKey?: string;
			activeId?: string;
			/** Bindings that change in the same undo step, by template id. */
			bindings?: BindingPatch;
	  }
	| { type: "datasetUndo" }
	| { type: "datasetRedo" }
	| { type: "setActiveDataset"; id: string | null }
	| {
			type: "setRecordStatus";
			datasetId: string;
			ids: string[];
			status: RecordStatus;
			exportedAt?: string;
			errors?: Record<string, string>;
			fromJob?: true;
	  }
	| { type: "setPreset"; preset: ExportPreset }
	| { type: "removePreset"; id: string }
	| { type: "setActivePreset"; id: string | null }
	| { type: "setPreviewRecord"; id: string | null }
	| { type: "setRecord"; id: string | null }
	| { type: "setExportView"; view: Partial<ExportView> }
	| { type: "setDataView"; datasetId: string; patch: Partial<DataViewState> }
	| {
			type: "previewRecord";
			id: string;
			values: Record<string, string>;
			variantId?: string;
	  };

const EMPTY_SET: ReadonlySet<string> = new Set();

export function initialState(
	panels: EditorState["panels"] = { left: true, right: true },
): EditorState {
	return {
		doc: null,
		side: 0,
		values: {},
		selection: [],
		hover: null,
		hidden: EMPTY_SET,
		locked: EMPTY_SET,
		tool: "move",
		view: { x: 0, y: 0, zoom: 1 },
		panels,
		rulers: false,
		rightTab: "design",
		shownFields: null,
		geometry: new Map(),
		render: { status: "idle", warnings: [] },
		section: "edit",
		workspace: null,
		previewRecordId: null,
		recordId: null,
		exportView: EXPORT_VIEW,
		dataViews: {},
		activeFill: null,
		textEdit: null,
	};
}

function freshEditor(
	template: Template,
	fileName: string,
	view: View,
	notices: string[] = [],
	guides?: TemplateGuides,
): ParkedEditor {
	return {
		doc: {
			history: createHistory(template, guides),
			fileName,
			saved: template,
			issues: issuesOf(template),
			notices,
		},
		side: 0,
		variantId: undefined,
		values: sampleValues(template),
		hidden: EMPTY_SET,
		locked: EMPTY_SET,
		view,
	};
}

/** The base template: what saving, autosave and exports read. */
export function present(state: Pick<EditorState, "doc">): Template | null {
	return state.doc?.history.present ?? null;
}

/**
 * The template as the editor shows and edits it: the base with the active
 * variant applied, hidden layers kept. The base when no variant
 * is active. Memoised on the base and the variant id.
 */
export function working(
	state: Pick<EditorState, "doc" | "variantId">,
): Template | null {
	const t = present(state);
	return t && workingTemplate(t, state.variantId);
}

/** `next` as the base it stands for: folded into the active variant unless
 *  the edit is scoped to the base. */
function landEdit(
	state: EditorState,
	base: Template,
	next: Template,
	scope: EditScope | undefined,
): Template {
	const id = activeVariantId(base, state.variantId);
	return scope === "base" || id === undefined
		? next
		: foldVariantEdit(base, id, next);
}

/** Drops an active variant the base no longer has. */
function withKnownVariant(state: EditorState): EditorState {
	const t = present(state);
	if (state.variantId === undefined || !t) return state;
	return activeVariantId(t, state.variantId) === undefined
		? { ...state, variantId: undefined }
		: state;
}

export function isDirty(state: EditorState): boolean {
	return workspaceDirty(state);
}

export function reduce(state: EditorState, action: Action): EditorState {
	switch (action.type) {
		case "open":
		case "openWorkspace":
		case "switchTemplate":
		case "addTemplate":
		case "removeTemplate":
		case "restoreTemplate":
		case "duplicateTemplate":
			return withKnownVariant(reduceOpen(validated(state), action));
		case "commit":
			return withHistory(
				state,
				(h) => {
					const next = landEdit(state, h.present, action.next, action.scope);
					return commit(h, next, {
						mergeKey: action.mergeKey,
						guides: followSides(h, next),
					});
				},
				{ select: action.select, validate: action.mergeKey === undefined },
			);
		case "txBegin":
			return withHistory(state, begin);
		case "txPreview":
			return withHistory(
				state,
				(h) => {
					const next = landEdit(state, h.present, action.next, action.scope);
					return preview(h, next, followSides(h, next));
				},
				{ select: action.select },
			);
		case "guides":
			return withHistory(state, (h) =>
				action.preview
					? preview(h, h.present, action.guides)
					: commitGuides(h, action.guides, { mergeKey: action.mergeKey }),
			);
		case "txEnd":
			return withHistory(state, end, { validate: true });
		case "validate":
			return validated(state);
		case "txCancel":
			return withHistory(state, cancel, { validate: true });
		case "undo":
			return withHistory(state, undo, { validate: true });
		case "redo":
			return withHistory(state, redo, { validate: true });
		default:
			return reduceView(state, action);
	}
}

function reduceOpen(state: EditorState, action: Action): EditorState {
	switch (action.type) {
		case "open": {
			// Opening a template adds it to the workspace, or starts one.
			if (!state.workspace)
				return reduce(state, {
					type: "openWorkspace",
					workspace: singleTemplateWorkspace(action.template, action.fileName),
					fileName: "Untitled.coatworkspace",
					notices: action.notices,
				});
			const added = reduce(state, {
				type: "addTemplate",
				template: action.template,
				fileName: action.fileName,
			});
			return added.doc
				? { ...added, doc: { ...added.doc, notices: action.notices ?? [] } }
				: added;
		}
		case "openWorkspace": {
			const ws = workspaceState(action.workspace, action.fileName);
			const first = ws.templates[0];
			if (!first) return state;
			return {
				...initialState(state.panels),
				rulers: state.rulers,
				...freshEditor(
					first.template,
					first.fileName,
					state.view,
					action.notices,
					first.guides,
				),
				workspace: ws,
			};
		}
		default:
			return reduceWorkspace(state, action);
	}
}

function reduceView(state: EditorState, action: Action): EditorState {
	switch (action.type) {
		case "close":
			return {
				...initialState(state.panels),
				view: state.view,
				rulers: state.rulers,
			};
		case "saved":
			if (!state.doc) return state;
			return {
				...state,
				doc: {
					...state.doc,
					saved: action.template,
					fileName: action.fileName ?? state.doc.fileName,
				},
			};
		case "setSide": {
			const t = present(state);
			if (!t || !t.template_data[action.side] || action.side === state.side)
				return state;
			return {
				...state,
				side: action.side,
				selection: [],
				hover: null,
				geometry: new Map(),
			};
		}
		case "setVariant": {
			const t = present(state);
			const variantId = t ? activeVariantId(t, action.variantId) : undefined;
			const { variantBeforeRecord: _, ...rest } = state;
			return variantId === state.variantId && !state.variantBeforeRecord
				? state
				: { ...rest, variantId };
		}
		case "setValue":
			// A value typed by hand is no longer that record's.
			return {
				...state,
				values: { ...state.values, [action.field]: action.value },
				previewRecordId: null,
			};
		case "resetValues": {
			// Ending a record preview also gives back the variant it replaced.
			const t = present(state);
			if (!t) return state;
			const { variantBeforeRecord: before, ...rest } = state;
			return withKnownVariant({
				...rest,
				values: sampleValues(t),
				previewRecordId: null,
				...(before ? { variantId: before.variantId } : {}),
			});
		}
		case "select": {
			const t = present(state);
			if (!t) return state;
			const keys = action.keys.filter((k) => getElement(t, k));
			const mode = action.mode ?? "replace";
			let selection: string[];
			if (mode === "replace") selection = keys;
			else if (mode === "add")
				selection = [
					...state.selection,
					...keys.filter((k) => !state.selection.includes(k)),
				];
			else {
				selection = state.selection.filter((k) => !keys.includes(k));
				for (const k of keys)
					if (!state.selection.includes(k)) selection.push(k);
			}
			return sameList(selection, state.selection)
				? state
				: { ...state, selection };
		}
		case "hover":
			return state.hover === action.key
				? state
				: { ...state, hover: action.key };
		case "textEdit":
			return state.textEdit === action.key
				? state
				: { ...state, textEdit: action.key };
		case "toggleHidden":
			return { ...state, hidden: toggled(state.hidden, action.key) };
		case "toggleLocked": {
			const locked = toggled(state.locked, action.key);
			return {
				...state,
				locked,
				selection: locked.has(action.key)
					? state.selection.filter((k) => k !== action.key)
					: state.selection,
			};
		}
		case "setTool":
			return state.tool === action.tool
				? state
				: { ...state, tool: action.tool };
		case "setView":
			return { ...state, view: action.view };
		case "setPanels":
			return { ...state, panels: { ...state.panels, ...action.panels } };
		case "setRulers":
			return state.rulers === action.on
				? state
				: { ...state, rulers: action.on };
		case "setRightTab": {
			const tab = LEGACY_TAB[action.tab] ?? action.tab;
			return state.rightTab === tab ? state : { ...state, rightTab: tab };
		}
		case "showFields":
			return action.fields
				? {
						...state,
						rightTab: "content",
						panels: { ...state.panels, right: true },
						shownFields: action.fields,
					}
				: state.shownFields
					? { ...state, shownFields: null }
					: state;
		case "setActiveFill": {
			const a = state.activeFill;
			const b = action.fill;
			if (a === b || (a && b && a.key === b.key && a.index === b.index))
				return state;
			return { ...state, activeFill: b };
		}
		case "rendered":
			return {
				...state,
				geometry: sameGeometry(state.geometry, action.geometry)
					? state.geometry
					: action.geometry,
				render: {
					status: "ok",
					timings: action.timings,
					stats: action.stats,
					warnings: keepIfSame(action.warnings, state.render.warnings),
					...(action.barcodes?.length ? { barcodes: action.barcodes } : {}),
				},
			};
		case "renderFailed":
			return {
				...state,
				render: { ...state.render, status: "error", error: action.error },
			};
		default:
			return reduceWorkspace(state, action);
	}
}

function reduceWorkspace(state: EditorState, action: Action): EditorState {
	const ws = state.workspace;
	if (!ws) return state;
	const withWs = (next: WorkspaceState): EditorState =>
		next === ws ? state : { ...state, workspace: next };
	const edit = (recipe: (w: Draft<WorkspaceState>) => void) =>
		withWs(produce(ws, recipe));
	const fresh = (t: Template, fileName: string, guides?: TemplateGuides) =>
		freshEditor(t, fileName, state.view, [], guides);
	switch (action.type) {
		case "workspaceSaved":
			return edit((w) => {
				w.saved = action.saved;
				w.fileName = action.fileName ?? ws.fileName;
			});
		case "renameWorkspace":
			return edit((w) => {
				w.name = action.name;
			});
		case "setSection":
			return state.section === action.section
				? state
				: { ...state, section: action.section };
		case "switchTemplate":
			return switchTo(state, action.id, fresh);
		case "addTemplate": {
			const id = action.id ?? newId("t");
			const added: EditorState = {
				...state,
				workspace: {
					...ws,
					templates: [
						...ws.templates,
						{
							id,
							fileName: action.fileName,
							template: action.template,
							...(action.guides ? { guides: action.guides } : {}),
						},
					],
				},
			};
			return switchTo(added, id, fresh);
		}
		case "removeTemplate": {
			if (ws.templates.length <= 1) return state;
			const index = ws.templates.findIndex((s) => s.id === action.id);
			if (index < 0) return state;
			let next = state;
			if (ws.activeTemplateId === action.id) {
				const other = ws.templates[index === 0 ? 1 : index - 1] as {
					id: string;
				};
				next = switchTo(state, other.id, fresh);
			}
			const nws = next.workspace as WorkspaceState;
			return {
				...next,
				workspace: produce(nws, (w) => {
					w.templates = nws.templates.filter((s) => s.id !== action.id);
					if (nws.presets.some((p) => p.templateId === action.id))
						w.presets = nws.presets.filter((p) => p.templateId !== action.id);
				}),
			};
		}
		case "restoreTemplate": {
			if (ws.templates.some((s) => s.id === action.slot.id)) return state;
			const templates = [...ws.templates];
			templates.splice(action.index, 0, action.slot);
			const restored: EditorState = {
				...state,
				workspace: {
					...ws,
					templates,
					presets: [...ws.presets, ...action.presets],
				},
			};
			return switchTo(restored, action.slot.id, fresh);
		}
		case "renameTemplateEntry":
			return edit((w) => {
				w.templates = produceAt(
					ws.templates,
					ws.templates.findIndex((s) => s.id === action.id),
					(slot) => {
						slot.fileName = action.fileName;
					},
				);
			});
		case "duplicateTemplate": {
			const source = ws.templates.find((s) => s.id === action.id);
			if (!source) return state;
			const history =
				source.id === ws.activeTemplateId && state.doc
					? state.doc.history
					: source.parked?.doc.history;
			const template = history?.present ?? source.template;
			const base = templateStem(source.fileName);
			return reduce(state, {
				type: "addTemplate",
				id: action.newId,
				template,
				guides: history?.guides ?? source.guides,
				fileName: `${base} copy${COAT_EXTENSION}`,
			});
		}
		case "setBinding":
			return edit((w) => {
				w.templates = patchBindings(ws.templates, {
					[action.id]: action.binding,
				}).templates;
			});
		case "datasetEdit": {
			const next = commitDatasets(ws, action.datasets, {
				mergeKey: action.mergeKey,
				bindings: action.bindings,
			});
			return withWs(
				produce(next, (w) => {
					w.activeDatasetId =
						action.activeId !== undefined
							? action.activeId
							: next.datasets.some((d) => d.id === next.activeDatasetId)
								? next.activeDatasetId
								: (next.datasets[0]?.id ?? null);
				}),
			);
		}
		case "datasetUndo":
			return withWs(undoDatasets(ws));
		case "datasetRedo":
			return withWs(redoDatasets(ws));
		case "setActiveDataset":
			return edit((w) => {
				w.activeDatasetId = action.id;
			});
		case "setRecordStatus":
			if (action.fromJob)
				return withWs(
					withJobStatus(ws, action.datasetId, action.ids, action.status, {
						exportedAt: action.exportedAt,
						errors: action.errors,
					}),
				);
			return withWs(
				commitDatasets(
					ws,
					withRecordStatus(
						ws.datasets,
						action.datasetId,
						action.ids,
						action.status,
						{ exportedAt: action.exportedAt, errors: action.errors },
					),
				),
			);
		case "setPreset": {
			const { preset } = action;
			const at = ws.presets.findIndex((p) => p.id === preset.id);
			return edit((w) => {
				w.presets = produce(ws.presets, (list) => {
					if (at >= 0) list[at] = preset;
					else list.push(preset);
				});
				if (at < 0) w.activePresetId = preset.id;
			});
		}
		case "removePreset": {
			if (!ws.presets.some((p) => p.id === action.id)) return state;
			const presets = ws.presets.filter((p) => p.id !== action.id);
			return edit((w) => {
				w.presets = presets;
				if (ws.activePresetId === action.id)
					w.activePresetId = presets[0]?.id ?? null;
			});
		}
		case "setActivePreset":
			return edit((w) => {
				w.activePresetId = action.id;
			});
		case "setPreviewRecord":
			return state.previewRecordId === action.id
				? state
				: { ...state, previewRecordId: action.id };
		case "setExportView": {
			const next = { ...state.exportView, ...action.view };
			return (Object.keys(next) as (keyof ExportView)[]).every(
				(k) => next[k] === state.exportView[k],
			)
				? state
				: { ...state, exportView: next };
		}
		case "setRecord":
			return state.recordId === action.id
				? state
				: { ...state, recordId: action.id };
		case "setDataView": {
			const current = state.dataViews[action.datasetId];
			const base = current ?? DEFAULT_DATA_VIEW;
			const patch = action.patch as Record<string, unknown>;
			if (
				Object.keys(patch).every(
					(k) => patch[k] === (base as Record<string, unknown>)[k],
				)
			)
				return state;
			return {
				...state,
				dataViews: {
					...state.dataViews,
					[action.datasetId]: { ...base, ...action.patch },
				},
			};
		}
		case "previewRecord":
			return withKnownVariant({
				...state,
				values: action.values,
				variantId: action.variantId,
				previewRecordId: action.id,
				recordId: action.id,
				variantBeforeRecord: state.variantBeforeRecord ?? {
					variantId: state.variantId,
				},
			});
		default:
			return state;
	}
}

export { activeSlot };

/** The guides after `next`: a renamed side keeps its guides, a removed one
 *  loses them. */
function followSides(h: History, next: Template): TemplateGuides {
	if (next.template_data === h.present.template_data) return h.guides;
	return guidesForSides(
		h.guides,
		h.present.template_data.map((f) => f.name),
		next.template_data.map((f) => f.name),
	);
}

function withHistory(
	state: EditorState,
	step: (h: History) => History,
	opts: { select?: string[]; validate?: boolean } = {},
): EditorState {
	if (!state.doc) return state;
	const before = state.doc.history.present;
	const history = step(state.doc.history);
	if (history === state.doc.history && !opts.select) return state;
	const after = history.present;
	const changed = before !== after;
	const side = Math.min(state.side, after.template_data.length - 1);
	const variantId =
		changed && state.variantId !== undefined
			? activeVariantId(after, state.variantId)
			: state.variantId;
	const inTx = history.tx !== undefined;
	const validate =
		opts.validate && !inTx && (changed || state.doc.issuesStale === true);
	const from = state.doc.keysAt ?? before;
	const deferKeys = inTx && from !== after && sameStructure(from, after);
	const moved = from !== after && !deferKeys;
	const remap = moved
		? keyRemapper(from, after)
		: (keys: Iterable<string>) => [...keys];
	const { keysAt: _, ...doc } = state.doc;
	return {
		...state,
		side,
		variantId,
		doc: {
			...doc,
			history,
			issues: validate ? issuesOf(after) : state.doc.issues,
			issuesStale: validate ? false : state.doc.issuesStale || changed,
			...(deferKeys ? { keysAt: from } : {}),
		},
		selection: keepIfSame(
			opts.select ?? remap(state.selection),
			state.selection,
		),
		hover: changed ? null : state.hover,
		hidden: moved
			? keepSetIfSame(remap(state.hidden), state.hidden)
			: state.hidden,
		locked: moved
			? keepSetIfSame(remap(state.locked), state.locked)
			: state.locked,
	};
}

/** Brings `doc.issues` up to the present when an edit left them stale. */
function validated(state: EditorState): EditorState {
	const doc = state.doc;
	if (!doc?.issuesStale) return state;
	return {
		...state,
		doc: { ...doc, issues: issuesOf(doc.history.present), issuesStale: false },
	};
}

// Subscribers re-render on identity, and a drag remaps these on every frame
// without changing what they hold.
function keepIfSame(next: string[], prev: string[]): string[] {
	return sameList(next, prev) ? prev : next;
}

function keepSetIfSame(
	next: string[],
	prev: ReadonlySet<string>,
): ReadonlySet<string> {
	return next.length === prev.size && next.every((k) => prev.has(k))
		? prev
		: new Set(next);
}

function issuesOf(t: Template): ValidationError[] {
	const result = validate(t);
	return result.ok ? [] : result.errors;
}

function toggled(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
	const next = new Set(set);
	if (!next.delete(key)) next.add(key);
	return next;
}

function sameList(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((v, i) => v === b[i]);
}

export type EditorStore = {
	getState(): EditorState;
	subscribe(listener: () => void): () => void;
	dispatch(action: Action): void;
};

export function createEditorStore(
	initial: EditorState = initialState(),
): EditorStore {
	let state = initial;
	const listeners = new Set<() => void>();
	return {
		getState: () => state,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		dispatch(action) {
			const next = reduce(state, action);
			if (next === state) return;
			state = next;
			for (const l of listeners) l();
		},
	};
}
