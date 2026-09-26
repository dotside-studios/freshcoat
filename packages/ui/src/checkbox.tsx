import type { ReactNode } from "react";
import {
	Checkbox as RACCheckbox,
	type CheckboxProps as RACCheckboxProps,
	Switch as RACSwitch,
	type SwitchProps as RACSwitchProps,
} from "react-aria-components";
import { CheckIcon, DashIcon } from "./icons";
import { composeTw } from "./lib/compose";

// Relative, so react-aria's visually hidden input is positioned (and clipped)
// by the row inside whatever scrolls it. Otherwise it sits at its static
// place relative to some outer ancestor, overflows the app's root, and
// focusing it scrolls the whole window.
const row =
	"group relative flex min-h-fc-control cursor-default select-none items-center gap-1.5 text-fc-base text-fc-text outline-none data-disabled:opacity-40 data-focus-visible:outline-none";

const focusRing =
	"group-data-focus-visible:outline-1 group-data-focus-visible:outline-fc-accent group-data-focus-visible:outline-offset-1";

export interface CheckboxProps extends Omit<RACCheckboxProps, "children"> {
	children?: ReactNode;
}

export function Checkbox({ children, className, ...props }: CheckboxProps) {
	return (
		<RACCheckbox {...props} className={composeTw(className, row)}>
			{({ isSelected, isIndeterminate }) => (
				<>
					<span
						className={`flex size-3.5 shrink-0 items-center justify-center rounded-[2px] border border-fc-border-strong bg-fc-raised text-white group-data-hovered:border-fc-muted group-data-indeterminate:border-fc-accent group-data-selected:border-fc-accent group-data-indeterminate:bg-fc-accent group-data-selected:bg-fc-accent group-data-invalid:border-fc-danger pointer-coarse:size-[18px] ${focusRing}`}
					>
						{isIndeterminate ? (
							<DashIcon className="size-3" strokeWidth={2} />
						) : isSelected ? (
							<CheckIcon className="size-3" strokeWidth={2} />
						) : null}
					</span>
					{children}
				</>
			)}
		</RACCheckbox>
	);
}

export interface SwitchProps extends Omit<RACSwitchProps, "children"> {
	children?: ReactNode;
}

export function Switch({ children, className, ...props }: SwitchProps) {
	return (
		<RACSwitch {...props} className={composeTw(className, row, "gap-2")}>
			<span
				className={`relative flex h-3.5 w-6 shrink-0 items-center rounded-full border border-fc-border-strong bg-fc-active px-px transition-colors group-data-hovered:border-fc-muted group-data-selected:border-fc-accent group-data-selected:bg-fc-accent pointer-coarse:h-[18px] pointer-coarse:w-8 ${focusRing}`}
			>
				<span className="size-2.5 rounded-full bg-white shadow-(--shadow-fc-handle) transition-transform group-data-selected:translate-x-2.5 pointer-coarse:size-3.5 pointer-coarse:group-data-selected:translate-x-3.5" />
			</span>
			{children}
		</RACSwitch>
	);
}
