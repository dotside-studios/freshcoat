import { Button } from "@freshcoat-js/ui/button";
import { IconButton } from "@freshcoat-js/ui/icon-button";
import { formatShortcut } from "@freshcoat-js/ui/kbd";
import {
	Menu,
	MenuBar,
	MenuBarMenu,
	MenuItem,
	MenuSeparator,
	SubmenuTrigger,
} from "@freshcoat-js/ui/menu";
import { Popover } from "@freshcoat-js/ui/popover";
import { SegmentedControl, SegmentedItem } from "@freshcoat-js/ui/segmented";
import { ToggleButton } from "@freshcoat-js/ui/toggle";
import { type ReactNode, useMemo } from "react";
import { printGuidesOn, usePrintGuidesVersion } from "~/canvas/print-guides";
import { SAMPLES } from "~/samples";
import { useEditor } from "~/state/hooks";
import { isDirty, present } from "~/state/store";
import type { Section } from "~/state/workspace";
import UndoIcon from "~icons/mingcute/back-2-line";
import CheckIcon from "~icons/mingcute/check-line";
import RedoIcon from "~icons/mingcute/forward-2-line";
import LeftPanelIcon from "~icons/mingcute/layout-leftbar-open-line";
import RightPanelIcon from "~icons/mingcute/layout-rightbar-open-line";
import SendIconFill from "~icons/mingcute/send-fill";
import { COMMAND_BY_ID, type CommandContext } from "./commands";
import { useController } from "./context";
import { FreshcoatMark } from "./Logo";
import { useRenderStats } from "./render-stats";
import { hostOf, sendBack, useSendBackTarget } from "./send-back";
import { useThemePreference } from "./theme";

type Submenu = { label: string; items: (string | "-")[] };
type Entry = string | "-" | Submenu;

const MENUS: { label: string; items: Entry[] }[] = [
	{
		label: "File",
		items: [
			"file.new",
			"file.open",
			"samples",
			"-",
			"file.save",
			"file.templateSetup",
			"-",
			"file.importTemplate",
			"file.exportCoat",
			"file.exportJson",
			"file.exportTemplates",
			"-",
			"file.export1x",
			"file.export2x",
			"file.export3x",
			"-",
			"file.close",
		],
	},
	{
		label: "Edit",
		items: [
			"edit.undo",
			"edit.redo",
			"-",
			"edit.cut",
			"edit.copy",
			"edit.paste",
			"edit.duplicate",
			"edit.delete",
			"-",
			"edit.selectAll",
			"edit.selectChildren",
		],
	},
	{
		label: "Object",
		items: [
			"object.group",
			"object.ungroup",
			"object.textOnPath",
			"-",
			{
				label: "Boolean",
				items: [
					"object.union",
					"object.subtract",
					"object.intersect",
					"object.exclude",
				],
			},
			{
				label: "Arrange",
				items: [
					"object.front",
					"object.forward",
					"object.backward",
					"object.back",
				],
			},
			{
				label: "Align and distribute",
				items: [
					"align.left",
					"align.hcenter",
					"align.right",
					"-",
					"align.top",
					"align.vcenter",
					"align.bottom",
					"-",
					"align.hdistribute",
					"align.vdistribute",
				],
			},
			"-",
			"object.hide",
			"object.lock",
		],
	},
	{
		label: "View",
		items: [
			"view.zoomIn",
			"view.zoomOut",
			"view.zoom100",
			"view.fit",
			"view.zoomSelection",
			"-",
			"view.layers",
			"view.inspector",
			"view.panels",
			"-",
			"view.rulers",
			"view.clearGuides",
			"view.printGuides",
			"view.renderStats",
			"theme",
		],
	},
	{ label: "Help", items: ["help.shortcuts"] },
];

const idsOf = (items: Entry[]): string[] =>
	items.flatMap((e) =>
		typeof e === "string" ? (e === "-" ? [] : [e]) : idsOf(e.items),
	);
const MENU_IDS = MENUS.flatMap((m) => idsOf(m.items));
const THEME_IDS = ["view.theme.light", "view.theme.dark", "view.theme.system"];

