import { IconButton } from "@freshcoat-js/ui/icon-button";
import { cn } from "@freshcoat-js/ui/lib/cn";
import { Menu, MenuItem, MenuSeparator } from "@freshcoat-js/ui/menu";
import { Popover } from "@freshcoat-js/ui/popover";
import { Tooltip, TooltipTrigger } from "@freshcoat-js/ui/tooltip";
import type { ExportPreset } from "@freshcoat-js/workspace";
import { useState } from "react";
import { Button, Input, MenuTrigger } from "react-aria-components";
import { useController } from "~/app/context";
import { EMPTY } from "~/app/copy";
import { useEditor } from "~/state/hooks";
import AddIcon from "~icons/mingcute/add-line";
import CloseIcon from "~icons/mingcute/close-line";
import CopyIcon from "~icons/mingcute/copy-2-line";
import DeleteIcon from "~icons/mingcute/delete-2-line";
import EditIcon from "~icons/mingcute/edit-2-line";
import CollapseIcon from "~icons/mingcute/layout-left-line";
import MoreIcon from "~icons/mingcute/more-2-line";
import { FORMAT_LABEL } from "./export-ui";
import { duplicatePreset, newPreset } from "./preset";

const RECORDS_LABEL = {
	all: "all records",
	pending: "pending",
	failed: "failed",
	selected: "selected",
} as const;

export function presetSummary(preset: ExportPreset): string {
	return `${FORMAT_LABEL[preset.format]} · ${RECORDS_LABEL[preset.records]}`;
}

/** Up to two letters that tell presets apart on the rail. */
export function presetInitials(name: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return "?";
	const letters =
		words.length === 1
			? (words[0] as string).slice(0, 2)
			: `${(words[0] as string)[0]}${(words[1] as string)[0]}`;
	return letters.toUpperCase();
}

