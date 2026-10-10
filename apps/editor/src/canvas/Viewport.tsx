import type { Template } from "@freshcoat-js/coatfile";
import { ContextMenu } from "@freshcoat-js/ui/menu";
import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { useController } from "~/app/context";
import type { EditorController } from "~/app/controller";
import { LayerMenuItems } from "~/app/LayerMenu";
import type { ElementKind } from "~/doc/factories";
import {
	applyRect,
	canTransform,
	centreOf,
	type Guide,
	type Handle,
	type LayerGeometry,
	layerBounds,
	mapRectInBox,
	type Point,
	type Rect,
	resizeRect,
	rotateFromPointer,
	rotateRectAbout,
	type SnapCandidates,
	snapCandidates,
	snapMove,
	snapResize,
	translateLayers,
	unionRects,
} from "~/doc/geometry";
import { duplicateElements } from "~/doc/ops";
import { getElement, isAncestor, parentKeyOf } from "~/doc/path";
import {
	closePoint,
	constrain45,
	dragPoint,
	type PenPath,
	snapPenPoint,
} from "~/doc/pen";
import { useEditor } from "~/state/hooks";
import { type Tool, working } from "~/state/store";
import { createDraftStore } from "./draft-store";
import { Guides } from "./Guides";
import { parseGradientHandle } from "./gradient-geometry";
import {
	draggedGradient,
	type GradientHandleRef,
	type GradientTarget,
	gradientTarget,
	gradientWithStopAt,
	withGradient,
} from "./gradient-handles";
import { Overlay } from "./Overlay";
import {
	dragPath,
	isPathGesture,
	type PathGesture,
	type PenResume,
	penResumeAt,
	pressPath,
	releasePath,
	segmentUnder,
	togglePointAt,
} from "./path-edit";
import {
	printGuidesFor,
	printGuidesOn,
	usePrintGuidesVersion,
} from "./print-guides";
import { Rulers } from "./Rulers";
import { SideMenu } from "./SideVariantMenus";
import { TextEditor } from "./TextEditor";
import { useLiveRender } from "./use-live-render";

const DRAG_THRESHOLD = { mouse: 3, touch: 6 };
const SNAP_PX = 6;
const CLOSE_PX = 8;

const CREATE_KIND: Partial<Record<Tool, ElementKind>> = {
	frame: "frame",
	rect: "rect",
	ellipse: "ellipse",
	text: "text",
	placeholder: "image",
	qr: "qr",
	barcode: "barcode",
};

type Gesture =
	| { kind: "pan"; start: Point; view: { x: number; y: number } }
	| {
			kind: "pinch";
			startDist: number;
			startMid: Point;
			view: { x: number; y: number; zoom: number };
	  }
	| {
			kind: "press";
			start: Point;
			startWorld: Point;
			hit: string | null;
			shift: boolean;
			alt: boolean;
			pointerType: string;
	  }
	| {
			kind: "move";
			startWorld: Point;
			keys: string[];
			base: Template;
			geometry: LayerGeometry;
			bounds: Rect;
			candidates: SnapCandidates;
	  }
	| {
			kind: "resize";
			handle: Handle;
			startWorld: Point;
			keys: string[];
			base: Template;
			geometry: LayerGeometry;
			box: Rect;
			rects: Map<string, Rect>;
			candidates: SnapCandidates;
	  }
	| {
			kind: "rotate";
			startWorld: Point;
			keys: string[];
			base: Template;
			geometry: LayerGeometry;
			box: Rect;
			rects: Map<string, Rect>;
	  }
	| {
			kind: "gradient";
			target: GradientTarget;
			handle: GradientHandleRef;
			base: Template;
			start: Point;
			startWorld: Point;
			pointerType: string;
	  }
	| { kind: "marquee"; startWorld: Point; additive: boolean; before: string[] }
	| {
			kind: "pen";
			start: Point;
			anchor: Point;
			index: number;
			close: boolean;
			pointerType: string;
	  }
	| { kind: "create"; tool: ElementKind; startWorld: Point; parent?: string }
	| PathGesture;

