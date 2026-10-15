import type { ReactElement, ReactNode } from "react";
import {
	Dialog,
	DialogTrigger,
	Heading,
	type PopoverProps,
} from "react-aria-components";
import { IconButton } from "./icon-button";
import { CloseIcon } from "./icons";
import { cn } from "./lib/cn";
import { Popover } from "./popover";

export interface PopoverPanelProps {
	/** The pressable element that opens the panel. */
	trigger: ReactElement;
	title: ReactNode;
	/** Header controls shown before the close button. */
	actions?: ReactNode;
	children: ReactNode | ((close: () => void) => ReactNode);
	placement?: PopoverProps["placement"];
	isOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
	className?: string;
	bodyClassName?: string;
}

/** A titled settings panel anchored to its trigger, for the details of an
 *  inspector row. */
export function PopoverPanel({
	trigger,
	title,
	actions,
	children,
	placement = "left top",
	isOpen,
	onOpenChange,
	className,
	bodyClassName,
}: PopoverPanelProps) {
	return (
		<DialogTrigger isOpen={isOpen} onOpenChange={onOpenChange}>
			{trigger}
			<Popover
				placement={placement}
				offset={8}
				className={cn("w-64", className)}
			>
				<Dialog
					aria-label={typeof title === "string" ? title : undefined}
					className="flex max-h-[inherit] flex-col outline-none"
				>
					{({ close }) => (
						<>
							<div className="flex h-8 shrink-0 items-center gap-1 border-fc-border border-b pr-1 pl-3">
								<Heading
									slot="title"
									className="m-0 min-w-0 flex-1 truncate font-semibold text-fc-base"
								>
									{title}
								</Heading>
								{actions}
								<IconButton aria-label="Close" onPress={close}>
									<CloseIcon />
								</IconButton>
							</div>
							<div
								className={cn(
									"flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto p-2",
									bodyClassName,
								)}
							>
								{typeof children === "function" ? children(close) : children}
							</div>
						</>
					)}
				</Dialog>
			</Popover>
		</DialogTrigger>
	);
}
