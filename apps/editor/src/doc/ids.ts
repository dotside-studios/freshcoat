import type { Element, Template } from "@freshcoat-js/coatfile";
import { childEntries, walkLayers } from "./path";

/** Every id on a side at any depth, the background's included. */
export function collectIds(t: Template, side: number): Set<string> {
	const out = new Set<string>();
	for (const entry of walkLayers(t, side)) out.add(entry.element.id);
	return out;
}

/**
 * `base` when no layer on the side uses it, else `base-2`, `base-3`, and so on.
 * A base that already ends in `-<n>` counts on from its stem, so a copy of
 * `title-2` is `title-3` rather than `title-2-2`. `taken` adds ids reserved by
 * the caller (layers about to be inserted alongside).
 */
export function uniqueId(
	t: Template,
	side: number,
	base: string,
	taken?: ReadonlySet<string>,
): string {
	return nextFreeId(collectIds(t, side), base, taken);
}

export function nextFreeId(
	used: ReadonlySet<string>,
	base: string,
	taken?: ReadonlySet<string>,
): string {
	const clean = base.trim() || "layer";
	const isFree = (id: string) => !used.has(id) && !taken?.has(id);
	if (isFree(clean)) return clean;
	const m = /^(.*)-(\d+)$/.exec(clean);
	const stem = m?.[1] ? m[1] : clean;
	let n = m?.[1] ? Number(m[2]) + 1 : 2;
	while (!isFree(`${stem}-${n}`)) n++;
	return `${stem}-${n}`;
}

/** Gives `el` and everything nested in it ids unused in `used`, adding each
 *  one it picks to `used`. Unchanged subtrees are returned as they are. */
export function uniquifyTree(el: Element, used: Set<string>): Element {
	const id = nextFreeId(used, el.id);
	used.add(id);
	let next: Element = id === el.id ? el : { ...el, id };
	if (next.type === "frame" || next.type === "mask") {
		const entries = childEntries(next).map(
			([i, c]) => [i, uniquifyTree(c, used)] as const,
		);
		const changed = entries.some(([i, c]) =>
			i === -1
				? c !== (next as Extract<Element, { type: "mask" }>).properties.mask
				: c !==
					(next as Extract<Element, { type: "frame" | "mask" }>).properties
						.children[i],
		);
		if (changed) {
			const children = entries.filter(([i]) => i !== -1).map(([, c]) => c);
			const mask = entries.find(([i]) => i === -1)?.[1];
			next = {
				...next,
				properties: {
					...next.properties,
					children,
					...(mask ? { mask } : {}),
				},
			} as Element;
		}
	}
	return next;
}
