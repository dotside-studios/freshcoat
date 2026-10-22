import { Button } from "@freshcoat-js/ui/button";
import { Dialog } from "@freshcoat-js/ui/dialog";
import { DialogTrigger, Popover } from "@freshcoat-js/ui/popover";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button as RACButton } from "react-aria-components";
import { createPortal } from "react-dom";
import {
	type AutosavePause,
	autosavePaused,
	subscribeAutosavePaused,
} from "~/app/autosave";
import { discardUnreadableAutosave, retryAutosaveRead } from "~/app/controller";
import { AUTOSAVE_COPY } from "~/app/copy";
import WarnIcon from "~icons/mingcute/warning-line";
import { STATUS_PRIORITY } from "./priority";
import type { StatusItem } from "./types";

export function useAutosavePaused(): AutosavePause | null {
	return useSyncExternalStore(
		subscribeAutosavePaused,
		autosavePaused,
		autosavePaused,
	);
}

/** Shown while autosave holds back writes, with Retry, and Discard old
 *  autosave when the stored one couldn't be read. An autosave from a newer
 *  version is never discarded: only that version can open it. */
export function AutosavePaused() {
	const paused = useAutosavePaused();
	const [open, setOpen] = useState(false);
	const bar = useRef<HTMLElement | null>(null);
	const acted = useRef(false);
	const detail =
		paused === "newer"
			? AUTOSAVE_COPY.pausedNewerDetail
			: AUTOSAVE_COPY.pausedDetail;

	useEffect(() => {
		if (paused || !acted.current) return;
		acted.current = false;
		const active = document.activeElement;
		if (active && active !== document.body) return;
		bar.current?.focus();
	}, [paused]);

	const live = createPortal(
		<output className="sr-only" data-testid="autosave-paused-live">
			{paused ? `${AUTOSAVE_COPY.paused}. ${detail}` : ""}
		</output>,
		document.body,
	);
	return (
		<>
			{live}
			{paused && (
				<DialogTrigger isOpen={open} onOpenChange={setOpen}>
					<RACButton
						ref={(el) => {
							if (el) bar.current = el.closest("footer");
						}}
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
									{paused === "failed" && (
										<Button
											size="sm"
											onPress={() => {
												acted.current = true;
												close();
												void discardUnreadableAutosave();
											}}
										>
											{AUTOSAVE_COPY.discard}
										</Button>
									)}
									<Button
										size="sm"
										variant="primary"
										onPress={() => {
											acted.current = true;
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
								{detail}
							</p>
						</Dialog>
					</Popover>
				</DialogTrigger>
			)}
		</>
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
