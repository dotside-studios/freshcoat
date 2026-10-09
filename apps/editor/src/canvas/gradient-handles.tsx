import type { Template } from "@freshcoat-js/coatfile";
import {
	colorAt,
	fillsOf,
	fillsPatch,
	type Gradient,
	hasFills,
	insertStop,
	moveStop,
	withStops,
} from "@freshcoat-js/coatfile/fills";
import type { Point } from "~/doc/geometry";
import { updateElement } from "~/doc/ops";
import { getElement, keyOf, parentKeyOf } from "~/doc/path";
import { editedGradient, replaceAt } from "~/panels/design/fills";
import { useEditor } from "~/state/hooks";
import { type EditorState, type View, working } from "~/state/store";
import {
	dragHandle,
	frameOf,
	type GradientFrame,
	gradientHandles,
	type HandlePart,
	type parseGradientHandle,
	stopOffsetAt,
} from "./gradient-geometry";

/** The angular stop ring's radius on screen, in pixels. */
export const RING_PX = 44;

export type GradientTarget = {
	key: string;
	index: number;
	fill: Gradient;
	frame: GradientFrame;
};

export type GradientHandleRef = NonNullable<
	ReturnType<typeof parseGradientHandle>
>;

type TargetState = Pick<
	EditorState,
	| "doc"
	| "variantId"
	| "tool"
	| "selection"
	| "side"
	| "activeFill"
	| "geometry"
	| "hidden"
	| "locked"
>;

function concealed(key: string, s: TargetState): boolean {
	for (let k: string | null = key; k; k = parentKeyOf(k))
		if (s.hidden.has(k) || s.locked.has(k)) return true;
	return false;
}

/**
 * The gradient the canvas handles edit: on the one selected layer (or the
 * side's background, when nothing is selected and its gradient was last
 * opened in the inspector), the fill last opened, else the topmost gradient.
 */
export function gradientTarget(s: TargetState): GradientTarget | null {
	const t = working(s);
	if (!t || s.tool !== "move") return null;
	const bg = keyOf({ side: s.side, background: true });
	const key =
		s.selection.length === 1
			? (s.selection[0] as string)
			: s.selection.length === 0 && s.activeFill?.key === bg
				? bg
				: null;
	if (!key || concealed(key, s)) return null;
	const el = getElement(t, key);
	if (!el || !hasFills(el)) return null;
	const fills = fillsOf(el);
	const index = editedGradient(
		fills,
		s.activeFill?.key === key ? s.activeFill.index : null,
	);
	if (index === null) return null;
	const frame = frameOf(key, s.geometry);
	if (!frame) return null;
	return { key, index, fill: fills[index] as Gradient, frame };
}

/** The template with fill `index` of layer `key` replaced. */
export function withGradient(
	t: Template,
	key: string,
	index: number,
	fill: Gradient,
): Template {
	const el = getElement(t, key);
	if (!el) return t;
	const r = updateElement(t, key, {
		properties: fillsPatch(el, replaceAt(fillsOf(el), index, fill)),
	});
	return r.ok ? r.template : t;
}

/** The fill a drag of `handle` to `world` makes of the target's. */
export function draggedGradient(
	target: GradientTarget,
	handle: GradientHandleRef,
	world: Point,
	opts: { snap?: boolean } = {},
): Gradient {
	const { fill, frame } = target;
	if (handle.part === "line") return fill;
	if (handle.part === "stop") {
		const offset = stopOffsetAt(fill, frame, world);
		return withStops(fill, moveStop(fill.stops, handle.stop, offset).stops);
	}
	return dragHandle(fill, frame, handle.part, world, opts);
}

/** The fill with a stop added where `world` projects onto its line. */
export function gradientWithStopAt(
	target: GradientTarget,
	world: Point,
): Gradient {
	const offset = stopOffsetAt(target.fill, target.frame, world);
	return withStops(target.fill, insertStop(target.fill.stops, offset).stops);
}

// ── Drawing ──────────────────────────────────────────────────────────────────

const HALO = "fill-black/35";

/**
 * The edited gradient's handles, in the overlay's screen space. White with an
 * accent ring and a dark halo, so they read over any colour; stop dots show
 * their stop's colour.
 */
