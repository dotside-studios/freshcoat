import { Dialog, Modal } from "@freshcoat-js/ui/dialog";
import { TextField } from "@freshcoat-js/ui/field";
import { formatShortcut, Kbd } from "@freshcoat-js/ui/kbd";
import { useState } from "react";
import { COMMANDS } from "./commands";

const GROUPS = [
	"File",
	"Edit",
	"Data",
	"Object",
	"Arrange",
	"Tools",
	"Canvas",
	"View",
	"Help",
];

type Entry = {
	id: string;
	label: string;
	shortcut: string;
	/** A pointer gesture made while holding `shortcut`. */
	gesture?: "drag" | "click";
};

/** Keys and gestures the editor handles outside its commands. */
const EXTRAS: Record<string, Entry[]> = {
	Edit: [{ id: "nudge", label: "Nudge (×10 with Shift)", shortcut: "ArrowUp" }],
	Tools: [
		{ id: "finish-path", label: "Finish path", shortcut: "Enter" },
		{ id: "remove-point", label: "Remove last point", shortcut: "Backspace" },
	],
	Canvas: [
		{ id: "pan", label: "Pan", shortcut: "Space", gesture: "drag" },
		{
			id: "no-snap",
			label: "Drag without snapping",
			shortcut: "Mod",
			gesture: "drag",
		},
		{
			id: "deep",
			label: "Select inside groups",
			shortcut: "Mod",
			gesture: "click",
		},
		{
			id: "axis",
			label: "Lock to one axis",
			shortcut: "Shift",
			gesture: "drag",
		},
		{
			id: "draw-center",
			label: "Draw from the center",
			shortcut: "Alt",
			gesture: "drag",
		},
		{
			id: "resize-center",
			label: "Resize from the center",
			shortcut: "Alt",
			gesture: "drag",
		},
		{
			id: "duplicate",
			label: "Duplicate while moving",
			shortcut: "Alt",
			gesture: "drag",
		},
		{ id: "rename", label: "Rename layer", shortcut: "F2" },
		{ id: "end-text", label: "Finish editing text", shortcut: "Mod+Enter" },
	],
};

function entriesOf(group: string): Entry[] {
	return [
		...COMMANDS.filter((c) => c.group === group && c.keys).map((c) => ({
			id: c.id,
			label: c.label,
			shortcut: (c.keys as string[])[0] as string,
		})),
		...(EXTRAS[group] ?? []),
	];
}

function matches(group: string, e: Entry, query: string): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return true;
	return [
		group,
		e.label,
		e.shortcut,
		formatShortcut(e.shortcut),
		e.gesture ?? "",
	].some((s) => s.toLowerCase().includes(q));
}

export function ShortcutsDialog({
	isOpen,
	onOpenChange,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [query, setQuery] = useState("");
	const groups = GROUPS.map((group) => ({
		group,
		items: entriesOf(group).filter((e) => matches(group, e, query)),
	})).filter((g) => g.items.length > 0);

	return (
		<Modal
			isOpen={isOpen}
			onOpenChange={(open) => {
				if (!open) setQuery("");
				onOpenChange(open);
			}}
			width="max-w-3xl"
		>
			<Dialog title="Keyboard shortcuts" bodyClassName="p-4">
				<TextField
					aria-label="Filter shortcuts"
					placeholder="Filter"
					type="search"
					value={query}
					onChange={setQuery}
					className="mb-4 max-w-60"
				/>
				{groups.length === 0 ? (
					<p className="text-fc-faint text-fc-sm">No matching shortcuts</p>
				) : null}
				<div className="columns-1 gap-6 sm:columns-2 lg:columns-3">
					{groups.map(({ group, items }) => (
						<section key={group} className="mb-4 break-inside-avoid">
							<h3 className="mb-1.5 font-semibold text-fc-muted text-fc-xs uppercase tracking-wider">
								{group}
							</h3>
							<ul className="space-y-1">
								{items.map((e) => (
									<li
										key={e.id}
										className="flex items-center justify-between gap-3"
									>
										<span className="truncate">{e.label}</span>
										<span className="flex shrink-0 items-center gap-1">
											<Kbd shortcut={e.shortcut} />
											{e.gesture ? (
												<span className="text-fc-muted text-fc-xs">
													{e.gesture}
												</span>
											) : null}
										</span>
									</li>
								))}
							</ul>
						</section>
					))}
				</div>
			</Dialog>
		</Modal>
	);
}
