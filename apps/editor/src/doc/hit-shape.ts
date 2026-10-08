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
	tolerance: number;
	trim: string;
	outline: Path | null;
	paintsFill: boolean;
	stroke: Path | null;
	clip: "inside" | "outside" | null;
};

const MAX_ENTRIES = 512;

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

/**
 * Tests rects and vectors against the pixels they paint: the fill by its
 * outline and fill rule, the stroke by its trimmed, stroked outline grown by
 * `tolerance` on each side. A trim bound to a field reads it from `values`.
 * Paths are cached per layer key until the element, its box, the tolerance or
 * the trim changes.
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
		const cached = this.entries.get(key);
		if (
			cached &&
			cached.el === el &&
			cached.width === width &&
			cached.height === height &&
			cached.tolerance === tolerance &&
			cached.trim === trimKey(trim)
		)
			return cached;
		if (cached) {
			release(cached);
			this.entries.delete(key);
		}
		if (this.entries.size >= MAX_ENTRIES) this.clear();
		const entry = this.build(el, width, height, tolerance, trim);
		this.entries.set(key, entry);
		return entry;
	}

	private build(
		el: ShapeElement,
		width: number,
		height: number,
		tolerance: number,
		trim: StrokeTrim | null,
	): Entry {
		const ck = this.ck;
		const outline = this.outline(el, width, height);
		const stroke = el.properties.stroke;
		const stroked = stroke && stroke.width > 0;
		const fill = el.properties.fill;
		const hasFill = Array.isArray(fill) ? fill.length > 0 : fill !== undefined;
		const entry: Entry = {
			el,
			width,
			height,
			tolerance,
			trim: trimKey(trim),
			outline,
			paintsFill: hasFill || !stroked,
			stroke: null,
			clip: null,
		};
		if (!outline || !stroke || !stroked) return entry;
		const inset = strokeInset(stroke);
		const shape = this.shape(el, trim);
		if (shape && (inset !== 0 || trim)) {
			const offset = outlinePath(ck, shape, width, height, inset, !!trim);
			if (offset) {
				entry.stroke = this.stroke(
					offset,
					stroke,
					stroke.width + 2 * tolerance,
					trim,
				);
				offset.delete();
				return entry;
			}
		}
		if (inset === 0) {
			entry.stroke = this.stroke(
				outline,
				stroke,
				stroke.width + 2 * tolerance,
				trim,
			);
			return entry;
		}
		entry.stroke = this.stroke(
			outline,
			stroke,
			stroke.width * 2 + 2 * tolerance,
			trim,
		);
		entry.clip = stroke.align === "inside" ? "inside" : "outside";
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

	private stroke(
		path: Path,
		stroke: Stroke,
		width: number,
		trim: StrokeTrim | null,
	): Path | null {
		const ck = this.ck;
		const trimmed = trim ? trimPath(ck, path, trim) : path;
		if (!trimmed) return null;
		const out = trimmed.makeStroked({
			width,
			cap: ck.StrokeCap[CAP[stroke.cap ?? "butt"]],
			join: ck.StrokeJoin[JOIN[stroke.join ?? "miter"]],
		});
		if (trimmed !== path) trimmed.delete();
		return out;
	}
}

function trimKey(trim: StrokeTrim | null): string {
	return trim ? `${trim.start},${trim.end}` : "";
}

function release(entry: Entry): void {
	entry.outline?.delete();
	entry.stroke?.delete();
}
