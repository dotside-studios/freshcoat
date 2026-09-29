import { type LayerGeometry, layerBounds, unionRects } from "~/doc/geometry";

/** Thickness of each ruler, in screen px. */
export const RULER_SIZE = 20;

const MIN_LABEL_GAP = 56;
const MIN_TICK_GAP = 5;

export type Tick = {
	/** Screen position along the ruler, relative to the viewport. */
	at: number;
	/** Design px. */
	value: number;
	major: boolean;
};

/** The smallest 1, 2 or 5 × 10ⁿ design-px step that keeps labels apart. */
export function majorStep(zoom: number): number {
	const want = MIN_LABEL_GAP / zoom;
	let base = 10 ** Math.floor(Math.log10(want));
	for (;;) {
		for (const m of [1, 2, 5]) if (base * m >= want) return base * m;
		base *= 10;
	}
}

/** Ticks for a ruler `length` screen px long whose design origin sits at
 *  screen `origin`. */
export function rulerTicks(
	origin: number,
	zoom: number,
	length: number,
): Tick[] {
	const step = majorStep(zoom);
	const parts =
		(step / 10) * zoom >= MIN_TICK_GAP
			? 10
			: (step / 5) * zoom >= MIN_TICK_GAP
				? 5
				: (step / 2) * zoom >= MIN_TICK_GAP
					? 2
					: 1;
	const minor = step / parts;
	const first = Math.floor(-origin / zoom / minor);
	const last = Math.ceil((length - origin) / zoom / minor);
	const out: Tick[] = [];
	for (let i = first; i <= last; i++) {
		const value = roundValue(i * minor);
		out.push({ at: origin + value * zoom, value, major: i % parts === 0 });
	}
	return out;
}

/** A tick value as a ruler label. */
export function rulerLabel(value: number): string {
	return String(roundValue(value));
}

function roundValue(n: number): number {
	const r = Math.round(n * 1000) / 1000;
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
