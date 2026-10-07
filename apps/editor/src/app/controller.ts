import {
	type Element,
	formatVersionStatus,
	type Template,
	validate,
} from "@freshcoat-js/coatfile";
import {
	COAT_EXTENSION,
	COAT_JSON_EXTENSION,
	COAT_JSON_MEDIA_TYPE,
	COAT_MEDIA_TYPE,
} from "@freshcoat-js/coatfile/coat";
import { type SvgElements, svgToElements } from "@freshcoat-js/coatfile/svg";
import { toast } from "@freshcoat-js/ui/toast";
import {
	resolveValues,
	variantFor,
	type Workspace,
} from "@freshcoat-js/workspace";
import type { CanvasKit } from "canvaskit-wasm";
import type { BooleanOp } from "~/doc/boolean";
import { createElement, defaultRect, type ElementKind } from "~/doc/factories";
import {
	type AlignMode,
	align,
	type LayerGeometry,
	rectOf,
	translateLayers,
	unionRects,
} from "~/doc/geometry";
import {
	addGuide,
	clearGuides,
	type GuideAxis,
	moveGuide,
	removeGuide,
	type SideGuides,
	sideGuides,
	type TemplateGuides,
} from "~/doc/guides";
import { MERGE_WINDOW_MS } from "~/doc/history";
import { uniqueId } from "~/doc/ids";
import { openFile, saveCoat, saveFileName, saveJson } from "~/doc/io";
import { isUnnamed, newDocument, type Preset } from "~/doc/new-document";
import {
	type AddVariantResult,
	addVariant,
	attachImageAsset,
	booleanElements,
	changeVariantId,
	duplicateElements,
	groupElements,
	insertElements,
	moveElements,
	type OpResult,
	type ParentRef,
	removeElements,
	removeVariant,
	setHiddenInVariant,
	ungroup,
	updateElement,
} from "~/doc/ops";
import {
	childPaths,
	getElement,
	isAncestor,
	isBackgroundPath,
	keyOf,
	parentKeyOf,
	parseKey,
	siblingsOf,
} from "~/doc/path";
import { type PenPath, penElement } from "~/doc/pen";
import {
	activeVariantId,
	geometryForBase,
	isHiddenInVariant,
	isStructuralEdit,
} from "~/doc/variant-edit";
import { newPreset } from "~/export/export-ui";
import { getCanvasKit } from "~/render/canvaskit";
import { findSample } from "~/samples";
import { findStarter } from "~/samples/starters";
import {
	type Action,
	createEditorStore,
	type EditorState,
	type EditorStore,
	type EditScope,
	isDirty,
	present,
	type View,
	working,
} from "~/state/store";
import {
	activeSlot,
	singleTemplateWorkspace,
	workspaceSnapshot,
} from "~/state/workspace";
import {
	clearAutosave,
	configureAutosave,
	readAutosaveAsset,
	writeAutosave,
} from "./autosave";
import { readClipboard, writeClipboard } from "./clipboard";
import { BOOLEAN, plural } from "./copy";
import { downloadBytes } from "./download";
import { exportSidePng } from "./export-png";
import {
	SourceChangedError,
	settleAssets,
	stopSourceAssets,
	trackSourceAssets,
} from "./source-assets";
import { svgMarkup, svgSize } from "./svg";

configureAutosave({
	onStorageFull: () =>
		toast("Storage full. Photos aren't autosaved.", {
			tone: "warning",
			timeout: 10000,
		}),
});

/** The notice a file from a newer format opens with. Saving checks for it. */
export const NEWER_FORMAT = "Made in a newer version. Saving is off.";

export const ZOOM_MIN = 0.02;
export const ZOOM_MAX = 64;
const FIT_PADDING = 40;
const ZOOM_STEPS = [
	0.02, 0.05, 0.1, 0.125, 0.25, 0.33, 0.5, 0.67, 1, 1.5, 2, 3, 4, 6, 8, 12, 16,
	24, 32, 48, 64,
];

/** How the naming prompt was answered: name it and save, save it as it is,
 *  or don't save. */
export type NameAnswer = "save" | "skip" | "cancel";

/** Asks for a name for the active template, whose file is `fileName`, before
 *  it is saved for the first time. */
export type NamePrompt = (fileName: string) => Promise<NameAnswer>;

export type SvgPasteAnswer = "layers" | "image" | "text" | "cancel";

export type SvgPastePrompt = () => Promise<SvgPasteAnswer>;

export type EditOptions = {
	mergeKey?: string;
	/** Select the keys the operation reports (inserted, moved) afterwards. */
	selectResult?: boolean;
	select?: string[];
	/** Say nothing when the operation is refused. */
	quiet?: boolean;
	/**
	 * While a variant is active: "variant" (the default) runs the operation on
	 * the working template and keeps what it changes as the variant's
	 * overrides; "base" runs it on the base, so it applies to every variant.
	 * Operations that change structure (add, remove, reorder, group, rename
	 * layers or sides, fields, variants) use "base".
	 */
	scope?: EditScope;
};

/**
 * Everything the menus, shortcuts, panels and canvas do to the editor goes
 * through here, so each action has one implementation whatever triggers it.
 */
export class EditorController {
	readonly store: EditorStore;
	fonts: Map<string, Uint8Array[]> | undefined;
	private viewport = { width: 0, height: 0 };
	private autosaveTimer: ReturnType<typeof setTimeout> | undefined;
	private autosaveSeen: Pick<EditorState, "doc" | "workspace">;
	private validateTimer: ReturnType<typeof setTimeout> | undefined;
	private validateSeen: EditorState["doc"] = null;
	private openedListeners = new Set<() => void>();
	private issuesListeners = new Set<() => void>();
	private namePrompt: NamePrompt | undefined;
	private svgPastePrompt: SvgPastePrompt | undefined;
	private naming = false;
	private textEditFrom: string | undefined;

	constructor(store: EditorStore = createEditorStore()) {
		this.store = store;
		const { doc, workspace } = store.getState();
		this.autosaveSeen = { doc, workspace };
		this.store.subscribe(() => this.scheduleAutosave());
		this.store.subscribe(() => this.scheduleValidation());
	}

	get state(): EditorState {
		return this.store.getState();
	}

