import { togglePrintGuides } from "~/canvas/print-guides";
import { openExportSelected } from "~/data/export-selected";
import type { AlignMode } from "~/doc/geometry";
import { loadBarcodeEncoder } from "~/render/barcode";
import type { EditorState, Tool } from "~/state/store";
import type { Section } from "~/state/workspace";
import type { EditorController } from "./controller";
import { TEMPLATE_SETUP } from "./copy";
import { toggleRenderStats } from "./render-stats";
import { setThemePreference, type ThemePreference } from "./theme";

export type CommandContext = {
	controller: EditorController;
	/** Opens the system file picker for a workspace or a template. */
	pickFile(): void;
	/** Opens the picker for a template to add to the workspace. */
	pickTemplate(): void;
	/** Opens the picker for an image to place. */
	pickImage(): void;
	showShortcuts(): void;
	/** Opens Template setup for the active template. */
	showTemplateSetup(): void;
	/** Asks before discarding unsaved work. */
	confirmDiscard(then: () => void): void;
};

export type Command = {
	id: string;
	label: string;
	/** "Mod+Shift+Z" style; several alternatives allowed. */
	keys?: string[];
	group: string;
	/** Runs even when focus is in a text field. */
	global?: boolean;
	/** Where the command applies; the canvas commands only make sense in Edit,
	 *  and in Data the same keys belong to the grid. */
	sections?: readonly Section[];
	enabled?(s: EditorState): boolean;
	run(ctx: CommandContext): void | Promise<void>;
};

const hasDoc = (s: EditorState) => s.doc !== null;
const hasSelection = (s: EditorState) =>
	s.selection.some((k) => !k.endsWith("/bg"));
const tool = (t: Tool, label: string, key: string): Command => ({
	id: `tool.${t}`,
	label,
	keys: [key],
	group: "Tools",
	enabled: hasDoc,
	run: ({ controller, pickImage }) => {
		if (t === "image") pickImage();
		else controller.dispatch({ type: "setTool", tool: t });
		// Fetched now so the first code drawn is not a placeholder.
		if (t === "barcode") void loadBarcodeEncoder().catch(() => {});
	},
});
const themeCommand = (pref: ThemePreference, label: string): Command => ({
	id: `view.theme.${pref}`,
	label,
	group: "View",
	sections: ["edit", "data", "export"],
	run: () => setThemePreference(pref),
});
const alignCommand = (mode: AlignMode, label: string, key?: string) => ({
	id: `align.${mode}`,
	label,
	keys: key ? [key] : undefined,
	group: "Arrange",
	enabled: hasSelection,
	run: ({ controller }: CommandContext) => controller.alignSelection(mode),
});

