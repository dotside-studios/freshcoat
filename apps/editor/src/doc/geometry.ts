import type { Element, Template } from "@freshcoat-js/coatfile";
import type { Node } from "@freshcoat-js/engine";
import { scalePathData } from "@freshcoat-js/engine";
import { ellipsePath, isEllipseVector, round2 } from "./factories";
import {
	getElement,
	isAncestor,
	isBackgroundPath,
	keyOf,
	MASK_SOURCE,
	parentKeyOf,
	parentOf,
	parseKey,
} from "./path";
import { type OpResult, ok, refuse } from "./result";
import { mergeDefined, updateAt } from "./tree";

/** An unrotated box in absolute template units, turned `rotation` degrees
 *  about its centre. */
export type Rect = {
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
};

export type Point = { x: number; y: number };

export type LayerBox = {
	rect: Rect;
	/** The layer's rotation plus every ancestor's. */
	worldRotation: number;
	parentKey: string | null;
	/** Placed by its parent's auto layout. */
	autoLayoutChild: boolean;
};

export type LayerGeometry = Map<string, LayerBox>;

// ── Collecting ───────────────────────────────────────────────────────────────

/**
 * Layer boxes from a prepared (layout-resolved, absolute) coat engine tree whose
 * node ids are the preview's `k:<key>` ids. The background node carries no id,
 * so it is read as `root.children[0]`.
 */
export function collectGeometry(
	preparedRoot: Node,
	pathIds: Map<string, string>,
	t: Template,
	side: number,
): LayerGeometry {
	const out: LayerGeometry = new Map();
	const visit = (node: Node, inherited: number) => {
		const rotation = node.rotation ?? 0;
		const key = node.id === undefined ? undefined : pathIds.get(node.id);
		if (key !== undefined && node.pos && node.size) {
			out.set(key, {
				rect: {
					x: node.pos.x,
					y: node.pos.y,
					width: node.size.width,
					height: node.size.height,
					rotation,
				},
				worldRotation: inherited + rotation,
				parentKey: parentKeyOf(key),
				autoLayoutChild: isAutoLayoutChild(t, key),
			});
		}
		for (const child of nodeChildren(node)) visit(child, inherited + rotation);
	};
	visit(preparedRoot, 0);

	const bgKey = keyOf({ side, background: true });
	const bgNode =
		preparedRoot.kind === "group" ? preparedRoot.children[0] : undefined;
	out.set(bgKey, {
		rect: {
			x: bgNode?.pos?.x ?? 0,
			y: bgNode?.pos?.y ?? 0,
			width: bgNode?.size?.width ?? t.width,
			height: bgNode?.size?.height ?? t.height,
			rotation: 0,
		},
		worldRotation: 0,
		parentKey: null,
		autoLayoutChild: false,
	});
	return out;
}

function nodeChildren(node: Node): Node[] {
	if (node.kind === "group") return node.children;
	if (node.kind === "mask") return [node.mask, ...node.children];
	return [];
}

export function isAutoLayoutChild(t: Template, key: string): boolean {
	const p = parseKey(key);
	if (!p || isBackgroundPath(p) || p.path.at(-1) === MASK_SOURCE) return false;
	const parent = parentOf(p);
	if (!parent) return false;
	const pe = getElement(t, parent);
	const el = getElement(t, p) as Element | undefined;
	return (
		pe?.type === "frame" &&
		pe.properties.layout !== undefined &&
		el?.layoutChild?.absolute !== true
	);
}

// ── Reading boxes ────────────────────────────────────────────────────────────

/** The ancestors' rects, nearest first. */
export function ancestorRects(key: string, geometry: LayerGeometry): Rect[] {
	const out: Rect[] = [];
	let parent = geometry.get(key)?.parentKey ?? null;
	while (parent !== null) {
		const box = geometry.get(parent);
		if (!box) break;
		out.push(box.rect);
		parent = box.parentKey;
	}
	return out;
}

