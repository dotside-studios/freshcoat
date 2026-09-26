import type { ReactNode } from "react";
import {
	Button,
	Disclosure,
	DisclosurePanel,
	type DisclosureProps,
	Heading,
} from "react-aria-components";
import { ChevronRightIcon } from "./icons";
import { cn } from "./lib/cn";
import { composeTw } from "./lib/compose";

export interface PanelSectionProps extends Omit<DisclosureProps, "children"> {
	title: ReactNode;
	/** Header controls (e.g. a "+" button). Pressing them does not toggle the section. */
	actions?: ReactNode;
	children?: ReactNode;
	bodyClassName?: string;
}

export function PanelSection({
	title,
	actions,
	children,
	className,
	bodyClassName,
	defaultExpanded = true,
	...props
}: PanelSectionProps) {
	return (
		<Disclosure
			{...props}
			defaultExpanded={defaultExpanded}
			className={composeTw(
				className,
				"group/section border-fc-border border-b last:border-b-0",
			)}
		>
			<div className="flex h-7 items-center pr-1 pointer-coarse:h-9">
				<Heading className="m-0 flex h-full min-w-0 flex-1">
					<Button
						slot="trigger"
						className="flex h-full min-w-0 flex-1 cursor-default items-center gap-1 pl-1.5 text-left font-semibold text-[10px] text-fc-muted uppercase tracking-[0.06em] outline-none data-hovered:text-fc-text data-focus-visible:-outline-offset-2"
					>
						<ChevronRightIcon className="size-3 shrink-0 transition-transform duration-100 group-data-expanded/section:rotate-90" />
						<span className="truncate">{title}</span>
					</Button>
				</Heading>
				{actions != null && (
					<div className="flex shrink-0 items-center gap-0.5">{actions}</div>
				)}
			</div>
			<DisclosurePanel>
				<div className={cn("flex flex-col gap-1.5 px-2 pb-2.5", bodyClassName)}>
					{children}
				</div>
			</DisclosurePanel>
		</Disclosure>
	);
}
