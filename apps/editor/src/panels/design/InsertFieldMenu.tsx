import type { FieldDefinition, Template } from "@freshcoat-js/coatfile";
import { IconButton } from "@freshcoat-js/ui/icon-button";
import { cn } from "@freshcoat-js/ui/lib/cn";
import { Menu, MenuItem, MenuSeparator } from "@freshcoat-js/ui/menu";
import { Popover } from "@freshcoat-js/ui/popover";
import { useMemo, useRef, useState } from "react";
import { MenuTrigger, Dialog as RACDialog } from "react-aria-components";
import { useController } from "~/app/context";
import { CONTENT } from "~/app/copy";
import { type FieldEntry, listFields } from "~/doc/values";
import { createField } from "~/panels/content/field-def";
import { NewFieldKey } from "~/panels/content/shared";
import AddIcon from "~icons/mingcute/add-line";
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

const NEW_FIELD = "\0new";

export function InsertFieldMenu({
	template,
	onInsert,
	prefer,
	newFormat,
	isDisabled,
	className,
}: {
	template: Template;
	onInsert: (id: string) => void;
	prefer?: readonly Format[];
	/** The format a field made from the menu starts with. */
	newFormat?: Format;
	isDisabled?: boolean;
	className?: string;
}) {
	const controller = useController();
	const anchor = useRef<HTMLSpanElement>(null);
	const [naming, setNaming] = useState(false);
	const fields = useMemo(
		() => orderFields(listFields(template), prefer),
		[template, prefer],
	);
	const create = (key: string) => {
		if (!createField(controller, key, newFormat)) return false;
		setNaming(false);
		onInsert(key);
		return true;
	};
	return (
		<span ref={anchor} className="inline-flex shrink-0">
			<MenuTrigger>
				<IconButton
					aria-label="Insert field"
					tooltip="Insert field"
					className={cn("size-5 shrink-0 pointer-coarse:size-8", className)}
					isDisabled={isDisabled}
				>
					<BracesIcon />
				</IconButton>
				<Popover placement="bottom end">
					<Menu
						onAction={(k) => {
							if (k === NEW_FIELD) setNaming(true);
							else onInsert(String(k));
						}}
					>
						{fields.map((f) => (
							<MenuItem key={f.id} id={f.id} textValue={f.id}>
								{fieldLabel(f)}
							</MenuItem>
						))}
						{fields.length > 0 ? <MenuSeparator /> : null}
						<MenuItem id={NEW_FIELD} icon={<AddIcon />}>
							{CONTENT.newField}
						</MenuItem>
					</Menu>
				</Popover>
			</MenuTrigger>
			<Popover
				triggerRef={anchor}
				isOpen={naming}
				onOpenChange={setNaming}
				placement="bottom end"
				className="w-56 p-1.5"
			>
				<RACDialog aria-label={CONTENT.newField} className="outline-none">
					<NewFieldKey
						taken={(k) => k in template.fields.properties}
						onCreate={create}
						onCancel={() => setNaming(false)}
					/>
				</RACDialog>
			</Popover>
		</span>
	);
}
