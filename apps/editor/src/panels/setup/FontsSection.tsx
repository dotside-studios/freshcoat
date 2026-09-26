import type { Template } from "@freshcoat/coatfile";
import { Button } from "@freshcoat/ui/button";
import { IconButton } from "@freshcoat/ui/icon-button";
import { toast } from "@freshcoat/ui/toast";
import { useMemo, useState } from "react";
import { useController } from "~/app/context";
import { addFont, fontReferences, removeFont } from "~/doc/ops";
import { applyFontPick, templateFamilies } from "~/fonts/apply";
import { type FontPick, FontPicker } from "~/fonts/FontPicker";
import {
	type DocumentFonts,
	useDocumentFonts,
} from "~/render/use-document-fonts";
import AddIcon from "~icons/mingcute/add-line";
import DeleteIcon from "~icons/mingcute/delete-2-line";
import { Badge, RefusalNotice } from "../content/shared";
import { verifyGoogleFont } from "./google-font";

type Row = { family: string; kind: string; declared: boolean };

export function fontStatus(
	family: string,
	fonts: Pick<DocumentFonts, "loading" | "guessed" | "missing">,
): "loading" | "loaded" | "guessed" | "missing" {
	if (fonts.missing.includes(family)) return "missing";
	if (fonts.guessed.includes(family)) return "guessed";
	return fonts.loading ? "loading" : "loaded";
}

const STATUS_TONE = {
	loading: "muted",
	loaded: "success",
	guessed: "warning",
	missing: "danger",
} as const;

const STATUS_HINT = {
	loading: "Loading",
	loaded: "Loaded",
	guessed: "Found on Google Fonts by name",
	missing: "Not found, using a fallback",
} as const;

/** The fonts the template declares or uses, with their status, and Add font. */
export function FontsSection({ template }: { template: Template }) {
	const controller = useController();
	const fonts = useDocumentFonts(template);
	const [blocked, setBlocked] = useState<{
		family: string;
		reason: string;
	} | null>(null);

	const declared = template.fonts ?? [];
	const rows: Row[] = [
		...declared.map((f) => ({
			family: f.family,
			kind: f.kind,
			declared: true,
		})),
		...fonts.families
			.filter((f) => !declared.some((d) => d.family === f))
			.filter((f, i, all) => all.indexOf(f) === i)
			.map((family) => ({ family, kind: "undeclared", declared: false })),
	];

	const remove = (family: string) => {
		const result = controller.edit((t) => removeFont(t, family), {
			quiet: true,
			scope: "base",
		});
		if (!result) return;
		if (result.ok) setBlocked(null);
		else setBlocked({ family, reason: result.reason });
	};

	return (
		<div className="flex flex-col gap-1">
			{rows.length === 0 ? (
				<p className="m-0 text-fc-faint text-fc-sm">No fonts</p>
			) : null}
			<ul className="m-0 flex list-none flex-col gap-0.5 p-0">
				{rows.map((row) => {
					const status = fontStatus(row.family, fonts);
					const references =
						blocked?.family === row.family
							? fontReferences(template, row.family)
							: [];
					return (
						<li
							key={`${row.kind}:${row.family}`}
							data-testid={`font-${row.family}`}
							className="flex flex-col gap-1"
						>
							<div className="flex h-fc-control items-center gap-1.5">
								<span className="min-w-0 flex-1 truncate text-fc-text">
									{row.family}
								</span>
								<span className="shrink-0 text-fc-faint text-fc-sm">
									{row.kind}
								</span>
								<span title={STATUS_HINT[status]} className="flex">
									<Badge tone={STATUS_TONE[status]}>{status}</Badge>
								</span>
								{row.declared ? (
									<IconButton
										aria-label={`Remove font ${row.family}`}
										tooltip="Remove font"
										className="size-5 pointer-coarse:size-8"
										onPress={() => remove(row.family)}
									>
										<DeleteIcon />
									</IconButton>
								) : (
									<span className="size-5 shrink-0 pointer-coarse:size-8" />
								)}
							</div>
							{blocked?.family === row.family && references.length > 0 ? (
								<RefusalNotice
									template={template}
									message={`${blocked.reason}. Change their font first:`}
									references={references}
									onDismiss={() => setBlocked(null)}
								/>
							) : null}
						</li>
					);
				})}
			</ul>
			<AddFont
				template={template}
				onAdd={(pick, url) =>
					controller.edit(
						(t) =>
							url
								? addFont(t, { kind: "google", family: pick.family, url })
								: applyFontPick(t, [], pick.family, pick.row),
						{ scope: "base" },
					)?.ok ?? false
				}
			/>
		</div>
	);
}

function AddFont({
	template,
	onAdd,
}: {
	template: Template;
	/** adds a catalogue family, or a looked-up one with its stylesheet url */
	onAdd: (pick: FontPick, url?: string) => boolean;
}) {
	const [busy, setBusy] = useState(false);
	const families = useMemo(() => templateFamilies(template), [template]);

	const add = async (pick: FontPick) => {
		const name = pick.family.trim().replace(/\s+/g, " ");
		if (!name || busy) return;
		if (template.fonts?.some((d) => d.family === name)) {
			toast(`"${name}" is already in the template`, { tone: "warning" });
			return;
		}
		let url: string | undefined;
		if (!pick.row) {
			// A name the catalogue lacks is checked against Google Fonts first.
			setBusy(true);
			url = (await verifyGoogleFont(name)) ?? undefined;
			setBusy(false);
			if (!url) {
				toast(`Google Fonts has no family called "${name}"`, {
					tone: "danger",
				});
				return;
			}
		}
		if (onAdd({ family: name, row: pick.row }, url))
			toast(`Added ${name}`, { tone: "success" });
	};

	return (
		<div className="mt-1 flex">
			<FontPicker
				value={null}
				templateFamilies={families}
				onPick={(pick) => void add(pick)}
			>
				<Button isDisabled={busy}>
					<AddIcon />
					{busy ? "Checking…" : "Add font…"}
				</Button>
			</FontPicker>
		</div>
	);
}
