import type { Template } from "@freshcoat-js/coatfile";
import type { EditorController } from "~/app/controller";
import {
	type Guide,
	type Point,
	type Rect,
	type SnapCandidates,
	snapCandidates,
} from "~/doc/geometry";
import {
	constrain45,
	type PenPath,
	type PenPoint,
	snapPenPoint,
} from "~/doc/pen";
import {
	frameToWorld,
	type HandleSide,
	moveHandle,
	movePoints,
	nearestSegment,
	type PointRef,
	type SegmentHit,
	sameRef,
	setVectorPaths,
	worldToFrame,
} from "~/doc/vector-edit";
import type { View } from "~/state/store";

const HIT_PX = { mouse: 7, touch: 12 };
const SEGMENT_PX = 5;
const SNAP_PX = 6;
const DRAG_THRESHOLD = { mouse: 3, touch: 6 };

/** What a press on the canvas lands on while a vector's points are edited. */
type PathHit =
	| { kind: "point"; ref: PointRef }
	| { kind: "handle"; ref: PointRef; side: HandleSide }
	| { kind: "segment"; hit: SegmentHit };

type Held = {
	key: string;
	base: Template;
	frame: Rect;
	/** The path as it was when the press began. */
	paths: PenPath[];
	press: Point;
	startWorld: Point;
	pointerType: string;
	/** A transaction is open, so the press has become a drag. */
	tx: boolean;
};

/** A press in path editing, from the press to its release. */
export type PathGesture = Held &
	(
		| {
				kind: "path-point";
				ref: PointRef;
				/** The points the drag carries. */
				refs: PointRef[];
				startLocal: Point;
				alt: boolean;
				/** A plain click on one of several picked points picks it alone. */
				collapse: boolean;
				candidates: SnapCandidates;
		  }
		| { kind: "path-handle"; ref: PointRef; side: HandleSide }
		| { kind: "path-segment"; hit: SegmentHit }
	);

export function isPathGesture(g: { kind: string } | null): g is PathGesture {
	return !!g && g.kind.startsWith("path-");
}

type Mods = {
	shiftKey: boolean;
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
};

const screenOf = (frame: Rect, view: View, p: Point): Point => {
	const w = frameToWorld(frame, p);
	return { x: view.x + w.x * view.zoom, y: view.y + w.y * view.zoom };
};

/** What lies under `p` (viewport pixels): a point, else a handle, else the
 *  path itself. */
export function hitPath(
	controller: EditorController,
	p: Point,
	pointerType: string,
): PathHit | null {
	const target = controller.pathTarget();
	if (!target) return null;
	const { view } = controller.state;
	const reach = pointerType === "mouse" ? HIT_PX.mouse : HIT_PX.touch;
	const near = (q: Point) => {
		const s = screenOf(target.frame, view, q);
		return Math.hypot(s.x - p.x, s.y - p.y);
	};
	let best: { hit: PathHit; d: number } | null = null;
	const offer = (hit: PathHit, d: number) => {
		if (d <= reach && (!best || d < best.d)) best = { hit, d };
	};
	target.paths.forEach((path, i) => {
		path.points.forEach((pt, j) => {
			offer({ kind: "point", ref: { path: i, index: j } }, near(pt));
		});
	});
	if (best) return (best as { hit: PathHit }).hit;
	target.paths.forEach((path, i) => {
		path.points.forEach((pt, j) => {
			const ref = { path: i, index: j };
			if (pt.in) offer({ kind: "handle", ref, side: "in" }, near(pt.in));
			if (pt.out) offer({ kind: "handle", ref, side: "out" }, near(pt.out));
		});
	});
	if (best) return (best as { hit: PathHit }).hit;
	const world = {
		x: (p.x - view.x) / view.zoom,
		y: (p.y - view.y) / view.zoom,
	};
	const segment = nearestSegment(
		target.paths,
		worldToFrame(target.frame, world),
		SEGMENT_PX / view.zoom,
	);
	return segment ? { kind: "segment", hit: segment } : null;
}

/** The point of the path a click at `p` would add a point at, if any. */
export function segmentUnder(
	controller: EditorController,
	p: Point,
): Point | null {
	const hit = hitPath(controller, p, "mouse");
	const target = controller.pathTarget();
	if (hit?.kind !== "segment" || !target) return null;
	return frameToWorld(target.frame, hit.hit.point);
}

/**
 * A press at `p` while editing a vector's points. Null when it lands on
 * nothing of the path, which ends the editing. Picking points happens at
 * once; moving them starts when the press has travelled.
 */
