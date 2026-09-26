import type { ReactNode } from "react";
import {
	Button,
	Input,
	Label,
	ListBox,
	type ListBoxItemProps,
	ComboBox as RACComboBox,
	type ComboBoxProps as RACComboBoxProps,
} from "react-aria-components";
import { inputBase } from "./field";
import { ChevronDownIcon } from "./icons";
import { cn } from "./lib/cn";
import { composeTw } from "./lib/compose";
import { fieldLabel, listBox } from "./lib/styles";
import { Popover } from "./popover";
import { SelectItem } from "./select";

export interface ComboBoxProps<T extends object>
	extends Omit<RACComboBoxProps<T>, "children"> {
	label?: ReactNode;
	labelPosition?: "top" | "side";
	placeholder?: string;
	children: ReactNode | ((item: T) => ReactNode);
}

export function ComboBox<T extends object>({
	label,
	labelPosition = "top",
	placeholder,
	items,
	children,
	className,
	...props
}: ComboBoxProps<T>) {
	const side = labelPosition === "side";
	return (
		<RACComboBox
			{...props}
			items={items}
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
			<div className="relative min-w-0 flex-1">
				<Input
					placeholder={placeholder}
					className={cn(inputBase, "h-fc-control pr-6")}
				/>
				<Button className="absolute inset-y-0 right-0 flex w-5 cursor-default items-center justify-center text-fc-muted outline-none data-hovered:text-fc-text data-pressed:text-fc-text pointer-coarse:w-8">
					<ChevronDownIcon className="size-3.5" />
				</Button>
			</div>
			<Popover placement="bottom start" className="min-w-(--trigger-width)">
				<ListBox className={listBox}>{children}</ListBox>
			</Popover>
		</RACComboBox>
	);
}

export interface ComboBoxItemProps<T extends object>
	extends Omit<ListBoxItemProps<T>, "children"> {
	children: ReactNode;
	icon?: ReactNode;
}

export function ComboBoxItem<T extends object>(props: ComboBoxItemProps<T>) {
	return <SelectItem {...props} />;
}
