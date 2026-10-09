import {
	Menu,
	MenuItem,
	MenuSeparator,
	SubmenuTrigger,
} from "@freshcoat-js/ui/menu";
import { Popover } from "@freshcoat-js/ui/popover";
import { getElement } from "~/doc/path";
import { useEditor } from "~/state/hooks";
import type { EditorState } from "~/state/store";
import { COMMAND_BY_ID, type CommandContext } from "./commands";
import { useController } from "./context";
import type { EditorController } from "./controller";
import { VARIANT_UI } from "./copy";

const ARRANGE = [
	"object.forward",
	"object.backward",
	"object.front",
	"object.back",
];
const ALIGN = [
	"align.left",
	"align.hcenter",
	"align.right",
	"align.top",
	"align.vcenter",
	"align.bottom",
	"align.hdistribute",
	"align.vdistribute",
];
const BOOLEAN_OPS = [
	"object.union",
	"object.subtract",
	"object.intersect",
	"object.exclude",
];

/** Runs a command whose implementation only needs the controller. */
export function runCommand(controller: EditorController, id: string) {
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

function CommandItem({
	id,
	state,
	label,
	isDisabled,
	destructive,
}: {
	id: string;
	state: EditorState;
	label?: string;
	isDisabled?: boolean;
	destructive?: boolean;
}) {
	const controller = useController();
	const c = COMMAND_BY_ID.get(id);
	if (!c) return null;
	return (
		<MenuItem
			id={id}
			shortcut={c.keys?.[id === "edit.delete" ? 1 : 0]}
			isDisabled={isDisabled || !(c.enabled?.(state) ?? true)}
			destructive={destructive}
			onAction={() => runCommand(controller, id)}
		>
			{label ?? c.label}
		</MenuItem>
	);
}

function CommandSubmenu({
	id,
	label,
	ids,
	state,
}: {
	id: string;
	label: string;
	ids: string[];
	state: EditorState;
}) {
	return (
		<SubmenuTrigger>
			<MenuItem id={id}>{label}</MenuItem>
			<Popover placement="end top">
				<Menu aria-label={label}>
					{ids.map((c) => (
						<CommandItem key={c} id={c} state={state} />
					))}
				</Menu>
			</Popover>
		</SubmenuTrigger>
	);
}

/** The actions on the selected layers, for the layers tree and the canvas.
 *  `onRename` adds Rename, for wherever a layer's name can be edited. */
export function LayerMenuItems({ onRename }: { onRename?: () => void }) {
	const controller = useController();
	const state = useEditor((s) => s);
	const selection = state.selection;
	const layers = controller.selectedLayers();
	const t = controller.template;
	const hasFrame = layers.some((k) => t && getElement(t, k)?.type === "frame");
	const allHidden =
		selection.length > 0 && selection.every((k) => state.hidden.has(k));
	const allLocked =
		selection.length > 0 && selection.every((k) => state.locked.has(k));
	const variantId = controller.variantId;
	const variant = controller.base?.variants?.find((v) => v.id === variantId);
	const inVariant = variant ? controller.variantVisibility(layers) : [];
	const allHiddenInVariant =
		inVariant.length > 0 && inVariant.every((l) => l.hidden);

	return (
		<>
			{onRename ? (
				<>
					<MenuItem
						id="rename"
						shortcut="F2"
						isDisabled={selection.length === 0}
						onAction={onRename}
					>
						Rename
					</MenuItem>
					<MenuSeparator />
				</>
			) : null}
			<CommandItem id="edit.cut" state={state} />
			<CommandItem id="edit.copy" state={state} />
			<CommandItem id="edit.paste" state={state} />
			<CommandItem id="edit.pasteInPlace" state={state} />
			<CommandItem id="edit.copyStyle" state={state} />
			<CommandItem
				id="edit.pasteStyle"
				state={state}
				isDisabled={!controller.hasCopiedStyle}
			/>
			<MenuSeparator />
			<CommandItem id="edit.duplicate" state={state} />
			<CommandItem
				id="edit.delete"
				state={state}
				isDisabled={layers.length === 0}
				destructive
			/>
			<MenuSeparator />
			<CommandItem
				id="object.group"
				state={state}
				label="Group"
				isDisabled={layers.length === 0}
			/>
			<CommandItem id="object.ungroup" state={state} isDisabled={!hasFrame} />
			<CommandItem id="object.textOnPath" state={state} />
			<MenuSeparator />
			<CommandSubmenu
				id="arrange"
				label="Arrange"
				ids={ARRANGE}
				state={state}
			/>
			<CommandSubmenu id="align" label="Align" ids={ALIGN} state={state} />
			<CommandSubmenu
				id="boolean"
				label="Boolean"
				ids={BOOLEAN_OPS}
				state={state}
			/>
			<MenuSeparator />
			<MenuItem
				id="hide"
				shortcut={COMMAND_BY_ID.get("object.hide")?.keys?.[0]}
				isDisabled={selection.length === 0}
				onAction={() => setAll(controller, "hidden", selection)}
			>
				{allHidden ? "Show" : "Hide"}
			</MenuItem>
			<MenuItem
				id="lock"
				shortcut={COMMAND_BY_ID.get("object.lock")?.keys?.[0]}
				isDisabled={selection.length === 0}
				onAction={() => setAll(controller, "locked", selection)}
			>
				{allLocked ? "Unlock" : "Lock"}
			</MenuItem>
			{variant ? (
				<MenuItem
					id="hide-in-variant"
					isDisabled={inVariant.length === 0}
					onAction={() =>
						controller.setHiddenInVariant(layers, !allHiddenInVariant)
					}
				>
					{allHiddenInVariant
						? VARIANT_UI.showIn(variant.label)
						: VARIANT_UI.hideIn(variant.label)}
				</MenuItem>
			) : null}
		</>
	);
}