export function pressPath(
	controller: EditorController,
	p: Point,
	world: Point,
	pointerType: string,
	e: Mods,
): PathGesture | null {
	const target = controller.pathTarget();
	const base = controller.template;
	const edit = controller.state.pathEdit;
	if (!target || !base || !edit) return null;
	const hit = hitPath(controller, p, pointerType);
	if (!hit) return null;
	const held: Held = {
		key: target.key,
		base,
		frame: target.frame,
		paths: target.paths,
		press: p,
		startWorld: world,
		pointerType,
		tx: false,
	};
	if (hit.kind === "segment")
		return { ...held, kind: "path-segment", hit: hit.hit };
	if (hit.kind === "handle")
		return { ...held, kind: "path-handle", ref: hit.ref, side: hit.side };

	const { ref } = hit;
	const picked = edit.selected.some((r) => sameRef(r, ref));
	let refs = edit.selected;
	if (e.shiftKey) {
		refs = picked
			? edit.selected.filter((r) => !sameRef(r, ref))
			: [...edit.selected, ref];
		controller.selectPathPoints(refs);
	} else if (!picked) {
		refs = [ref];
		controller.selectPathPoints(refs);
	}
	const state = controller.state;
	const anchor = target.paths[ref.path]?.points[ref.index] as PenPoint;
	return {
		...held,
		kind: "path-point",
		ref,
		refs,
		startLocal: { x: anchor.x, y: anchor.y },
		alt: e.altKey,
		collapse: picked && !e.shiftKey && edit.selected.length > 1,
		candidates: snapCandidates(
			state.geometry,
			base,
			[target.key],
			state.hidden,
			controller.sideGuides(),
		),
	};
}

function preview(
	controller: EditorController,
	g: PathGesture,
	paths: PenPath[],
) {
	const out = setVectorPaths(g.base, g.key, paths);
	if (out.ok) controller.previewTx(out.template);
}

/** Carries a press along as the pointer moves: a point or handle drag, one
 *  undo step. Returns the snap guides to show. */
export function dragPath(
	controller: EditorController,
	g: PathGesture,
	p: Point,
	world: Point,
	e: Mods,
): Guide[] {
	if (g.kind === "path-segment") return [];
	if (!g.tx) {
		const limit =
			g.pointerType === "mouse" ? DRAG_THRESHOLD.mouse : DRAG_THRESHOLD.touch;
		if (Math.hypot(p.x - g.press.x, p.y - g.press.y) < limit) return [];
		if (g.kind === "path-point" && g.refs.length === 0) return [];
		controller.beginTx();
		g.tx = true;
	}
	const local = worldToFrame(g.frame, world);
	if (g.kind === "path-handle") {
		const anchor = g.paths[g.ref.path]?.points[g.ref.index] as PenPoint;
		const to = e.shiftKey ? constrain45(anchor, local) : local;
		preview(controller, g, moveHandle(g.paths, g.ref, g.side, to, e.altKey));
		return [];
	}
	const grab = worldToFrame(g.frame, g.startWorld);
	let to = {
		x: g.startLocal.x + local.x - grab.x,
		y: g.startLocal.y + local.y - grab.y,
	};
	let guides: Guide[] = [];
	if (e.shiftKey) to = constrain45(g.startLocal, to);
	else if (!(e.ctrlKey || e.metaKey) && !g.frame.rotation) {
		const others = g.paths.flatMap((path, i) =>
			path.points
				.filter(
					(_, j) => !g.refs.some((r) => sameRef(r, { path: i, index: j })),
				)
				.map((q) => frameToWorld(g.frame, q)),
		);
		const snap = snapPenPoint(
			frameToWorld(g.frame, to),
			g.candidates,
			others,
			SNAP_PX / controller.state.view.zoom,
		);
		to = worldToFrame(g.frame, snap.point);
		guides = snap.guides;
	}
	preview(
		controller,
		g,
		movePoints(g.paths, g.refs, to.x - g.startLocal.x, to.y - g.startLocal.y),
	);
	return guides;
}

/** Ends a press: a drag closes its undo step; a click on a point picks it or,
 *  with Alt, toggles it; a click on the path adds a point. */
export function releasePath(controller: EditorController, g: PathGesture) {
	if (g.tx) {
		controller.endTx();
		return;
	}
	if (g.kind === "path-segment") controller.insertPathPoint(g.hit);
	else if (g.kind === "path-point") {
		if (g.alt) controller.togglePathPoint(g.ref);
		else if (g.collapse) controller.selectPathPoints([g.ref]);
	}
}

/** The toggle a double click on a point makes. */
export function togglePointAt(
	controller: EditorController,
	p: Point,
	pointerType: string,
): boolean {
	const hit = hitPath(controller, p, pointerType);
	if (hit?.kind !== "point") return false;
	controller.togglePathPoint(hit.ref);
	return true;
}
