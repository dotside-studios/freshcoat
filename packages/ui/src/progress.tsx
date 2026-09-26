import type { ReactNode } from "react";
import {
	Label,
	ProgressBar as RACProgressBar,
	type ProgressBarProps as RACProgressBarProps,
} from "react-aria-components";
import { cn } from "./lib/cn";
import { composeTw } from "./lib/compose";
import { fieldLabel } from "./lib/styles";

export type ProgressTone = "accent" | "success" | "danger";

export interface ProgressBarProps
	extends Omit<RACProgressBarProps, "children"> {
	label?: ReactNode;
	tone?: ProgressTone;
	/**
	 * `compact` is a bare 4px bar (give it an `aria-label`); `labelled` puts the
	 * label and the value text above a 6px bar. Defaults to `labelled` when a
	 * label is given.
	 */
	variant?: "compact" | "labelled";
	/** Show the value text in the labelled variant. Defaults to true. */
	showValue?: boolean;
	trackClassName?: string;
}

const fills: Record<ProgressTone, string> = {
	accent: "bg-fc-accent",
	success: "bg-fc-success",
	danger: "bg-fc-danger",
};

export function ProgressBar({
	label,
	tone = "accent",
	variant = label != null ? "labelled" : "compact",
	showValue = true,
	className,
	trackClassName,
	...props
}: ProgressBarProps) {
	const labelled = variant === "labelled";
	return (
		<RACProgressBar
			{...props}
			className={composeTw(className, "flex min-w-0 flex-col gap-1")}
		>
			{({ percentage, valueText, isIndeterminate }) => (
				<>
					{labelled && (label != null || showValue) && (
						<div className="flex min-w-0 items-baseline gap-2">
							{label != null && (
								<Label className={cn(fieldLabel, "min-w-0 flex-1 truncate")}>
									{label}
								</Label>
							)}
							{showValue && !isIndeterminate && (
								<span className="ml-auto shrink-0 text-fc-muted text-fc-sm tabular-nums">
									{valueText}
								</span>
							)}
						</div>
					)}
					<div
						className={cn(
							"relative w-full overflow-hidden rounded-full bg-fc-active",
							labelled ? "h-1.5" : "h-1",
							trackClassName,
						)}
					>
						{isIndeterminate ? (
							<div
								className={cn(
									"absolute inset-y-0 left-0 w-2/5 rounded-full",
									fills[tone],
									"animate-fc-indeterminate",
									"motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-60",
								)}
							/>
						) : (
							<div
								className={cn(
									"h-full rounded-full transition-[width] duration-200 ease-out motion-reduce:transition-none",
									fills[tone],
								)}
								style={{ width: `${percentage ?? 0}%` }}
							/>
						)}
					</div>
				</>
			)}
		</RACProgressBar>
	);
}
