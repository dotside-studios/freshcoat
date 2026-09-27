import type { Template } from "@freshcoat-js/coatfile";
import { cn } from "@freshcoat-js/ui/lib/cn";
import { ContextMenu, MenuItem, MenuSeparator } from "@freshcoat-js/ui/menu";
import { ToggleButton } from "@freshcoat-js/ui/toggle";
import { Tree, TreeItem } from "@freshcoat-js/ui/tree";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	Collection,
	type DropOperation,
	type Key,
	type Selection,
	useDragAndDrop,
} from "react-aria-components";
import { COMMAND_BY_ID, type CommandContext } from "~/app/commands";
import { useController } from "~/app/context";
import type { EditorController } from "~/app/controller";
import { VARIANT_UI } from "~/app/copy";
import { layerIcon } from "~/app/icons";
import { moveElements, renameElement } from "~/doc/ops";
import { parentKeyOf, remapKeys, walkLayers } from "~/doc/path";
import {
	activeVariantId,
	hiddenInVariant,
	overriddenKeys,
	overrideBackground,
	workingTemplate,
} from "~/doc/variant-edit";
import { useEditor } from "~/state/hooks";
import { present } from "~/state/store";
import EyeIcon from "~icons/mingcute/eye-2-line";
import EyeOffIcon from "~icons/mingcute/eye-close-line";
import LockIcon from "~icons/mingcute/lock-line";
import UnlockIcon from "~icons/mingcute/unlock-line";
import { dropToMove } from "./drop";
import { RenameInput } from "./RenameInput";
import { buildLayerRows, flattenRows, type LayerRow } from "./rows";

const LAYER_TYPE = "application/x-freshcoat-layer";

type Renaming = { key: string | null; start(key: string): void; stop(): void };
const RenamingContext = createContext<Renaming>({
	key: null,
	start() {},
	stop() {},
});

/** What the active variant does to each layer on the side: changes a value,
 *  or hides it. Null with no active variant. */
type VariantMarks = {
	label: string;
	changed: Set<string>;
	hidden: Set<string>;
} | null;
const VariantMarksContext = createContext<VariantMarks>(null);

function variantMarks(
	t: Template | null,
	variantId: string | undefined,
	side: number,
): VariantMarks {
	const id = t ? activeVariantId(t, variantId) : undefined;
	const frame = t?.template_data[side];
	const variant = t?.variants?.find((v) => v.id === id);
	if (!t || !frame || !variant) return null;
	const hiddenIds = hiddenInVariant(t, variant.id, frame.name);
	const changed = new Set<string>();
	const hidden = new Set<string>();
	for (const e of walkLayers(t, side)) {
		if ("background" in e.path) {
			if (overrideBackground(t, variant.id, frame.name)) changed.add(e.key);
			continue;
		}
		if (overriddenKeys(t, variant.id, frame.name, e.element.id).length > 0)
			changed.add(e.key);
		if (hiddenIds.has(e.element.id)) hidden.add(e.key);
	}
	return { label: variant.label, changed, hidden };
}

function ancestorsOf(key: string): string[] {
	const out: string[] = [];
	for (let k = parentKeyOf(key); k; k = parentKeyOf(k)) out.push(k);
	return out;
}

/** Hidden itself, or inside a hidden layer. */
function useHiddenInTree(key: string): boolean {
	return useEditor(
		(s) => s.hidden.has(key) || ancestorsOf(key).some((k) => s.hidden.has(k)),
	);
}

function rowSelector(key: string) {
	return `[data-layer-key="${key}"]`;
}

// Commands whose implementation only needs the controller.
function runCommand(controller: EditorController, id: string) {
	const ctx: CommandContext = {
		controller,
		pickFile() {},
		pickTemplate() {},
		pickImage() {},
		showShortcuts() {},
		showTemplateSetup() {},
		confirmDiscard: (then) => then(),
	};
	void COMMAND_BY_ID.get(id)?.run(ctx);
}

function shortcut(id: string, which = 0): string | undefined {
	return COMMAND_BY_ID.get(id)?.keys?.[which];
}

