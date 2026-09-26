import type { ReactNode } from "react";
import {
	ToggleButton as RACToggleButton,
	ToggleButtonGroup as RACToggleButtonGroup,
	type ToggleButtonGroupProps as RACToggleButtonGroupProps,
	type ToggleButtonProps as RACToggleButtonProps,
} from "react-aria-components";
import { iconButtonBase } from "./icon-button";
import { composeTw } from "./lib/compose";
import { Tooltip, TooltipTrigger } from "./tooltip";

export interface ToggleButtonProps extends RACToggleButtonProps {
	tooltip?: string;
	/** `icon` is a square ghost button (tools, eye/lock); `text` fits its label. */
	shape?: "icon" | "text";
}

/** A standalone on/off button. */
export function ToggleButton({
	tooltip,
	shape = "icon",
	className,
	...props
}: ToggleButtonProps) {
	const button = (
		<RACToggleButton
			{...props}
			className={composeTw(
				className,
				iconButtonBase,
				shape === "text" && "w-auto px-2 text-fc-base",
				"data-hovered:bg-fc-hover data-pressed:bg-fc-active data-selected:bg-fc-active data-selected:text-fc-text",
			)}
		/>
	);
	if (!tooltip) return button;
	return (
		<TooltipTrigger>
			{button}
			<Tooltip>{tooltip}</Tooltip>
		</TooltipTrigger>
	);
}

export interface ToggleGroupProps extends RACToggleButtonGroupProps {}

/** Segmented control. Defaults to single selection that cannot be emptied. */
export function ToggleGroup({
	className,
	selectionMode = "single",
	disallowEmptySelection = selectionMode === "single",
	...props
}: ToggleGroupProps) {
	return (
		<RACToggleButtonGroup
			{...props}
			selectionMode={selectionMode}
			disallowEmptySelection={disallowEmptySelection}
			className={composeTw(
				className,
				"inline-flex h-fc-control shrink-0 items-stretch gap-px rounded-[3px] bg-fc-raised p-px data-disabled:opacity-50",
				"data-[orientation=vertical]:h-auto data-[orientation=vertical]:flex-col",
			)}
		/>
	);
}

export interface ToggleGroupItemProps extends RACToggleButtonProps {
	tooltip?: string;
	children?: ReactNode;
}

export function ToggleGroupItem({
	tooltip,
	className,
	...props
}: ToggleGroupItemProps) {
	const button = (
		<RACToggleButton
			{...props}
			className={composeTw(
				className,
				"inline-flex min-w-6 flex-1 cursor-default select-none items-center justify-center gap-1 rounded-[2px] px-1.5 text-fc-sm text-fc-muted outline-none pointer-coarse:min-w-8",
				"data-hovered:text-fc-text data-pressed:bg-fc-hover data-selected:bg-fc-active data-selected:text-fc-text data-selected:shadow-(--shadow-fc-control)",
				"data-disabled:opacity-40 data-focus-visible:outline-solid data-focus-visible:outline-1 data-focus-visible:outline-fc-accent data-focus-visible:-outline-offset-1 [&_svg]:size-4",
			)}
		/>
	);
	if (!tooltip) return button;
	return (
		<TooltipTrigger>
			{button}
			<Tooltip>{tooltip}</Tooltip>
		</TooltipTrigger>
	);
}
