import { useContext } from "react";
import {
	PopoverContext,
	Popover as RACPopover,
	type PopoverProps as RACPopoverProps,
} from "react-aria-components";
import { composeTw } from "./lib/compose";
import { popoverSurface } from "./lib/styles";

export { DialogTrigger } from "react-aria-components";

export interface PopoverProps extends RACPopoverProps {}

export function Popover({ className, offset, ...props }: PopoverProps) {
	// A submenu's popover gets its offsets from SubmenuTrigger; do not override them.
	const context = useContext(PopoverContext) as { trigger?: string } | null;
	const isSubmenu = context?.trigger === "SubmenuTrigger";
	return (
		<RACPopover
			{...props}
			offset={offset ?? (isSubmenu ? undefined : 4)}
			className={composeTw(
				className,
				popoverSurface,
				"max-h-[min(var(--visual-viewport-height,100vh),480px)] overflow-auto",
			)}
		/>
	);
}
