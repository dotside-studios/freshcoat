import { cn } from "@freshcoat-js/ui/lib/cn";
import {
	codepointLabel,
	type GlyphIssue,
	summarizeGlyphs,
} from "@freshcoat-js/workspace/export";
import { useState } from "react";
import { Button as RACButton } from "react-aria-components";
import { plural } from "~/app/copy";
import ChevronIcon from "~icons/mingcute/right-line";

const SHOWN_CHARS = 12;

/** Records whose text has characters no font in the export can draw. A
 *  warning: the export still runs, and those characters come out as boxes. */
export function GlyphNotice({
	issues,
	labelFor,
	onPick,
	showSide,
}: {
	issues: readonly GlyphIssue[];
	labelFor: (recordId: string) => string;
	onPick?: (recordId: string) => void;
	showSide?: boolean;
}) {
	const [open, setOpen] = useState(false);
	if (issues.length === 0) return null;
	const { records, codepoints } = summarizeGlyphs(issues);
	const chars = codepoints.slice(0, SHOWN_CHARS);
	return (
		<div
			className="shrink-0 border-fc-border border-b bg-fc-warning/10 text-fc-sm text-fc-warning"
			data-testid="export-missing-glyphs"
		>
			<RACButton
				aria-expanded={open}
				onPress={() => setOpen(!open)}
				className="flex w-full cursor-default items-center gap-1 px-3 py-1 text-left outline-none data-focus-visible:outline-solid data-focus-visible:outline-1 data-focus-visible:outline-fc-accent"
			>
				<ChevronIcon
					className={cn(
						"size-3.5 shrink-0 transition-transform duration-100",
						open && "rotate-90",
					)}
				/>
				<span className="min-w-0 flex-1 truncate">
					{`${plural(records, "record")} ${records === 1 ? "has" : "have"} characters the fonts can't draw: `}
					<span className="text-fc-text">
						{chars.map((cp) => String.fromCodePoint(cp)).join(" ")}
						{codepoints.length > chars.length ? " …" : ""}
					</span>
				</span>
			</RACButton>
			{open ? (
				<ul
					className="m-0 max-h-40 list-none overflow-auto px-3 pb-1.5"
					data-testid="export-missing-glyphs-list"
				>
					{issues.map((issue, i) => (
						<li
							// biome-ignore lint/suspicious/noArrayIndexKey: issues are a fixed snapshot
							key={i}
							className="flex min-w-0 items-baseline gap-2 py-0.5"
						>
							<RACButton
								onPress={() => onPick?.(issue.recordId)}
								isDisabled={!onPick}
								className="max-w-40 shrink-0 cursor-default truncate text-left text-fc-text outline-none data-hovered:underline data-focus-visible:outline-solid data-focus-visible:outline-1 data-focus-visible:outline-fc-accent"
							>
								{labelFor(issue.recordId)}
							</RACButton>
							<span className="shrink-0 font-fc-mono text-fc-muted text-[11px]">
								{[showSide ? issue.side : null, issue.elementId]
									.filter(Boolean)
									.join(" · ")}
							</span>
							<span className="min-w-0 truncate text-fc-muted">
								{issue.codepoints
									.map(
										(cp) => `${String.fromCodePoint(cp)} ${codepointLabel(cp)}`,
									)
									.join(", ")}
							</span>
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}
