import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

export type { ClassValue };

// The kit's `text-fc-*` sizes would otherwise be read as text colours and
// clobber `text-fc-muted` (and vice versa).
const twMerge = extendTailwindMerge({
	extend: {
		theme: {
			text: ["fc-xs", "fc-sm", "fc-base"],
			spacing: ["fc-control", "fc-icon"],
		},
	},
});

export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}
