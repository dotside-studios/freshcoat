import {
	Toolbar as RACToolbar,
	type ToolbarProps as RACToolbarProps,
	Separator,
	type SeparatorProps,
} from "react-aria-components";
import { cn } from "./lib/cn";
import { composeTw } from "./lib/compose";

export function Toolbar({ className, ...props }: RACToolbarProps) {
	return (
		<RACToolbar
			{...props}
			className={composeTw(
				className,
				"flex items-center gap-0.5 data-[orientation=vertical]:flex-col",
			)}
		/>
	);
}

/** Takes the orientation opposite to its Toolbar. */
export function ToolbarSeparator({ className, ...props }: SeparatorProps) {
	return (
		<Separator
			{...props}
			className={cn(
				"shrink-0 border-none bg-fc-border",
				"aria-[orientation=vertical]:mx-1 aria-[orientation=vertical]:h-4 aria-[orientation=vertical]:w-px",
				"not-aria-[orientation=vertical]:my-1 not-aria-[orientation=vertical]:h-px not-aria-[orientation=vertical]:w-5",
				className,
			)}
		/>
	);
}