	/** The template as shown and edited: the base with the active variant
	 *  applied. Read it for anything displayed or to compute an edit. */
	get template(): Template | null {
		return working(this.state);
	}

	/** The base template, every variant's shared layers: what is saved. */
	get base(): Template | null {
		return present(this.state);
	}

	/** The active variant's id, when one is. */
	get variantId(): string | undefined {
		const t = this.base;
		return t ? activeVariantId(t, this.state.variantId) : undefined;
	}

	/** The rendered geometry, fit for an op on the base (it shows the active
	 *  variant, whose moved layers the base has elsewhere). */
	baseGeometry(): LayerGeometry {
		const t = this.base;
		return t
			? geometryForBase(t, this.state.variantId, this.state.geometry)
			: this.state.geometry;
	}

	dispatch(action: Action): void {
		this.store.dispatch(action);
	}

	// ── Editing ──────────────────────────────────────────────────────────────

	/** Applies an operation to the current document as one undo step. */
	edit(
		op: (t: Template) => OpResult | Template,
		opts: EditOptions = {},
	): OpResult | null {
		const scope = opts.scope ?? "variant";
		const t = scope === "base" ? this.base : this.template;
		if (!t) return null;
		const out = op(t);
		const result: OpResult =
			"ok" in out && typeof out.ok === "boolean"
				? (out as OpResult)
				: { ok: true, template: out as Template };
		if (!result.ok) {
			if (!opts.quiet) toast(result.reason, { tone: "warning" });
			return result;
		}
		const select = opts.select ?? (opts.selectResult ? result.keys : undefined);
		if (import.meta.env.DEV && scope === "variant" && this.variantId)
			warnStructural(t, result.template, op);
		this.dispatch({
			type: "commit",
			next: result.template,
			mergeKey: opts.mergeKey,
			select,
			scope,
		});
		return result;
	}

	beginTx(): void {
		this.dispatch({ type: "txBegin" });
	}

	/** Shows `template` without recording it. It is an edit of the working
	 *  template (`this.template` when the gesture began), unless `scope` is
	 *  "base". */
	previewTx(template: Template, select?: string[], scope?: EditScope): void {
		this.dispatch({ type: "txPreview", next: template, select, scope });
	}

	endTx(): void {
		this.dispatch({ type: "txEnd" });
	}

	cancelTx(): void {
		this.dispatch({ type: "txCancel" });
	}

	undo(): void {
		this.dispatch({ type: "undo" });
	}

	redo(): void {
		this.dispatch({ type: "redo" });
	}

	// ── Selection ────────────────────────────────────────────────────────────

	select(keys: string[], mode: "replace" | "add" | "toggle" = "replace"): void {
		this.dispatch({ type: "select", keys, mode });
	}

	/** Siblings of the selection, or the side's top level. */
	selectAll(): void {
		const t = this.template;
		if (!t) return;
		const first = this.state.selection[0];
		const keys = first
			? siblingsOf(t, first).map(keyOf)
			: (t.template_data[this.state.side]?.elements.map((_, i) =>
					keyOf({ side: this.state.side, path: [i] }),
				) ?? []);
		this.select(keys.filter((k) => !this.state.locked.has(k)));
	}

	selectChildren(): void {
		const t = this.template;
		const first = this.state.selection[0];
		if (!t || !first) return;
		const kids = childPaths(t, first)
			.map(keyOf)
			.filter((k) => !k.endsWith("/-1"));
		if (kids.length) this.select(kids);
	}

	selectParent(): boolean {
		const first = this.state.selection[0];
		if (!first) return false;
		const parent = parentKeyOf(first);
		this.select(parent ? [parent] : []);
		return true;
	}

	/** Selected keys that are real layers (not the background), outermost only. */
	selectedLayers(): string[] {
		const sel = this.state.selection.filter((k) => {
			const p = parseKey(k);
			return p && !isBackgroundPath(p);
		});
		return sel.filter((k) => !sel.some((o) => o !== k && isAncestor(o, k)));
	}

	// ── Layer commands ───────────────────────────────────────────────────────

	deleteSelection(): void {
		const keys = this.selectedLayers();
		if (keys.length === 0) return;
		this.edit((t) => removeElements(t, keys), { select: [], scope: "base" });
	}

	duplicateSelection(): void {
		const keys = this.selectedLayers();
		if (keys.length === 0) return;
		this.edit((t) => duplicateElements(t, keys), {
			selectResult: true,
			scope: "base",
		});
	}

	groupSelection(): void {
		const keys = this.selectedLayers();
		if (keys.length === 0) return;
		const geometry = this.baseGeometry();
		this.edit((t) => groupElements(t, keys, geometry), {
			selectResult: true,
			scope: "base",
		});
	}

	ungroupSelection(): void {
		const [key] = this.selectedLayers();
		if (!key) return;
		const geometry = this.baseGeometry();
		this.edit((t) => ungroup(t, key, geometry), {
			selectResult: true,
			scope: "base",
		});
	}

	/** Moves the selection within its parent's stack. */
	reorder(where: "forward" | "backward" | "front" | "back"): void {
		const t = this.template;
		const keys = this.selectedLayers();
		if (!t || keys.length === 0) return;
		const parent = parentKeyOf(keys[0] as string);
		if (keys.some((k) => parentKeyOf(k) !== parent)) {
			toast("Layers must share a parent", { tone: "warning" });
			return;
		}
		const indexes = keys.map((k) => {
			const p = parseKey(k);
			return p && !isBackgroundPath(p) ? (p.path.at(-1) ?? 0) : 0;
		});
		const count = siblingsOf(t, keys[0] as string).length;
		const lo = Math.min(...indexes);
		const hi = Math.max(...indexes);
		const index =
			where === "front"
				? count
				: where === "back"
					? 0
					: where === "forward"
						? Math.min(count, hi + 2)
						: Math.max(0, lo - 1);
		const ref: ParentRef = parent ?? { side: this.state.side };
		const geometry = this.baseGeometry();
		const sorted = [...keys].sort(
			(a, b) => indexes[keys.indexOf(a)] - indexes[keys.indexOf(b)],
		);
		this.edit((doc) => moveElements(doc, sorted, ref, index, geometry), {
			selectResult: true,
			quiet: true,
			scope: "base",
		});
	}

