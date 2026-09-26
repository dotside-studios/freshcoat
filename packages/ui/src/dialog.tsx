import type { ReactNode } from "react";
import {
	Heading,
	ModalOverlay,
	type ModalOverlayProps,
	Dialog as RACDialog,
	type DialogProps as RACDialogProps,
	Modal as RACModal,
} from "react-aria-components";
import { cn } from "./lib/cn";
import { composeTw } from "./lib/compose";

export interface ModalProps extends ModalOverlayProps {
	/** Tailwind max-width class for the panel. */
	width?: string;
}

export function Modal({
	className,
	width = "max-w-md",
	isDismissable = true,
	children,
	...props
}: ModalProps) {
	return (
		<ModalOverlay
			{...props}
			isDismissable={isDismissable}
			className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-fc-scrim p-4"
		>
			<RACModal
				className={composeTw(
					className,
					"w-full overflow-hidden rounded-md border border-fc-border-strong bg-fc-panel text-fc-text shadow-(--shadow-fc-dialog) outline-none",
					width,
				)}
			>
				{children}
			</RACModal>
		</ModalOverlay>
	);
}

type WithClose = ReactNode | ((opts: { close: () => void }) => ReactNode);

export interface DialogProps extends Omit<RACDialogProps, "children"> {
	title?: ReactNode;
	children?: WithClose;
	footer?: WithClose;
	bodyClassName?: string;
}

function render(node: WithClose, close: () => void) {
	return typeof node === "function" ? node({ close }) : node;
}

/** Title bar, body and footer slots. Works inside `Modal` and `Popover`. */
export function Dialog({
	title,
	children,
	footer,
	className,
	bodyClassName,
	...props
}: DialogProps) {
	return (
		<RACDialog
			{...props}
			className={cn("flex max-h-[inherit] flex-col outline-none", className)}
		>
			{({ close }) => (
				<>
					{title != null && (
						<Heading
							slot="title"
							className="flex h-8 shrink-0 items-center border-fc-border border-b bg-fc-raised px-3 font-semibold text-fc-base"
						>
							{title}
						</Heading>
					)}
					<div
						className={cn("min-h-0 flex-1 overflow-auto p-3", bodyClassName)}
					>
						{render(children, close)}
					</div>
					{footer != null && (
						<div className="flex shrink-0 items-center justify-end gap-2 border-fc-border border-t px-3 py-2">
							{render(footer, close)}
						</div>
					)}
				</>
			)}
		</RACDialog>
	);
}
