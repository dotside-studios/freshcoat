import type { Template } from "@freshcoat-js/coatfile";
import type { ParentRef } from "~/doc/ops";
import {
	childEntries,
	compareKeys,
	getElement,
	isAncestor,
	isBackgroundPath,
	isContainer,
	MASK_SOURCE,
	parentKeyOf,
	parseKey,
} from "~/doc/path";

export type DropPosition = "before" | "after" | "on";

export type DropMove = {
	/** The layers to move, outermost only, in paint order. */
	keys: string[];
	parent: ParentRef;
	/** For `moveElements`: an index into the parent's list as it reads before the move. */
	index: number;
};

export function isMaskSource(key: string): boolean {
	const p = parseKey(key);
	return !!p && !isBackgroundPath(p) && p.path.at(-1) === MASK_SOURCE;
}

export function isBackgroundKey(key: string): boolean {
	const p = parseKey(key);
	return !!p && isBackgroundPath(p);
}

function childCount(t: Template, parent: string | null, side: number): number {
	if (parent === null) return t.template_data[side]?.elements.length ?? 0;
	const el = getElement(t, parent);
	return el ? childEntries(el).filter(([i]) => i !== MASK_SOURCE).length : 0;
}

/**
 * Maps a drop in the layers tree to a `moveElements` call, or null when the
 * drop is not allowed or would change nothing.
 *
 * The tree lists each stack topmost first, so a row shown above another is
 * painted over it: "before" a row is the paint index above it (i + 1) and
 * "after" is its own index. "On" a frame or mask makes the layers its topmost
 * children. The background row only takes a drop before it (the bottom of the
 * side), and a mask's source takes none.
 */
export function dropToMove(
	t: Template,
	dragged: Iterable<string>,
	targetKey: string,
	position: DropPosition,
): DropMove | null {
	const target = parseKey(targetKey);
	if (!target || !getElement(t, target)) return null;
	const all = [...new Set(dragged)];
	if (all.length === 0) return null;
	for (const k of all) {
		const p = parseKey(k);
		if (!p || isBackgroundPath(p) || isMaskSource(k) || !getElement(t, p))
			return null;
		if (p.side !== target.side) return null;
	}
	const keys = all
		.filter((k) => !all.some((o) => o !== k && isAncestor(o, k)))
		.sort(compareKeys);
	if (isMaskSource(targetKey)) return null;

	let parentKey: string | null;
	let index: number;
	if (isBackgroundPath(target)) {
		if (position !== "before") return null;
		parentKey = null;
		index = 0;
	} else if (position === "on") {
		if (!isContainer(getElement(t, target))) return null;
		parentKey = targetKey;
		index = childCount(t, targetKey, target.side);
	} else {
		parentKey = parentKeyOf(targetKey);
		const i = target.path.at(-1) as number;
		index = position === "before" ? i + 1 : i;
	}

	if (
		parentKey !== null &&
		keys.some((k) => k === parentKey || isAncestor(k, parentKey as string))
	)
		return null;

	if (isNoop(keys, parentKey, index)) return null;
	return {
		keys,
		parent: parentKey ?? { side: target.side },
		index,
	};
}

// Layers already forming one run in the target list, dropped at either edge
// of that run or inside it, stay where they are.
function isNoop(keys: string[], parent: string | null, index: number): boolean {
	if (keys.some((k) => parentKeyOf(k) !== parent)) return false;
	const idx = keys
		.map((k) => (parseKey(k) as { path: number[] }).path.at(-1) as number)
		.sort((a, b) => a - b);
	const lo = idx[0] as number;
	const hi = idx.at(-1) as number;
	if (hi - lo + 1 !== idx.length) return false;
	return index >= lo && index <= hi + 1;
}