	/** Combines the selected shapes into one vector layer, as one undo step.
	 *  `ck` stands in for the session's CanvasKit. */
	async booleanSelection(op: BooleanOp, ck?: CanvasKit): Promise<boolean> {
		const keys = this.selectedLayers();
		if (keys.length < 2) {
			toast(BOOLEAN.tooFew, { tone: "warning" });
			return false;
		}
		let kit = ck;
		try {
			kit ??= (await getCanvasKit()) as CanvasKit;
		} catch {
			toast(BOOLEAN.couldNotLoad, { tone: "warning" });
			return false;
		}
		const result = this.edit((t) => booleanElements(t, keys, op, kit), {
			scope: "base",
			selectResult: true,
		});
		return result?.ok ?? false;
	}

	alignSelection(mode: AlignMode): void {
		const keys = this.selectedLayers();
		if (keys.length === 0) return;
		const geometry = this.state.geometry;
		this.edit((t) => align(t, keys, geometry, mode));
	}

	/** Moves the selection by a delta; consecutive nudges are one undo step. */
	nudge(dx: number, dy: number): void {
		const keys = this.selectedLayers().filter(
			(k) => !this.state.geometry.get(k)?.autoLayoutChild,
		);
		if (keys.length === 0) return;
		const geometry = this.state.geometry;
		this.edit((t) => translateLayers(t, keys, dx, dy, geometry), {
			mergeKey: "nudge",
		});
	}

	// ── Guides ───────────────────────────────────────────────────────────────

	/** The active side's guides. */
	sideGuides(): SideGuides {
		const h = this.state.doc?.history;
		const name = this.base?.template_data[this.state.side]?.name;
		return h && name !== undefined
			? sideGuides(h.guides, name)
			: { x: [], y: [] };
	}

	private withSideGuides(
		change: (g: TemplateGuides, side: string) => TemplateGuides,
		opts: { preview?: boolean; mergeKey?: string } = {},
	): void {
		const h = this.state.doc?.history;
		const name = this.base?.template_data[this.state.side]?.name;
		if (!h || name === undefined) return;
		const guides = change(h.guides, name);
		if (guides !== h.guides) this.dispatch({ type: "guides", guides, ...opts });
	}

	/** Adds a guide on the active side; returns its index on `axis`. */
	addGuide(
		axis: GuideAxis,
		value: number,
		opts: { preview?: boolean } = {},
	): number {
		let index = -1;
		this.withSideGuides((g, side) => {
			const out = addGuide(g, side, axis, value);
			index = out.index;
			return out.guides;
		}, opts);
		return index;
	}

	moveGuide(
		axis: GuideAxis,
		index: number,
		value: number,
		opts: { preview?: boolean; mergeKey?: string } = {},
	): void {
		this.withSideGuides(
			(g, side) => moveGuide(g, side, axis, index, value),
			opts,
		);
	}

	removeGuide(
		axis: GuideAxis,
		index: number,
		opts: { preview?: boolean } = {},
	): void {
		this.withSideGuides((g, side) => removeGuide(g, side, axis, index), opts);
	}

	/** Removes every guide on the active side, as one undo step. */
	clearGuides(): void {
		this.withSideGuides(clearGuides);
	}

	toggleHidden(keys = this.state.selection): void {
		for (const key of keys) this.dispatch({ type: "toggleHidden", key });
	}

	toggleLocked(keys = this.state.selection): void {
		for (const key of keys) this.dispatch({ type: "toggleLocked", key });
	}

	// ── Text on the canvas ──────────────────────────────────────────────────

	/** Starts editing a text layer's raw template text on the canvas, as one
	 *  undo step. False for a layer that isn't plain text (mixed-style spans are
	 *  edited in the inspector). */
	beginTextEdit(key: string): boolean {
		const t = this.template;
		const el = t && getElement(t, key);
		if (!el || !("type" in el) || el.type !== "text") return false;
		if (el.properties.spans?.length) return false;
		if (this.state.textEdit) this.endTextEdit();
		this.select([key]);
		this.beginTx();
		this.textEditFrom = el.properties.value ?? "";
		this.dispatch({ type: "textEdit", key });
		return true;
	}

	/** Shows the edited text on the layer, within the edit's undo step. */
	setEditedText(value: string): void {
		const key = this.state.textEdit;
		const t = this.template;
		if (!key || !t) return;
		const r = updateElement(t, key, { properties: { value } });
		if (r.ok) this.previewTx(r.template);
	}

	/** Ends the edit: one undo step when the text changed, none otherwise. */
	endTextEdit(): void {
		const key = this.state.textEdit;
		if (!key) return;
		const t = this.template;
		const el = t && getElement(t, key);
		const value =
			el && "type" in el && el.type === "text"
				? el.properties.value
				: undefined;
		this.dispatch({ type: "textEdit", key: null });
		if ((value ?? "") === this.textEditFrom) this.cancelTx();
		else this.endTx();
		this.textEditFrom = undefined;
	}

	/** Inserts a new layer, at the top of `parent` (the side when omitted). */
	insert(element: Element, parent?: string): string | null {
		const t = this.template;
		if (!t) return null;
		const ref: ParentRef = parent ?? { side: this.state.side };
		const count = parent
			? childPaths(t, parent).filter((p) => !keyOf(p).endsWith("/-1")).length
			: (t.template_data[this.state.side]?.elements.length ?? 0);
		const result = this.edit(
			(doc) => insertElements(doc, ref, count, [element]),
			{ selectResult: true, scope: "base" },
		);
		return result?.ok ? (result.keys?.[0] ?? null) : null;
	}

	/** Creates a layer of `kind` at a template-space box, or a default box at a point. */
	create(
		kind: ElementKind,
		box: { x: number; y: number; width: number; height: number } | null,
		point: { x: number; y: number },
		opts: { src?: string; parent?: string } = {},
	): string | null {
		const t = this.template;
		if (!t) return null;
		const rect = box ?? defaultRect(kind, point, t);
		const origin = opts.parent
			? this.state.geometry.get(opts.parent)?.rect
			: undefined;
		const local = origin
			? { ...rect, x: rect.x - origin.x, y: rect.y - origin.y }
			: rect;
		const element = createElement(kind, local, t, this.state.side, {
			src: opts.src,
		});
		const key = this.insert(element, opts.parent);
		this.dispatch({ type: "setTool", tool: "move" });
		return key;
	}

