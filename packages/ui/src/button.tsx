import {
	Button as RACButton,
	type ButtonProps as RACButtonProps,
} from "react-aria-components";
import { composeTw } from "./lib/compose";

export type ButtonVariant = "default" | "primary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends RACButtonProps {
	variant?: ButtonVariant;
	size?: ButtonSize;
}

const variants: Record<ButtonVariant, string> = {
	default:
		"border-fc-border-strong bg-fc-hover text-fc-text data-hovered:bg-fc-active data-pressed:bg-fc-border-strong",
	primary:
		"border-transparent bg-fc-accent text-white data-hovered:bg-fc-accent-hover data-pressed:bg-fc-accent",
	ghost:
		"border-transparent bg-transparent text-fc-text data-hovered:bg-fc-hover data-pressed:bg-fc-active",
	danger:
		"border-transparent bg-fc-danger text-white data-hovered:bg-fc-danger-hover data-pressed:bg-fc-danger",
};

const sizes: Record<ButtonSize, string> = {
	sm: "h-5 gap-1 px-1.5 text-fc-sm pointer-coarse:h-7 [&_svg]:size-3.5",
	md: "h-fc-control gap-1.5 px-2.5 text-fc-base [&_svg]:size-4",
};

export const buttonBase =
	"inline-flex shrink-0 cursor-default select-none items-center justify-center whitespace-nowrap rounded-[3px] border font-medium outline-none data-disabled:opacity-40 data-focus-visible:outline-solid data-focus-visible:outline-1 data-focus-visible:outline-fc-accent data-focus-visible:outline-offset-1";

export function Button({
	variant = "default",
	size = "md",
	className,
	...props
}: ButtonProps) {
	return (
		<RACButton
			{...props}
			className={composeTw(
				className,
				buttonBase,
				variants[variant],
				sizes[size],
			)}
		/>
	);
}