export function Viewport() {
	const controller = useController();
	const ref = useRef<HTMLDivElement>(null);
	const artboardRef = useRef<HTMLDivElement>(null);
	const template = useEditor(working);
	const view = useEditor((s) => s.view);
	const tool = useEditor((s) => s.tool);
	const textEditing = useEditor((s) => s.textEdit !== null);
	const pathEditing = useEditor((s) => s.pathEdit !== null);
	const renderStatus = useEditor((s) => s.render.status);
	const { canvas, fontsLoading } = useLiveRender();
	usePrintGuidesVersion();
	const guides = useEditor((s) =>
		printGuidesOn(
			s.workspace?.activeTemplateId,
			s.doc?.history.present ?? null,
		),
	);

	const gesture = useRef<Gesture | null>(null);
	const pointers = useRef(new Map<number, Point>());
	const [spaceHeld, setSpaceHeld] = useState(false);
	const [cursor, setCursor] = useState<string | undefined>();
	const [drafts] = useState(createDraftStore);
	const { setDraft, setPen } = drafts;
	const penPath = useCallback(() => drafts.get().pen?.path ?? null, [drafts]);
	// The vector subpath the pen is carrying on, and how many points it began with.
	const resuming = useRef<(PenResume & { count: number }) | null>(null);
	const finishPen = useCallback(
		(path: PenPath | null) => {
			const resume = resuming.current;
			resuming.current = null;
			setPen(null);
			setDraft({});
			if (resume && path) {
				if (path.closed || path.points.length > resume.count)
					controller.continuePath(
						resume.key,
						resume.subpath,
						resume.reversed,
						path,
					);
			} else if (path && path.points.length >= 2) controller.createPath(path);
		},
		[controller, setPen, setDraft],
	);

	// Enter or Esc finishes the path being drawn; Backspace or undo takes back
	// its last point, and redo is swallowed so it never reaches the document.
	// Leaving the tool keeps what was drawn.
	useEffect(() => {
		if (tool !== "pen") {
			finishPen(penPath());
			return;
		}
		const onKey = (e: KeyboardEvent) => {
			const path = penPath();
			if (!path || isTyping(e.target)) return;
			const undo = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z";
			if (e.key === "Enter" || e.key === "Escape") finishPen(path);
			else if (
				e.key === "Backspace" ||
				e.key === "Delete" ||
				(undo && !e.shiftKey)
			) {
				const points = path.points.slice(0, -1);
				setPen(points.length ? { path: { ...path, points } } : null);
			} else if (!undo) return;
			e.preventDefault();
			e.stopImmediatePropagation();
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [tool, finishPen, setPen, penPath]);

	// Enter or Esc leaves path editing; Backspace removes the picked points and
	// the arrows nudge them, as one undo step each.
	useEffect(() => {
		if (!pathEditing) return;
		const step = (e: KeyboardEvent): [number, number] | null => {
			const n = e.shiftKey ? 10 : 1;
			const arrow: Record<string, [number, number]> = {
				ArrowLeft: [-n, 0],
				ArrowRight: [n, 0],
				ArrowUp: [0, -n],
				ArrowDown: [0, n],
			};
			return arrow[e.key] ?? null;
		};
		const onKey = (e: KeyboardEvent) => {
			if (gesture.current || isTyping(e.target)) return;
			const picked = controller.state.pathEdit?.selected.length;
			const nudge = step(e);
			if (e.key === "Enter" || e.key === "Escape") controller.endPathEdit();
			else if ((e.key === "Backspace" || e.key === "Delete") && picked)
				controller.removePathPoints();
			else if (nudge && picked) controller.nudgePathPoints(...nudge);
			else return;
			e.preventDefault();
			e.stopImmediatePropagation();
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [pathEditing, controller]);

	// Mount the session's canvas; it is replaced when the painted size changes.
	useLayoutEffect(() => {
		const host = artboardRef.current;
		if (!host || !canvas) return;
		if (canvas.parentElement !== host) {
			host.querySelector("canvas")?.remove();
			canvas.className = "absolute inset-0 size-full";
			canvas.setAttribute("aria-hidden", "true");
			canvas.dataset.testid = "artboard-canvas";
			host.prepend(canvas);
		}
	}, [canvas]);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const ro = new ResizeObserver(([entry]) => {
			if (!entry) return;
			const { width, height } = entry.contentRect;
			controller.setViewportSize(width, height);
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, [controller]);

	// Space is the temporary hand, as in every design tool.
	useEffect(() => {
		const down = (e: KeyboardEvent) => {
			if (e.code !== "Space" || e.repeat || isTyping(e.target)) return;
			e.preventDefault();
			setSpaceHeld(true);
		};
		const up = (e: KeyboardEvent) => {
			if (e.code === "Space") setSpaceHeld(false);
		};
		const cancel = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || !gesture.current) return;
			const g = gesture.current;
			if (inTransaction(g)) {
				controller.cancelTx();
				e.stopImmediatePropagation();
			}
			gesture.current = null;
			setDraft({});
		};
		window.addEventListener("keydown", down);
		window.addEventListener("keyup", up);
		window.addEventListener("keydown", cancel, true);
		return () => {
			window.removeEventListener("keydown", down);
			window.removeEventListener("keyup", up);
			window.removeEventListener("keydown", cancel, true);
		};
	}, [controller, setDraft]);

	// Wheel has to be non-passive to stop the page zooming on ctrl+wheel.
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			const r = el.getBoundingClientRect();
			const p = { x: e.clientX - r.left, y: e.clientY - r.top };
			const v = controller.state.view;
			if (e.ctrlKey || e.metaKey) {
				const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.01));
				controller.zoomTo(v.zoom * factor, p);
			} else {
				const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
				const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
				controller.setView({ ...v, x: v.x - dx, y: v.y - dy });
			}
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, [controller]);

	const local = useCallback((e: { clientX: number; clientY: number }) => {
		const r = ref.current?.getBoundingClientRect();
		return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
	}, []);

	const penTarget = (
		world: Point,
		e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
		path: PenPath | null,
	): { point: Point; guides: Guide[] } => {
		const last = path?.points.at(-1);
		if (e.shiftKey && last)
			return { point: constrain45(last, world), guides: [] };
		const t = controller.template;
		if (!t || e.ctrlKey || e.metaKey) return { point: world, guides: [] };
		const { geometry, hidden, view: v } = controller.state;
		return snapPenPoint(
			world,
			snapCandidates(geometry, t, [], hidden, controller.sideGuides()),
			path?.points ?? [],
			SNAP_PX / v.zoom,
		);
	};

	const toWorld = useCallback(
		(p: Point): Point => {
			const v = controller.state.view;
			return { x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom };
		},
		[controller],
	);

	const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (!template || onControl(e)) return;
		const el = ref.current;
		if (!el) return;
		el.setPointerCapture?.(e.pointerId);
		const p = local(e);
		pointers.current.set(e.pointerId, p);

		// A second finger turns whatever the first was doing into a pinch.
		if (e.pointerType === "touch" && pointers.current.size === 2) {
			abandonGesture(controller, gesture.current);
			setDraft({});
			const [a, b] = [...pointers.current.values()] as [Point, Point];
			gesture.current = {
				kind: "pinch",
				startDist: Math.hypot(a.x - b.x, a.y - b.y),
				startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
				view: controller.state.view,
			};
			return;
		}
		if (pointers.current.size > 1) return;

		const state = controller.state;
		if (e.button === 1 || spaceHeld || state.tool === "hand") {
			gesture.current = { kind: "pan", start: p, view: state.view };
			setCursor("grabbing");
			return;
		}
		if (e.button !== 0) return;
		const world = toWorld(p);

		const handle = (e.target as Element).closest?.("[data-handle]");
		if (handle && state.tool === "move") {
			const name = handle.getAttribute("data-handle") as string;
			if (name.startsWith("grad:"))
				startGradient(name, p, world, e.pointerType);
			else startTransform(name, world);
			return;
		}

		if (state.pathEdit && state.tool === "move") {
			const held = pressPath(controller, p, world, e.pointerType, e);
			if (held) {
				gesture.current = held;
				return;
			}
			controller.endPathEdit();
		}

		if (state.tool === "pen") {
			const resume = penPath() ? null : penResumeAt(controller, p, CLOSE_PX);
			if (resume) {
				resuming.current = { ...resume, count: resume.path.points.length };
				setPen({ path: resume.path });
				return;
			}
			if (!penPath()) resuming.current = null;
			const path = penPath() ?? { points: [], closed: false };
			const first = path.points[0];
			const v = state.view;
			if (
				first &&
				path.points.length >= 2 &&
				Math.hypot(
					v.x + first.x * v.zoom - p.x,
					v.y + first.y * v.zoom - p.y,
				) <= CLOSE_PX
			) {
				gesture.current = {
					kind: "pen",
					start: p,
					anchor: { x: first.x, y: first.y },
					index: 0,
					close: true,
					pointerType: e.pointerType,
				};
				return;
			}
			const { point: anchor, guides } = penTarget(world, e, path);
			const points = [...path.points, { x: anchor.x, y: anchor.y }];
			setPen({ path: { ...path, points } });
			setDraft({ guides });
			gesture.current = {
				kind: "pen",
				start: p,
				anchor,
				index: points.length - 1,
				close: false,
				pointerType: e.pointerType,
			};
			return;
		}

		const kind = CREATE_KIND[state.tool];
		if (kind) {
			gesture.current = {
				kind: "create",
				tool: kind,
				startWorld: world,
				parent: frameUnder(controller, world),
			};
			return;
		}
		if (state.tool === "image") return;

		const hit = controller.hitTest(world, { deep: e.metaKey || e.ctrlKey });
		gesture.current = {
			kind: "press",
			start: p,
			startWorld: world,
			hit,
			shift: e.shiftKey,
			alt: e.altKey,
			pointerType: e.pointerType,
		};
		if (hit) {
			if (e.shiftKey) controller.select([hit], "toggle");
			else if (!state.selection.includes(hit)) controller.select([hit]);
		}
	};

	const startGradient = (
		name: string,
		start: Point,
		world: Point,
		pointerType: string,
	) => {
		const handle = parseGradientHandle(name);
		const target = gradientTarget(controller.state);
		const t = controller.template;
		if (!handle || !target || !t || handle.index !== target.index) return;
		// A press on the line adds a stop on release, or moves the layer
		// if it turns into a drag; only a handle opens a transaction now.
		if (handle.part !== "line") controller.beginTx();
		gesture.current = {
			kind: "gradient",
			target,
			handle,
			base: t,
			start,
			startWorld: world,
			pointerType,
		};
	};

	const startTransform = (name: string, world: Point) => {
		const state = controller.state;
		const t = controller.template;
		if (!t) return;
		const keys = controller
			.selectedLayers()
			.filter((k) => canTransform(k, state.geometry));
		if (keys.length === 0) return;
		const geometry = state.geometry;
		const candidates = snapCandidates(
			geometry,
			t,
			keys,
			state.hidden,
			controller.sideGuides(),
		);
		const rects = new Map<string, Rect>();
		for (const k of keys) {
			const r = geometry.get(k)?.rect;
			if (r) rects.set(k, r);
		}
		const box =
			keys.length === 1
				? (rects.get(keys[0] as string) as Rect)
				: unionRects([...rects.values()]);
		controller.beginTx();
		if (name === "rotate") {
			gesture.current = {
				kind: "rotate",
				startWorld: world,
				keys,
				base: t,
				geometry,
				box,
				rects,
			};
			return;
		}
		gesture.current = {
			kind: "resize",
			handle: name as Handle,
			startWorld: world,
			keys,
			base: t,
			geometry,
			box,
			rects,
			candidates,
		};
	};

	const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
		const p = local(e);
		if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p);
		const g = gesture.current;
		const state = controller.state;
		const world = toWorld(p);

		if (!g) {
			if (state.tool === "pen") {
				const path = penPath();
				const { point, guides } = penTarget(world, e, path);
				setDraft({ guides });
				if (path) setPen({ path, cursor: point });
				return;
			}
			if (state.pathEdit) {
				const at =
					e.pointerType === "mouse" ? segmentUnder(controller, p) : null;
				setDraft(at ? { pathHover: at } : {});
				return;
			}
			if (e.pointerType === "mouse" && state.tool === "move" && template) {
				const onHandle = (e.target as Element).closest?.("[data-handle]");
				const hit = onHandle ? null : controller.hitTest(world);
				if (hit !== state.hover)
					controller.dispatch({ type: "hover", key: hit });
			}
			return;
		}

		if (isPathGesture(g)) {
			setDraft({ guides: dragPath(controller, g, p, world, e) });
			return;
		}

		switch (g.kind) {
			case "pan":
				controller.setView({
					zoom: state.view.zoom,
					x: g.view.x + p.x - g.start.x,
					y: g.view.y + p.y - g.start.y,
				});
				return;
			case "pinch": {
				const pts = [...pointers.current.values()];
				if (pts.length < 2) return;
				const [a, b] = pts as [Point, Point];
				const dist = Math.hypot(a.x - b.x, a.y - b.y);
				const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
				const zoom = Math.min(
					64,
					Math.max(0.02, (g.view.zoom * dist) / Math.max(1, g.startDist)),
				);
				const wx = (g.startMid.x - g.view.x) / g.view.zoom;
				const wy = (g.startMid.y - g.view.y) / g.view.zoom;
				controller.setView({
					zoom,
					x: mid.x - wx * zoom,
					y: mid.y - wy * zoom,
				});
				return;
			}
			case "press": {
				const limit =
					g.pointerType === "mouse"
						? DRAG_THRESHOLD.mouse
						: DRAG_THRESHOLD.touch;
				if (Math.hypot(p.x - g.start.x, p.y - g.start.y) < limit) return;
				if (g.hit && !g.shift) beginMove(g.startWorld, g.alt);
				else if (g.hit && g.shift && state.selection.includes(g.hit))
					beginMove(g.startWorld, false);
				else
					gesture.current = {
						kind: "marquee",
						startWorld: g.startWorld,
						additive: g.shift,
						before: state.selection,
					};
				onPointerMove(e);
				return;
			}
			case "move": {
				let dx = world.x - g.startWorld.x;
				let dy = world.y - g.startWorld.y;
				if (e.shiftKey) {
					if (Math.abs(dx) > Math.abs(dy)) dy = 0;
					else dx = 0;
				}
				let guides: Guide[] = [];
				if (!(e.ctrlKey || e.metaKey)) {
					const snap = snapMove(
						{ ...g.bounds, x: g.bounds.x + dx, y: g.bounds.y + dy },
						g.candidates,
						SNAP_PX / state.view.zoom,
					);
					dx += snap.dx;
					dy += snap.dy;
					guides = snap.guides;
				}
				controller.previewTx(
					translateLayers(g.base, g.keys, dx, dy, g.geometry),
				);
				setDraft({ guides });
				return;
			}
			case "resize": {
				const delta = {
					x: world.x - g.startWorld.x,
					y: world.y - g.startWorld.y,
				};
				const opts = { keepAspect: e.shiftKey, fromCenter: e.altKey };
				let box = resizeRect(g.box, g.handle, delta, opts);
				let guides: Guide[] = [];
				if (!g.box.rotation && !(e.ctrlKey || e.metaKey)) {
					const snap = snapResize(
						box,
						g.handle,
						g.candidates,
						SNAP_PX / state.view.zoom,
					);
					if (snap.dx || snap.dy) {
						box = resizeRect(
							g.box,
							g.handle,
							{ x: delta.x + snap.dx, y: delta.y + snap.dy },
							opts,
						);
						guides = snap.guides;
					}
				}
				let next = g.base;
				for (const key of g.keys) {
					const r = g.rects.get(key);
					if (!r) continue;
					const target =
						g.keys.length === 1 ? box : mapRectInBox(r, g.box, box);
					const out = applyRect(next, key, target, g.geometry);
					if (out.ok) next = out.template;
				}
				controller.previewTx(next);
				setDraft({ guides });
				return;
			}
			case "rotate": {
				const rotation = rotateFromPointer(
					g.box,
					g.startWorld,
					world,
					g.box.rotation,
					{ snap: e.shiftKey },
				);
				const turn = rotation - g.box.rotation;
				const pivot = centreOf(g.box);
				let next = g.base;
				for (const [key, r] of g.rects) {
					const out = applyRect(
						next,
						key,
						rotateRectAbout(r, pivot, turn),
						g.geometry,
					);
					if (out.ok) next = out.template;
				}
				controller.previewTx(next);
				setDraft({ angle: { at: world, value: rotation } });
				return;
			}
			case "gradient": {
				if (g.handle.part === "line") {
					const limit =
						g.pointerType === "mouse"
							? DRAG_THRESHOLD.mouse
							: DRAG_THRESHOLD.touch;
					if (Math.hypot(p.x - g.start.x, p.y - g.start.y) < limit) return;
					gesture.current = null;
					beginMove(g.startWorld, false);
					if (gesture.current) onPointerMove(e);
					return;
				}
				const fill = draggedGradient(g.target, g.handle, world, {
					snap: e.shiftKey,
				});
				controller.previewTx(
					withGradient(g.base, g.target.key, g.target.index, fill),
				);
				setDraft({ gradient: true });
				return;
			}
			case "marquee": {
				const box = rectFrom(g.startWorld, world);
				setDraft({ marquee: box });
				const hits = marqueeHits(controller, box, g.before);
				controller.select(
					g.additive ? [...new Set([...g.before, ...hits])] : hits,
				);
				return;
			}
			case "pen": {
				const path = penPath();
				const limit =
					g.pointerType === "mouse"
						? DRAG_THRESHOLD.mouse
						: DRAG_THRESHOLD.touch;
				if (!path || Math.hypot(p.x - g.start.x, p.y - g.start.y) < limit)
					return;
				const points = path.points.slice();
				points[g.index] = (g.close ? closePoint : dragPoint)(
					g.anchor,
					e.shiftKey ? constrain45(g.anchor, world) : world,
					points[g.index],
					e.altKey,
				);
				setPen({ path: { ...path, points, closed: g.close } });
				return;
			}
			case "create": {
				let box = rectFrom(g.startWorld, world, {
					square: e.shiftKey,
					fromCenter: e.altKey,
				});
				box = { ...box, rotation: 0 };
				setDraft({ create: box });
				return;
			}
		}
	};

	const beginMove = (startWorld: Point, duplicate: boolean) => {
		const state = controller.state;
		let t = controller.template;
		if (!t) return;
		let keys = controller
			.selectedLayers()
			.filter((k) => canTransform(k, state.geometry));
		if (keys.length === 0) {
			gesture.current = null;
			return;
		}
		const geometry = state.geometry;
		const bounds = unionRects(
			keys.map((k) => layerBounds(k, geometry)).filter((r) => r !== undefined),
		);
		controller.beginTx();
		const base = controller.base;
		if (duplicate && base) {
			// Copies are layers, so they join the base, on the originals; the
			// drag then moves them like any other.
			const dup = duplicateElements(base, keys, { offset: 0 });
			if (dup.ok && dup.keys) {
				keys = dup.keys;
				controller.previewTx(dup.template, keys, "base");
				t = controller.template ?? t;
			}
		}
		gesture.current = {
			kind: "move",
			startWorld,
			keys,
			base: t,
			geometry,
			bounds,
			candidates: snapCandidates(
				geometry,
				t,
				keys,
				state.hidden,
				controller.sideGuides(),
			),
		};
	};

	const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
		pointers.current.delete(e.pointerId);
		const g = gesture.current;
		if (!g) return;
		if (g.kind === "pinch") {
			if (pointers.current.size === 0) gesture.current = null;
			return;
		}
		gesture.current = null;
		setCursor(undefined);
		if (isPathGesture(g)) {
			releasePath(controller, g);
			setDraft({});
			return;
		}
		const world = toWorld(local(e));
		switch (g.kind) {
			case "press":
				if (!g.hit && !g.shift) controller.select([]);
				else if (g.hit && !g.shift) controller.select([g.hit]);
				break;
			case "move":
			case "resize":
			case "rotate":
				controller.endTx();
				break;
			case "gradient":
				if (g.handle.part !== "line") controller.endTx();
				else {
					const { key, index } = g.target;
					const fill = gradientWithStopAt(g.target, g.startWorld);
					controller.edit((t) => withGradient(t, key, index, fill));
				}
				break;
			case "pen": {
				const path = penPath();
				if (g.close && path) finishPen({ ...path, closed: true });
				return;
			}
			case "create": {
				const box = rectFrom(g.startWorld, world, {
					square: e.shiftKey,
					fromCenter: e.altKey,
				});
				const zoom = controller.state.view.zoom;
				const tiny = box.width * zoom < 4 && box.height * zoom < 4;
				const key = controller.create(g.tool, tiny ? null : box, g.startWorld, {
					parent: g.parent,
				});
				if (key && g.tool === "text") controller.beginTextEdit(key);
				break;
			}
		}
		setDraft({});
	};

	const onDoubleClick = (e: React.MouseEvent) => {
		if (onControl(e)) return;
		const t = controller.template;
		if (!t || controller.state.tool !== "move") return;
		if (controller.state.pathEdit) {
			togglePointAt(controller, local(e), "mouse");
			return;
		}
		const world = toWorld(local(e));
		const deep = controller.hitTest(world, { deep: true });
		if (!deep) return;
		const selected = controller.state.selection;
		const el = getElement(t, deep);
		if (selected.includes(deep) && el && "type" in el && el.type === "vector") {
			controller.beginPathEdit(deep);
			return;
		}
		if (selected.includes(deep) && el && "type" in el && el.type === "text") {
			if (controller.beginTextEdit(deep)) return;
			controller.dispatch({ type: "setRightTab", tab: "design" });
			controller.dispatch({ type: "setPanels", panels: { right: true } });
			requestAnimationFrame(() =>
				window.dispatchEvent(new CustomEvent("freshcoat:focus-text")),
			);
			return;
		}
		// Drill one level towards the layer under the pointer.
		let k: string | null = deep;
		let next = deep;
		while (k) {
			const parent = parentKeyOf(k);
			if (parent && selected.includes(parent)) {
				next = k;
				break;
			}
			if (!parent) next = selected.some((s) => isAncestor(s, deep)) ? deep : k;
			k = parent;
		}
		controller.select([next]);
	};

	const cursorStyle =
		cursor ??
		(spaceHeld || tool === "hand"
			? "grab"
			: CREATE_KIND[tool] || tool === "image" || tool === "pen"
				? "crosshair"
				: "default");

	return (
		<ContextMenu
			className="size-full"
			menu={<LayerMenuItems />}
			menuProps={{ "aria-label": "Layer actions" }}
			isDisabled={!template || textEditing}
			onOpen={(e) => {
				const r = ref.current?.getBoundingClientRect();
				if (
					!r ||
					onControl(e) ||
					e.clientX < r.left ||
					e.clientX >= r.right ||
					e.clientY < r.top ||
					e.clientY >= r.bottom
				)
					return;
				const hit = controller.hitTest(
					toWorld({ x: e.clientX - r.left, y: e.clientY - r.top }),
				);
				if (!hit) controller.select([]);
				else if (!controller.state.selection.includes(hit))
					controller.select([hit]);
			}}
		>
			<div
				ref={ref}
				data-testid="viewport"
				role="application"
				aria-label="Canvas"
				className="relative size-full touch-none select-none overflow-hidden bg-fc-pasteboard"
				style={{ cursor: cursorStyle }}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={onPointerUp}
				onPointerLeave={() => {
					if (!gesture.current)
						controller.dispatch({ type: "hover", key: null });
				}}
				onDoubleClick={onDoubleClick}
				onDrop={(e) => {
					const images = [...e.dataTransfer.files].filter((f) =>
						f.type.startsWith("image/"),
					);
					if (!template || images.length === 0) return;
					e.preventDefault();
					e.stopPropagation();
					const at = toWorld(local(e));
					void (async () => {
						for (const [i, file] of images.entries())
							await controller.placeImage(file, {
								x: at.x + i * 20,
								y: at.y + i * 20,
							});
					})();
				}}
			>
				{template ? (
					<>
						<div
							className="absolute flex text-fc-muted text-fc-sm"
							style={{
								left: Math.round(view.x),
								top: Math.round(view.y) - 20,
								maxWidth: Math.max(40, template.width * view.zoom),
							}}
							data-canvas-control
						>
							<SideMenu className="data-hovered:text-fc-text" />
						</div>
						<div
							ref={artboardRef}
							data-testid="artboard"
							className="fc-checkerboard absolute shadow-(--shadow-fc-artboard) ring-1 ring-fc-border"
							style={{
								left: Math.round(view.x),
								top: Math.round(view.y),
								width: Math.round(template.width * view.zoom),
								height: Math.round(template.height * view.zoom),
								// With print guides the overlay masks the corners outside
								// the trim, so the edge and shadow follow the trim too.
								borderRadius: guides
									? printGuidesFor(template).corner * view.zoom || undefined
									: undefined,
							}}
						>
							{!canvas || fontsLoading ? (
								<div className="absolute inset-0 grid place-items-center text-fc-faint text-fc-sm">
									{renderStatus === "error" ? "Couldn't render" : "Rendering…"}
								</div>
							) : null}
						</div>
						<Overlay drafts={drafts} />
						<TextEditor />
						<Guides />
						<Rulers />
					</>
				) : null}
			</div>
		</ContextMenu>
	);
}

