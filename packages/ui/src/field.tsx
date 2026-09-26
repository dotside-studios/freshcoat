import type { ReactNode } from "react";
import {
	FieldError,
	Input,
	Label,
	TextArea as RACTextArea,
	TextField as RACTextField,
	type TextFieldProps as RACTextFieldProps,
	Text,
} from "react-aria-components";
import { cn } from "./lib/cn";
import { composeTw } from "./lib/compose";
import { fieldLabel } from "./lib/styles";

interface SharedFieldProps extends RACTextFieldProps {
	label?: ReactNode;
	/** `top` stacks the label above; `side` puts it in a fixed column on the left. */
	labelPosition?: "top" | "side";
	description?: ReactNode;
	errorMessage?: ReactNode;
	placeholder?: string;
	inputClassName?: string;
}

export interface TextFieldProps extends SharedFieldProps {
	size?: "compact" | "regular";
}

export const inputBase =
	"w-full min-w-0 rounded-[3px] border border-transparent bg-fc-raised px-1.5 text-fc-base text-fc-text outline-none placeholder:text-fc-faint data-hovered:border-fc-border-strong data-focused:border-fc-accent data-focused:data-hovered:border-fc-accent data-invalid:border-fc-danger data-disabled:opacity-50 data-focus-visible:outline-none";

function FieldShell({
	label,
	labelPosition = "top",
	description,
	errorMessage,
	children,
}: Pick<
	SharedFieldProps,
	"label" | "labelPosition" | "description" | "errorMessage"
> & { children: ReactNode }) {
	const side = labelPosition === "side";
	return (
		<>
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
			{side ? <div className="min-w-0 flex-1">{children}</div> : children}
			{description != null && (
				<Text
					slot="description"
					className={cn(
						"mt-1 block text-fc-sm text-fc-faint",
						side && "basis-full pl-18",
					)}
				>
					{description}
				</Text>
			)}
			<FieldError
				className={cn(
					"mt-1 block text-fc-sm text-fc-danger",
					side && "basis-full pl-18",
				)}
			>
				{errorMessage}
			</FieldError>
		</>
	);
}

export function TextField({
	label,
	labelPosition = "top",
	description,
	errorMessage,
	placeholder,
	inputClassName,
	size = "compact",
	className,
	...props
}: TextFieldProps) {
	return (
		<RACTextField
			{...props}
			className={composeTw(
				className,
				"min-w-0",
				labelPosition === "side" && "flex flex-wrap items-center gap-x-2",
			)}
		>
			<FieldShell
				label={label}
				labelPosition={labelPosition}
				description={description}
				errorMessage={errorMessage}
			>
				<Input
					placeholder={placeholder}
					className={cn(
						inputBase,
						size === "compact" ? "h-fc-control" : "h-8",
						inputClassName,
					)}
				/>
			</FieldShell>
		</RACTextField>
	);
}

export interface TextAreaProps extends SharedFieldProps {
	rows?: number;
}

export function TextArea({
	label,
	labelPosition = "top",
	description,
	errorMessage,
	placeholder,
	inputClassName,
	rows = 3,
	className,
	...props
}: TextAreaProps) {
	return (
		<RACTextField
			{...props}
			className={composeTw(
				className,
				"min-w-0",
				labelPosition === "side" && "flex flex-wrap items-start gap-x-2",
			)}
		>
			<FieldShell
				label={label}
				labelPosition={labelPosition}
				description={description}
				errorMessage={errorMessage}
			>
				<RACTextArea
					rows={rows}
					placeholder={placeholder}
					className={cn(
						inputBase,
						"block resize-y py-1 leading-normal",
						inputClassName,
					)}
				/>
			</FieldShell>
		</RACTextField>
	);
}
