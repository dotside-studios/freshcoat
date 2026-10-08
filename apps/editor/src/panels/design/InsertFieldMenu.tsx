import type { FieldDefinition, Template } from "@freshcoat-js/coatfile";
import { IconButton } from "@freshcoat-js/ui/icon-button";
import { cn } from "@freshcoat-js/ui/lib/cn";
import { Menu, MenuItem } from "@freshcoat-js/ui/menu";
import { Popover } from "@freshcoat-js/ui/popover";
import { useMemo } from "react";
import { MenuTrigger } from "react-aria-components";
import { type FieldEntry, listFields } from "~/doc/values";
import BracesIcon from "~icons/mingcute/braces-line";

type Format = FieldDefinition["format"];

/** Fields in declaration order, those of a `prefer` format first. */
export function orderFields(
	fields: readonly FieldEntry[],
	prefer: readonly Format[] = [],
): FieldEntry[] {
	const rank = (f: FieldEntry) => {
		const i = prefer.indexOf(f.field.format);
		return i < 0 ? prefer.length : i;
	};
	return [...fields].sort((a, b) => rank(a) - rank(b));
}

export function fieldLabel({ id, field }: FieldEntry): string {
	return field.title ? `${field.title} · ${id}` : id;
}

/** Writes `{{id}}` over the input's selection, then puts the caret after it. */
export function spliceToken(
	input: HTMLInputElement | HTMLTextAreaElement | null | undefined,
	current: string,
	id: string,
	write: (value: string) => void,
) {
	const token = `{{${id}}}`;
	const start = input?.selectionStart ?? current.length;
	const end = input?.selectionEnd ?? current.length;
	write(current.slice(0, start) + token + current.slice(end));
	requestAnimationFrame(() => {
		input?.focus();
		input?.setSelectionRange(start + token.length, start + token.length);
	});
}

export function InsertFieldMenu({
	template,
	onInsert,
	prefer,
	isDisabled,
	className,
}: {
	template: Template;
	onInsert: (id: string) => void;
	prefer?: readonly Format[];
	isDisabled?: boolean;
	className?: string;
}) {
	const fields = useMemo(
		() => orderFields(listFields(template), prefer),
		[template, prefer],
	);
	return (
		<MenuTrigger>
			<IconButton
				aria-label="Insert field"
				tooltip="Insert field"
				className={cn("size-5 shrink-0 pointer-coarse:size-8", className)}
				isDisabled={isDisabled || fields.length === 0}
			>
				<BracesIcon />
			</IconButton>
			<Popover placement="bottom end">
				<Menu onAction={(k) => onInsert(String(k))}>
					{fields.map((f) => (
						<MenuItem key={f.id} id={f.id} textValue={f.id}>
							{fieldLabel(f)}
						</MenuItem>
					))}
				</Menu>
			</Popover>
		</MenuTrigger>
	);
}
