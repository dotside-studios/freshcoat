import type { Template } from "@freshcoat-js/coatfile";
import { FIELD_ID } from "@freshcoat-js/coatfile/mustache";
import { cn } from "@freshcoat-js/ui/lib/cn";
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import { useController } from "~/app/context";
import { CONTENT } from "~/app/copy";
import { type FieldEntry, listFields } from "~/doc/values";
import { createField } from "~/panels/content/field-def";
import { fieldLabel } from "./InsertFieldMenu";

/** An unclosed `{{` before the caret: where it starts, where the token it
 *  begins ends, and the key typed so far. */
export type Completion = { start: number; end: number; query: string };

export function completionAt(text: string, caret: number): Completion | null {
	const open = /\{\{\s*([A-Za-z0-9_]*)$/.exec(text.slice(0, caret));
	if (!open) return null;
	const rest = /^[A-Za-z0-9_]*(\s*\}\})?/.exec(text.slice(caret))?.[0] ?? "";
	return {
		start: open.index,
		end: caret + rest.length,
		query: open[1] ?? "",
	};
}

export type CompletionOption =
	| { kind: "field"; entry: FieldEntry }
	| { kind: "new"; id: string };

const LIMIT = 8;

/** Fields whose key starts with the query, then those whose key or title
 *  holds it, and a new field when the query is a free key. */
export function completionOptions(
	template: Template,
	query: string,
): CompletionOption[] {
	const q = query.toLowerCase();
	const fields = listFields(template);
	const starts = fields.filter((f) => f.id.toLowerCase().startsWith(q));
	const holds = fields.filter(
		(f) =>
			!starts.includes(f) &&
			(f.id.toLowerCase().includes(q) ||
				(f.field.title ?? "").toLowerCase().includes(q)),
	);
	const out: CompletionOption[] = [...starts, ...holds]
		.slice(0, LIMIT)
		.map((entry) => ({ kind: "field", entry }));
	if (FIELD_ID.test(query) && !(query in template.fields.properties))
		out.push({ kind: "new", id: query });
	return out;
}

type Open = { at: Completion; options: CompletionOption[]; active: number };

type Editable = HTMLTextAreaElement | HTMLInputElement;

/**
 * Suggests field keys while a `{{` is open in the text field inside `wrap`.
 * Arrows move through them, Enter or Tab writes one, Escape dismisses them.
 * Returns the list, to render under the field.
 */
export function useFieldCompletion(
	wrap: RefObject<HTMLElement | null>,
	template: Template | null,
	replace: (value: string, caret: number) => void,
) {
	const controller = useController();
	const id = useId();
	const [open, setOpen] = useState<Open | null>(null);
	const latest = useRef({ open, template, replace });
	latest.current = { open, template, replace };
	const dismissed = useRef<number | null>(null);

	const accept = (option: CompletionOption, el: Editable) => {
		const { open, replace } = latest.current;
		if (!open) return;
		const key = option.kind === "field" ? option.entry.id : option.id;
		if (option.kind === "new" && !createField(controller, key)) return;
		const token = `{{${key}}}`;
		const value = el.value;
		replace(
			value.slice(0, open.at.start) + token + value.slice(open.at.end),
			open.at.start + token.length,
		);
		setOpen(null);
	};
	const acceptRef = useRef(accept);
	acceptRef.current = accept;

	useEffect(() => {
		const field = (e: Event) =>
			(e.target instanceof HTMLTextAreaElement ||
				e.target instanceof HTMLInputElement) &&
			wrap.current?.contains(e.target)
				? (e.target as Editable)
				: null;
		const update = (el: Editable) => {
			const { template } = latest.current;
			const caret = el.selectionStart ?? 0;
			const at =
				template && caret === el.selectionEnd
					? completionAt(el.value, caret)
					: null;
			if (!at || dismissed.current !== at.start) dismissed.current = null;
			if (!at || !template || dismissed.current !== null) {
				setOpen(null);
				return;
			}
			const options = completionOptions(template, at.query);
			setOpen(options.length ? { at, options, active: 0 } : null);
		};
		const onUpdate = (e: Event) => {
			const el = field(e);
			if (el) update(el);
		};
		const onKeyUp = (e: KeyboardEvent) => {
			if (!["ArrowUp", "ArrowDown", "Enter", "Tab", "Escape"].includes(e.key))
				onUpdate(e);
		};
		const onKeyDown = (e: KeyboardEvent) => {
			const el = field(e);
			const { open } = latest.current;
			if (!el || !open || e.isComposing) return;
			const move = (by: number) =>
				setOpen({
					...open,
					active:
						(open.active + by + open.options.length) % open.options.length,
				});
			if (e.key === "ArrowDown") move(1);
			else if (e.key === "ArrowUp") move(-1);
			else if (e.key === "Enter" || e.key === "Tab") {
				const option = open.options[open.active];
				if (option) acceptRef.current(option, el);
			} else if (e.key === "Escape") {
				dismissed.current = open.at.start;
				setOpen(null);
			} else return;
			e.preventDefault();
			e.stopPropagation();
		};
		const onBlur = (e: Event) => {
			if (field(e)) setOpen(null);
		};
		document.addEventListener("input", onUpdate, true);
		document.addEventListener("click", onUpdate, true);
		document.addEventListener("keyup", onKeyUp, true);
		document.addEventListener("keydown", onKeyDown, true);
		document.addEventListener("focusout", onBlur, true);
		return () => {
			document.removeEventListener("input", onUpdate, true);
			document.removeEventListener("click", onUpdate, true);
			document.removeEventListener("keyup", onKeyUp, true);
			document.removeEventListener("keydown", onKeyDown, true);
			document.removeEventListener("focusout", onBlur, true);
		};
	}, [wrap]);

	useEffect(() => {
		const el = wrap.current?.querySelector<Editable>("textarea, input");
		if (!el) return;
		el.setAttribute("aria-autocomplete", "list");
		if (open) {
			el.setAttribute("aria-controls", id);
			el.setAttribute("aria-activedescendant", `${id}-${open.active}`);
		} else {
			el.removeAttribute("aria-controls");
			el.removeAttribute("aria-activedescendant");
		}
	});

	if (!open) return null;
	return (
		<div
			id={id}
			role="listbox"
			aria-label="Fields"
			data-testid="field-completion"
			onPointerDown={(e) => e.stopPropagation()}
			className="absolute top-full left-0 z-50 mt-1 flex max-h-56 min-w-44 max-w-full flex-col overflow-auto rounded-[4px] border border-fc-border-strong bg-fc-raised p-1 text-fc-sm text-fc-text shadow-lg"
		>
			{open.options.map((option, i) => (
				// biome-ignore lint/a11y/useKeyWithClickEvents: the field keeps focus and its arrow keys move through the list
				<div
					key={option.kind === "field" ? option.entry.id : "\0new"}
					id={`${id}-${i}`}
					role="option"
					aria-selected={i === open.active}
					tabIndex={-1}
					onMouseDown={(e) => e.preventDefault()}
					onClick={() => {
						const el = wrap.current?.querySelector<Editable>("textarea, input");
						if (el) accept(option, el);
					}}
					className={cn(
						"flex h-6 shrink-0 cursor-default items-center truncate rounded-[3px] px-1.5",
						i === open.active ? "bg-fc-accent text-white" : "hover:bg-fc-hover",
					)}
				>
					{option.kind === "field" ? (
						fieldLabel(option.entry)
					) : (
						<span className="truncate">
							{CONTENT.createField}{" "}
							<code className="font-fc-mono">{`{{${option.id}}}`}</code>
						</span>
					)}
				</div>
			))}
		</div>
	);
}
