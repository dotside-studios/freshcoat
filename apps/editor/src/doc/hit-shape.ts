import {
	type Element,
	isEllipsePath,
	resolveStrokeTrim,
} from "@freshcoat-js/coatfile";
import {
	outlinePath,
	rectShape,
	type ShapeMask,
	type StrokeTrim,
	strokeInset,
	strokeTrim,
	trimPath,
} from "@freshcoat-js/engine";
import type { CanvasKit, Path } from "canvaskit-wasm";
import type { LayerBox, Point } from "./geometry";

type ShapeElement = Extract<Element, { type: "rect" | "vector" }>;
type Stroke = NonNullable<ShapeElement["properties"]["stroke"]>;

type Entry = {
	el: Element;
	width: number;
	height: number;
	trim: string;
	outline: Path | null;
	paintsFill: boolean;
	/** The path the stroke outlines: `outline`, or an offset copy of it. */
	strokeBase: Path | null;
	strokeWidth: number;
	clip: "inside" | "outside" | null;
	tolerance: number;
	stroke: Path | null;
};

export const MAX_ENTRIES = 512;

const TOLERANCE_STEPS = 4;

const CAP = { butt: "Butt", round: "Round", square: "Square" } as const;
const JOIN = { miter: "Miter", round: "Round", bevel: "Bevel" } as const;

export function isShapeElement(el: Element): el is ShapeElement {
	return el.type === "rect" || el.type === "vector";
}

/**
 * How far past its box a shape can be hit: the stroke's outward extent plus
 * `tolerance`. Vector miter joins and square caps use Skia's fast bound.
 */
export function hitReach(el: Element, tolerance = 0): number {
	if (!isShapeElement(el)) return 0;
	const stroke = el.properties.stroke;
	if (!stroke || stroke.width <= 0) return tolerance;
	const outward = stroke.width / 2 - strokeInset(stroke);
	if (el.type === "rect") return outward + tolerance;
	let multiplier = 1;
	if ((stroke.join ?? "miter") === "miter") multiplier = 4;
	if (stroke.cap === "square") multiplier = Math.max(multiplier, Math.SQRT2);
	return outward * multiplier + tolerance;
}

/** `point` in the box's own unrotated space, origin at its top left. */
export function localPoint(box: LayerBox, point: Point): Point {
	const { x, y, width, height } = box.rect;
	const cx = x + width / 2;
	const cy = y + height / 2;
	const rad = (-box.worldRotation * Math.PI) / 180;
	const dx = point.x - cx;
	const dy = point.y - cy;
	return {
		x: dx * Math.cos(rad) - dy * Math.sin(rad) + width / 2,
		y: dx * Math.sin(rad) + dy * Math.cos(rad) + height / 2,
	};
}

/** `tolerance` rounded up to a quarter octave. */
export function toleranceBucket(tolerance: number): number {
	if (!(tolerance > 0)) return 0;
	return (
		2 ** (Math.ceil(Math.log2(tolerance) * TOLERANCE_STEPS) / TOLERANCE_STEPS)
	);
}

/**
 * Tests rects and vectors against the pixels they paint: the fill by its
 * outline and fill rule, the stroke by its trimmed, stroked outline grown by
 * `tolerance` on each side. A trim bound to a field reads it from `values`.
 * Outlines are cached per layer key until the element, its box or its trim
 * changes, stroked outlines until the tolerance bucket does too. The least
 * recently used key is evicted past `MAX_ENTRIES`.
 */
export class ShapeHits {
	private entries = new Map<string, Entry>();

	constructor(private ck: CanvasKit) {}

	hits(
		key: string,
		el: Element,
		box: LayerBox,
		point: Point,
		tolerance = 0,
		values: Record<string, unknown> = {},
	): boolean {
		if (!isShapeElement(el)) return true;
		const entry = this.entry(key, el, box, tolerance, values);
		if (!entry.outline) return true;
		const p = localPoint(box, point);
		if (entry.stroke?.contains(p.x, p.y)) {
			if (!entry.clip) return true;
			if ((entry.clip === "inside") === entry.outline.contains(p.x, p.y))
				return true;
		}
		return entry.paintsFill && entry.outline.contains(p.x, p.y);
	}

	clear(): void {
		for (const entry of this.entries.values()) release(entry);
		this.entries.clear();
	}