/** Sets every key to the same state: on if any of them is off. */
function setAll(
	controller: EditorController,
	which: "hidden" | "locked",
	keys: string[],
) {
	const set = controller.state[which];
	const turnOn = keys.some((k) => !set.has(k));
	const flip = keys.filter((k) => set.has(k) !== turnOn);
	if (which === "hidden") controller.toggleHidden(flip);
	else controller.toggleLocked(flip);
}

export function LayersTree() {
	const controller = useController();
	// A drag moves layers without renaming or restacking them, so the tree
	// shows the state the drag started from until it ends.
	const template = useEditor((s) => {
		const base = s.doc?.history.tx?.base ?? present(s);
		return base && workingTemplate(base, s.variantId);
	});
	const side = useEditor((s) => s.side);
	const variantId = useEditor((s) => s.variantId);
	const selection = useEditor((s) => s.selection);
	const hover = useEditor((s) => s.hover);
	const marks = useMemo(
		() => variantMarks(template, variantId, side),
		[template, variantId, side],
	);
	const wrapRef = useRef<HTMLDivElement>(null);
	const fromTree = useRef(false);
	const dragged = useRef<string[]>([]);
	const [renaming, setRenaming] = useState<string | null>(null);
	const [menuKey, setMenuKey] = useState<string | null>(null);

	const rows = useMemo(
		() => (template ? buildLayerRows(template, side) : []),
		[template, side],
	);
	const rowIndex = useMemo(() => indexRows(rows), [rows]);
	// Handing RAC back its own Selection keeps its anchor, which Shift-click
	// ranges start from.
	const lastSelection = useRef<Selection | null>(null);
	const selectedKeys = useMemo(() => {
		const own = lastSelection.current;
		if (
			own &&
			own !== "all" &&
			own.size === selection.length &&
			selection.every((k) => own.has(k))
		)
			return own;
		return new Set<Key>(selection);
	}, [selection]);

	// Expanded rows follow the document (keys shift as layers move) and open
	// to reveal whatever gets selected.
	const [expand, setExpand] = useState<{
		t: Template | null;
		sel: string[];
		keys: Set<Key>;
	}>(() => ({ t: template, sel: [], keys: new Set() }));
	let expanded = expand.keys;
	if (expand.t !== template || expand.sel !== selection) {
		let keys = expand.keys;
		if (expand.t && template && expand.t !== template)
			keys = new Set(remapKeys(expand.t, template, keys as Set<string>));
		if (expand.sel !== selection) {
			const missing = selection
				.flatMap(ancestorsOf)
				.filter((k) => !keys.has(k));
			if (missing.length) keys = new Set([...keys, ...missing]);
		}
		expanded = keys;
		setExpand({ t: template, sel: selection, keys });
	}

	// A selection made elsewhere scrolls its row into view.
	useEffect(() => {
		if (fromTree.current) {
			fromTree.current = false;
			return;
		}
		const last = selection.at(-1);
		if (!last) return;
		const id = requestAnimationFrame(() => {
			const el = wrapRef.current?.querySelector(rowSelector(last));
			el?.scrollIntoView?.({ block: "nearest" });
		});
		return () => cancelAnimationFrame(id);
	}, [selection]);

	// A layer hovered on the canvas lights up its row.
	useEffect(() => {
		if (!hover || rows.length === 0) return;
		const el = wrapRef.current?.querySelector(rowSelector(hover));
		el?.setAttribute("data-canvas-hover", "");
		return () => el?.removeAttribute("data-canvas-hover");
	}, [hover, rows]);

	const onSelectionChange = useCallback(
		(keys: Selection) => {
			lastSelection.current = keys;
			const next = keys === "all" ? flattenRows(rows) : [...keys].map(String);
			const prev = controller.state.selection;
			const ordered = [
				...prev.filter((k) => next.includes(k)),
				...next.filter((k) => !prev.includes(k)),
			];
			controller.select(ordered);
			fromTree.current = controller.state.selection !== prev;
		},
		[controller, rows],
	);

	const { dragAndDropHooks } = useDragAndDrop<LayerRow>({
		getItems: (keys) =>
			[...keys].map((k) => ({
				"text/plain": rowIndex.get(String(k))?.id ?? String(k),
				[LAYER_TYPE]: String(k),
			})),
		onDragStart: (e) => {
			dragged.current = [...e.keys].map(String);
		},
		onDragEnd: () => {
			dragged.current = [];
		},
		renderDragPreview: (items) => (
			<div className="rounded-[3px] border border-fc-accent bg-fc-raised px-2 py-0.5 text-fc-base text-fc-text shadow-lg">
				{items[0]?.["text/plain"]}
				{items.length > 1 && ` +${items.length - 1}`}
			</div>
		),
		getDropOperation: (target): DropOperation => {
			const t = controller.template;
			if (!t || target.type !== "item") return "cancel";
			return dropToMove(
				t,
				dragged.current,
				String(target.key),
				target.dropPosition,
			)
				? "move"
				: "cancel";
		},
		onMove: (e) => {
			const t = controller.template;
			if (!t) return;
			const move = dropToMove(
				t,
				[...e.keys].map(String),
				String(e.target.key),
				e.target.dropPosition,
			);
			if (!move) return;
			const geometry = controller.baseGeometry();
			controller.edit(
				(doc) =>
					moveElements(doc, move.keys, move.parent, move.index, geometry),
				{ selectResult: true, scope: "base" },
			);
		},
	});

	const renameCtx = useMemo<Renaming>(
		() => ({
			key: renaming,
			start: (key) => {
				setExpand((s) => ({
					...s,
					keys: new Set([...s.keys, ...ancestorsOf(key)]),
				}));
				setRenaming(key);
			},
			stop: () => {
				const key = renaming;
				setRenaming(null);
				if (key)
					requestAnimationFrame(() =>
						(
							wrapRef.current?.querySelector(rowSelector(key)) as HTMLElement
						)?.focus(),
					);
			},
		}),
		[renaming],
	);

	const renderRow = useCallback(
		function renderRow(row: LayerRow): ReactNode {
			return (
				<TreeItem
					id={row.key}
					textValue={row.id}
					data-layer-key={row.key}
					data-pinned={row.kind === "layer" ? undefined : ""}
					data-testid={`layer-row-${row.key}`}
					className={cn(
						"data-canvas-hover:bg-fc-hover",
						row.kind === "background" && "border-fc-border border-t",
					)}
					onHoverStart={() =>
						controller.dispatch({ type: "hover", key: row.key })
					}
					onHoverEnd={() => {
						if (controller.state.hover === row.key)
							controller.dispatch({ type: "hover", key: null });
					}}
					icon={<RowIcon row={row} />}
					label={<RowLabel row={row} />}
					actions={<RowToggles rowKey={row.key} />}
				>
					{row.children.length > 0 && (
						<Collection items={row.children}>{renderRow}</Collection>
					)}
				</TreeItem>
			);
		},
		[controller],
	);

	const menuTarget = menuKey ?? selection[0] ?? null;
	const layers = controller.selectedLayers();
	const hasLayers = layers.length > 0;
	const allHidden =
		selection.length > 0 &&
		selection.every((k) => controller.state.hidden.has(k));
	const allLocked =
		selection.length > 0 &&
		selection.every((k) => controller.state.locked.has(k));
	const inVariant = marks ? controller.variantVisibility(layers) : [];
	const allHiddenInVariant =
		inVariant.length > 0 && inVariant.every((l) => l.hidden);

	const menu = (
		<>
			<MenuItem
				id="rename"
				shortcut="F2"
				isDisabled={!menuTarget}
				onAction={() => menuTarget && renameCtx.start(menuTarget)}
			>
				Rename
			</MenuItem>
			<MenuItem
				id="duplicate"
				shortcut={shortcut("edit.duplicate")}
				isDisabled={!hasLayers}
				onAction={() => runCommand(controller, "edit.duplicate")}
			>
				Duplicate
			</MenuItem>
			<MenuItem
				id="delete"
				shortcut={shortcut("edit.delete", 1)}
				isDisabled={!hasLayers}
				destructive
				onAction={() => runCommand(controller, "edit.delete")}
			>
				Delete
			</MenuItem>
			<MenuSeparator />
			<MenuItem
				id="group"
				shortcut={shortcut("object.group")}
				isDisabled={!hasLayers}
				onAction={() => runCommand(controller, "object.group")}
			>
				Group
			</MenuItem>
			<MenuItem
				id="ungroup"
				shortcut={shortcut("object.ungroup")}
				isDisabled={
					!layers.some((k) => rowIndex.get(k)?.element.type === "frame")
				}
				onAction={() => runCommand(controller, "object.ungroup")}
			>
				Ungroup
			</MenuItem>
			<MenuSeparator />
			<MenuItem
				id="forward"
				shortcut={shortcut("object.forward")}
				isDisabled={!hasLayers}
				onAction={() => runCommand(controller, "object.forward")}
			>
				Bring forward
			</MenuItem>
			<MenuItem
				id="backward"
				shortcut={shortcut("object.backward")}
				isDisabled={!hasLayers}
				onAction={() => runCommand(controller, "object.backward")}
			>
				Send backward
			</MenuItem>
			<MenuSeparator />
			<MenuItem
				id="hide"
				shortcut={shortcut("object.hide")}
				isDisabled={selection.length === 0}
				onAction={() => setAll(controller, "hidden", selection)}
			>
				{allHidden ? "Show" : "Hide"}
			</MenuItem>
			<MenuItem
				id="lock"
				shortcut={shortcut("object.lock")}
				isDisabled={selection.length === 0}
				onAction={() => setAll(controller, "locked", selection)}
			>
				{allLocked ? "Unlock" : "Lock"}
			</MenuItem>
			{marks ? (
				<MenuItem
					id="hide-in-variant"
					isDisabled={inVariant.length === 0}
					onAction={() =>
						controller.setHiddenInVariant(layers, !allHiddenInVariant)
					}
				>
					{allHiddenInVariant
						? VARIANT_UI.showIn(marks.label)
						: VARIANT_UI.hideIn(marks.label)}
				</MenuItem>
			) : null}
			<MenuSeparator />
			<MenuItem
				id="copy"
				shortcut={shortcut("edit.copy")}
				isDisabled={!hasLayers}
				onAction={() => runCommand(controller, "edit.copy")}
			>
				Copy
			</MenuItem>
			<MenuItem
				id="paste"
				shortcut={shortcut("edit.paste")}
				onAction={() => runCommand(controller, "edit.paste")}
			>
				Paste
			</MenuItem>
		</>
	);

	return (
		<VariantMarksContext.Provider value={marks}>
			<RenamingContext.Provider value={renameCtx}>
				<ContextMenu
					className="flex min-h-0 flex-1 flex-col"
					menu={menu}
					menuProps={{ "aria-label": "Layer actions" }}
					onOpen={(e) => {
						const row = (e.target as Element).closest?.("[data-layer-key]");
						const key = row?.getAttribute("data-layer-key") ?? null;
						if (key && !controller.state.selection.includes(key)) {
							fromTree.current = true;
							controller.select([key]);
						}
						setMenuKey(key);
					}}
					onOpenChange={(open) => {
						if (!open) setMenuKey(null);
					}}
				>
					{/* biome-ignore lint/a11y/noStaticElementInteractions: only vetoes native drags of pinned rows and F2 from the focused row */}
					<div
						ref={wrapRef}
						className="flex min-h-0 flex-1 flex-col"
						onDragStartCapture={(e) => {
							if ((e.target as Element).closest?.("[data-pinned]"))
								e.preventDefault();
						}}
						onKeyDown={(e) => {
							if (e.key !== "F2" || renaming) return;
							const row = (e.target as Element).closest?.("[data-layer-key]");
							const key =
								row?.getAttribute("data-layer-key") ??
								controller.state.selection[0];
							if (key) {
								e.preventDefault();
								renameCtx.start(key);
							}
						}}
					>
						<Tree
							aria-label="Layers"
							data-testid="layers-tree"
							items={rows}
							selectionMode="multiple"
							selectionBehavior="replace"
							selectedKeys={selectedKeys}
							onSelectionChange={onSelectionChange}
							expandedKeys={expanded}
							onExpandedChange={(keys) =>
								setExpand((s) => ({ ...s, keys: new Set(keys) }))
							}
							dragAndDropHooks={dragAndDropHooks}
							className="min-h-0 flex-1"
						>
							{renderRow}
						</Tree>
					</div>
				</ContextMenu>
			</RenamingContext.Provider>
		</VariantMarksContext.Provider>
	);
}