	/** Adds a drawn path as a vector layer on the side, selected, and goes
	 *  from the pen back to the move tool. */
	createPath(path: PenPath): string | null {
		const t = this.template;
		if (!t) return null;
		const element = penElement(path, t, this.state.side);
		const key = element ? this.insert(element) : null;
		if (this.state.tool === "pen")
			this.dispatch({ type: "setTool", tool: "move" });
		return key;
	}

	/** Embeds an image file and places it at its own aspect within half the artboard. */
	async placeImage(
		file: File,
		point?: { x: number; y: number },
	): Promise<string | null> {
		if (!this.base) return null;
		if (file.type === "image/svg+xml") {
			const svg = svgMarkup(await file.text());
			if (svg) return this.placeSvg(svg, point);
		}
		const size = await imageSize(file).catch(() => ({
			width: 400,
			height: 300,
		}));
		return this.placeImageBytes(file, size, point);
	}

	async placeSvg(
		svg: string,
		point?: { x: number; y: number },
	): Promise<string | null> {
		return this.placeImageBytes(
			new Blob([svg], { type: "image/svg+xml" }),
			svgSize(svg),
			point,
		);
	}

	/** Converts SVG markup to layers, fitted within half the artboard. */
	placeSvgLayers(svg: string, point?: { x: number; y: number }): string | null {
		const t = this.base;
		if (!t) return null;
		const side = this.state.side;
		const taken = new Set<string>();
		let converted: SvgElements;
		try {
			converted = svgToElements(svg, {
				maxSize: { width: t.width / 2, height: t.height / 2 },
				uniqueId: (base) => {
					const id = uniqueId(t, side, base, taken);
					taken.add(id);
					return id;
				},
			});
		} catch {
			toast("Couldn't read that SVG", { tone: "danger" });
			return null;
		}
		const { element, warnings } = converted;
		const at = point ?? { x: t.width / 2, y: t.height / 2 };
		const size = element.size ?? { width: 0, height: 0 };
		const placed = {
			...element,
			pos: { x: at.x - size.width / 2, y: at.y - size.height / 2 },
		};
		const result = this.edit(
			() =>
				insertElements(
					t,
					{ side },
					t.template_data[side]?.elements.length ?? 0,
					[placed],
				),
			{ selectResult: true, scope: "base" },
		);
		if (warnings.length)
			toast("Some SVG features were skipped", { tone: "warning" });
		this.dispatch({ type: "setTool", tool: "move" });
		return result?.ok ? (result.keys?.[0] ?? null) : null;
	}

	private async placeImageBytes(
		file: Blob,
		size: { width: number; height: number },
		point?: { x: number; y: number },
	): Promise<string | null> {
		const t = this.base;
		if (!t) return null;
		const bytes = new Uint8Array(await file.arrayBuffer());
		const attached = await attachImageAsset(t, bytes, file.type || "image/png");
		const fit = Math.min(
			1,
			t.width / 2 / size.width,
			t.height / 2 / size.height,
		);
		const width = Math.max(1, Math.round(size.width * fit));
		const height = Math.max(1, Math.round(size.height * fit));
		const at = point ?? { x: t.width / 2, y: t.height / 2 };
		const element = createElement(
			"image",
			{ x: at.x - width / 2, y: at.y - height / 2, width, height },
			attached.template,
			this.state.side,
			{ src: attached.src },
		);
		const result = this.edit(
			() =>
				insertElements(
					attached.template,
					{ side: this.state.side },
					attached.template.template_data[this.state.side]?.elements.length ??
						0,
					[element],
				),
			{ selectResult: true, scope: "base" },
		);
		this.dispatch({ type: "setTool", tool: "move" });
		return result?.ok ? (result.keys?.[0] ?? null) : null;
	}

	// ── Variants ─────────────────────────────────────────────────────────────

	/** Shows and edits `id`, or Default with undefined. */
	setVariant(id: string | undefined): void {
		this.dispatch({ type: "setVariant", variantId: id });
	}

	/** Appends a variant (a copy of `from`'s changes, when given) as one undo
	 *  step. The active variant stays; the caller selects the new one. */
	addVariant(label: string, from?: string): string | null {
		let added: AddVariantResult | undefined;
		this.edit(
			(t) => {
				added = addVariant(t, { label, from });
				return added;
			},
			{ scope: "base" },
		);
		return added?.ok ? added.variantId : null;
	}

	/** Removes a variant; a binding fixed to it shows Default instead. */
	removeVariant(id: string): boolean {
		const r = this.edit((t) => removeVariant(t, id), { scope: "base" });
		if (!r?.ok) return false;
		this.repointBinding(id, undefined);
		return true;
	}

	/** Changes a variant's id, following it in this workspace: the binding
	 *  fixed to it, and the active variant. */
	changeVariantId(id: string, next: string): boolean {
		const active = this.variantId === id;
		const r = this.edit((t) => changeVariantId(t, id, next), {
			scope: "base",
		});
		if (!r?.ok) return false;
		const clean = next.trim();
		if (clean === id) return true;
		this.repointBinding(id, clean);
		if (active) this.setVariant(clean);
		return true;
	}

	/** The selected layers (or `keys`) the active variant can hide, with
	 *  whether it hides each: empty with no active variant. */
	variantVisibility(
		keys: readonly string[] = this.selectedLayers(),
	): { key: string; side: string; id: string; hidden: boolean }[] {
		const t = this.base;
		const variant = this.variantId;
		if (!t || variant === undefined) return [];
		return keys.flatMap((key) => {
			const p = parseKey(key);
			if (!p || isBackgroundPath(p)) return [];
			const side = t.template_data[p.side]?.name;
			const el = getElement(t, key);
			if (side === undefined || !el || !("id" in el) || !el.id) return [];
			const id = el.id;
			return [
				{ key, side, id, hidden: isHiddenInVariant(t, variant, side, id) },
			];
		});
	}