	private entry(
		key: string,
		el: ShapeElement,
		box: LayerBox,
		tolerance: number,
		values: Record<string, unknown>,
	): Entry {
		const { width, height } = box.rect;
		const stroke = el.properties.stroke;
		const trim = stroke ? strokeTrim(resolveStrokeTrim(stroke, values)) : null;
		let entry = this.entries.get(key);
		if (entry) {
			this.entries.delete(key);
			if (
				entry.el !== el ||
				entry.width !== width ||
				entry.height !== height ||
				entry.trim !== trimKey(trim)
			) {
				release(entry);
				entry = undefined;
			}
		}
		if (!entry) {
			for (const [oldest, old] of this.entries) {
				if (this.entries.size < MAX_ENTRIES) break;
				release(old);
				this.entries.delete(oldest);
			}
			entry = this.build(el, width, height, trim);
		}
		this.entries.set(key, entry);
		const bucket = toleranceBucket(tolerance);
		if (entry.strokeBase && entry.tolerance !== bucket) {
			entry.stroke?.delete();
			entry.stroke = this.stroke(
				entry.strokeBase,
				el.properties.stroke as Stroke,
				entry.strokeWidth + 2 * bucket,
			);
			entry.tolerance = bucket;
		}
		return entry;
	}

	private build(
		el: ShapeElement,
		width: number,
		height: number,
		trim: StrokeTrim | null,
	): Entry {
		const outline = this.outline(el, width, height);
		const stroke = el.properties.stroke;
		const stroked = stroke && stroke.width > 0;
		const fill = el.properties.fill;
		const hasFill = Array.isArray(fill) ? fill.length > 0 : fill !== undefined;
		const entry: Entry = {
			el,
			width,
			height,
			trim: trimKey(trim),
			outline,
			paintsFill: hasFill || !stroked,
			strokeBase: null,
			strokeWidth: 0,
			clip: null,
			tolerance: Number.NaN,
			stroke: null,
		};
		if (!outline || !stroke || !stroked) return entry;
		const inset = strokeInset(stroke);
		entry.strokeWidth = stroke.width;
		const shape = this.shape(el, trim);
		let base: Path = outline;
		if (shape && (inset !== 0 || trim)) {
			const offset = outlinePath(this.ck, shape, width, height, inset, !!trim);
			if (offset) base = offset;
		}
		if (base === outline && inset !== 0) {
			entry.strokeWidth = stroke.width * 2;
			entry.clip = stroke.align === "inside" ? "inside" : "outside";
		}
		if (!trim) {
			entry.strokeBase = base;
			return entry;
		}
		entry.strokeBase = trimPath(this.ck, base, trim);
		if (base !== outline) base.delete();
		return entry;
	}

	/** The shape the engine strokes in place of the element's own path: a
	 *  rect's, or a trimmed ellipse vector's, which runs from its top. */
	private shape(el: ShapeElement, trim: StrokeTrim | null): ShapeMask | null {
		if (el.type === "rect")
			return rectShape(
				el.properties.cornerRadius,
				el.properties.cornerSmoothing,
			);
		if (
			trim &&
			el.size &&
			isEllipsePath(el.properties.d, el.size.width, el.size.height)
		)
			return { kind: "ellipse" };
		return null;
	}

	private outline(el: ShapeElement, width: number, height: number) {
		const ck = this.ck;
		if (el.type === "rect")
			return outlinePath(
				ck,
				rectShape(el.properties.cornerRadius, el.properties.cornerSmoothing),
				width,
				height,
			);
		const path = ck.Path.MakeFromSVGString(el.properties.d);
		if (path && el.properties.fillRule === "evenodd")
			path.setFillType(ck.FillType.EvenOdd);
		return path;
	}

	private stroke(path: Path, stroke: Stroke, width: number): Path | null {
		const ck = this.ck;
		return path.makeStroked({
			width,
			cap: ck.StrokeCap[CAP[stroke.cap ?? "butt"]],
			join: ck.StrokeJoin[JOIN[stroke.join ?? "miter"]],
		});
	}
}

function trimKey(trim: StrokeTrim | null): string {
	return trim ? `${trim.start},${trim.end}` : "";
}

function release(entry: Entry): void {
	if (entry.strokeBase !== entry.outline) entry.strokeBase?.delete();
	entry.outline?.delete();
	entry.stroke?.delete();
}