function indexRows(rows: LayerRow[]): Map<string, LayerRow> {
	const out = new Map<string, LayerRow>();
	const visit = (list: LayerRow[]) => {
		for (const r of list) {
			out.set(r.key, r);
			visit(r.children);
		}
	};
	visit(rows);
	return out;
}

function RowIcon({ row }: { row: LayerRow }) {
	const Icon = layerIcon(row.element, row.kind === "background");
	const marks = useContext(VariantMarksContext);
	const dim = useHiddenInTree(row.key) || (marks?.hidden.has(row.key) ?? false);
	return <Icon className={cn(dim && "opacity-45")} />;
}

function RowLabel({ row }: { row: LayerRow }) {
	const controller = useController();
	const renaming = useContext(RenamingContext);
	const marks = useContext(VariantMarksContext);
	const hiddenInVariant = marks?.hidden.has(row.key) ?? false;
	const dim = useHiddenInTree(row.key) || hiddenInVariant;

	if (renaming.key === row.key)
		return (
			<RenameInput
				initial={row.id}
				label={`Rename ${row.id}`}
				onCommit={(value) =>
					controller.edit((t) => renameElement(t, row.key, value), {
						scope: "base",
					})?.ok ?? false
				}
				onDone={renaming.stop}
			/>
		);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: double-click is a shortcut; F2 and the context menu rename from the keyboard
		<span
			className="flex min-w-0 items-center gap-1.5"
			onDoubleClick={(e) => {
				e.stopPropagation();
				renaming.start(row.key);
			}}
		>
			{row.kind === "maskSource" && (
				<span
					className={cn("shrink-0 text-fc-faint italic", dim && "opacity-45")}
				>
					mask ·
				</span>
			)}
			<span
				data-layer-name=""
				className={cn(
					"min-w-0 truncate",
					row.kind === "maskSource" && "text-fc-muted italic",
					dim && "opacity-45",
				)}
			>
				{row.id}
			</span>
			{marks?.changed.has(row.key) ? (
				<span
					role="img"
					aria-label={VARIANT_UI.changedIn(marks.label)}
					title={VARIANT_UI.changedIn(marks.label)}
					data-testid="layer-variant-changed"
					className="size-1.5 shrink-0 rounded-full bg-fc-accent"
				/>
			) : null}
			{hiddenInVariant && marks ? (
				<EyeOffIcon
					role="img"
					aria-label={VARIANT_UI.hiddenIn(marks.label)}
					data-testid="layer-variant-hidden"
					className="size-3.5 shrink-0 text-fc-accent-hover"
				/>
			) : null}
			{row.bound && (
				<span
					title="Uses a field"
					className={cn(
						"shrink-0 rounded-[2px] bg-fc-accent-soft px-[3px] font-mono text-[10px] text-fc-accent-hover leading-[14px]",
						dim && "opacity-45",
					)}
				>
					{"{}"}
				</span>
			)}
		</span>
	);
}