/** Whether `e` is on a control drawn over the canvas, not on the canvas. */
function onControl(e: { target: EventTarget }): boolean {
	return (
		e.target instanceof Element && !!e.target.closest("[data-canvas-control]")
	);
}

/** Whether the gesture holds an open history transaction. */
function inTransaction(g: Gesture | null): boolean {
	if (!g) return false;
	if (g.kind === "gradient") return g.handle.part !== "line";
	if (isPathGesture(g)) return g.tx;
	return g.kind === "move" || g.kind === "resize" || g.kind === "rotate";
}

function abandonGesture(controller: EditorController, g: Gesture | null) {
	if (inTransaction(g)) controller.cancelTx();
}

function rectFrom(
	a: Point,
	b: Point,
	opts: { square?: boolean; fromCenter?: boolean } = {},
): Rect {
	let w = b.x - a.x;
	let h = b.y - a.y;
	if (opts.square) {
		const s = Math.max(Math.abs(w), Math.abs(h));
		w = Math.sign(w || 1) * s;
		h = Math.sign(h || 1) * s;
	}
	if (opts.fromCenter)
		return {
			x: a.x - Math.abs(w),
			y: a.y - Math.abs(h),
			width: Math.abs(w) * 2,
			height: Math.abs(h) * 2,
			rotation: 0,
		};
	return {
		x: Math.min(a.x, a.x + w),
		y: Math.min(a.y, a.y + h),
		width: Math.abs(w),
		height: Math.abs(h),
		rotation: 0,
	};
}

