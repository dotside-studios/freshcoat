import type { Template } from "@freshcoat/coatfile";
import { Button } from "@freshcoat/ui/button";
import { ColorPanel } from "@freshcoat/ui/color";
import { Dialog, Modal } from "@freshcoat/ui/dialog";
import { TextField } from "@freshcoat/ui/field";
import { IconButton } from "@freshcoat/ui/icon-button";
import { cn } from "@freshcoat/ui/lib/cn";
import { ContextMenu, MenuItem, MenuSeparator } from "@freshcoat/ui/menu";
import { Popover } from "@freshcoat/ui/popover";
import { treeRow } from "@freshcoat/ui/tree";
import { type RefObject, useMemo, useRef, useState } from "react";
import {
	ListBox,
	ListBoxItem,
	Dialog as RACDialog,
} from "react-aria-components";
import { useController } from "~/app/context";
import type { EditorController } from "~/app/controller";
import { LEFT_PANEL, VARIANT_UI } from "~/app/copy";
import { VariantSwatch } from "~/app/VariantSwatch";
import { useConfirm } from "~/data/ConfirmDialog";
import {
	changeVariantId,
	moveVariant,
	renameVariant,
	setVariantSwatch,
	suggestSwatch,
} from "~/doc/ops";
import { activeVariantId, changedLayerCount } from "~/doc/variant-edit";
import { documentSwatches } from "~/panels/design/field-helpers";
import { useEditor } from "~/state/hooks";
import { present } from "~/state/store";
import AddIcon from "~icons/mingcute/add-line";
import WarnIcon from "~icons/mingcute/warning-line";
import { RenameInput } from "./RenameInput";

/** Default's key in the list: not a slug, so no variant id can take it. */
const DEFAULT = "__default";

type Item = {
	id: string;
	label: string;
	swatch?: string;
	changes: number;
};

/** A label no variant has yet: "Variant 2", "Variant 3", … */
export function nextVariantLabel(t: Template): string {
	const labels = new Set((t.variants ?? []).map((v) => v.label));
	let n = (t.variants?.length ?? 0) + 1;
	while (labels.has(VARIANT_UI.newLabel(n))) n++;
	return VARIANT_UI.newLabel(n);
}

/** Adds "Variant N" and selects it; the id, or null when nothing was added. */
function addVariant(controller: EditorController): string | null {
	const t = controller.base;
	if (!t) return null;
	const id = controller.addVariant(nextVariantLabel(t));
	if (id !== null) controller.setVariant(id);
	return id;
}

/** The Variants header's `+`: adds a variant and hands it over for renaming. */
export function VariantsHeaderActions({
	onAdded,
}: {
	onAdded: (id: string) => void;
}) {
	const controller = useController();
	return (
		<IconButton
			aria-label={VARIANT_UI.add}
			tooltip={VARIANT_UI.add}
			className="size-5 pointer-coarse:size-7 [&_svg]:size-3.5"
			onPress={() => {
				const id = addVariant(controller);
				if (id !== null) onAdded(id);
			}}
		>
			<AddIcon />
		</IconButton>
	);
}

/**
 * Default, then each variant. Selecting one edits it; each variant has a
 * context menu to manage it. `renaming` is shared with the header's `+`,
 * which starts renaming what it adds.
 */
