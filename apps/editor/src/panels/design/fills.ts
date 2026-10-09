import type { Fill } from "@freshcoat-js/coatfile";
import { isGradient } from "@freshcoat-js/coatfile/fills";

export const DEFAULT_FILL_COLOR = "#d9d9d9";

export function replaceAt<T>(list: readonly T[], i: number, value: T): T[] {
	return list.map((x, j) => (j === i ? value : x));
}

export function removeAt<T>(list: readonly T[], i: number): T[] {
	return list.filter((_, j) => j !== i);
}

/** Which fill the gradient handles edit: the one last opened in the
 *  inspector when it is still a gradient, else the topmost gradient. */
export function editedGradient(
	fills: readonly Fill[],
	active: number | null,
): number | null {
	if (active !== null && isGradient(fills[active])) return active;
	for (let i = fills.length - 1; i >= 0; i--)
		if (isGradient(fills[i])) return i;
	return null;
}
