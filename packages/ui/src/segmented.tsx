import { type ReactNode, useRef } from "react";
import {
	type Key,
	ToggleButton as RACToggleButton,
	ToggleButtonGroup as RACToggleButtonGroup,
	type ToggleButtonGroupProps as RACToggleButtonGroupProps,
	type ToggleButtonProps as RACToggleButtonProps,
} from "react-aria-components";
import { Kbd } from "./kbd";
import { composeTw } from "./lib/compose";
import { Tooltip, TooltipTrigger } from "./tooltip";

export interface SegmentedControlProps
	extends Omit<
		RACToggleButtonGroupProps,
		| "selectionMode"
		| "disallowEmptySelection"
		| "selectedKeys"
		| "defaultSelectedKeys"
		| "onSelectionChange"
	> {
	selectedKey?: Key | null;
	defaultSelectedKey?: Key;
	onSelectionChange?: (key: Key) => void;
}

/**
 * A single-choice row of text buttons, e.g. the Edit / Data / Export section
 * switcher. 22px tall so it sits inside a 32px menu bar; larger on touch.
 */
export function SegmentedControl({
	selectedKey,
	defaultSelectedKey,
	onSelectionChange,
	className,
	...props
}: SegmentedControlProps) {
	const last = useRef<Key | null | undefined>(defaultSelectedKey);
	if (selectedKey !== undefined) last.current = selectedKey;
	return (
		<RACToggleButtonGroup
			{...props}
			selectionMode="single"
			disallowEmptySelection
			selectedKeys={
				selectedKey === undefined
					? undefined
					: selectedKey === null
						? []
						: [selectedKey]
			}
			defaultSelectedKeys={
				defaultSelectedKey === undefined ? undefined : [defaultSelectedKey]
			}
			onSelectionChange={(keys) => {
				const [key] = keys;
				if (key === undefined || key === last.current) return;
				last.current = key;
				onSelectionChange?.(key);
			}}
			className={composeTw(
				className,
				"inline-flex h-[22px] shrink-0 items-stretch gap-px rounded-[4px] border border-fc-border bg-fc-panel p-px data-disabled:opacity-50 pointer-coarse:h-8",
			)}
		/>
	);
}

export interface SegmentedItemProps extends RACToggleButtonProps {
	id: Key;
	/** Tooltip text. Defaults to the item's label when a `shortcut` is given. */
	tooltip?: ReactNode;
	/** e.g. "Mod+1", shown in the tooltip. */
	shortcut?: string;
	children?: ReactNode;
}

export function SegmentedItem({
	tooltip,
	shortcut,
	className,
	children,
	...props
}: SegmentedItemProps) {
	const button = (
		<RACToggleButton
			{...props}
			className={composeTw(
				className,
				"inline-flex min-w-14 cursor-default select-none items-center justify-center rounded-[3px] px-3 font-medium text-fc-base text-fc-muted outline-none pointer-coarse:min-w-18 pointer-coarse:px-4",
				"data-hovered:text-fc-text data-pressed:bg-fc-hover data-selected:bg-fc-active data-selected:text-fc-text data-selected:shadow-(--shadow-fc-control)",
				"data-disabled:opacity-40 data-focus-visible:outline-1 data-focus-visible:outline-solid data-focus-visible:outline-fc-accent data-focus-visible:-outline-offset-1",
			)}
		>
			{children}
		</RACToggleButton>
	);
	const tip = tooltip ?? (shortcut ? children : null);
	if (tip == null) return button;
	return (
		<TooltipTrigger>
			{button}
			<Tooltip className="flex items-center gap-1.5">
				{tip}
				{shortcut && <Kbd shortcut={shortcut} />}
			</Tooltip>
		</TooltipTrigger>
	);
}