/** Layers at the selection's depth (the side's top level when nothing is
 *  selected) whose painted bounds meet the marquee. */
function marqueeHits(
	controller: EditorController,
	box: Rect,
	before: string[],
): string[] {
	const { geometry, locked, hidden } = controller.state;
	const depthParent = before[0] ? parentKeyOf(before[0]) : null;
	const out: string[] = [];
	for (const [key, entry] of geometry) {
		if (key.endsWith("/bg") || key.includes("/-1")) continue;
		if (entry.parentKey !== depthParent) continue;
		if (locked.has(key) || hidden.has(key)) continue;
		const b = layerBounds(key, geometry);
		if (!b) continue;
		if (
			b.x < box.x + box.width &&
			b.x + b.width > box.x &&
			b.y < box.y + box.height &&
			b.y + b.height > box.y
		)
			out.push(key);
	}
	return out;
}

/** A selected frame without auto layout under the point: new layers go in it. */
function frameUnder(
	controller: EditorController,
	p: Point,
): string | undefined {
	const t = controller.template;
	if (!t) return undefined;
	for (const key of controller.state.selection) {
		const el = getElement(t, key);
		const r = controller.state.geometry.get(key)?.rect;
		if (
			el &&
			"type" in el &&
			el.type === "frame" &&
			!el.properties.layout &&
			r &&
			!r.rotation &&
			p.x >= r.x &&
			p.x <= r.x + r.width &&
			p.y >= r.y &&
			p.y <= r.y + r.height
		)
			return key;
	}
	return undefined;
}

export function isTyping(target: EventTarget | null): boolean {
	const el = target as HTMLElement | null;
	if (!el) return false;
	return (
		el.isContentEditable ||
		el.tagName === "INPUT" ||
		el.tagName === "TEXTAREA" ||
		el.tagName === "SELECT"
	);
}