export function VariantsList({
	renaming,
	onRenamingChange: setRenaming,
}: {
	renaming: string | null;
	onRenamingChange: (id: string | null) => void;
}) {
	const controller = useController();
	// A string of what the rows show, so an edit that leaves them alone does
	// not rebuild the list.
	const signature = useEditor((s) => {
		const t = present(s);
		return JSON.stringify(
			t
				? [
						{ id: DEFAULT, label: VARIANT_UI.default, changes: 0 },
						...(t.variants ?? []).map((v) => ({
							id: v.id,
							label: v.label,
							swatch: v.swatch,
							changes: changedLayerCount(t, v.id),
						})),
					]
				: [],
		);
	});
	const active = useEditor((s) => {
		const t = present(s);
		return (t && activeVariantId(t, s.variantId)) ?? DEFAULT;
	});
	const [menuFor, setMenuFor] = useState<string | null>(null);
	const [swatchFor, setSwatchFor] = useState<string | null>(null);
	const [changeIdFor, setChangeIdFor] = useState<string | null>(null);
	const anchor = useRef<Element | null>(null);
	const { confirm, element: confirmElement } = useConfirm();

	const items = useMemo(() => JSON.parse(signature) as Item[], [signature]);
	const variants = items.slice(1);
	const selectedKeys = useMemo(() => new Set([active]), [active]);
	const byId = (id: string | null) =>
		id === null || id === DEFAULT
			? undefined
			: variants.find((v) => v.id === id);

	const add = () => {
		const id = addVariant(controller);
		if (id !== null) setRenaming(id);
	};

	const duplicate = (id: string) => {
		const v = byId(id);
		if (!v) return;
		const copy = controller.addVariant(VARIANT_UI.copyLabel(v.label), id);
		if (copy !== null) controller.setVariant(copy);
	};

	const move = (id: string, by: number) => {
		const from = variants.findIndex((v) => v.id === id);
		controller.edit((t) => moveVariant(t, id, from + by), { scope: "base" });
	};

	const remove = async (id: string) => {
		const v = byId(id);
		if (!v) return;
		const answer = await confirm({
			title: VARIANT_UI.deleteTitle(v.label),
			message: VARIANT_UI.deleteMessage(v.changes),
			confirmLabel: "Delete",
			destructive: true,
		});
		if (answer === "confirm") controller.removeVariant(id);
	};

	const target = byId(menuFor);
	const index = target ? variants.indexOf(target) : -1;

	const menu = target ? (
		<>
			<MenuItem
				id="rename"
				shortcut="F2"
				onAction={() => {
					// After the menu has handed focus back to the row, so the
					// field keeps it.
					requestAnimationFrame(() => setRenaming(target.id));
				}}
			>
				Rename
			</MenuItem>
			<MenuItem id="duplicate" onAction={() => duplicate(target.id)}>
				Duplicate
			</MenuItem>
			<MenuItem id="swatch" onAction={() => setSwatchFor(target.id)}>
				Swatch…
			</MenuItem>
			<MenuSeparator />
			<MenuItem
				id="up"
				isDisabled={index <= 0}
				onAction={() => move(target.id, -1)}
			>
				Move up
			</MenuItem>
			<MenuItem
				id="down"
				isDisabled={index >= variants.length - 1}
				onAction={() => move(target.id, 1)}
			>
				Move down
			</MenuItem>
			<MenuSeparator />
			<MenuItem id="change-id" onAction={() => setChangeIdFor(target.id)}>
				Change id…
			</MenuItem>
			<MenuItem id="delete" destructive onAction={() => void remove(target.id)}>
				Delete
			</MenuItem>
		</>
	) : null;

	return (
		<>
			<ContextMenu
				menu={menu}
				menuProps={{ "aria-label": `${target?.label ?? ""} actions` }}
				onOpen={(e) => {
					const row = (e.target as Element).closest?.("[data-variant]");
					anchor.current = row ?? null;
					setMenuFor(row?.getAttribute("data-variant") ?? null);
				}}
				onOpenChange={(open) => {
					if (!open) setMenuFor(null);
				}}
			>
				{/* biome-ignore lint/a11y/noStaticElementInteractions: F2, the context-menu key and Shift+F10 act on the focused variant */}
				<div
					onKeyDown={(e) => {
						if (renaming !== null) return;
						const row = (e.target as Element).closest?.("[data-variant]");
						const id = row?.getAttribute("data-variant") ?? active;
						if ((e.key === "F10" && e.shiftKey) || e.key === "ContextMenu") {
							// Not every browser turns these keys into a
							// contextmenu event, so raise one on the row.
							e.preventDefault();
							row?.dispatchEvent(
								new MouseEvent("contextmenu", {
									bubbles: true,
									cancelable: true,
								}),
							);
						} else if (e.key === "F2" && id !== DEFAULT) {
							e.preventDefault();
							setRenaming(id);
						}
					}}
					onContextMenu={(e) => {
						// Default has no menu, and neither does the space
						// around the rows.
						const row = (e.target as Element).closest?.("[data-variant]");
						const id = row?.getAttribute("data-variant");
						if (!id || id === DEFAULT || renaming !== null) {
							e.preventDefault();
							e.stopPropagation();
						}
					}}
				>
					<ListBox
						aria-label="Variants"
						data-testid="variants-list"
						items={items}
						dependencies={[renaming]}
						selectionMode="single"
						selectionBehavior="replace"
						disallowEmptySelection
						selectedKeys={selectedKeys}
						onSelectionChange={(keys) => {
							const [k] = keys === "all" ? [] : [...keys];
							if (typeof k === "string")
								controller.setVariant(k === DEFAULT ? undefined : k);
						}}
						className={cn(
							"flex max-h-32 flex-col overflow-auto outline-none pointer-coarse:max-h-44",
							items.length > 1 && "pb-1",
						)}
					>
						{(item) => (
							<ListBoxItem
								id={item.id}
								textValue={item.label}
								data-variant={item.id}
								data-testid={`variant-${item.id}`}
								className={cn(
									treeRow,
									"gap-1.5 pr-2 pl-2.5 data-focus-visible:outline-solid data-focus-visible:outline-1 data-focus-visible:outline-fc-accent",
								)}
							>
								<VariantSwatch
									swatch={item.swatch}
									none={item.id === DEFAULT ? "default" : "empty"}
								/>
								{renaming === item.id ? (
									<RenameInput
										initial={item.label}
										label={`Rename ${item.label}`}
										onCommit={(value) =>
											controller.edit((t) => renameVariant(t, item.id, value), {
												scope: "base",
											})?.ok ?? false
										}
										onDone={() => setRenaming(null)}
									/>
								) : (
									// biome-ignore lint/a11y/noStaticElementInteractions: double-click is a shortcut; F2 and the context menu rename from the keyboard
									<span
										className="min-w-0 flex-1 truncate"
										onDoubleClick={() =>
											item.id !== DEFAULT && setRenaming(item.id)
										}
									>
										{item.label}
									</span>
								)}
								{item.id !== DEFAULT && renaming !== item.id ? (
									<span className="shrink-0 text-fc-faint text-fc-sm tabular-nums group-data-selected/row:text-fc-muted">
										{VARIANT_UI.changes(item.changes)}
									</span>
								) : null}
							</ListBoxItem>
						)}
					</ListBox>
				</div>
			</ContextMenu>
			{items.length === 1 ? (
				<button
					type="button"
					onClick={add}
					data-testid="variants-empty-add"
					className="mb-1 flex min-h-6 w-full cursor-default items-start gap-1.5 py-1 pr-2 pl-2.5 text-left text-fc-faint text-fc-sm leading-snug outline-none hover:bg-fc-hover hover:text-fc-text focus-visible:outline-solid focus-visible:outline-1 focus-visible:outline-fc-accent focus-visible:-outline-offset-1 pointer-coarse:min-h-9"
				>
					<AddIcon className="mt-px size-3.5 shrink-0" />
					<span>{LEFT_PANEL.addVariantHint}</span>
				</button>
			) : null}

			{swatchFor !== null ? (
				<SwatchPopover
					variantId={swatchFor}
					anchor={anchor}
					onClose={() => setSwatchFor(null)}
				/>
			) : null}
			{changeIdFor !== null ? (
				<ChangeIdDialog
					variantId={changeIdFor}
					onClose={() => setChangeIdFor(null)}
				/>
			) : null}
			{confirmElement}
		</>
	);
}