export function AppMenuBar({ ctx }: { ctx: CommandContext }) {
	const name = useEditor((s) => s.workspace?.name);
	const fileName = useEditor((s) => s.workspace?.fileName);
	const dirty = useEditor(isDirty);
	// A string, so the bar re-renders only when an item's enabled state flips,
	// not on every render or pointer move.
	const disabledSig = useEditor((s) =>
		MENU_IDS.filter((id) => {
			const c = COMMAND_BY_ID.get(id);
			return c?.enabled ? !c.enabled(s) : false;
		}).join(","),
	);
	const disabled = useMemo(() => disabledSig.split(","), [disabledSig]);
	const panels = useEditor((s) => s.panels);
	const theme = useThemePreference();
	const renderStats = useRenderStats();
	const rulers = useEditor((s) => s.rulers);
	usePrintGuidesVersion();
	const guides = useEditor((s) =>
		printGuidesOn(s.workspace?.activeTemplateId, present(s)),
	);
	const sendTarget = useSendBackTarget(
		useEditor((s) => s.workspace?.activeTemplateId),
	);
	const runCommand = (id: string) => {
		const command = COMMAND_BY_ID.get(id);
		if (command) void command.run(ctx);
	};
	const commandItem = (id: string) => {
		const c = COMMAND_BY_ID.get(id);
		if (!c) return null;
		return (
			<MenuItem
				key={id}
				id={id}
				shortcut={c.keys?.[0]}
				destructive={id === "edit.delete"}
				icon={
					(id === "view.rulers" && rulers) ||
					(id === "view.printGuides" && guides) ||
					(id === "view.renderStats" && renderStats) ? (
						<CheckIcon />
					) : undefined
				}
			>
				{c.label}
			</MenuItem>
		);
	};
	const togglePanel = (side: "left" | "right") =>
		ctx.controller.dispatch({
			type: "setPanels",
			panels: { [side]: !panels[side] },
		});

	return (
		<header className="flex h-8 shrink-0 items-stretch border-fc-border border-b bg-fc-app pointer-coarse:h-10">
			<div className="flex shrink-0 items-center px-3">
				<FreshcoatMark height={18} />
			</div>
			<div className="flex min-w-fit flex-1 items-stretch">
				<MenuBar>
					{MENUS.map((menu) => (
						<MenuBarMenu
							key={menu.label}
							label={menu.label}
							menuProps={{
								onAction: (id) => runCommand(String(id)),
								disabledKeys: idsOf(menu.items).filter((id) =>
									disabled.includes(id),
								),
							}}
						>
							{menu.items.map((id, i) => {
								if (id === "-")
									// biome-ignore lint/suspicious/noArrayIndexKey: separators are positional
									return <MenuSeparator key={`sep-${i}`} />;
								if (typeof id !== "string")
									return (
										<SubmenuTrigger key={id.label}>
											<MenuItem id={id.label}>{id.label}</MenuItem>
											<Popover>
												<Menu
													aria-label={id.label}
													onAction={(item) => runCommand(String(item))}
													disabledKeys={idsOf(id.items).filter((item) =>
														disabled.includes(item),
													)}
												>
													{id.items.map((item, j) =>
														item === "-" ? (
															// biome-ignore lint/suspicious/noArrayIndexKey: separators are positional
															<MenuSeparator key={`sep-${j}`} />
														) : (
															commandItem(item)
														),
													)}
												</Menu>
											</Popover>
										</SubmenuTrigger>
									);
								if (id === "samples")
									return (
										<SubmenuTrigger key="samples">
											<MenuItem id="samples">Open sample</MenuItem>
											<Popover>
												<Menu
													onAction={(sampleId) =>
														ctx.confirmDiscard(
															() =>
																void ctx.controller.openSample(
																	String(sampleId),
																),
														)
													}
												>
													{SAMPLES.map((s) => (
														<MenuItem key={s.id} id={s.id}>
															{s.name}
														</MenuItem>
													))}
												</Menu>
											</Popover>
										</SubmenuTrigger>
									);
								if (id === "theme")
									return (
										<SubmenuTrigger key="theme">
											<MenuItem id="theme">Theme</MenuItem>
											<Popover>
												<Menu
													aria-label="Theme"
													selectionMode="single"
													selectedKeys={[`view.theme.${theme}`]}
													disallowEmptySelection
													onSelectionChange={(keys) => {
														if (keys === "all") return;
														const [themeId] = keys;
														void COMMAND_BY_ID.get(String(themeId))?.run(ctx);
													}}
												>
													{THEME_IDS.map((themeId) => (
														<MenuItem key={themeId} id={themeId}>
															{COMMAND_BY_ID.get(themeId)?.label}
														</MenuItem>
													))}
												</Menu>
											</Popover>
										</SubmenuTrigger>
									);
								return commandItem(id);
							})}
						</MenuBarMenu>
					))}
				</MenuBar>
			</div>
			{name ? <SectionSwitcher /> : null}
			<div className="flex min-w-0 flex-1 items-center justify-end gap-2 pr-1.5 pl-3 text-fc-muted">
				{name ? (
					<>
						<span className="hidden truncate text-fc-text lg:inline">
							{name}
						</span>
						<span className="hidden truncate xl:inline">{fileName}</span>
						{dirty ? (
							<span
								className="size-2 shrink-0 rounded-full bg-fc-warning"
								title="Unsaved changes"
							/>
						) : null}
						{sendTarget ? (
							<Button
								size="sm"
								variant="primary"
								onPress={() => void sendBack(ctx.controller)}
							>
								<SendIconFill />
								Send to {hostOf(sendTarget.origin)}
							</Button>
						) : null}
						<span className="ml-1 flex items-center gap-0.5">
							<HistoryButton id="edit.undo" ctx={ctx}>
								<UndoIcon />
							</HistoryButton>
							<HistoryButton id="edit.redo" ctx={ctx}>
								<RedoIcon />
							</HistoryButton>
						</span>
						<span className="flex items-center gap-0.5">
							<ToggleButton
								aria-label="Layers panel"
								tooltip="Layers panel"
								isSelected={panels.left}
								onChange={() => togglePanel("left")}
							>
								<LeftPanelIcon />
							</ToggleButton>
							<ToggleButton
								aria-label="Inspector panel"
								tooltip="Inspector panel"
								isSelected={panels.right}
								onChange={() => togglePanel("right")}
							>
								<RightPanelIcon />
							</ToggleButton>
						</span>
					</>
				) : null}
			</div>
		</header>
	);
}

