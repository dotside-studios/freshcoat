import type { ReactNode } from "react";
import {
	Button,
	Label,
	ListBox,
	ListBoxItem,
	type ListBoxItemProps,
	Select as RACSelect,
	type SelectProps as RACSelectProps,
	SelectValue,
} from "react-aria-components";
import { CheckIcon, ChevronDownIcon } from "./icons";
import { cn } from "./lib/cn";
import { composeTw } from "./lib/compose";
import { fieldLabel, listBox, listItem } from "./lib/styles";
import { Popover } from "./popover";

export interface SelectProps<T extends object>
	extends Omit<RACSelectProps<T>, "children"> {
	label?: ReactNode;
	labelPosition?: "top" | "side";
	items?: Iterable<T>;
	children: ReactNode | ((item: T) => ReactNode);
	triggerClassName?: string;
}

export const triggerButton =
	"flex h-fc-control w-full min-w-0 cursor-default items-center gap-1 rounded-[3px] border border-transparent bg-fc-raised pr-0.5 pl-1.5 text-left text-fc-base text-fc-text outline-none data-hovered:border-fc-border-strong data-pressed:bg-fc-hover data-focus-visible:border-fc-accent data-focus-visible:outline-none data-disabled:opacity-40";

export function Select<T extends object>({
	label,
	labelPosition = "top",
	items,
	children,
	className,
	triggerClassName,
	placeholder = "Select…",
	...props
}: SelectProps<T>) {
	const side = labelPosition === "side";
	return (
		<RACSelect
			{...props}
			placeholder={placeholder}
			className={composeTw(
				className,
				"group min-w-0",
				side && "flex items-center gap-2",
			)}
		>
			{label != null && (
				<Label
					className={cn(
						fieldLabel,
						side ? "w-16 shrink-0 truncate" : "mb-1 block",
					)}
				>
					{label}
				</Label>
			)}
			<Button
				className={cn(
					triggerButton,
					"group-data-open:border-fc-accent",
					triggerClassName,
				)}
			>
				<SelectValue className="flex-1 truncate data-placeholder:text-fc-faint" />
				<ChevronDownIcon className="size-3.5 shrink-0 text-fc-muted" />
			</Button>
			<Popover placement="bottom start" className="min-w-(--trigger-width)">
				<ListBox items={items} className={listBox}>
					{children}
				</ListBox>
			</Popover>
		</RACSelect>
	);
}

export interface SelectItemProps<T extends object>
	extends Omit<ListBoxItemProps<T>, "children"> {
	children: ReactNode;
	/** Optional leading glyph. */
	icon?: ReactNode;
}

export function SelectItem<T extends object>({
	children,
	icon,
	className,
	textValue,
	...props
}: SelectItemProps<T>) {
	return (
		<ListBoxItem
			{...props}
			textValue={
				textValue ?? (typeof children === "string" ? children : undefined)
			}
			className={composeTw(className, listItem)}
		>
			{({ isSelected }) => (
				<>
					<span className="flex w-3.5 shrink-0 justify-center">
						{isSelected && <CheckIcon className="size-3.5" />}
					</span>
					{icon != null && (
						<span className="flex shrink-0 text-fc-muted group-data-focused/item:text-white [&_svg]:size-4">
							{icon}
						</span>
					)}
					<span className="min-w-0 flex-1 truncate">{children}</span>
				</>
			)}
		</ListBoxItem>
	);
}
