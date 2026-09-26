import type { HTMLAttributes } from "react";
import { cn } from "./lib/cn";

export const isMac =
	typeof navigator !== "undefined" &&
	/Mac|iPhone|iPad|iPod/.test(
		// biome-ignore lint/suspicious/noExplicitAny: userAgentData is not in the DOM lib yet
		(navigator as any).userAgentData?.platform ?? navigator.platform ?? "",
	);

const macGlyphs: Record<string, string> = {
	mod: "⌘",
	cmd: "⌘",
	meta: "⌘",
	ctrl: "⌃",
	control: "⌃",
	shift: "⇧",
	alt: "⌥",
	option: "⌥",
	enter: "↩",
	return: "↩",
	backspace: "⌫",
	delete: "⌫",
	escape: "Esc",
	esc: "Esc",
	tab: "⇥",
	up: "↑",
	arrowup: "↑",
	down: "↓",
	arrowdown: "↓",
	left: "←",
	arrowleft: "←",
	right: "→",
	arrowright: "→",
	space: "Space",
};

const otherNames: Record<string, string> = {
	mod: "Ctrl",
	cmd: "Ctrl",
	meta: "Win",
	ctrl: "Ctrl",
	control: "Ctrl",
	shift: "Shift",
	alt: "Alt",
	option: "Alt",
	enter: "Enter",
	return: "Enter",
	backspace: "Backspace",
	delete: "Del",
	escape: "Esc",
	esc: "Esc",
	tab: "Tab",
	up: "↑",
	arrowup: "↑",
	down: "↓",
	arrowdown: "↓",
	left: "←",
	arrowleft: "←",
	right: "→",
	arrowright: "→",
	space: "Space",
};

/**
 * Formats "Mod+Shift+Z" for the platform: "⌘⇧Z" on a Mac, "Ctrl+Shift+Z"
 * elsewhere. `Mod` is ⌘ on a Mac and Ctrl elsewhere.
 */
export function formatShortcut(shortcut: string, mac = isMac): string {
	// Split on "+" but keep a literal "+" key ("Mod++", "+").
	const parts = shortcut.split(/\+(?!$)/).filter(Boolean);
	const names = mac ? macGlyphs : otherNames;
	const keys = parts.map((p) => {
		const known = names[p.toLowerCase()];
		if (known) return known;
		return p.length === 1 ? p.toUpperCase() : p;
	});
	return mac ? keys.join("") : keys.join("+");
}

export interface KbdProps extends HTMLAttributes<HTMLElement> {
	/** e.g. "Mod+Shift+Z". */
	shortcut: string;
}

export function Kbd({ shortcut, className, ...props }: KbdProps) {
	return (
		<kbd
			{...props}
			className={cn(
				"inline-flex h-4 min-w-4 items-center justify-center rounded-[3px] border border-fc-border-strong bg-fc-app px-1 font-fc text-fc-muted text-fc-xs leading-none tracking-wide shadow-(--shadow-fc-kbd)",
				className,
			)}
		>
			{formatShortcut(shortcut)}
		</kbd>
	);
}
