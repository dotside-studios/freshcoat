// Reading and editing the fills a layer paints. Text paints one fill, its
// solid `color` or its gradient `fill`; shapes, frames and backgrounds paint
// `fill` as one value or a list, bottom first.

import {
	linearGradientAngle,
	linearGradientPoints,
	PATTERN_DEFAULTS,
	parseColor,
	toHex,
} from "@freshcoat-js/engine";
import type {
	Background,
	Element,
	Fill,
	Gradient,
	GradientStop,
} from "./types";

export type { Gradient, GradientStop } from "./types";

export type FillKind = "solid" | "linear" | "radial" | "angular" | "pattern";
export type PatternFill = Extract<Fill, { kind: "pattern" }>;
export type PatternName = PatternFill["pattern"];
export type LinearGradient = Extract<Gradient, { kind: "linear" }>;

type Layer = Element | Background;
type Point = [number, number];

const NO_COLOR = "#d9d9d9";

export function isGradient(f: Fill | undefined): f is Gradient {
	return typeof f === "object" && f.kind !== "pattern";
}

export function fillKind(f: Fill): FillKind {
	return typeof f === "string" ? "solid" : f.kind;
}

/** A pattern's parameters with its defaults filled in. */
export function patternParams(p: PatternFill) {
	const d = PATTERN_DEFAULTS[p.pattern];
	return {
		scale: p.scale ?? d.scale,
		angle: p.angle ?? d.angle,
		density: p.density ?? d.density,
		seed: p.seed ?? d.seed,
		colors: p.colors ?? d.colors,
	};
}

/** Whether the layer paints a fill list: shapes, frames, text, a rect background. */
export function hasFills(el: Layer): boolean {
	return (
		el.type === "rect" ||
		el.type === "vector" ||
		el.type === "frame" ||
		el.type === "text"
	);
}

/** The fills as a list, bottom first. Text has at most one: its gradient
 *  `fill`, else its solid `color`. */
export function fillsOf(el: Layer): Fill[] {
	if (el.type === "text") {
		const p = el.properties;
		if (p.fill !== undefined) return [p.fill];
		return p.color !== undefined ? [p.color] : [];
	}
	if (el.type === "rect" || el.type === "vector" || el.type === "frame") {
		const f = el.properties.fill;
		if (f === undefined) return [];
		return Array.isArray(f) ? f : [f];
	}
	return [];
}

/** The `properties` patch that writes `fills` back in the layer's shape. */
export function fillsPatch(el: Layer, fills: Fill[]): Record<string, unknown> {
	if (el.type === "text") {
		const f = fills[0];
		if (f === undefined) return { color: undefined, fill: undefined };
		if (typeof f === "string") return { color: f, fill: undefined };
		return { fill: f };
	}
	return {
		fill:
			fills.length === 0 ? undefined : fills.length === 1 ? fills[0] : fills,
	};
}

/** The colour a fill reads as at a glance: a solid, its first stop, or a
 *  pattern's background. */
export function leadColor(f: Fill): string {
	if (typeof f === "string") return f;
	if (f.kind === "pattern") return patternParams(f).colors[0];
	return f.stops[0]?.color ?? NO_COLOR;
}

function transparentOf(color: string): string {
	return /^#[0-9a-f]{6}$/i.test(color) ? `${color}00` : "#ffffff";
}

/** Converts a fill to another kind, keeping its colours. */
export function convertFill(f: Fill, kind: FillKind): Fill {
	if (fillKind(f) === kind) return f;
	if (kind === "solid") return leadColor(f);
	if (kind === "pattern")
		return {
			kind,
			pattern: "noise",
			colors: [leadColor(f), PATTERN_DEFAULTS.noise.colors[1]],
		};
	const stops: GradientStop[] =
		typeof f === "string"
			? [
					{ offset: 0, color: f },
					{ offset: 1, color: transparentOf(f) },
				]
			: f.kind === "pattern"
				? patternParams(f).colors.map((color, i) => ({ offset: i, color }))
				: f.stops;
	if (kind === "linear") return { kind, angle: 90, stops };
	if (kind === "radial")
		return { kind, center: [0.5, 0.5], radius: 0.5, stops };
	return { kind, center: [0.5, 0.5], stops };
}

/** A linear gradient's endpoints in box fractions: its own points, else the
 *  ones its `angle` resolves to. */
export function linearPoints(g: LinearGradient): { from: Point; to: Point } {
	if (g.from && g.to) return { from: g.from, to: g.to };
	return linearGradientPoints(g.angle);
}

export function withStops(g: Gradient, stops: GradientStop[]): Gradient {
	return { ...g, stops };
}

/** The stops ordered by offset; equal offsets keep their order. */
export function sortedStops(stops: readonly GradientStop[]): GradientStop[] {
	return stops
		.map((s, i) => ({ s, i }))
		.sort((a, b) => a.s.offset - b.s.offset || a.i - b.i)
		.map(({ s }) => s);
}

