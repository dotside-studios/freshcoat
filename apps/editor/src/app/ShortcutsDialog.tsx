import { Dialog, Modal } from "@freshcoat-js/ui/dialog";
import { Kbd } from "@freshcoat-js/ui/kbd";
import { COMMANDS } from "./commands";

const GROUPS = [
	"File",
	"Edit",
	"Data",
	"Object",
	"Arrange",
	"Tools",
	"View",
	"Help",
];

export function ShortcutsDialog({
	isOpen,
	onOpenChange,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Modal isOpen={isOpen} onOpenChange={onOpenChange} width="max-w-3xl">
			<Dialog title="Keyboard shortcuts" bodyClassName="p-4">
				<div className="columns-1 gap-6 sm:columns-2 lg:columns-3">
					{GROUPS.map((group) => {
						const items = COMMANDS.filter((c) => c.group === group && c.keys);
						if (items.length === 0) return null;
						return (
							<section key={group} className="mb-4 break-inside-avoid">
								<h3 className="mb-1.5 font-semibold text-fc-muted text-fc-xs uppercase tracking-wider">
									{group}
								</h3>
								<ul className="space-y-1">
									{items.map((c) => (
										<li
											key={c.id}
											className="flex items-center justify-between gap-3"
										>
											<span className="truncate">{c.label}</span>
											<Kbd shortcut={(c.keys as string[])[0] as string} />
										</li>
									))}
									{group === "Edit" ? (
										<li className="flex items-center justify-between gap-3">
											<span className="truncate">Nudge (×10 with Shift)</span>
											<Kbd shortcut="ArrowUp" />
										</li>
									) : null}
								</ul>
							</section>
						);
					})}
				</div>
			</Dialog>
		</Modal>
	);
}
