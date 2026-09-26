/** Shared class recipes. Kept as strings so tailwind's scanner sees them. */

export const popoverSurface =
	"rounded-md border border-fc-border-strong bg-fc-popover text-fc-text shadow-(--shadow-fc-popover) outline-none";

export const listBox =
	"flex max-h-[inherit] flex-col overflow-auto p-1 outline-none";

export const listItem =
	"group/item relative flex h-fc-control shrink-0 cursor-default select-none items-center gap-2 rounded-[3px] pr-2 pl-1.5 text-fc-base text-fc-text outline-none data-disabled:text-fc-faint data-focused:bg-fc-accent data-focused:text-white data-focus-visible:outline-none";

export const fieldSurface =
	"rounded-[3px] border border-transparent bg-fc-raised text-fc-base text-fc-text data-hovered:border-fc-border-strong data-disabled:opacity-50";

export const fieldLabel = "text-fc-sm text-fc-muted";