	/** Hides layers in the active variant, or shows them again, as one undo
	 *  step. The eye in the layers tree is a view setting; this is saved. */
	setHiddenInVariant(keys: readonly string[], hidden: boolean): void {
		const variant = this.variantId;
		const layers = this.variantVisibility(keys);
		if (variant === undefined || layers.length === 0) return;
		this.edit(
			(t) => {
				let next = t;
				for (const l of layers) {
					const r = setHiddenInVariant(next, variant, l.side, l.id, hidden);
					if (!r.ok) return r;
					next = r.template;
				}
				return next;
			},
			{ scope: "base" },
		);
	}

	/** Points the active template's binding, when its variant is fixed to
	 *  `from`, at `to` (Default when undefined). */
	private repointBinding(from: string, to: string | undefined): void {
		const ws = this.state.workspace;
		const slot = activeSlot(this.state);
		const binding = slot?.binding;
		if (!ws || !binding || binding.variant?.kind !== "fixed") return;
		if (binding.variant.id !== from) return;
		this.dispatch({
			type: "setBinding",
			id: ws.activeTemplateId,
			binding: {
				...binding,
				variant:
					to === undefined ? { kind: "fixed" } : { kind: "fixed", id: to },
			},
		});
	}

	// ── Clipboard ────────────────────────────────────────────────────────────

	async copy(): Promise<void> {
		const t = this.template;
		const keys = this.selectedLayers();
		if (!t || keys.length === 0) return;
		const elements = keys
			.map((k) => getElement(t, k))
			.filter((e): e is Element => !!e && "type" in e);
		await writeClipboard(t, elements);
	}

	async cut(): Promise<void> {
		await this.copy();
		this.deleteSelection();
	}

	async paste(): Promise<void> {
		const t = this.base;
		if (!t) return;
		let clip = await readClipboard();
		if (!clip) return;
		if (clip.kind === "svg") {
			const answer = this.svgPastePrompt
				? await this.svgPastePrompt()
				: "layers";
			if (answer === "cancel") return;
			if (answer === "layers") {
				this.placeSvgLayers(clip.svg);
				return;
			}
			if (answer === "image") {
				await this.placeSvg(clip.svg);
				return;
			}
			clip = { kind: "text", text: clip.svg };
		}
		let base = t;
		if (clip.kind === "layers" && clip.assets.length) {
			const have = new Set((t.assets ?? []).map((a) => a.sha256));
			const extra = clip.assets.filter((a) => !have.has(a.sha256));
			if (extra.length)
				base = { ...t, assets: [...(t.assets ?? []), ...extra] };
		}
		const elements: Element[] =
			clip.kind === "text"
				? [
						createElement(
							"text",
							defaultRect("text", { x: t.width / 2, y: t.height / 2 }, t),
							t,
							this.state.side,
						),
					].map((el) =>
						el.type === "text"
							? { ...el, properties: { ...el.properties, value: clip.text } }
							: el,
					)
				: clip.elements;
		const anchor = this.selectedLayers()[0];
		const parent = anchor ? parentKeyOf(anchor) : null;
		const ref: ParentRef = parent ?? { side: this.state.side };
		const index = anchor
			? ((parseKey(anchor) as { path: number[] }).path.at(-1) ?? 0) + 1
			: (base.template_data[this.state.side]?.elements.length ?? 0);
		const occupied = new Set(
			[...this.state.geometry.values()].map((b) => boxKey(b.rect)),
		);
		const placed = elements.map((el) =>
			el.pos &&
			occupied.has(
				boxKey({ ...el.pos, ...(el.size ?? { width: 0, height: 0 }) }),
			)
				? { ...el, pos: { x: el.pos.x + 10, y: el.pos.y + 10 } }
				: el,
		);
		this.edit(() => insertElements(base, ref, index, placed), {
			selectResult: true,
			scope: "base",
		});
	}

	// ── Document ─────────────────────────────────────────────────────────────

	open(template: Template, fileName: string, notices: string[] = []): void {
		const starts = !this.state.workspace;
		this.dispatch({ type: "open", template, fileName, notices });
		for (const n of notices) toast(n, { tone: "warning", timeout: 8000 });
		requestAnimationFrame(() => this.fitView());
		if (starts) this.emitOpened();
	}

	/** Calls `fn` each time a workspace is opened, restored or started, after
	 *  its state is in the store. */
	onWorkspaceOpened(fn: () => void): () => void {
		this.openedListeners.add(fn);
		return () => this.openedListeners.delete(fn);
	}

	private emitOpened(): void {
		for (const fn of this.openedListeners) fn();
	}

	/** Calls `fn` when the issues list should be shown, as when a save fails
	 *  validation. */
	onShowIssues(fn: () => void): () => void {
		this.issuesListeners.add(fn);
		return () => this.issuesListeners.delete(fn);
	}

	showIssues(): void {
		this.dispatch({ type: "setSection", section: "edit" });
		for (const fn of this.issuesListeners) fn();
	}

	/** Sets what asks how pasted SVG is imported. Without a prompt, it becomes
	 *  layers. */
	setSvgPastePrompt(prompt: SvgPastePrompt): () => void {
		this.svgPastePrompt = prompt;
		return () => {
			if (this.svgPastePrompt === prompt) this.svgPastePrompt = undefined;
		};
	}

	/**
	 * Sets what asks for a template's name when an unnamed one is saved. The
	 * editor sets the naming dialog; without a prompt, saves go ahead.
	 */
	setNamePrompt(prompt: NamePrompt): () => void {
		this.namePrompt = prompt;
		return () => {
			if (this.namePrompt === prompt) this.namePrompt = undefined;
		};
	}

	/**
	 * Asks for a name for each template in `ids` that is unnamed, one after
	 * another, showing each while it is asked about, then comes back to the
	 * template that was active. False when a prompt was dismissed: the save
	 * should not go ahead.
	 */
	private async nameUnnamed(ids: string[]): Promise<boolean> {
		const prompt = this.namePrompt;
		const ws = workspaceSnapshot(this.state);
		const start = this.state.workspace?.activeTemplateId;
		if (!prompt || !ws) return true;
		const unnamed = ws.templates.filter(
			(e) => ids.includes(e.id) && isUnnamed(e.template),
		);
		if (unnamed.length === 0) return true;
		this.naming = true;
		try {
			for (const entry of unnamed) {
				if (entry.id !== this.state.workspace?.activeTemplateId)
					this.switchTemplate(entry.id);
				if ((await prompt(entry.fileName)) === "cancel") return false;
			}
			return true;
		} finally {
			this.naming = false;
			if (start && start !== this.state.workspace?.activeTemplateId)
				this.switchTemplate(start);
		}
	}