function SwatchPopover({
	variantId,
	anchor,
	onClose,
}: {
	variantId: string;
	anchor: RefObject<Element | null>;
	onClose: () => void;
}) {
	const controller = useController();
	const template = useEditor((s) => present(s));
	const variant = template?.variants?.find((v) => v.id === variantId);
	const suggested =
		template && variant ? suggestSwatch(template, variant.id) : undefined;
	const sides = template?.template_data;
	const swatches = useMemo(() => documentSwatches(sides ?? []), [sides]);
	const set = (swatch: string | undefined, merge = true) =>
		variant &&
		controller.edit((t) => setVariantSwatch(t, variant.id, swatch), {
			scope: "base",
			mergeKey: merge ? `variant-swatch:${variant.id}` : undefined,
		});

	return (
		<Popover
			triggerRef={anchor}
			isOpen={variant !== undefined}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
			placement="bottom end"
			className="overflow-visible"
		>
			<RACDialog
				aria-label={variant ? `${variant.label} swatch` : "Swatch"}
				className="outline-none"
			>
				{variant ? (
					<>
						<ColorPanel
							value={variant.swatch ?? suggested ?? ""}
							onChange={(v) => set(v)}
							swatches={swatches}
						/>
						<div className="flex gap-1.5 border-fc-border border-t px-2.5 py-2">
							<Button
								size="sm"
								isDisabled={!suggested || suggested === variant.swatch}
								onPress={() => set(suggested, false)}
							>
								{VARIANT_UI.useSuggested}
							</Button>
							<Button
								size="sm"
								variant="ghost"
								isDisabled={variant.swatch === undefined}
								onPress={() => set(undefined, false)}
							>
								{VARIANT_UI.noSwatch}
							</Button>
						</div>
					</>
				) : null}
			</RACDialog>
		</Popover>
	);
}

function ChangeIdDialog({
	variantId,
	onClose,
}: {
	variantId: string;
	onClose: () => void;
}) {
	const controller = useController();
	const [value, setValue] = useState(variantId);
	const [error, setError] = useState<string | null>(null);
	const submit = () => {
		const base = controller.base;
		if (!base) return;
		const check = changeVariantId(base, variantId, value);
		if (!check.ok) {
			setError(check.reason);
			return;
		}
		if (controller.changeVariantId(variantId, value)) onClose();
	};

	return (
		<Modal
			isOpen
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
			width="max-w-sm"
		>
			<Dialog
				title={"Change variant id"}
				footer={
					<>
						<Button variant="ghost" onPress={onClose}>
							Cancel
						</Button>
						<Button
							variant="primary"
							onPress={submit}
							isDisabled={value.trim() === variantId}
						>
							{VARIANT_UI.changeId}
						</Button>
					</>
				}
			>
				<form
					className="flex flex-col gap-3"
					onSubmit={(e) => {
						e.preventDefault();
						submit();
					}}
				>
					<TextField
						label="Id"
						autoFocus
						value={value}
						onChange={(v) => {
							setValue(v);
							setError(null);
						}}
						isInvalid={error !== null}
						errorMessage={error}
						inputClassName="font-fc-mono"
					/>
					<p
						data-testid="change-id-warning"
						className="m-0 flex gap-1.5 rounded-[3px] bg-fc-raised px-2 py-1.5 text-fc-muted text-fc-sm leading-snug"
					>
						<WarnIcon className="mt-px size-3.5 shrink-0 text-fc-warning" />
						{VARIANT_UI.changeIdWarning}
					</p>
				</form>
			</Dialog>
		</Modal>
	);
}