export function GradientHandles({
	view,
	coarse,
}: {
	view: View;
	coarse: boolean;
}) {
	const doc = useEditor((s) => s.doc);
	const tool = useEditor((s) => s.tool);
	const selection = useEditor((s) => s.selection);
	const side = useEditor((s) => s.side);
	const activeFill = useEditor((s) => s.activeFill);
	const geometry = useEditor((s) => s.geometry);
	const hidden = useEditor((s) => s.hidden);
	const locked = useEditor((s) => s.locked);
	const target = gradientTarget({
		doc,
		tool,
		selection,
		side,
		activeFill,
		geometry,
		hidden,
		locked,
	});
	if (!target) return null;

	const { fill, frame, index } = target;
	const h = gradientHandles(fill, frame, { ring: RING_PX / view.zoom });
	const s = (p: Point) => ({
		x: view.x + p.x * view.zoom,
		y: view.y + p.y * view.zoom,
	});
	const name = (part: string) => `grad:${index}:${part}`;
	const r = coarse ? 8 : 5.5;
	const dot = coarse ? 7 : 4.5;

	const points = Object.entries(h.points) as [HandlePart, Point][];
	const pointsOnScreen = points.map(([, p]) => s(p));
	const endColor: Partial<Record<HandlePart, string>> =
		fill.kind === "angular"
			? {}
			: {
					[fill.kind === "linear" ? "from" : "center"]: colorAt(fill.stops, 0),
					[fill.kind === "linear" ? "to" : "radius"]: colorAt(fill.stops, 1),
				};

	return (
		<g data-testid="gradient-handles" data-kind={fill.kind}>
			{h.guide ? <Rule a={s(h.guide[0])} b={s(h.guide[1])} dashed /> : null}
			{h.line ? (
				<>
					<Rule a={s(h.line[0])} b={s(h.line[1])} />
					<line
						data-handle={name("line")}
						x1={s(h.line[0]).x}
						y1={s(h.line[0]).y}
						x2={s(h.line[1]).x}
						y2={s(h.line[1]).y}
						className="pointer-events-auto stroke-transparent"
						strokeWidth={coarse ? 16 : 10}
						style={{ cursor: "copy", pointerEvents: "stroke" }}
					/>
				</>
			) : null}
			{h.ring ? (
				<>
					<Ring at={s(h.ring.center)} radius={RING_PX} />
					<Rule a={s(h.ring.center)} b={s(h.points.rotation as Point)} thin />
					<circle
						data-handle={name("line")}
						cx={s(h.ring.center).x}
						cy={s(h.ring.center).y}
						r={RING_PX}
						className="pointer-events-auto fill-none stroke-transparent"
						strokeWidth={coarse ? 16 : 10}
						style={{ cursor: "copy", pointerEvents: "stroke" }}
					/>
				</>
			) : null}
			{h.stops.map((stop) => {
				const at = s(stop.at);
				// A stop under a point handle is drawn by that handle.
				if (pointsOnScreen.some((p) => Math.hypot(p.x - at.x, p.y - at.y) < r))
					return null;
				return (
					<g
						key={`stop-${stop.index}`}
						data-handle={name(`stop:${stop.index}`)}
						className="pointer-events-auto"
						style={{ cursor: "grab" }}
					>
						<circle
							cx={at.x}
							cy={at.y}
							r={dot + 5}
							className="fill-transparent"
						/>
						<circle cx={at.x} cy={at.y} r={dot + 1.5} className={HALO} />
						<circle cx={at.x} cy={at.y} r={dot + 0.5} className="fill-white" />
						<circle
							cx={at.x}
							cy={at.y}
							r={dot - 1.5}
							style={{ fill: stop.color }}
						/>
					</g>
				);
			})}
			{points.map(([part, p]) => {
				const at = s(p);
				const color = endColor[part];
				return (
					<g
						key={part}
						data-handle={name(part)}
						className="pointer-events-auto"
						style={{ cursor: "move" }}
					>
						<circle
							cx={at.x}
							cy={at.y}
							r={r + 5}
							className="fill-transparent"
						/>
						<circle cx={at.x} cy={at.y} r={r + 1} className={HALO} />
						<circle
							cx={at.x}
							cy={at.y}
							r={r}
							className="fill-white stroke-fc-accent"
							strokeWidth={1.5}
						/>
						{color ? (
							<circle cx={at.x} cy={at.y} r={r - 2.5} style={{ fill: color }} />
						) : null}
					</g>
				);
			})}
		</g>
	);
}

function Rule({
	a,
	b,
	dashed,
	thin,
}: {
	a: Point;
	b: Point;
	dashed?: boolean;
	thin?: boolean;
}) {
	const dash = dashed ? "4 3" : undefined;
	return (
		<>
			<line
				x1={a.x}
				y1={a.y}
				x2={b.x}
				y2={b.y}
				className="stroke-black/35"
				strokeWidth={thin ? 2.5 : 3}
				strokeDasharray={dash}
			/>
			<line
				x1={a.x}
				y1={a.y}
				x2={b.x}
				y2={b.y}
				className="stroke-white"
				strokeWidth={thin ? 1 : 1.5}
				strokeDasharray={dash}
			/>
		</>
	);
}

function Ring({ at, radius }: { at: Point; radius: number }) {
	return (
		<>
			<circle
				cx={at.x}
				cy={at.y}
				r={radius}
				className="fill-none stroke-black/35"
				strokeWidth={3}
			/>
			<circle
				cx={at.x}
				cy={at.y}
				r={radius}
				className="fill-none stroke-white"
				strokeWidth={1.5}
			/>
		</>
	);
}