	newDocument(preset: Preset | { width: number; height: number }): void {
		const t = newDocument(preset);
		this.open(t, `Untitled${COAT_EXTENSION}`);
	}

	async openSample(id: string): Promise<void> {
		const sample = findSample(id);
		if (!sample) return;
		this.open(await sample.load(), `${sample.id}${COAT_EXTENSION}`);
	}

	hasStarter(id: string): boolean {
		return findStarter(id) !== undefined;
	}

	async openStarter(id: string): Promise<void> {
		const starter = findStarter(id);
		if (!starter) return;
		const template = await starter.load();
		const fileName = `${starter.id}${COAT_EXTENSION}`;
		if (!starter.preset) {
			this.open(template, fileName);
			return;
		}
		if (!this.state.workspace) {
			// A starter's preset is part of what opens, so it is not an unsaved
			// change.
			const ws = singleTemplateWorkspace(template, fileName);
			const entry = ws.templates[0];
			if (entry)
				ws.presets = [{ ...newPreset(entry.id, []), ...starter.preset }];
			this.openWorkspace(ws, "Untitled.coatworkspace");
			return;
		}
		this.open(template, fileName);
		const next = this.state.workspace;
		if (!next) return;
		this.dispatch({
			type: "setPreset",
			preset: {
				...newPreset(next.activeTemplateId, next.presets),
				...starter.preset,
			},
		});
	}

	async openBytes(bytes: Uint8Array | string, name: string): Promise<boolean> {
		if (typeof bytes !== "string" && isWorkspaceFile(bytes, name))
			return this.openWorkspaceBytes(bytes, name);
		const outcome = await openFile(bytes, name);
		if (outcome.kind === "unreadable") {
			toast(`Couldn't read ${name}: ${outcome.message}`, { tone: "danger" });
			return false;
		}
		if (outcome.kind === "invalid") {
			const first = outcome.errors[0];
			toast(
				`${name} isn't a valid template${first ? `: ${first.message}` : ""}`,
				{ tone: "danger" },
			);
			return false;
		}
		const notices: string[] = [];
		if (outcome.healed.length)
			notices.push(`Renamed duplicate layer ids: ${outcome.healed.join(", ")}`);
		if (outcome.newerFormat) notices.push(NEWER_FORMAT);
		if (outcome.misKeyedAssets.length)
			notices.push(
				`${plural(outcome.misKeyedAssets.length, "asset")} with a wrong key. Saving as ${COAT_EXTENSION} fixes ${outcome.misKeyedAssets.length === 1 ? "it" : "them"}.`,
			);
		this.open(outcome.template, name, notices);
		return true;
	}

	async openFile(file: File): Promise<boolean> {
		// A workspace is read as a stream, so its photos stay Blobs and the
		// file is never in memory whole.
		const head = new Uint8Array(await file.slice(0, 120).arrayBuffer());
		if (isWorkspaceFile(head, file.name))
			return this.openWorkspaceBytes(file, file.name);
		return this.openBytes(new Uint8Array(await file.arrayBuffer()), file.name);
	}

	close(): void {
		stopSourceAssets();
		this.dispatch({ type: "close" });
		void clearAutosave();
	}

	async openWorkspaceBytes(
		bytes: Uint8Array | Blob,
		name: string,
	): Promise<boolean> {
		const { unpackWorkspace } = await import("@freshcoat-js/workspace");
		const out = await unpackWorkspace(bytes);
		if (!out.ok) {
			toast(`Couldn't open ${name}: ${out.message}`, { tone: "danger" });
			return false;
		}
		this.openWorkspace(out.workspace, name, out.warnings);
		if (bytes instanceof Blob)
			trackSourceAssets(out.workspace, {
				fileName: name,
				backup: readAutosaveAsset,
				onChanged: (err) =>
					toast(err.message, { tone: "danger", timeout: 12000 }),
			});
		return true;
	}

	openWorkspace(ws: Workspace, fileName: string, notices: string[] = []): void {
		stopSourceAssets();
		this.dispatch({ type: "openWorkspace", workspace: ws, fileName, notices });
		for (const n of notices) toast(n, { tone: "warning", timeout: 8000 });
		requestAnimationFrame(() => this.fitView());
		this.emitOpened();
	}

	/** The whole workspace as a .coatworkspace download. */
	async saveWorkspace(): Promise<boolean> {
		if (this.naming) return false;
		const before = workspaceSnapshot(this.state);
		if (!before) return false;
		// A template from a newer format lost the fields this editor doesn't
		// know when it was read, so writing it back would drop them for good.
		const newer = before.templates.find(
			(e) => formatVersionStatus(e.template.format_version) === "newer",
		);
		if (newer) {
			toast(`${newer.fileName}: ${NEWER_FORMAT}`, { tone: "danger" });
			return false;
		}
		if (!(await this.nameUnnamed(before.templates.map((e) => e.id))))
			return false;
		const ws = workspaceSnapshot(this.state);
		if (!ws) return false;
		// Opening validates every template, so an invalid one would make the
		// file unopenable; say which one instead.
		for (const entry of ws.templates) {
			const v = validate(entry.template);
			if (v.ok) continue;
			const first = v.errors[0];
			toast(
				`Fix ${plural(v.errors.length, "issue")} in ${entry.fileName} before saving${first ? `: ${first.message}` : ""}`,
				{ tone: "danger" },
			);
			if (entry.id !== this.state.workspace?.activeTemplateId)
				this.switchTemplate(entry.id);
			this.showIssues();
			return false;
		}
		const { packWorkspace, WORKSPACE_MEDIA_TYPE } = await import(
			"@freshcoat-js/workspace"
		);
		try {
			await settleAssets(ws.datasets.flatMap((d) => d.assets));
			const bytes = await packWorkspace(ws);
			const name = workspaceFileName(this.state.workspace?.fileName, ws.name);
			await downloadBytes(bytes, name, WORKSPACE_MEDIA_TYPE);
			this.dispatch({ type: "workspaceSaved", saved: ws, fileName: name });
			void clearAutosave();
			return true;
		} catch (err) {
			const reason =
				err instanceof SourceChangedError ? err.message : String(err);
			toast(`Couldn't save the workspace: ${reason}`, { tone: "danger" });
			return false;
		}
	}