export function PresetList({
	activeId,
	onPicked,
	onClose,
	collapsed = false,
	onCollapsedChange,
}: {
	activeId: string | null;
	onPicked?: () => void;
	/** shows a close button, for the list as an overlay */
	onClose?: () => void;
	/** shows the list as a rail of initials */
	collapsed?: boolean;
	/** shows a button that folds the list to a rail and back */
	onCollapsedChange?: (collapsed: boolean) => void;
}) {
	const controller = useController();
	const presets = useEditor((s) => s.workspace?.presets);
	const activeTemplateId = useEditor((s) => s.workspace?.activeTemplateId);
	const templates = useEditor((s) => s.workspace?.templates);
	const [renaming, setRenaming] = useState<string | null>(null);

	const add = () => {
		if (!activeTemplateId || !presets) return;
		controller.dispatch({
			type: "setPreset",
			preset: newPreset(activeTemplateId, presets),
		});
	};
	const rename = (preset: ExportPreset, name: string) => {
		setRenaming(null);
		const trimmed = name.trim();
		if (trimmed && trimmed !== preset.name)
			controller.dispatch({
				type: "setPreset",
				preset: { ...preset, name: trimmed },
			});
	};

	if (collapsed)
		return (
			<div
				className="flex min-h-0 flex-1 flex-col items-center gap-1 py-1"
				data-testid="export-presets"
				data-collapsed
			>
				<IconButton
					aria-label="Show presets"
					tooltip="Show presets"
					onPress={() => onCollapsedChange?.(false)}
				>
					<CollapseIcon />
				</IconButton>
				<IconButton aria-label="New preset" tooltip="New preset" onPress={add}>
					<AddIcon />
				</IconButton>
				<div className="my-0.5 h-px w-5 shrink-0 bg-fc-border" />
				<ul className="m-0 flex min-h-0 flex-1 list-none flex-col items-center gap-1 overflow-auto p-0">
					{(presets ?? []).map((preset) => {
						const active = preset.id === activeId;
						return (
							<li key={preset.id} data-testid="export-preset">
								<TooltipTrigger>
									<Button
										aria-label={preset.name}
										aria-current={active || undefined}
										className={cn(
											"flex size-7 cursor-default items-center justify-center rounded-[4px] font-semibold text-[10px] tracking-[0.02em] outline-none data-focus-visible:outline-1 data-focus-visible:outline-fc-accent data-focus-visible:outline-solid pointer-coarse:size-9",
											active
												? "bg-fc-accent text-white"
												: "bg-fc-raised text-fc-muted data-hovered:bg-fc-hover data-hovered:text-fc-text",
										)}
										onPress={() => {
											controller.dispatch({
												type: "setActivePreset",
												id: preset.id,
											});
											onPicked?.();
										}}
									>
										{presetInitials(preset.name)}
									</Button>
									<Tooltip placement="right">
										<span className="block text-fc-text">{preset.name}</span>
										<span className="block text-fc-muted">
											{presetSummary(preset)}
										</span>
									</Tooltip>
								</TooltipTrigger>
							</li>
						);
					})}
				</ul>
			</div>
		);

	return (
		<div className="flex min-h-0 flex-1 flex-col" data-testid="export-presets">
			<div className="flex h-8 shrink-0 items-center gap-1 border-fc-border border-b pr-1 pl-2 pointer-coarse:h-10">
				<h2 className="m-0 flex-1 font-semibold text-[10px] text-fc-muted uppercase tracking-[0.06em]">
					Presets
				</h2>
				<IconButton aria-label="New preset" tooltip="New preset" onPress={add}>
					<AddIcon />
				</IconButton>
				{onCollapsedChange ? (
					<IconButton
						aria-label="Hide presets"
						tooltip="Hide presets"
						onPress={() => onCollapsedChange(true)}
					>
						<CollapseIcon />
					</IconButton>
				) : null}
				{onClose ? (
					<IconButton aria-label="Close" onPress={onClose}>
						<CloseIcon />
					</IconButton>
				) : null}
			</div>
			<ul className="m-0 min-h-0 flex-1 list-none overflow-auto p-1">
				{(presets ?? []).map((preset) => {
					const active = preset.id === activeId;
					const template = templates?.find((t) => t.id === preset.templateId);
					return (
						<li
							key={preset.id}
							className={cn(
								"group/preset flex min-h-9 items-center gap-1 rounded-[3px] pr-0.5 pointer-coarse:min-h-11",
								active ? "bg-fc-accent-soft" : "hover:bg-fc-raised",
							)}
							data-testid="export-preset"
							data-active={active || undefined}
						>
							{renaming === preset.id ? (
								<Input
									aria-label="Preset name"
									autoFocus
									defaultValue={preset.name}
									className="mx-1 h-fc-control min-w-0 flex-1 rounded-[3px] border border-fc-accent bg-fc-raised px-1.5 text-fc-base text-fc-text outline-none"
									onFocus={(e) => e.currentTarget.select()}
									onBlur={(e) => rename(preset, e.currentTarget.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter")
											rename(preset, e.currentTarget.value);
										else if (e.key === "Escape") {
											e.stopPropagation();
											setRenaming(null);
										}
									}}
								/>
							) : (
								<button
									type="button"
									className="flex min-w-0 flex-1 cursor-default flex-col items-start gap-0 rounded-[3px] px-2 py-1 text-left outline-none focus-visible:outline-1 focus-visible:outline-fc-accent focus-visible:outline-solid"
									aria-current={active || undefined}
									onClick={() => {
										controller.dispatch({
											type: "setActivePreset",
											id: preset.id,
										});
										onPicked?.();
									}}
									onDoubleClick={() => setRenaming(preset.id)}
									onKeyDown={(e) => {
										if (e.key === "F2") setRenaming(preset.id);
									}}
								>
									<span className="max-w-full truncate text-fc-base text-fc-text">
										{preset.name}
									</span>
									<span className="max-w-full truncate text-fc-faint text-fc-sm">
										{presetSummary(preset)}
										{template ? ` · ${template.fileName}` : ""}
									</span>
								</button>
							)}
							<MenuTrigger>
								<IconButton
									aria-label={`Actions for ${preset.name}`}
									className="opacity-60 group-hover/preset:opacity-100 data-pressed:opacity-100"
								>
									<MoreIcon />
								</IconButton>
								<Popover placement="bottom end">
									<Menu
										onAction={(id) => {
											if (id === "rename") setRenaming(preset.id);
											else if (id === "duplicate" && presets)
												controller.dispatch({
													type: "setPreset",
													preset: duplicatePreset(preset, presets),
												});
											else if (id === "delete")
												controller.dispatch({
													type: "removePreset",
													id: preset.id,
												});
										}}
									>
										<MenuItem id="rename" icon={<EditIcon />}>
											Rename
										</MenuItem>
										<MenuItem id="duplicate" icon={<CopyIcon />}>
											Duplicate
										</MenuItem>
										<MenuSeparator />
										<MenuItem id="delete" icon={<DeleteIcon />} destructive>
											Delete
										</MenuItem>
									</Menu>
								</Popover>
							</MenuTrigger>
						</li>
					);
				})}
				{presets?.length === 0 ? (
					<li className="px-2 py-3 text-fc-faint text-fc-sm">
						{EMPTY.presets}
					</li>
				) : null}
			</ul>
		</div>
	);
}
