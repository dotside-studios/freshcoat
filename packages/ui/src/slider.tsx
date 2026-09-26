import type { ReactNode } from "react";
import {
	Label,
	Slider as RACSlider,
	type SliderProps as RACSliderProps,
	SliderOutput,
	SliderThumb,
	SliderTrack,
} from "react-aria-components";
import { cn } from "./lib/cn";
import { composeTw } from "./lib/compose";
import { fieldLabel } from "./lib/styles";

export interface SliderProps extends Omit<RACSliderProps<number>, "children"> {
	label?: ReactNode;
	/** Show the formatted value at the end of the row. Defaults to true. */
	showValue?: boolean;
	outputClassName?: string;
}

export function Slider({
	label,
	showValue = true,
	className,
	outputClassName,
	...props
}: SliderProps) {
	return (
		<RACSlider
			{...props}
			className={composeTw(
				className,
				"group flex min-w-0 items-center gap-2 data-disabled:opacity-40",
			)}
		>
			{label != null && (
				<Label className={cn(fieldLabel, "shrink-0")}>{label}</Label>
			)}
			<SliderTrack className="relative h-fc-control min-w-12 flex-1 touch-none">
				{({ state }) => (
					<>
						<div className="absolute top-1/2 h-[3px] w-full -translate-y-1/2 rounded-full bg-fc-active" />
						<div
							className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-fc-accent"
							style={{ width: `${state.getThumbPercent(0) * 100}%` }}
						/>
						<SliderThumb className="top-1/2 size-3 -translate-y-1/2 rounded-full bg-white shadow-(--shadow-fc-handle) outline-none data-focus-visible:outline-2 data-focus-visible:outline-fc-accent data-focus-visible:outline-offset-1 pointer-coarse:size-5" />
					</>
				)}
			</SliderTrack>
			{showValue && (
				<SliderOutput
					className={cn(
						"w-9 shrink-0 text-right text-fc-sm text-fc-muted tabular-nums",
						outputClassName,
					)}
				/>
			)}
		</RACSlider>
	);
}
