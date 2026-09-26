import type { Template } from "@freshcoat/coatfile";
import { useRef, useState } from "react";
import { useController } from "~/app/context";
import { isUnnamed } from "~/doc/new-document";
import { setTemplateMeta, type TemplateMeta } from "~/doc/ops";
import { DraftTextField } from "../content/shared";

const META: {
	key: keyof Omit<TemplateMeta, "author">;
	label: string;
	required?: boolean;
	multiline?: boolean;
	mono?: boolean;
}[] = [
	{ key: "name", label: "Name", required: true },
	{ key: "id", label: "ID", required: true, mono: true },
	{ key: "description", label: "Description", multiline: true },
	{ key: "version", label: "Version", mono: true },
	{ key: "product", label: "Product" },
];

/** "Spring badge" → "spring-badge": the id a name suggests. */
export function slugId(name: string): string {
	return (
		name
			.normalize("NFKD")
			.replace(/[̀-ͯ]/g, "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "template"
	);
}

/**
 * Name, id, description, version and product. Each field commits as it is
 * typed, one undo step per field. On a template that was never named, typing
 * the name also sets the id to its slug, until the id is edited by hand.
 */
export function GeneralSection({
	template,
	autoFocusName,
}: {
	template: Template;
	/** Focuses the name with its text selected, for the naming prompt. */
	autoFocusName?: boolean;
}) {
	const controller = useController();
	const [suggest, setSuggest] = useState(() => isUnnamed(template));
	const selectOnFocus = useRef(autoFocusName);
	return (
		<div className="flex flex-col gap-1.5">
			{META.map((m) => (
				<DraftTextField
					key={m.key}
					label={m.label}
					labelPosition="side"
					multiline={m.multiline}
					rows={3}
					value={template[m.key] ?? ""}
					inputClassName={m.mono ? "font-fc-mono" : undefined}
					autoFocus={m.key === "name" && autoFocusName}
					onFocus={
						m.key === "name"
							? (e) => {
									if (!selectOnFocus.current) return;
									selectOnFocus.current = false;
									(e.target as HTMLInputElement).select();
								}
							: undefined
					}
					validate={(v) =>
						m.required && !v.trim() ? `${m.label} is required` : null
					}
					onCommit={(v) => {
						if (m.key === "id") setSuggest(false);
						const patch: TemplateMeta =
							m.key === "name" && suggest
								? { name: v, id: slugId(v) }
								: { [m.key]: v };
						return (
							controller.edit((t) => setTemplateMeta(t, patch), {
								mergeKey: `meta:${m.key}`,
								quiet: true,
								scope: "base",
							})?.ok ?? false
						);
					}}
				/>
			))}
		</div>
	);
}
