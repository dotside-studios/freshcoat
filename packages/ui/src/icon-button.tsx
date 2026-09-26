import {
	Button as RACButton,
	type ButtonProps as RACButtonProps,
} from "react-aria-components";
import { composeTw } from "./lib/compose";
import { Tooltip, TooltipTrigger } from "./tooltip";

export interface IconButtonProps extends RACButtonProps {
	"aria-label": string;
	/** Shown after the tooltip delay. Defaults to nothing (the aria-label is not repeated). */
	tooltip?: string;
	variant?: "ghost" | "default" | "primary";
}

export const iconButtonBase =
	"inline-flex size-fc-icon shrink-0 cursor-default select-none items-center justify-center rounded-[3px] text-fc-muted outline-none data-disabled:opacity-40 data-hovered:text-fc-text data-focus-visible:outline-solid data-focus-visible:outline-1 data-focus-visible:outline-fc-accent data-focus-visible:-outline-offset-1 [&_svg]:size-4";

const variants = {
	ghost: "data-hovered:bg-fc-hover data-pressed:bg-fc-active",
	default:
		"border border-fc-border-strong bg-fc-hover text-fc-text data-hovered:bg-fc-active data-pressed:bg-fc-border-strong",
	primary:
		"bg-fc-accent text-white data-hovered:bg-fc-accent-hover data-hovered:text-white",
};

export function IconButton({
	tooltip,
	variant = "ghost",
	className,
	...props
}: IconButtonProps) {
	const button = (
		<RACButton
			{...props}
			className={composeTw(className, iconButtonBase, variants[variant])}
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