/** Adds a stop in the middle of the widest gap, in the lower stop's colour. */
export function addStop(stops: readonly GradientStop[]): GradientStop[] {
	const sorted = [...stops].sort((a, b) => a.offset - b.offset);
	let at = 0;
	let widest = -1;
	for (let i = 0; i < sorted.length - 1; i++) {
		const gap = sorted[i + 1].offset - sorted[i].offset;
		if (gap > widest) {
			widest = gap;
			at = i;
		}
	}
	const lo = sorted[at] ?? { offset: 0, color: NO_COLOR };
	const hi = sorted[at + 1] ?? { offset: 1, color: lo.color };
	const stop = {
		offset: Math.round(((lo.offset + hi.offset) / 2) * 1000) / 1000,
		color: lo.color,
	};
	return [...sorted.slice(0, at + 1), stop, ...sorted.slice(at + 1)];
}

/** Removes a stop; a gradient keeps at least two. */
export function removeStop(
	stops: readonly GradientStop[],
	i: number,
): GradientStop[] {
	return stops.length <= 2 ? [...stops] : stops.filter((_, j) => j !== i);
}

/** The colour the gradient paints at `offset`, blended in sRGB between the
 *  stops either side. A stop that is not a colour (a binding) is taken as it
 *  is from the nearer side. */
export function colorAt(stops: readonly GradientStop[], offset: number): string {
	const sorted = sortedStops(stops);
	const first = sorted[0];
	const last = sorted.at(-1);
	if (!first || !last) return NO_COLOR;
	if (offset <= first.offset) return first.color;
	if (offset >= last.offset) return last.color;
	const hi = sorted.findIndex((s) => s.offset >= offset);
	const b = sorted[hi] as GradientStop;
	const a = sorted[hi - 1] as GradientStop;
	const span = b.offset - a.offset;
	const t = span > 0 ? (offset - a.offset) / span : 0;
	const ca = parseColor(a.color);
	const cb = parseColor(b.color);
	if (!ca || !cb || ca === "none" || cb === "none")
		return t < 0.5 ? a.color : b.color;
	const hex = toHex([
		ca[0] + (cb[0] - ca[0]) * t,
		ca[1] + (cb[1] - ca[1]) * t,
		ca[2] + (cb[2] - ca[2]) * t,
		ca[3] + (cb[3] - ca[3]) * t,
	]);
	return hex.endsWith("ff") ? hex.slice(0, 7) : hex;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Adds a stop at `offset`, coloured as the gradient already is there.
 *  Returns the stops in order and the new stop's index. */
export function insertStop(
	stops: readonly GradientStop[],
	offset: number,
): { stops: GradientStop[]; index: number } {
	const at = round3(clamp01(offset));
	const stop = { offset: at, color: colorAt(stops, at) };
	const next = sortedStops([...stops, stop]);
	return { stops: next, index: next.indexOf(stop) };
}

/** Moves stop `i` to `offset`, keeping the list in order so the painter
 *  sees rising offsets. Returns the moved stop's new index. */
export function moveStop(
	stops: readonly GradientStop[],
	i: number,
	offset: number,
): { stops: GradientStop[]; index: number } {
	const s = stops[i];
	if (!s) return { stops: [...stops], index: i };
	const moved = { ...s, offset: round3(clamp01(offset)) };
	const next = sortedStops(stops.map((x, j) => (j === i ? moved : x)));
	return { stops: next, index: next.indexOf(moved) };
}

/** The same colours in the opposite direction. */
export function reverseStops(stops: readonly GradientStop[]): GradientStop[] {
	return sortedStops(
		stops.map((s) => ({ ...s, offset: round3(1 - s.offset) })),
	);
}

/** A gradient turned a quarter clockwise: a linear one's angle, and its
 *  points about the box centre when it has them. */
export function rotateQuarter(g: Gradient): Gradient {
	if (g.kind !== "linear") return g;
	const angle = (g.angle + 90) % 360;
	if (!g.from || !g.to) return { ...g, angle };
	const turn = ([x, y]: Point): Point => [
		round3(0.5 - (y - 0.5)),
		round3(0.5 + (x - 0.5)),
	];
	const from = turn(g.from);
	const to = turn(g.to);
	return { ...g, from, to, angle: linearGradientAngle(from, to) };
}

/** A linear gradient pointed along `angle`. Points it has turn about their
 *  midpoint and keep their length, in box space as `angle` is. */
export function withLinearAngle(g: LinearGradient, angle: number): Gradient {
	if (!g.from || !g.to) return { ...g, angle };
	const mx = (g.from[0] + g.to[0]) / 2;
	const my = (g.from[1] + g.to[1]) / 2;
	const half = Math.hypot(g.to[0] - g.from[0], g.to[1] - g.from[1]) / 2;
	const r = (angle * Math.PI) / 180;
	const dx = Math.cos(r) * half;
	const dy = Math.sin(r) * half;
	return { ...g, angle, from: [mx - dx, my - dy], to: [mx + dx, my + dy] };
}
