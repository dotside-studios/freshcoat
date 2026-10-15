import type { ReactNode } from "react";
import { Toolbar } from "react-aria-components";
import { IconButton } from "./icon-button";
import { CloseIcon } from "./icons";
import { cn } from "./lib/cn";

export interface SelectionBarProps {
	/** The count text, such as "3 records". Nothing renders when empty. */
	label: string | null;
	onClear: () => void;
	children?: ReactNode;
	className?: string;
}

/** Actions for the current selection, shown only while something is
 *  selected. */
export function SelectionBar({
	label,
	onClear,
	children,
	className,
}: SelectionBarProps) {
	if (!label) return null;
	return (
		<Toolbar
			aria-label="Selection"
			data-testid="selection-bar"
			className={cn(
				"flex h-9 shrink-0 items-center gap-1 rounded-md border border-fc-border-strong bg-fc-popover px-2 text-fc-base shadow-(--shadow-fc-popover)",
				className,
			)}
		>
			<span className="mr-1 shrink-0 text-fc-muted tabular-nums">{label}</span>
			{children}
			<IconButton
				aria-label="Clear selection"
				tooltip="Clear selection"
				onPress={onClear}
			>
				<CloseIcon />
			</IconButton>
		</Toolbar>
	);
}