	/** Every template as its own .coat, in one zip, without the data. */
	async exportAllTemplates(): Promise<void> {
		const ws = workspaceSnapshot(this.state);
		if (!ws) return;
		const { packTemplates } = await import("@freshcoat-js/workspace");
		try {
			const bytes = await packTemplates(ws);
			await downloadBytes(
				bytes,
				`${slugName(ws.name)}-templates.zip`,
				"application/zip",
			);
		} catch (err) {
			toast(`Couldn't export the templates: ${String(err)}`, {
				tone: "danger",
			});
		}
	}

	/** Adds a template file to the open workspace. */
	async importTemplate(file: File): Promise<boolean> {
		const outcome = await openFile(
			new Uint8Array(await file.arrayBuffer()),
			file.name,
		);
		if (outcome.kind !== "ok") {
			toast(
				outcome.kind === "invalid"
					? `${file.name} isn't a valid template`
					: `Couldn't read ${file.name}: ${outcome.message}`,
				{ tone: "danger" },
			);
			return false;
		}
		this.open(outcome.template, file.name);
		return true;
	}

	newTemplate(preset: Preset | { width: number; height: number }): void {
		const t = newDocument(preset);
		this.dispatch({
			type: "addTemplate",
			template: t,
			fileName: `Untitled${COAT_EXTENSION}`,
		});
		requestAnimationFrame(() => this.fitView());
	}

	removeTemplate(id: string): void {
		const ws = this.state.workspace;
		if (!ws || ws.templates.length <= 1) {
			toast("A workspace needs at least one template", { tone: "warning" });
			return;
		}
		this.dispatch({ type: "removeTemplate", id });
		requestAnimationFrame(() => this.fitView());
	}

	/** Shows one dataset record in the Edit preview, through the active
	 *  template's binding. */
	previewRecord(recordId: string | null): void {
		if (recordId === null) {
			this.dispatch({ type: "resetValues" });
			return;
		}
		const t = this.base;
		const slot = activeSlot(this.state);
		const binding = slot?.binding;
		const dataset = this.state.workspace?.datasets.find(
			(d) => d.id === binding?.datasetId,
		);
		const index = dataset?.records.findIndex((r) => r.id === recordId) ?? -1;
		const record = dataset?.records[index];
		if (!t || !binding || !dataset || !record) return;
		this.dispatch({
			type: "previewRecord",
			id: record.id,
			values: resolveValues(t, binding, dataset, record, index),
			variantId: variantFor(t, binding, dataset, record),
		});
	}

	switchTemplate(id: string): void {
		this.dispatch({ type: "switchTemplate", id });
		requestAnimationFrame(() => this.fitView());
	}

	async save(kind: "coat" | "json"): Promise<boolean> {
		if (this.naming || !this.base) return false;
		if (this.state.doc?.notices.includes(NEWER_FORMAT)) {
			toast(NEWER_FORMAT, { tone: "danger" });
			return false;
		}
		const active = this.state.workspace?.activeTemplateId;
		if (active && !(await this.nameUnnamed([active]))) return false;
		const t = this.base;
		if (!t) return false;
		const result = kind === "coat" ? await saveCoat(t) : saveJson(t);
		if (!result.ok) {
			const first = result.errors[0];
			toast(
				`Fix ${plural(result.errors.length, "issue")} before saving${first ? `: ${first.message}` : ""}`,
				{ tone: "danger" },
			);
			this.showIssues();
			return false;
		}
		const name = saveFileName(
			t,
			kind === "coat" ? COAT_EXTENSION : COAT_JSON_EXTENSION,
		);
		await downloadBytes(
			result.data,
			name,
			kind === "coat" ? COAT_MEDIA_TYPE : COAT_JSON_MEDIA_TYPE,
		);
		this.dispatch({ type: "saved", template: t, fileName: name });
		return true;
	}

	async exportPng(scale: number): Promise<void> {
		const t = this.base;
		if (!t) return;
		try {
			await exportSidePng(t, {
				side: this.state.side,
				variantId: this.state.variantId,
				values: this.state.values,
				scale,
				fonts: this.fonts,
			});
		} catch (err) {
			toast(`Couldn't export: ${String(err)}`, { tone: "danger" });
		}
	}

	get dirty(): boolean {
		return isDirty(this.state);
	}

	private scheduleAutosave(): void {
		const { doc, workspace } = this.state;
		const seen = this.autosaveSeen;
		if (doc === seen.doc && workspace === seen.workspace) return;
		this.autosaveSeen = { doc, workspace };
		if (!workspace) return;
		clearTimeout(this.autosaveTimer);
		this.autosaveTimer = setTimeout(() => {
			const ws = workspaceSnapshot(this.state);
			const fileName = this.state.workspace?.fileName;
			if (ws && fileName && isDirty(this.state))
				void writeAutosave({ workspace: ws, fileName });
		}, 1000);
	}

	private scheduleValidation(): void {
		const { doc } = this.state;
		if (doc === this.validateSeen) return;
		this.validateSeen = doc;
		clearTimeout(this.validateTimer);
		if (!doc?.issuesStale || doc.history.tx) return;
		this.validateTimer = setTimeout(
			() => this.dispatch({ type: "validate" }),
			MERGE_WINDOW_MS,
		);
	}

	// ── View ─────────────────────────────────────────────────────────────────

	setViewportSize(width: number, height: number): void {
		// A hidden section reports zero; keep the last real size.
		if (width === 0 || height === 0) return;
		const first = this.viewport.width === 0;
		this.viewport = { width, height };
		if (first && this.template) this.fitView();
	}

	get viewportSize(): { width: number; height: number } {
		return this.viewport;
	}

