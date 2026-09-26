import {
	Tab as RACTab,
	TabList as RACTabList,
	type TabListProps as RACTabListProps,
	TabPanel as RACTabPanel,
	type TabPanelProps as RACTabPanelProps,
	type TabProps as RACTabProps,
	Tabs as RACTabs,
	type TabsProps as RACTabsProps,
} from "react-aria-components";
import { composeTw } from "./lib/compose";

export function Tabs({ className, ...props }: RACTabsProps) {
	return (
		<RACTabs
			{...props}
			className={composeTw(
				className,
				"flex min-h-0 flex-col data-[orientation=vertical]:flex-row",
			)}
		/>
	);
}

export function TabList<T extends object>({
	className,
	...props
}: RACTabListProps<T>) {
	return (
		<RACTabList
			{...props}
			className={composeTw(
				className,
				"flex h-8 shrink-0 items-stretch gap-0.5 border-fc-border border-b px-1 pointer-coarse:h-10",
			)}
		/>
	);
}

export function Tab({ className, ...props }: RACTabProps) {
	return (
		<RACTab
			{...props}
			className={composeTw(
				className,
				"relative flex cursor-default select-none items-center px-2 text-fc-base text-fc-muted outline-none",
				"data-hovered:text-fc-text data-selected:text-fc-text data-disabled:text-fc-faint",
				"after:absolute after:inset-x-1.5 after:bottom-[-1px] after:h-0.5 after:rounded-full after:bg-transparent data-selected:after:bg-fc-accent",
				"data-focus-visible:-outline-offset-2",
			)}
		/>
	);
}

export function TabPanel({ className, ...props }: RACTabPanelProps) {
	return (
		<RACTabPanel
			{...props}
			className={composeTw(
				className,
				"min-h-0 flex-1 overflow-auto outline-none",
			)}
		/>
	);
}