function HistoryButton({
	id,
	ctx,
	children,
}: {
	id: "edit.undo" | "edit.redo";
	ctx: CommandContext;
	children: ReactNode;
}) {
	const command = COMMAND_BY_ID.get(id);
	const enabled = useEditor((s) => command?.enabled?.(s) ?? false);
	if (!command) return null;
	const key = command.keys?.[0];
	return (
		<IconButton
			aria-label={command.label}
			tooltip={`${command.label}${key ? `  ${formatShortcut(key)}` : ""}`}
			isDisabled={!enabled}
			onPress={() => void command.run(ctx)}
			className="pointer-coarse:size-7"
		>
			{children}
		</IconButton>
	);
}

const SECTIONS: { id: Section; label: string }[] = [
	{ id: "edit", label: "Edit" },
	{ id: "data", label: "Data" },
	{ id: "export", label: "Export" },
];

function SectionSwitcher() {
	const controller = useController();
	const section = useEditor((s) => s.section);
	return (
		<div className="flex items-center px-2">
			<SegmentedControl
				aria-label="Section"
				data-testid="section-switcher"
				selectedKey={section}
				onSelectionChange={(key) =>
					controller.dispatch({ type: "setSection", section: key as Section })
				}
			>
				{SECTIONS.map((s, i) => (
					<SegmentedItem
						key={s.id}
						id={s.id}
						shortcut={`Mod+${i + 1}`}
						className="w-16"
					>
						{s.label}
					</SegmentedItem>
				))}
			</SegmentedControl>
		</div>
	);
}