export const COMMANDS: Command[] = [
	{
		id: "file.new",
		label: "New workspace",
		group: "File",
		run: ({ controller, confirmDiscard }) =>
			confirmDiscard(() => controller.close()),
	},
	{
		id: "file.open",
		label: "Open…",
		keys: ["Mod+O"],
		group: "File",
		global: true,
		run: ({ pickFile, confirmDiscard }) => confirmDiscard(pickFile),
	},
	{
		id: "file.save",
		label: "Save workspace",
		keys: ["Mod+S"],
		group: "File",
		global: true,
		enabled: hasDoc,
		run: ({ controller }) => {
			void controller.saveWorkspace();
		},
	},
	{
		id: "file.templateSetup",
		label: TEMPLATE_SETUP.command,
		keys: ["Mod+Alt+,"],
		group: "File",
		enabled: hasDoc,
		run: ({ showTemplateSetup }) => showTemplateSetup(),
	},
	{
		id: "file.importTemplate",
		label: "Import template…",
		group: "File",
		enabled: hasDoc,
		run: ({ pickTemplate }) => pickTemplate(),
	},
	{
		id: "file.exportCoat",
		label: "Export template as .coat",
		group: "File",
		enabled: hasDoc,
		run: ({ controller }) => {
			void controller.save("coat");
		},
	},
	{
		id: "file.exportJson",
		label: "Export template as .coat.json",
		keys: ["Mod+Shift+S"],
		group: "File",
		global: true,
		enabled: hasDoc,
		run: ({ controller }) => {
			void controller.save("json");
		},
	},
	{
		id: "file.exportTemplates",
		label: "Export all templates (.zip)",
		group: "File",
		enabled: hasDoc,
		run: ({ controller }) => controller.exportAllTemplates(),
	},
	...[1, 2, 3].map(
		(scale): Command => ({
			id: `file.export${scale}x`,
			label: `Export PNG @${scale}×`,
			keys: scale === 2 ? ["Mod+Shift+E"] : undefined,
			group: "File",
			enabled: hasDoc,
			run: ({ controller }) => controller.exportPng(scale),
		}),
	),
	{
		id: "file.close",
		label: "Close workspace",
		group: "File",
		enabled: hasDoc,
		run: ({ controller, confirmDiscard }) =>
			confirmDiscard(() => controller.close()),
	},
	...(
		[
			["edit", "Edit", "1"],
			["data", "Data", "2"],
			["export", "Export", "3"],
		] as const
	).map(
		([section, label, key]): Command => ({
			id: `section.${section}`,
			label,
			keys: [`Mod+${key}`],
			group: "Sections",
			global: true,
			enabled: hasDoc,
			run: ({ controller }) =>
				controller.dispatch({ type: "setSection", section }),
		}),
	),
	{
		id: "data.exportSelected",
		label: "Export selected",
		keys: ["Mod+E"],
		group: "Data",
		sections: ["data"],
		enabled: hasDoc,
		run: () => {
			openExportSelected();
		},
	},
	{
		id: "edit.undo",
		label: "Undo",
		keys: ["Mod+Z"],
		group: "Edit",
		global: true,
		enabled: (s) =>
			s.section === "data"
				? (s.workspace?.datasetHistory.past.length ?? 0) > 0
				: (s.doc?.history.past.length ?? 0) > 0,
		run: ({ controller }) =>
			controller.state.section === "data"
				? controller.dispatch({ type: "datasetUndo" })
				: controller.undo(),
	},
	{
		id: "edit.redo",
		label: "Redo",
		keys: ["Mod+Shift+Z", "Mod+Y"],
		group: "Edit",
		global: true,
		enabled: (s) =>
			s.section === "data"
				? (s.workspace?.datasetHistory.future.length ?? 0) > 0
				: (s.doc?.history.future.length ?? 0) > 0,
		run: ({ controller }) =>
			controller.state.section === "data"
				? controller.dispatch({ type: "datasetRedo" })
				: controller.redo(),
	},
	{
		id: "edit.cut",
		label: "Cut",
		keys: ["Mod+X"],
		group: "Edit",
		enabled: hasSelection,
		run: ({ controller }) => controller.cut(),
	},
	{
		id: "edit.copy",
		label: "Copy",
		keys: ["Mod+C"],
		group: "Edit",
		enabled: hasSelection,
		run: ({ controller }) => controller.copy(),
	},
	{
		id: "edit.paste",
		label: "Paste",
		keys: ["Mod+V"],
		group: "Edit",
		enabled: hasDoc,
		run: ({ controller }) => controller.paste(),
	},
	{
		id: "edit.duplicate",
		label: "Duplicate",
		keys: ["Mod+D"],
		group: "Edit",
		enabled: hasSelection,
		run: ({ controller }) => controller.duplicateSelection(),
	},
	{
		id: "edit.delete",
		label: "Delete",
		keys: ["Backspace", "Delete"],
		group: "Edit",
		enabled: hasSelection,
		run: ({ controller }) => controller.deleteSelection(),
	},
	{
		id: "edit.selectAll",
		label: "Select all",
		keys: ["Mod+A"],
		group: "Edit",
		enabled: hasDoc,
		run: ({ controller }) => controller.selectAll(),
	},
	{
		id: "edit.selectChildren",
		label: "Select children",
		keys: ["Enter"],
		group: "Edit",
		enabled: hasSelection,
		run: ({ controller }) => controller.selectChildren(),
	},
	{
		id: "edit.escape",
		label: "Deselect / select parent",
		keys: ["Escape"],
		group: "Edit",
		enabled: hasDoc,
		run: ({ controller }) => {
			const s = controller.state;
			if (s.tool !== "move")
				controller.dispatch({ type: "setTool", tool: "move" });
			else if (s.selection.length) controller.selectParent();
		},
	},
	{
		id: "object.group",
		label: "Group into frame",
		keys: ["Mod+G"],
		group: "Object",
		enabled: hasSelection,
		run: ({ controller }) => controller.groupSelection(),
	},
	{
		id: "object.ungroup",
		label: "Ungroup",
		keys: ["Mod+Shift+G"],
		group: "Object",
		enabled: hasSelection,
		run: ({ controller }) => controller.ungroupSelection(),
	},
	{
		id: "object.forward",
		label: "Bring forward",
		keys: ["Mod+]"],
		group: "Object",
		enabled: hasSelection,
		run: ({ controller }) => controller.reorder("forward"),
	},
	{
		id: "object.backward",
		label: "Send backward",
		keys: ["Mod+["],
		group: "Object",
		enabled: hasSelection,
		run: ({ controller }) => controller.reorder("backward"),
	},
	{
		id: "object.front",
		label: "Bring to front",
		keys: ["Mod+Shift+]"],
		group: "Object",
		enabled: hasSelection,
		run: ({ controller }) => controller.reorder("front"),
	},
	{
		id: "object.back",
		label: "Send to back",
		keys: ["Mod+Shift+["],
		group: "Object",
		enabled: hasSelection,
		run: ({ controller }) => controller.reorder("back"),
	},
	{
		id: "object.hide",
		label: "Hide / show",
		keys: ["Mod+Shift+H"],
		group: "Object",
		enabled: hasSelection,
		run: ({ controller }) => controller.toggleHidden(),
	},
	{
		id: "object.lock",
		label: "Lock / unlock",
		keys: ["Mod+Shift+L"],
		group: "Object",
		enabled: hasSelection,
		run: ({ controller }) => controller.toggleLocked(),
	},
	alignCommand("left", "Align left", "Alt+A"),
	alignCommand("hcenter", "Align horizontal centers", "Alt+H"),
	alignCommand("right", "Align right", "Alt+D"),
	alignCommand("top", "Align top", "Alt+W"),
	alignCommand("vcenter", "Align vertical centers", "Alt+V"),
	alignCommand("bottom", "Align bottom", "Alt+S"),
	alignCommand("hdistribute", "Distribute horizontally"),
	alignCommand("vdistribute", "Distribute vertically"),
	tool("move", "Move", "V"),
	tool("hand", "Hand", "H"),
	tool("frame", "Frame", "F"),
	tool("rect", "Rectangle", "R"),
	tool("ellipse", "Ellipse", "O"),
	tool("text", "Text", "T"),
	tool("image", "Image…", "I"),
	tool("qr", "QR code", "Q"),
	tool("barcode", "Barcode", "B"),
	{
		id: "view.zoomIn",
		label: "Zoom in",
		keys: ["=", "+", "Mod+="],
		group: "View",
		enabled: hasDoc,
		run: ({ controller }) => controller.zoomStep(1),
	},
	{
		id: "view.zoomOut",
		label: "Zoom out",
		keys: ["-", "Mod+-"],
		group: "View",
		enabled: hasDoc,
		run: ({ controller }) => controller.zoomStep(-1),
	},
	{
		id: "view.zoom100",
		label: "Zoom to 100%",
		keys: ["Shift+0"],
		group: "View",
		enabled: hasDoc,
		run: ({ controller }) => controller.zoomTo(1),
	},
	{
		id: "view.fit",
		label: "Zoom to fit",
		keys: ["Shift+1"],
		group: "View",
		enabled: hasDoc,
		run: ({ controller }) => controller.fitView(),
	},
	{
		id: "view.zoomSelection",
		label: "Zoom to selection",
		keys: ["Shift+2"],
		group: "View",
		enabled: hasSelection,
		run: ({ controller }) => controller.zoomToSelection(),
	},
	{
		id: "view.panels",
		label: "Toggle panels",
		keys: ["Mod+\\"],
		group: "View",
		global: true,
		run: ({ controller }) => {
			const { left, right } = controller.state.panels;
			const open = !(left || right);
			controller.dispatch({
				type: "setPanels",
				panels: { left: open, right: open },
			});
		},
	},
	{
		id: "view.layers",
		label: "Layers panel",
		group: "View",
		run: ({ controller }) =>
			controller.dispatch({
				type: "setPanels",
				panels: { left: !controller.state.panels.left },
			}),
	},
	{
		id: "view.inspector",
		label: "Inspector panel",
		group: "View",
		run: ({ controller }) =>
			controller.dispatch({
				type: "setPanels",
				panels: { right: !controller.state.panels.right },
			}),
	},
	{
		id: "view.rulers",
		label: "Rulers",
		keys: ["Shift+R"],
		group: "View",
		enabled: hasDoc,
		run: ({ controller }) =>
			controller.dispatch({
				type: "setRulers",
				on: !controller.state.rulers,
			}),
	},
	{
		id: "view.clearGuides",
		label: "Remove guides",
		group: "View",
		enabled: (s) => {
			const t = s.doc?.history.present;
			const name = t?.template_data[s.side]?.name;
			const g = name === undefined ? undefined : s.doc?.history.guides[name];
			return !!g && g.x.length + g.y.length > 0;
		},
		run: ({ controller }) => controller.clearGuides(),
	},
	{
		id: "view.printGuides",
		label: "Print guides",
		group: "View",
		enabled: hasDoc,
		run: ({ controller }) => togglePrintGuides(controller.state),
	},
	{
		id: "view.renderStats",
		label: "Render stats",
		group: "View",
		sections: ["edit", "data", "export"],
		run: () => toggleRenderStats(),
	},
	themeCommand("light", "Light"),
	themeCommand("dark", "Dark"),
	themeCommand("system", "System"),
	{
		id: "help.shortcuts",
		label: "Keyboard shortcuts",
		keys: ["Shift+?", "?"],
		group: "Help",
		run: ({ showShortcuts }) => showShortcuts(),
	},
];

