import { Button } from "@freshcoat-js/ui/button";
import { Dialog } from "@freshcoat-js/ui/dialog";
import { DialogTrigger, Popover } from "@freshcoat-js/ui/popover";
import { useState, useSyncExternalStore } from "react";
import { Button as RACButton } from "react-aria-components";
import { autosavePaused, subscribeAutosavePaused } from "~/app/autosave";
import { discardUnreadableAutosave, retryAutosaveRead } from "~/app/controller";
import { AUTOSAVE_COPY } from "~/app/copy";
import WarnIcon from "~icons/mingcute/warning-line";
import { STATUS_PRIORITY } from "./priority";
import type { StatusItem } from "./types";

export function useAutosavePaused(): boolean {
	return useSyncExternalStore(
		subscribeAutosavePaused,
		autosavePaused,
		autosavePaused,
	);
}

/** Shown while autosave holds back writes because the stored autosave
 *  couldn't be read, with Retry and Discard old autosave. */
export function AutosavePaused() {
	const paused = useAutosavePaused();
	const [open, setOpen] = useState(false);
	if (!paused) return null;
	return (
		<DialogTrigger isOpen={open} onOpenChange={setOpen}>
			<RACButton
				data-testid="autosave-paused"
				className="flex h-6 shrink-0 cursor-default items-center gap-1 rounded-[3px] px-1.5 pointer-coarse:h-8 text-fc-danger text-fc-sm outline-none data-focus-visible:outline-solid data-focus-visible:outline-1 data-focus-visible:outline-fc-accent data-hovered:bg-fc-hover"
			>
				<WarnIcon aria-hidden="true" className="size-3.5" />
				{AUTOSAVE_COPY.paused}
			</RACButton>
			<Popover
				placement="top end"
				className="flex w-72 max-w-[calc(100vw-1rem)] flex-col"
			>
				<Dialog
					data-testid="autosave-paused-popover"
					title={AUTOSAVE_COPY.paused}
					footer={({ close }) => (
						<>
							<Button
								size="sm"
								onPress={() => {
									close();
									void discardUnreadableAutosave();
								}}
							>
								{AUTOSAVE_COPY.discard}
							</Button>
							<Button
								size="sm"
								variant="primary"
								onPress={() => {
									close();
									void retryAutosaveRead();
								}}
							>
								{AUTOSAVE_COPY.retry}
							</Button>
						</>
					)}
				>
					<p className="m-0 text-fc-sm text-fc-text leading-snug">
						{AUTOSAVE_COPY.pausedDetail}
					</p>
				</Dialog>
			</Popover>
		</DialogTrigger>
	);
}

export const AUTOSAVE_ITEM: StatusItem = {
	id: "autosave",
	name: "Autosave",
	pinned: true,
	sections: "all",
	align: "end",
	priority: STATUS_PRIORITY.autosave,
	component: AutosavePaused,
};
