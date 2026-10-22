import {
	Button,
	UNSTABLE_Toast as RACToast,
	UNSTABLE_ToastContent as RACToastContent,
	UNSTABLE_ToastQueue as RACToastQueue,
	UNSTABLE_ToastRegion as RACToastRegion,
	Text,
} from "react-aria-components";
import { CloseIcon } from "./icons";
import { cn } from "./lib/cn";

export type ToastTone = "info" | "success" | "warning" | "danger";

interface ToastAction {
	label: string;
	onAction: () => void;
}

interface ToastContent {
	message: string;
	tone: ToastTone;
	actions: ToastAction[];
}

const TIMEOUT_MS = 4000;

const queue = new RACToastQueue<ToastContent>({ maxVisibleToasts: 4 });

export interface ToastOptions {
	tone?: ToastTone;
	/** Milliseconds; 0 keeps it until dismissed. Defaults to 4000. */
	timeout?: number;
	/** One button beside the message; pressing it also closes the toast. */
	action?: ToastAction;
	/** Buttons below the message, for a toast with more than one choice. */
	actions?: ToastAction[];
}

/** Shows a toast in the `ToastRegion`. Returns a function that closes it. */
export function toast(message: string, options: ToastOptions = {}) {
	const timeout = options.timeout ?? TIMEOUT_MS;
	const key = queue.add(
		{
			message,
			tone: options.tone ?? "info",
			actions: options.actions ?? (options.action ? [options.action] : []),
		},
		timeout > 0 ? { timeout } : undefined,
	);
	return () => queue.close(key);
}

const toneDot: Record<ToastTone, string> = {
	info: "bg-fc-accent",
	success: "bg-fc-success",
	warning: "bg-fc-warning",
	danger: "bg-fc-danger",
};

export interface ToastRegionProps {
	className?: string;
}

/** Mount once at the app root. */
export function ToastRegion({ className }: ToastRegionProps) {
	return (
		<RACToastRegion
			queue={queue}
			className={cn(
				"fixed right-3 bottom-8 z-[60] flex flex-col-reverse items-end gap-2 outline-none",
				className,
			)}
		>
			{({ toast: item }) => (
				<RACToast
					toast={item}
					className="flex min-h-9 w-80 max-w-[calc(100vw-24px)] items-start gap-2.5 rounded-md border border-fc-border-strong bg-fc-popover py-2 pr-1.5 pl-3 text-fc-base text-fc-text shadow-(--shadow-fc-popover) outline-none data-focus-visible:outline-fc-accent"
				>
					<span
						className={cn(
							"mt-[5px] size-2 shrink-0 rounded-full",
							toneDot[item.content.tone],
						)}
						aria-hidden="true"
					/>
					<div className="flex min-w-0 flex-1 flex-col gap-1">
						<RACToastContent className="py-px leading-snug">
							<Text slot="title">{item.content.message}</Text>
						</RACToastContent>
						{item.content.actions.length > 1 ? (
							<div className="-ml-1.5 flex flex-wrap gap-1">
								{item.content.actions.map((action) => (
									<ActionButton
										key={action.label}
										action={action}
										close={() => queue.close(item.key)}
									/>
								))}
							</div>
						) : null}
					</div>
					{item.content.actions.length === 1 && item.content.actions[0] ? (
						<ActionButton
							action={item.content.actions[0]}
							close={() => queue.close(item.key)}
						/>
					) : null}
					<Button
						slot="close"
						aria-label="Dismiss"
						className="flex size-5 shrink-0 cursor-default items-center justify-center rounded-[3px] text-fc-muted outline-none data-hovered:bg-fc-hover data-hovered:text-fc-text pointer-coarse:size-7"
					>
						<CloseIcon className="size-3.5" />
					</Button>
				</RACToast>
			)}
		</RACToastRegion>
	);
}

function ActionButton({
	action,
	close,
}: {
	action: ToastAction;
	close: () => void;
}) {
	return (
		<Button
			onPress={() => {
				action.onAction();
				close();
			}}
			className="shrink-0 cursor-default rounded-[3px] px-1.5 py-px font-medium text-fc-accent outline-none data-hovered:bg-fc-hover data-focus-visible:outline-solid data-focus-visible:outline-1 data-focus-visible:outline-fc-accent"
		>
			{action.label}
		</Button>
	);
}
