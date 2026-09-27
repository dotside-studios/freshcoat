import { inputBase } from "@freshcoat-js/ui/field";
import { cn } from "@freshcoat-js/ui/lib/cn";
import { useEffect, useRef } from "react";

/**
 * An inline name field. Enter commits (it stays open when `onCommit` returns
 * false, so a refused name can be corrected), Escape cancels, and leaving the
 * field commits or, when refused, cancels.
 */
export function RenameInput({
	initial,
	label,
	onCommit,
	onDone,
	className,
}: {
	initial: string;
	label: string;
	onCommit: (value: string) => boolean;
	onDone: () => void;
	className?: string;
}) {
	const ref = useRef<HTMLInputElement>(null);
	const settled = useRef(false);

	useEffect(() => {
		// Focus once the menu or the double-click that opened it has let go.
		const id = requestAnimationFrame(() => {
			ref.current?.focus();
			ref.current?.select();
		});
		return () => cancelAnimationFrame(id);
	}, []);

	const finish = (commit: boolean) => {
		if (settled.current) return;
		const value = ref.current?.value ?? initial;
		if (commit && value !== initial && !onCommit(value)) return;
		settled.current = true;
		onDone();
	};

	return (
		<input
			ref={ref}
			aria-label={label}
			defaultValue={initial}
			spellCheck={false}
			className={cn(
				inputBase,
				"h-[calc(100%-4px)] border-fc-accent py-0 data-hovered:border-fc-accent",
				className,
			)}
			onKeyDown={(e) => {
				// The tree and list would otherwise take arrows, Home/End and typeahead.
				e.stopPropagation();
				if (e.key === "Enter") {
					e.preventDefault();
					finish(true);
				} else if (e.key === "Escape") {
					e.preventDefault();
					finish(false);
				}
			}}
			onKeyUp={(e) => e.stopPropagation()}
			// A list or tree that saw focus arrive would move it to the item.
			onFocus={(e) => e.stopPropagation()}
			onPointerDown={(e) => e.stopPropagation()}
			onMouseDown={(e) => e.stopPropagation()}
			onClick={(e) => e.stopPropagation()}
			onDoubleClick={(e) => e.stopPropagation()}
			onDragStart={(e) => {
				e.preventDefault();
				e.stopPropagation();
			}}
			onBlur={() => {
				if (settled.current) return;
				const value = ref.current?.value ?? initial;
				if (value !== initial) onCommit(value);
				settled.current = true;
				onDone();
			}}
		/>
	);
}
