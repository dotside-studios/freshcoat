import { Button } from "@freshcoat-js/ui/button";
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
import { useMemo } from "react";
import { printGuidesOn, usePrintGuidesVersion } from "~/canvas/print-guides";
import { SAMPLES } from "~/samples";
import { useEditor } from "~/state/hooks";
import { isDirty, present } from "~/state/store";
import type { Section } from "~/state/workspace";
import CheckIcon from "~icons/mingcute/check-line";
import LeftPanelIcon from "~icons/mingcute/layout-leftbar-open-line";
import RightPanelIcon from "~icons/mingcute/layout-rightbar-open-line";
import SendIconFill from "~icons/mingcute/send-fill";
import { COMMAND_BY_ID, type CommandContext } from "./commands";
import { useController } from "./context";
import { FreshcoatMark } from "./Logo";
import { useRenderStats } from "./render-stats";
import { hostOf, sendBack, useSendBackTarget } from "./send-back";
import { useThemePreference } from "./theme";

const MENUS: { label: string; items: (string | "-")[] }[] = [
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
			"-",
			"object.front",
			"object.forward",
			"object.backward",
			"object.back",
			"-",
			"align.left",
			"align.hcenter",
			"align.right",
			"align.top",
			"align.vcenter",
			"align.bottom",
			"align.hdistribute",
			"align.vdistribute",
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

const MENU_IDS = MENUS.flatMap((m) => m.items);
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
								onAction: (id) => {
									const command = COMMAND_BY_ID.get(String(id));
									if (command) void command.run(ctx);
								},
								disabledKeys: menu.items.filter((id) => disabled.includes(id)),
							}}
						>
							{menu.items.map((id, i) => {
								if (id === "-")
									// biome-ignore lint/suspicious/noArrayIndexKey: separators are positional
									return <MenuSeparator key={`sep-${i}`} />;
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
