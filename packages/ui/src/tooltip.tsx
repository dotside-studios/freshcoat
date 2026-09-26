import {
	Tooltip as RACTooltip,
	type TooltipProps as RACTooltipProps,
	TooltipTrigger as RACTooltipTrigger,
	type TooltipTriggerComponentProps,
} from "react-aria-components";
import { composeTw } from "./lib/compose";

export interface TooltipProps extends RACTooltipProps {}

export function Tooltip({ className, offset = 6, ...props }: TooltipProps) {
	return (
		<RACTooltip
			{...props}
			offset={offset}
			className={composeTw(
				className,
				"max-w-64 rounded-[3px] border border-fc-border-strong bg-fc-tooltip px-1.5 py-1 text-fc-sm text-fc-text leading-tight shadow-(--shadow-fc-popover) outline-none",
			)}
		/>
	);
}

export function TooltipTrigger({
	delay = 600,
	closeDelay = 0,
	...props
}: TooltipTriggerComponentProps) {
	return <RACTooltipTrigger {...props} delay={delay} closeDelay={closeDelay} />;
}
