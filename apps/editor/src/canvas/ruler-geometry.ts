import type { LengthUnit } from "@freshcoat-js/coatfile";
import { type LayerGeometry, layerBounds, unionRects } from "~/doc/geometry";

/** Thickness of each ruler, in screen px. */
export const RULER_SIZE = 20;

const MIN_LABEL_GAP = 56;
const MIN_TICK_GAP = 5;

export type Tick = {
	/** Screen position along the ruler, relative to the viewport. */
	at: number;
	/** In the ruler's unit. */
	value: number;
	major: boolean;
};

/** Inches step in halves down to 1/16; other units step 1, 2, 5 × 10ⁿ. */
const BINARY_UNITS: ReadonlySet<LengthUnit> = new Set(["in"]);

/** The smallest step, in units, that keeps labels apart when one unit is
 *  `scale` screen px long. */
export function majorStep(scale: number, unit: LengthUnit = "px"): number {
	const want = MIN_LABEL_GAP / scale;
	if (BINARY_UNITS.has(unit) && want < 1) {
		let step = 1 / 16;
		while (step < want) step *= 2;
		return step;
	}
	let base = 10 ** Math.floor(Math.log10(want));
	for (;;) {
		for (const m of [1, 2, 5]) if (base * m >= want) return base * m;
		base *= 10;
	}
}

function subdivisions(step: number, scale: number, unit: LengthUnit): number {
	const halving = BINARY_UNITS.has(unit) && Number.isInteger(Math.log2(step));
	for (const parts of halving ? [8, 4, 2] : [10, 5, 2])
		if ((step / parts) * scale >= MIN_TICK_GAP) return parts;
	return 1;
}

/** Ticks for a ruler `length` screen px long whose design origin sits at
 *  screen `origin`, with one `unit` `pxPerUnit` design px long. */
export function rulerTicks(
	origin: number,
	zoom: number,
	length: number,
	unit: LengthUnit = "px",
	pxPerUnit = 1,
): Tick[] {
	const scale = zoom * pxPerUnit;
	const step = majorStep(scale, unit);
	const parts = subdivisions(step, scale, unit);
	const minor = step / parts;
	const first = Math.floor(-origin / scale / minor);
	const last = Math.ceil((length - origin) / scale / minor);
	const out: Tick[] = [];
	for (let i = first; i <= last; i++) {
		const value = roundValue(i * minor);
		out.push({ at: origin + value * scale, value, major: i % parts === 0 });
	}
	return out;
}

/** A tick value as a ruler label. */
export function rulerLabel(value: number): string {
	return String(roundValue(value));
}

function roundValue(n: number): number {
	const r = Math.round(n * 10000) / 10000;
	return r === 0 ? 0 : r;
}

/** The painted extent of the selection, in design px, or null. */
export function selectionExtent(
	selection: readonly string[],
	geometry: LayerGeometry,
): { x: [number, number]; y: [number, number] } | null {
	const rects = selection
		.map((k) => layerBounds(k, geometry))
		.filter((r) => r !== undefined);
	if (rects.length === 0) return null;
	const b = unionRects(rects);
	return { x: [b.x, b.x + b.width], y: [b.y, b.y + b.height] };
}