export function centreOf(r: Pick<Rect, "x" | "y" | "width" | "height">): Point {
	return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

export function rotatePoint(p: Point, deg: number, about?: Point): Point {
	if (!deg) return p;
	const rad = (deg * Math.PI) / 180;
	const c = Math.cos(rad);
	const s = Math.sin(rad);
	const o = about ?? { x: 0, y: 0 };
	const dx = p.x - o.x;
	const dy = p.y - o.y;
	return { x: o.x + dx * c - dy * s, y: o.y + dx * s + dy * c };
}

/**
 * The four corners (nw, ne, se, sw) as painted: turned about the rect's own
 * centre, then about each ancestor's centre, nearest ancestor first.
 */
export function worldCorners(rect: Rect, ancestors: Rect[] = []): Point[] {
	const c = centreOf(rect);
	let pts: Point[] = [
		{ x: rect.x, y: rect.y },
		{ x: rect.x + rect.width, y: rect.y },
		{ x: rect.x + rect.width, y: rect.y + rect.height },
		{ x: rect.x, y: rect.y + rect.height },
	].map((p) => rotatePoint(p, rect.rotation, c));
	for (const a of ancestors) {
		const ac = centreOf(a);
		pts = pts.map((p) => rotatePoint(p, a.rotation, ac));
	}
	return pts;
}

/** The axis-aligned box around some points, unrotated. */
export function boundsOf(points: Point[]): Rect {
	const xs = points.map((p) => p.x);
	const ys = points.map((p) => p.y);
	const x = Math.min(...xs);
	const y = Math.min(...ys);
	return {
		x,
		y,
		width: Math.max(...xs) - x,
		height: Math.max(...ys) - y,
		rotation: 0,
	};
}

export function unionRects(rects: Rect[]): Rect {
	return boundsOf(rects.flatMap((r) => worldCorners(r)));
}

/** A layer's painted axis-aligned bounds. */
export function layerBounds(
	key: string,
	geometry: LayerGeometry,
): Rect | undefined {
	const box = geometry.get(key);
	if (!box) return undefined;
	return boundsOf(worldCorners(box.rect, ancestorRects(key, geometry)));
}

/** Move, resize and rotate on the canvas: only with no rotated ancestor and
 *  outside auto layout. */
export function canTransform(key: string, geometry: LayerGeometry): boolean {
	const box = geometry.get(key);
	if (!box || box.autoLayoutChild) return false;
	const p = parseKey(key);
	if (!p || isBackgroundPath(p)) return false;
	return ancestorRects(key, geometry).every((a) => !a.rotation);
}

/** Absolute point to the parent's space: a top-level layer's parent is the
 *  artboard. */
export function toParentSpace(
	abs: Point,
	parentKey: string | null,
	geometry: LayerGeometry,
): Point {
	const origin = parentKey ? geometry.get(parentKey)?.rect : undefined;
	return { x: abs.x - (origin?.x ?? 0), y: abs.y - (origin?.y ?? 0) };
}

/** The absolute origin of the layer's parent: from geometry when known, else
 *  the template's own offsets summed (a layer hidden by `visibleWhen` has no
 *  geometry). */
export function parentOrigin(
	t: Template,
	key: string,
	geometry: LayerGeometry,
): Point {
	const parentKey = parentKeyOf(key);
	if (parentKey === null) return { x: 0, y: 0 };
	const known = geometry.get(parentKey)?.rect;
	if (known) return { x: known.x, y: known.y };
	return templateOrigin(t, parentKey);
}

function templateOrigin(t: Template, key: string): Point {
	const p = parseKey(key);
	if (!p || isBackgroundPath(p)) return { x: 0, y: 0 };
	let x = 0;
	let y = 0;
	for (let n = 1; n <= p.path.length; n++) {
		const el = getElement(t, { side: p.side, path: p.path.slice(0, n) });
		x += el?.pos?.x ?? 0;
		y += el?.pos?.y ?? 0;
	}
	return { x, y };
}

/** A layer's absolute rect: from geometry, else from the template. */
export function rectOf(
	t: Template,
	key: string,
	geometry: LayerGeometry,
): Rect | undefined {
	const known = geometry.get(key)?.rect;
	if (known) return known;
	const el = getElement(t, key);
	if (!el) return undefined;
	const o = parentOrigin(t, key, geometry);
	return {
		x: o.x + (el.pos?.x ?? 0),
		y: o.y + (el.pos?.y ?? 0),
		width: el.size?.width ?? 0,
		height: el.size?.height ?? 0,
		rotation: el.rotation ?? 0,
	};
}

// ── Resize and rotate ────────────────────────────────────────────────────────

export type Handle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
export const HANDLES: Handle[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

const HANDLE_DIR: Record<Handle, [number, number]> = {
	n: [0, -1],
	ne: [1, -1],
	e: [1, 0],
	se: [1, 1],
	s: [0, 1],
	sw: [-1, 1],
	w: [-1, 0],
	nw: [-1, -1],
};

export function handleDirection(h: Handle): [number, number] {
	return HANDLE_DIR[h];
}

export type ResizeOptions = { keepAspect?: boolean; fromCenter?: boolean };

/**
 * Drags `handle` by `delta` (absolute template units). Works in the rect's own
 * frame, keeps the anchor (the opposite handle, or the centre with
 * `fromCenter`) fixed in world space, floors each side at 1 and flips rather
 * than going negative.
 */
export function resizeRect(
	rect: Rect,
	handle: Handle,
	delta: Point,
	opts: ResizeOptions = {},
): Rect {
	const [sx, sy] = HANDLE_DIR[handle];
	const { keepAspect = false, fromCenter = false } = opts;
	const d = rotatePoint(delta, -rect.rotation);
	const w = rect.width;
	const h = rect.height;
	let l = -w / 2;
	let r = w / 2;
	let t = -h / 2;
	let b = h / 2;
	const k = fromCenter ? 1 : 0;
	if (sx === 1) [r, l] = [r + d.x, l - k * d.x];
	if (sx === -1) [l, r] = [l + d.x, r - k * d.x];
	if (sy === 1) [b, t] = [b + d.y, t - k * d.y];
	if (sy === -1) [t, b] = [t + d.y, b - k * d.y];

	if (keepAspect && w > 0 && h > 0) {
		if (sx !== 0 && sy !== 0) {
			const fx = (r - l) / w;
			const fy = (b - t) / h;
			const f = Math.abs(fx - 1) >= Math.abs(fy - 1) ? fx : fy;
			const W = w * f;
			const H = h * f;
			if (fromCenter) [l, r, t, b] = [-W / 2, W / 2, -H / 2, H / 2];
			else {
				if (sx === 1) r = l + W;
				else l = r - W;
				if (sy === 1) b = t + H;
				else t = b - H;
			}
		} else if (sx !== 0) {
			const H = h * Math.abs((r - l) / w);
			[t, b] = [-H / 2, H / 2];
		} else {
			const W = w * Math.abs((b - t) / h);
			[l, r] = [-W / 2, W / 2];
		}
	}

	const ax = fromCenter || sx === 0 ? null : -sx * (w / 2);
	const ay = fromCenter || sy === 0 ? null : -sy * (h / 2);
	[l, r] = span(l, r, ax, sx);
	[t, b] = span(t, b, ay, sy);

	const W = r - l;
	const H = b - t;
	const c = rotatePoint({ x: (l + r) / 2, y: (t + b) / 2 }, rect.rotation);
	const c0 = centreOf(rect);
	return {
		x: c0.x + c.x - W / 2,
		y: c0.y + c.y - H / 2,
		width: W,
		height: H,
		rotation: rect.rotation,
	};
}

// Orders an edge pair and floors it at 1, growing away from the anchor on the
// side the moving edge is on (the handle's side when it lands on the anchor).
function span(
	a: number,
	b: number,
	anchor: number | null,
	dir: number,
): [number, number] {
	const lo = Math.min(a, b);
	const hi = Math.max(a, b);
	if (hi - lo >= 1) return [lo, hi];
	if (anchor === null) {
		const mid = (lo + hi) / 2;
		return [mid - 0.5, mid + 0.5];
	}
	const mid = (lo + hi) / 2;
	const side = mid === anchor ? dir : Math.sign(mid - anchor);
	return side >= 0 ? [anchor, anchor + 1] : [anchor - 1, anchor];
}

/** Degrees in (-180, 180]. */
export function normalizeAngle(deg: number): number {
	let a = ((deg % 360) + 360) % 360;
	if (a > 180) a -= 360;
	return a === 0 ? 0 : a;
}

/** The rotation while dragging a rotate zone: the pointer's turn about the
 *  centre since the drag began, added to the rotation it began with. */
export function rotateFromPointer(
	rect: Rect,
	start: Point,
	pointer: Point,
	startRotation: number,
	opts: { snap?: boolean } = {},
): number {
	const c = centreOf(rect);
	const a0 = Math.atan2(start.y - c.y, start.x - c.x);
	const a1 = Math.atan2(pointer.y - c.y, pointer.x - c.x);
	let deg = startRotation + ((a1 - a0) * 180) / Math.PI;
	if (opts.snap) deg = Math.round(deg / 15) * 15;
	return normalizeAngle(deg);
}

/** Maps `rect` from `from` to `to` proportionally: a multi-selection's
 *  members when its bounding box is resized. */
export function mapRectInBox(rect: Rect, from: Rect, to: Rect): Rect {
	const fx = from.width ? to.width / from.width : 1;
	const fy = from.height ? to.height / from.height : 1;
	return {
		x: to.x + (rect.x - from.x) * fx,
		y: to.y + (rect.y - from.y) * fy,
		width: Math.max(1, rect.width * fx),
		height: Math.max(1, rect.height * fy),
		rotation: rect.rotation,
	};
}

// ── Writing boxes ────────────────────────────────────────────────────────────

/**
 * Writes an absolute rect back to the element: `pos` in its parent's space,
 * `size` and `rotation`, all rounded to 0.01. A vector's path follows its size,
 * and hug-sized text becomes fixed on the axis that changed.
 */
export function applyRect(
	t: Template,
	key: string,
	rect: Rect,
	geometry: LayerGeometry,
): OpResult {
	const p = parseKey(key);
	if (!p) return refuse("not_found", "That layer no longer exists");
	if (isBackgroundPath(p))
		return refuse("background", "The background always fills the side");
	const el = getElement(t, p) as Element | undefined;
	if (!el) return refuse("not_found", "That layer no longer exists");

	const o = parentOrigin(t, key, geometry);
	const width = round2(Math.max(1, rect.width));
	const height = round2(Math.max(1, rect.height));
	const rotation = round2(normalizeAngle(rect.rotation));
	let next = mergeDefined(el, {
		pos: { x: round2(rect.x - o.x), y: round2(rect.y - o.y) },
		size: { width, height },
		rotation:
			rotation === 0 && el.rotation === undefined ? undefined : rotation,
	}) as Element;

	if (next.type === "vector" && el.type === "vector") {
		next = {
			...next,
			properties: {
				...next.properties,
				d: resizedPath(el, width, height),
			},
		};
	}
	if (next.type === "text" && next.layoutChild) {
		const lc = next.layoutChild;
		const w = lc.width === "hug" && width !== el.size?.width;
		const h = lc.height === "hug" && height !== el.size?.height;
		if (w || h)
			next = {
				...next,
				layoutChild: {
					...lc,
					...(w ? { width: "fixed" } : {}),
					...(h ? { height: "fixed" } : {}),
				},
			};
	}
	return ok(
		updateAt(t, p.side, p.path, () => next),
		[key],
	);
}

function resizedPath(
	el: Extract<Element, { type: "vector" }>,
	width: number,
	height: number,
): string {
	const d = el.properties.d;
	if (isEllipseVector(el)) return ellipsePath(width, height);
	const old = el.size;
	if (!old || !old.width || !old.height) return d;
	const sx = width / old.width;
	const sy = height / old.height;
	if (sx === 1 && sy === 1) return d;
	try {
		return scalePathData(d, sx, sy);
	} catch {
		return d;
	}
}

/** Moves layers by an absolute delta. A layer under a rotated ancestor moves
 *  in its parent's turned axes, so the delta is turned back into them. */
export function translateLayers(
	t: Template,
	keys: string[],
	dx: number,
	dy: number,
	geometry: LayerGeometry,
): Template {
	let out = t;
	for (const key of keys) {
		const p = parseKey(key);
		if (!p || isBackgroundPath(p)) continue;
		const box = geometry.get(key);
		const inherited = box ? box.worldRotation - box.rect.rotation : 0;
		const d = rotatePoint({ x: dx, y: dy }, -inherited);
		out = updateAt(out, p.side, p.path, (el) => ({
			...el,
			pos: {
				x: round2((el.pos?.x ?? 0) + d.x),
				y: round2((el.pos?.y ?? 0) + d.y),
			},
		}));
	}
	return out;
}

// ── Snapping ─────────────────────────────────────────────────────────────────

/** A line a moving edge can snap to: `value` on one axis, spanning `from`–`to`
 *  on the other. */
export type SnapLine = { value: number; from: number; to: number };
export type SnapCandidates = { x: SnapLine[]; y: SnapLine[] };
/** A guide segment in template units. */
export type Guide = { x1: number; y1: number; x2: number; y2: number };
export type SnapResult = { dx: number; dy: number; guides: Guide[] };

/**
 * The artboard's edges and centre lines, the side's ruler guides, plus the
 * edges and centres of every layer that is not moving, not inside a moving
 * layer, not hidden and not a mask source. Rotated layers offer their painted
 * bounds.
 */
export function snapCandidates(
	geometry: LayerGeometry,
	artboard: { width: number; height: number },
	moving: Iterable<string>,
	hidden: ReadonlySet<string> = new Set(),
	guides: { x: readonly number[]; y: readonly number[] } = { x: [], y: [] },
): SnapCandidates {
	const movingKeys = [...moving];
	const hiddenKeys = [...hidden];
	const W = artboard.width;
	const H = artboard.height;
	const out: SnapCandidates = {
		x: [0, W / 2, W, ...guides.x].map((value) => ({ value, from: 0, to: H })),
		y: [0, H / 2, H, ...guides.y].map((value) => ({ value, from: 0, to: W })),
	};
	for (const key of geometry.keys()) {
		const p = parseKey(key);
		if (!p || isBackgroundPath(p) || p.path.includes(MASK_SOURCE)) continue;
		const excluded = (k: string) => k === key || isAncestor(k, key);
		if (movingKeys.some(excluded) || hiddenKeys.some(excluded)) continue;
		const b = layerBounds(key, geometry);
		if (!b) continue;
		for (const value of [b.x, b.x + b.width / 2, b.x + b.width])
			out.x.push({ value, from: b.y, to: b.y + b.height });
		for (const value of [b.y, b.y + b.height / 2, b.y + b.height])
			out.y.push({ value, from: b.x, to: b.x + b.width });
	}
	return out;
}

/** Snaps a moving rect's edges and centre lines. */
export function snapMove(
	moving: Rect,
	candidates: SnapCandidates,
	threshold: number,
): SnapResult {
	const b = boundsOf(worldCorners(moving));
	return snapEdges(
		b,
		[b.x, b.x + b.width / 2, b.x + b.width],
		[b.y, b.y + b.height / 2, b.y + b.height],
		candidates,
		threshold,
	);
}

/** Snaps only the edges a resize handle moves. */
export function snapResize(
	moving: Rect,
	handle: Handle,
	candidates: SnapCandidates,
	threshold: number,
): SnapResult {
	const b = boundsOf(worldCorners(moving));
	const [sx, sy] = HANDLE_DIR[handle];
	const xs = sx === 0 ? [] : [sx === 1 ? b.x + b.width : b.x];
	const ys = sy === 0 ? [] : [sy === 1 ? b.y + b.height : b.y];
	return snapEdges(b, xs, ys, candidates, threshold);
}

function snapEdges(
	box: Rect,
	xs: number[],
	ys: number[],
	candidates: SnapCandidates,
	threshold: number,
): SnapResult {
	const dx = bestDelta(xs, candidates.x, threshold);
	const dy = bestDelta(ys, candidates.y, threshold);
	const moved = {
		...box,
		x: box.x + (dx ?? 0),
		y: box.y + (dy ?? 0),
	};
	const guides: Guide[] = [];
	if (dx !== null) {
		for (const g of guideSpans(
			xs.map((v) => v + dx),
			candidates.x,
			moved.y,
			moved.y + moved.height,
		))
			guides.push({ x1: g.value, y1: g.from, x2: g.value, y2: g.to });
	}
	if (dy !== null) {
		for (const g of guideSpans(
			ys.map((v) => v + dy),
			candidates.y,
			moved.x,
			moved.x + moved.width,
		))
			guides.push({ x1: g.from, y1: g.value, x2: g.to, y2: g.value });
	}
	return { dx: dx ?? 0, dy: dy ?? 0, guides };
}

function bestDelta(
	edges: number[],
	lines: SnapLine[],
	threshold: number,
): number | null {
	let best: number | null = null;
	for (const e of edges)
		for (const l of lines) {
			const d = l.value - e;
			if (
				Math.abs(d) <= threshold &&
				(best === null || Math.abs(d) < Math.abs(best))
			)
				best = d;
		}
	return best;
}

// One guide per matched line value, spanning every rect that offered it and
// the moving one.
function guideSpans(
	edges: number[],
	lines: SnapLine[],
	from: number,
	to: number,
): SnapLine[] {
	const byValue = new Map<number, SnapLine>();
	for (const l of lines) {
		if (!edges.some((e) => Math.abs(e - l.value) < 1e-6)) continue;
		const v = Math.round(l.value * 1e6) / 1e6;
		const g = byValue.get(v) ?? { value: l.value, from, to };
		g.from = Math.min(g.from, l.from);
		g.to = Math.max(g.to, l.to);
		byValue.set(v, g);
	}
	return [...byValue.values()];
}

// ── Align and distribute ─────────────────────────────────────────────────────

export type AlignMode =
	| "left"
	| "hcenter"
	| "right"
	| "top"
	| "vcenter"
	| "bottom"
	| "hdistribute"
	| "vdistribute";

/**
 * Aligns painted bounds to the selection's box, or to the artboard when one
 * layer is selected; distributing gives equal gaps and needs three layers.
 * Auto-layout children, the background, and layers inside another selected
 * layer are skipped.
 */
export function align(
	t: Template,
	keys: string[],
	geometry: LayerGeometry,
	mode: AlignMode,
): OpResult {
	const targets = keys.filter((k) => {
		const p = parseKey(k);
		const box = geometry.get(k);
		return (
			p &&
			!isBackgroundPath(p) &&
			box &&
			!box.autoLayoutChild &&
			!keys.some((o) => isAncestor(o, k))
		);
	});
	if (targets.length === 0)
		return refuse("empty_selection", "Nothing selected can be aligned");
	const bounds = targets.map((k) => layerBounds(k, geometry) as Rect);
	const moves: [string, number, number][] = [];

	if (mode === "hdistribute" || mode === "vdistribute") {
		if (targets.length < 3)
			return refuse("too_few", "Select at least three layers to distribute");
		const horizontal = mode === "hdistribute";
		const pos = (r: Rect) => (horizontal ? r.x : r.y);
		const len = (r: Rect) => (horizontal ? r.width : r.height);
		const order = targets
			.map((k, i) => ({ k, r: bounds[i] }))
			.sort((a, b) => pos(a.r) - pos(b.r));
		const first = order[0].r;
		const last = order[order.length - 1].r;
		const total = order.reduce((s, o) => s + len(o.r), 0);
		const gap =
			(pos(last) + len(last) - pos(first) - total) / (order.length - 1);
		let cursor = pos(first);
		for (const o of order) {
			const d = cursor - pos(o.r);
			moves.push(horizontal ? [o.k, d, 0] : [o.k, 0, d]);
			cursor += len(o.r) + gap;
		}
	} else {
		const box =
			keys.length === 1
				? { x: 0, y: 0, width: t.width, height: t.height, rotation: 0 }
				: unionRects(bounds);
		const cx = (r: Rect) => r.x + r.width / 2;
		const cy = (r: Rect) => r.y + r.height / 2;
		const delta: Record<typeof mode, (r: Rect) => [number, number]> = {
			left: (r) => [box.x - r.x, 0],
			hcenter: (r) => [cx(box) - cx(r), 0],
			right: (r) => [box.x + box.width - (r.x + r.width), 0],
			top: (r) => [0, box.y - r.y],
			vcenter: (r) => [0, cy(box) - cy(r)],
			bottom: (r) => [0, box.y + box.height - (r.y + r.height)],
		};
		targets.forEach((k, i) => {
			moves.push([k, ...delta[mode](bounds[i])]);
		});
	}
	let out = t;
	for (const [k, dx, dy] of moves)
		if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9)
			out = translateLayers(out, [k], dx, dy, geometry);
	return ok(out, targets);
}
