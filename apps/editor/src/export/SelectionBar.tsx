import { IconButton } from "@freshcoat-js/ui/icon-button";
import { cn } from "@freshcoat-js/ui/lib/cn";
import type { ReactNode } from "react";
import CloseIcon from "~icons/mingcute/close-line";

/** What is selected, a way to clear it, and the actions that apply to it.
 *  Nothing shows without a label. */
export function SelectionBar({
	label,
	onClear,
	children,
	className,
}: {
	label: string | null;
	onClear: () => void;
	children?: ReactNode;
	className?: string;
}) {
	if (label === null) return null;
	return (
		<div
			role="toolbar"
			aria-label="Selection"
			className={cn(
				"flex shrink-0 items-center gap-1 text-fc-muted text-fc-sm",
				className,
			)}
			data-testid="export-selection"
		>
			<span className="tabular-nums">{label}</span>
			<IconButton
				aria-label="Clear selection"
				tooltip="Clear selection"
				onPress={onClear}
			>
				<CloseIcon />
			</IconButton>
			{children}
		</div>
	);
}
