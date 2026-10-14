import { Popover, type PopoverProps } from "@freshcoat-js/ui/popover";
import type { ReactNode } from "react";
import { Dialog, DialogTrigger } from "react-aria-components";

/** A titled panel that opens from `trigger`, a button. The content may take
 *  a function that gets `close`, for a link that should put the panel away. */
export function PopoverPanel({
	trigger,
	title,
	children,
	placement = "top end",
}: {
	trigger: ReactNode;
	title: string;
	children: ReactNode | ((close: () => void) => ReactNode);
	placement?: PopoverProps["placement"];
}) {
	return (
		<DialogTrigger>
			{trigger}
			<Popover placement={placement} className="w-80 max-w-[90vw]">
				<Dialog aria-label={title} className="flex flex-col outline-none">
					{({ close }) => (
						<>
							<h2 className="m-0 flex h-7 shrink-0 items-center border-fc-border border-b px-2 font-semibold text-[10px] text-fc-muted uppercase tracking-[0.06em]">
								{title}
							</h2>
							{typeof children === "function" ? children(close) : children}
						</>
					)}
				</Dialog>
			</Popover>
		</DialogTrigger>
	);
}