const EVERYWHERE: readonly Section[] = ["edit", "data", "export"];
const EDIT_ONLY: readonly Section[] = ["edit"];

for (const c of COMMANDS)
	c.sections ??=
		/^(file|section|help)\./.test(c.id) ||
		c.id === "edit.undo" ||
		c.id === "edit.redo"
			? EVERYWHERE
			: EDIT_ONLY;

export const COMMAND_BY_ID = new Map(COMMANDS.map((c) => [c.id, c]));

export type KeyLike = Pick<
	KeyboardEvent,
	"key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
>;

/**
 * Whether a key event is the chord `spec` ("Mod+Shift+Z"). `Mod` is Meta on a
 * Mac and Ctrl elsewhere. Letters and digits are matched by physical key, so
 * Alt+A still matches on a Mac, where Alt changes the character typed.
 */
export function matchesChord(e: KeyLike, spec: string, mac: boolean): boolean {
	const parts = spec.split("+");
	const key = spec.endsWith("++") ? "+" : (parts.at(-1) as string);
	const mods = new Set(parts.slice(0, spec.endsWith("++") ? -2 : -1));
	const wantMod = mods.has("Mod");
	const mod = mac ? e.metaKey : e.ctrlKey;
	const other = mac ? e.ctrlKey : e.metaKey;
	if (wantMod !== mod || other) return false;
	if (mods.has("Alt") !== e.altKey) return false;
	const shiftless = key === "?" || key === "+";
	if (!shiftless && mods.has("Shift") !== e.shiftKey) return false;
	if (/^[A-Z]$/i.test(key)) return e.code === `Key${key.toUpperCase()}`;
	if (/^[0-9]$/.test(key)) return e.code === `Digit${key}`;
	if (key === "[" || key === "]")
		return e.code === (key === "[" ? "BracketLeft" : "BracketRight");
	if (key === "\\") return e.code === "Backslash";
	if (key === ",") return e.code === "Comma";
	if (key === "=" || key === "-")
		return e.code === (key === "=" ? "Equal" : "Minus") && !e.shiftKey;
	return e.key === key;
}

export function findCommand(
	e: KeyLike,
	mac: boolean,
	inField: boolean,
	section: Section = "edit",
): Command | undefined {
	return COMMANDS.find(
		(c) =>
			(!inField || c.global) &&
			(c.sections ?? EDIT_ONLY).includes(section) &&
			c.keys?.some((k) => matchesChord(e, k, mac)),
	);
}
