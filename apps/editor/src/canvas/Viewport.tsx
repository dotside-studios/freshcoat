import type { Template } from "@freshcoat-js/coatfile";
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
import type { ElementKind } from "~/doc/factories";
import {
	applyRect,
	canTransform,
	type Guide,
	type Handle,
	type LayerGeometry,
	layerBounds,
	mapRectInBox,
	type Point,
	type Rect,
	resizeRect,
	rotateFromPointer,
	type SnapCandidates,
	snapCandidates,
	snapMove,
	snapResize,
	translateLayers,
	unionRects,
} from "~/doc/geometry";
import { duplicateElements } from "~/doc/ops";
import { getElement, isAncestor, parentKeyOf } from "~/doc/path";
import { useEditor } from "~/state/hooks";
import type { Tool } from "~/state/store";
import { parseGradientHandle } from "./gradient-geometry";
import {
	draggedGradient,
	type GradientHandleRef,
	type GradientTarget,
	gradientTarget,
	gradientWithStopAt,
	withGradient,
} from "./gradient-handles";
import { Overlay, type OverlayDraft } from "./Overlay";
import {
	printGuidesFor,
	printGuidesOn,
	usePrintGuidesVersion,
} from "./print-guides";
import { useLiveRender } from "./use-live-render";

const DRAG_THRESHOLD = { mouse: 3, touch: 6 };
const SNAP_PX = 6;

const CREATE_KIND: Partial<Record<Tool, ElementKind>> = {
	frame: "frame",
	rect: "rect",
	ellipse: "ellipse",
	text: "text",
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
			key: string;
			base: Template;
			geometry: LayerGeometry;
			rect: Rect;
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
	| { kind: "create"; tool: ElementKind; startWorld: Point; parent?: string };

export function Viewport() {
	const controller = useController();
	const ref = useRef<HTMLDivElement>(null);
	const artboardRef = useRef<HTMLDivElement>(null);
	const template = useEditor((s) => s.doc?.history.present ?? null);
	const view = useEditor((s) => s.view);
	const tool = useEditor((s) => s.tool);
	const side = useEditor((s) => s.side);
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
	const [draft, setDraft] = useState<OverlayDraft>({});
	const [cursor, setCursor] = useState<string | undefined>();

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
	}, [controller]);

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

	const toWorld = useCallback(
		(p: Point): Point => {
			const v = controller.state.view;
			return { x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom };
		},
		[controller],
	);

	const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (!template) return;
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
		const candidates = snapCandidates(geometry, t, keys, state.hidden);
		if (name === "rotate") {
			const key = keys[0] as string;
			const rect = geometry.get(key)?.rect;
			if (!rect || keys.length > 1) return;
			controller.beginTx();
			gesture.current = {
				kind: "rotate",
				startWorld: world,
				key,
				base: t,
				geometry,
				rect,
			};
			return;
		}
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
			if (e.pointerType === "mouse" && state.tool === "move" && template) {
				const onHandle = (e.target as Element).closest?.("[data-handle]");
				const hit = onHandle ? null : controller.hitTest(world);
				if (hit !== state.hover)
					controller.dispatch({ type: "hover", key: hit });
			}
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
					g.rect,
					g.startWorld,
					world,
					g.rect.rotation,
					{ snap: e.shiftKey },
				);
				const out = applyRect(
					g.base,
					g.key,
					{ ...g.rect, rotation },
					g.geometry,
				);
				if (out.ok) controller.previewTx(out.template);
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
			candidates: snapCandidates(geometry, t, keys, state.hidden),
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
			case "create": {
				const box = rectFrom(g.startWorld, world, {
					square: e.shiftKey,
					fromCenter: e.altKey,
				});
				const zoom = controller.state.view.zoom;
				const tiny = box.width * zoom < 4 && box.height * zoom < 4;
				controller.create(g.tool, tiny ? null : box, g.startWorld, {
					parent: g.parent,
				});
				break;
			}
		}
		setDraft({});
	};

	const onDoubleClick = (e: React.MouseEvent) => {
		const t = controller.template;
		if (!t || controller.state.tool !== "move") return;
		const world = toWorld(local(e));
		const deep = controller.hitTest(world, { deep: true });
		if (!deep) return;
		const selected = controller.state.selection;
		const el = getElement(t, deep);
		if (selected.includes(deep) && el && "type" in el && el.type === "text") {
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
			: CREATE_KIND[tool] || tool === "image"
				? "crosshair"
				: "default");

	return (
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
				if (!gesture.current) controller.dispatch({ type: "hover", key: null });
			}}
			onDoubleClick={onDoubleClick}
			onContextMenu={(e) => e.preventDefault()}
		>
			{template ? (
				<>
					<div
						className="pointer-events-none absolute truncate text-fc-muted text-fc-sm"
						style={{
							left: Math.round(view.x),
							top: Math.round(view.y) - 20,
							maxWidth: Math.max(40, template.width * view.zoom),
						}}
					>
						{template.template_data[side]?.name}
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
					<Overlay draft={draft} />
				</>
			) : null}
		</div>
	);
}

/** Whether the gesture holds an open history transaction. */
function inTransaction(g: Gesture | null): boolean {
	if (!g) return false;
	if (g.kind === "gradient") return g.handle.part !== "line";
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
