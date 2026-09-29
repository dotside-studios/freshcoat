import type { SideGuides, TemplateGuides } from "@freshcoat-js/workspace";

export type { SideGuides, TemplateGuides } from "@freshcoat-js/workspace";

export type GuideAxis = "x" | "y";

export const NO_GUIDES: TemplateGuides = Object.freeze({});

const EMPTY_SIDE: SideGuides = Object.freeze({ x: [], y: [] });

export function sideGuides(g: TemplateGuides, side: string): SideGuides {
	return g[side] ?? EMPTY_SIDE;
}

export function hasGuides(g: TemplateGuides | undefined): boolean {
	return !!g && Object.values(g).some((s) => s.x.length > 0 || s.y.length > 0);
}

function round(v: number): number {
	const r = Math.round(v * 100) / 100;
	return r === 0 ? 0 : r;
}

function withAxis(
	g: TemplateGuides,
	side: string,
	axis: GuideAxis,
	values: number[],
): TemplateGuides {
	const s = sideGuides(g, side);
	const next = { ...s, [axis]: values };
	if (next.x.length === 0 && next.y.length === 0) {
		const { [side]: _, ...rest } = g;
		return rest;
	}
	return { ...g, [side]: next };
}

/** Adds a guide; returns the guides and its index on that axis. */
export function addGuide(
	g: TemplateGuides,
	side: string,
	axis: GuideAxis,
	value: number,
): { guides: TemplateGuides; index: number } {
	const list = sideGuides(g, side)[axis];
	return {
		guides: withAxis(g, side, axis, [...list, round(value)]),
		index: list.length,
	};
}

export function moveGuide(
	g: TemplateGuides,
	side: string,
	axis: GuideAxis,
	index: number,
	value: number,
): TemplateGuides {
	const list = sideGuides(g, side)[axis];
	const v = round(value);
	if (index < 0 || index >= list.length || list[index] === v) return g;
	return withAxis(
		g,
		side,
		axis,
		list.map((old, i) => (i === index ? v : old)),
	);
}

export function removeGuide(
	g: TemplateGuides,
	side: string,
	axis: GuideAxis,
	index: number,
): TemplateGuides {
	const list = sideGuides(g, side)[axis];
	if (index < 0 || index >= list.length) return g;
	return withAxis(
		g,
		side,
		axis,
		list.filter((_, i) => i !== index),
	);
}

export function clearGuides(g: TemplateGuides, side: string): TemplateGuides {
	if (!g[side]) return g;
	const { [side]: _, ...rest } = g;
	return rest;
}

/** Guides follow their side when it is renamed, and go with it when it is
 *  removed. */
export function guidesForSides(
	g: TemplateGuides,
	before: readonly string[],
	after: readonly string[],
): TemplateGuides {
	if (!hasGuides(g)) return g;
	const renamed =
		before.length === after.length
			? before.flatMap((name, i) =>
					after[i] !== name && !before.includes(after[i] as string)
						? [[name, after[i] as string] as const]
						: [],
				)
			: [];
	let next = g;
	for (const [from, to] of renamed) {
		const s = next[from];
		if (!s) continue;
		const { [from]: _, ...rest } = next;
		next = { ...rest, [to]: s };
	}
	for (const name of Object.keys(next))
		if (!after.includes(name)) next = clearGuides(next, name);
	return next;
}
