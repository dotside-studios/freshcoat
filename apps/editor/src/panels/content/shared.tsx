import type { Template } from "@freshcoat/coatfile";
import { TextArea, TextField, type TextFieldProps } from "@freshcoat/ui/field";
import { cn } from "@freshcoat/ui/lib/cn";
import { type ReactNode, useState } from "react";
import { Button as RACButton } from "react-aria-components";
import { useController } from "~/app/context";
import type { EditorController } from "~/app/controller";
import { getElement, parseKey } from "~/doc/path";
import CloseIcon from "~icons/mingcute/close-line";

type DraftFieldProps = Omit<
	TextFieldProps,
	"value" | "onChange" | "onBlur" | "onKeyDown" | "isInvalid" | "errorMessage"
> & {
	value: string;
	/** Applies a value; false means it was refused and the draft stays. */
	onCommit: (value: string) => boolean;
	/** `change` commits every keystroke; `blur` on Enter or blur, reverting a refusal. */
	commitOn?: "change" | "blur";
	/** An error message for a value that must not be committed. */
	validate?: (value: string) => string | null;
	multiline?: boolean;
	rows?: number;
};

/** A text field over a document value that keeps what is typed while it is
 *  invalid or refused, instead of snapping back to the stored value. */
export function DraftTextField({
	value,
	onCommit,
	commitOn = "change",
	validate,
	multiline,
	rows,
	...props
}: DraftFieldProps) {
	const [draft, setDraft] = useState<string | null>(null);
	const [refused, setRefused] = useState(false);
	const error = draft !== null ? validate?.(draft) : null;

	const apply = (next: string) => {
		if (validate?.(next)) return false;
		const ok = next === value || onCommit(next);
		setRefused(!ok);
		return ok;
	};

	const onChange = (next: string) => {
		setDraft(next);
		if (commitOn === "change") apply(next);
	};

	const finish = () => {
		if (draft === null) return;
		if (commitOn === "blur") apply(draft);
		setDraft(null);
		setRefused(false);
	};

	const shared = {
		...props,
		value: draft ?? value,
		onChange,
		onBlur: finish,
		onKeyDown: (e: {
			key: string;
			preventDefault(): void;
			continuePropagation(): void;
		}) => {
			if (e.key === "Enter" && !multiline) {
				e.preventDefault();
				finish();
			} else if (e.key === "Escape" && draft !== null && draft !== value) {
				setDraft(null);
				setRefused(false);
			} else if (e.key === "Escape") {
				// Nothing to revert, so Escape is the dialog's or popover's.
				setDraft(null);
				e.continuePropagation();
			}
		},
		isInvalid: !!error || (refused && draft !== null),
		errorMessage: error ?? undefined,
	};
	return multiline ? (
		<TextArea {...shared} rows={rows} />
	) : (
		<TextField {...shared} />
	);
}

export function Badge({
	tone = "muted",
	children,
	className,
}: {
	tone?: "muted" | "success" | "warning" | "danger" | "accent";
	children: ReactNode;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"inline-flex h-4 shrink-0 items-center rounded-[3px] px-1 font-medium text-[10px] leading-none",
				tone === "muted" && "bg-fc-hover text-fc-muted",
				tone === "success" && "bg-fc-success/20 text-fc-success-text",
				tone === "warning" && "bg-fc-warning/20 text-fc-warning",
				tone === "danger" && "bg-fc-danger/20 text-fc-danger-text",
				tone === "accent" && "bg-fc-accent-soft text-fc-accent-hover",
				className,
			)}
		>
			{children}
		</span>
	);
}

/** Selects a layer key on its side, or previews a `variant:<id>` reference. */
export function goToReference(controller: EditorController, ref: string) {
	if (ref.startsWith("variant:")) {
		controller.dispatch({
			type: "setVariant",
			variantId: ref.slice("variant:".length),
		});
		return;
	}
	const p = parseKey(ref);
	if (!p) return;
	controller.dispatch({ type: "setSide", side: p.side });
	controller.select([ref]);
}

export function referenceLabel(t: Template, ref: string): string {
	if (ref.startsWith("variant:")) {
		const id = ref.slice("variant:".length);
		const v = t.variants?.find((x) => x.id === id);
		return `Variant · ${v?.label ?? id}`;
	}
	const p = parseKey(ref);
	const el = getElement(t, ref);
	const name = el && "id" in el && el.id ? el.id : ref;
	const side = p ? t.template_data[p.side]?.name : undefined;
	return t.template_data.length > 1 && side ? `${side} · ${name}` : name;
}

export function ReferenceChips({
	template,
	references,
}: {
	template: Template;
	references: string[];
}) {
	const controller = useController();
	return (
		<div className="flex flex-wrap gap-1">
			{references.map((ref) => (
				<RACButton
					key={ref}
					data-testid="reference-chip"
					onPress={() => goToReference(controller, ref)}
					className="inline-flex h-5 max-w-full cursor-default items-center truncate rounded-[3px] border border-fc-border-strong bg-fc-raised px-1.5 font-fc-mono text-[11px] text-fc-text outline-none data-hovered:border-fc-accent data-focus-visible:outline-solid data-focus-visible:outline-1 data-focus-visible:outline-fc-accent pointer-coarse:h-7"
				>
					{referenceLabel(template, ref)}
				</RACButton>
			))}
		</div>
	);
}

/** Why an op was refused and what blocks it, shown inline under a row. */
export function RefusalNotice({
	template,
	message,
	references,
	onDismiss,
}: {
	template: Template;
	message: string;
	references: string[];
	onDismiss: () => void;
}) {
	return (
		<div
			role="alert"
			className="flex flex-col gap-1.5 rounded-[3px] border border-fc-warning/40 bg-fc-warning/10 p-1.5"
		>
			<div className="flex items-start gap-1">
				<p className="m-0 min-w-0 flex-1 text-fc-sm text-fc-text leading-snug">
					{message}
				</p>
				<RACButton
					aria-label="Dismiss"
					onPress={onDismiss}
					className="flex size-4 shrink-0 cursor-default items-center justify-center rounded-[2px] text-fc-muted outline-none data-hovered:bg-fc-hover data-hovered:text-fc-text"
				>
					<CloseIcon className="size-3" />
				</RACButton>
			</div>
			<ReferenceChips template={template} references={references} />
		</div>
	);
}

export function EmptyPanel({ children }: { children: ReactNode }) {
	return <p className="m-0 p-3 text-fc-faint text-fc-sm">{children}</p>;
}

export function Subheading({ children }: { children: ReactNode }) {
	return (
		<div className="mt-1 flex items-center gap-2 font-semibold text-[10px] text-fc-faint uppercase tracking-[0.06em]">
			{children}
			<span className="h-px flex-1 bg-fc-border" />
		</div>
	);
}