function RowToggles({ rowKey }: { rowKey: string }) {
	const controller = useController();
	const hidden = useEditor((s) => s.hidden.has(rowKey));
	const locked = useEditor((s) => s.locked.has(rowKey));
	const reveal =
		"opacity-0 group-data-hovered/row:opacity-100 group-data-focus-visible/row:opacity-100 data-focus-visible:opacity-100 pointer-coarse:opacity-100";
	const button =
		"size-5 bg-transparent data-hovered:bg-transparent data-selected:bg-transparent pointer-coarse:size-7 [&_svg]:size-3.5 pointer-coarse:[&_svg]:size-4";
	return (
		<>
			<ToggleButton
				aria-label={locked ? "Unlock" : "Lock"}
				isSelected={locked}
				onChange={() => controller.toggleLocked([rowKey])}
				className={cn(button, !locked && reveal)}
			>
				{locked ? <LockIcon /> : <UnlockIcon />}
			</ToggleButton>
			<ToggleButton
				aria-label={hidden ? "Show" : "Hide"}
				isSelected={hidden}
				onChange={() => controller.toggleHidden([rowKey])}
				className={cn(button, !hidden && reveal)}
			>
				{hidden ? <EyeOffIcon /> : <EyeIcon />}
			</ToggleButton>
		</>
	);
}