	setView(view: View): void {
		this.dispatch({
			type: "setView",
			view: {
				...view,
				zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.zoom)),
			},
		});
	}

	fitView(): void {
		const t = this.base;
		const { width, height } = this.viewport;
		if (!t || width === 0) return;
		const zoom = Math.max(
			ZOOM_MIN,
			Math.min(
				(width - FIT_PADDING * 2) / t.width,
				(height - FIT_PADDING * 2) / t.height,
			),
		);
		this.setView({
			zoom,
			x: Math.round((width - t.width * zoom) / 2),
			y: Math.round((height - t.height * zoom) / 2),
		});
	}

	/** Zooms keeping the screen point `about` (viewport-relative) still. */
	zoomTo(zoom: number, about?: { x: number; y: number }): void {
		const view = this.state.view;
		const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
		const p = about ?? {
			x: this.viewport.width / 2,
			y: this.viewport.height / 2,
		};
		const wx = (p.x - view.x) / view.zoom;
		const wy = (p.y - view.y) / view.zoom;
		this.setView({ zoom: z, x: p.x - wx * z, y: p.y - wy * z });
	}

	zoomStep(direction: 1 | -1): void {
		const z = this.state.view.zoom;
		const next =
			direction === 1
				? ZOOM_STEPS.find((s) => s > z * 1.001)
				: [...ZOOM_STEPS].reverse().find((s) => s < z / 1.001);
		if (next !== undefined) this.zoomTo(next);
	}

	/** Scrolls and zooms so the selection is in view. */
	zoomToSelection(): void {
		const rects = this.state.selection
			.map((k) => this.state.geometry.get(k)?.rect)
			.filter((r) => r !== undefined);
		if (rects.length === 0) {
			this.fitView();
			return;
		}
		const box = unionRects(rects);
		const { width, height } = this.viewport;
		const zoom = Math.min(
			(width - FIT_PADDING * 4) / Math.max(1, box.width),
			(height - FIT_PADDING * 4) / Math.max(1, box.height),
			8,
		);
		this.setView({
			zoom,
			x: width / 2 - (box.x + box.width / 2) * zoom,
			y: height / 2 - (box.y + box.height / 2) * zoom,
		});
	}

	/** The topmost unlocked, visible layer under a template-space point. */
	hitTest(
		point: { x: number; y: number },
		opts: { deep?: boolean } = {},
	): string | null {
		const t = this.template;
		if (!t) return null;
		const { geometry, locked, hidden, side, selection } = this.state;
		const hit = hitLayer(t, side, geometry, locked, hidden, point);
		if (!hit || opts.deep) return hit;
		return topmostSelectable(hit, selection);
	}

	rectOf(key: string): ReturnType<typeof rectOf> | undefined {
		const t = this.template;
		return t ? rectOf(t, key, this.state.geometry) : undefined;
	}

	geometry(): LayerGeometry {
		return this.state.geometry;
	}
}

/** In development, names an op that changed structure while scoped to a
 *  variant: the fold keeps its structure but gives back the base's values. */
function warnStructural(
	working: Template,
	next: Template,
	op: (t: Template) => unknown,
): void {
	if (!isStructuralEdit(working, next)) return;
	console.warn(
		"A structural edit ran in a variant; scope it to the base.",
		op.name || op.toString().slice(0, 120),
	);
}

/**
 * The topmost layer under `point` that is neither locked, under a locked
 * layer, nor hidden. Walks back to front, so the first hit is the answer.
 * Backgrounds and mask sources are never hit.
 */
export function hitLayer(
	t: Template,
	side: number,
	geometry: LayerGeometry,
	locked: ReadonlySet<string>,
	hidden: ReadonlySet<string>,
	point: { x: number; y: number },
): string | null {
	const frame = t.template_data[side];
	if (!frame) return null;
	const visit = (el: Element, key: string, blocked: boolean): string | null => {
		const out = blocked || locked.has(key);
		if (el.type === "frame" || el.type === "mask") {
			const children = el.properties.children;
			for (let i = children.length - 1; i >= 0; i--) {
				const hit = visit(children[i] as Element, `${key}/${i}`, out);
				if (hit) return hit;
			}
		}
		if (out || hidden.has(key)) return null;
		const box = geometry.get(key);
		return box && containsPoint(box.rect, box.worldRotation, point)
			? key
			: null;
	};
	for (let i = frame.elements.length - 1; i >= 0; i--) {
		const hit = visit(frame.elements[i] as Element, `${side}/${i}`, false);
		if (hit) return hit;
	}
	return null;
}

/**
 * Figma's click rule: the outermost layer under the pointer, unless one of its
 * ancestors (or it) is already selected, in which case the next level down.
 */
export function topmostSelectable(hit: string, selection: string[]): string {
	const chain: string[] = [];
	let k: string | null = hit;
	while (k) {
		chain.unshift(k);
		k = parentKeyOf(k);
	}
	for (let i = 0; i < chain.length; i++) {
		const key = chain[i] as string;
		if (selection.includes(key)) return key;
		if (selection.some((s) => parentKeyOf(s) === parentKeyOf(key))) return key;
	}
	return chain[0] as string;
}

function containsPoint(
	rect: { x: number; y: number; width: number; height: number },
	rotation: number,
	p: { x: number; y: number },
): boolean {
	const cx = rect.x + rect.width / 2;
	const cy = rect.y + rect.height / 2;
	const rad = (-rotation * Math.PI) / 180;
	const dx = p.x - cx;
	const dy = p.y - cy;
	const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
	const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
	return Math.abs(lx) <= rect.width / 2 && Math.abs(ly) <= rect.height / 2;
}

function boxKey(r: { x: number; y: number; width: number; height: number }) {
	return `${Math.round(r.x)}:${Math.round(r.y)}:${Math.round(r.width)}:${Math.round(r.height)}`;
}

function imageSize(file: Blob): Promise<{ width: number; height: number }> {
	return createImageBitmap(file).then((bmp) => {
		const size = { width: bmp.width, height: bmp.height };
		bmp.close();
		return size;
	});
}

function isWorkspaceFile(bytes: Uint8Array, name: string): boolean {
	if (name.toLowerCase().endsWith(".coatworkspace")) return true;
	if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false;
	const head = new TextDecoder().decode(bytes.subarray(30, 120));
	return head.includes("application/vnd.freshcoat.workspace+zip");
}

function slugName(name: string): string {
	return (
		name
			.trim()
			.replace(/[^\w.-]+/g, "-")
			.replace(/^-+|-+$/g, "") || "workspace"
	);
}

function workspaceFileName(current: string | undefined, name: string): string {
	if (current && current !== "Untitled.coatworkspace") return current;
	return `${slugName(name)}.coatworkspace`;
}
