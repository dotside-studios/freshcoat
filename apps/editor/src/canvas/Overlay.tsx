import { useCoarsePointer } from "@freshcoat-js/ui/data-table";
import type { ReactNode } from "react";
import {
	ancestorRects,
	canTransform,
	centreOf,
	type Guide,
	HANDLES,
	type Handle,
	type LayerGeometry,
	type Point,
	type Rect,
	unionRects,
	worldCorners,
} from "~/doc/geometry";
import { type PenPath, penPathData } from "~/doc/pen";
import { useEditor } from "~/state/hooks";
import type { View } from "~/state/store";
import { GradientHandles } from "./gradient-handles";
import { PrintGuides } from "./PrintGuides";

export type OverlayDraft = {
	marquee?: Rect;
	create?: Rect;
	guides?: Guide[];
	angle?: { at: Point; value: number };
	/** A gradient handle is being dragged, so its handles stay up. */
	gradient?: boolean;
};

/** The path the pen tool is drawing, and where the pointer is. */
export type PenDraft = { path: PenPath; cursor?: Point };

const HANDLE_CURSOR: Record<Handle, string> = {
	n: "ns-resize",
	s: "ns-resize",
	e: "ew-resize",
	w: "ew-resize",
	ne: "nesw-resize",
	sw: "nesw-resize",
	nw: "nwse-resize",
	se: "nwse-resize",
};

export function Overlay({
	draft,
	pen,
}: {
	draft: OverlayDraft;
	pen?: PenDraft | null;
}) {
	const view = useEditor((s) => s.view);
	const geometry = useEditor((s) => s.geometry);
	const selection = useEditor((s) => s.selection);
	const hover = useEditor((s) => s.hover);
	const tool = useEditor((s) => s.tool);
	const inTx = useEditor((s) => s.doc?.history.tx !== undefined);
	const coarse = useCoarsePointer();

	const toScreen = (p: Point) => ({
		x: view.x + p.x * view.zoom,
		y: view.y + p.y * view.zoom,
	});
	const outline = (key: string) => {
		const box = geometry.get(key);
		if (!box) return null;
		return worldCorners(box.rect, ancestorRects(key, geometry)).map(toScreen);
	};

	const selected = selection.filter((k) => geometry.has(k));
	const gradient =
		(!inTx || draft.gradient) && !draft.marquee && !draft.create ? (
			<GradientHandles view={view} coarse={coarse} />
		) : null;
	const transformable =
		tool === "move" &&
		selected.length > 0 &&
		selected.every((k) => canTransform(k, geometry));

	return (
		<svg
			className="pointer-events-none absolute inset-0 size-full overflow-visible"
			aria-hidden="true"
			data-testid="overlay"
		>
			<PrintGuides view={view} />
			{hover && !selection.includes(hover) ? (
				<Poly
					points={outline(hover)}
					className="stroke-fc-accent"
					width={1.5}
				/>
			) : null}
			{selected.map((key) => (
				<Poly
					key={key}
					points={outline(key)}
					className="stroke-fc-accent"
					width={1}
				/>
			))}
			{selected.length > 0 ? (
				<SelectionBox
					keys={selected}
					geometry={geometry}
					view={view}
					handles={transformable}
					rotate={transformable && selected.length === 1}
					coarse={coarse}
					between={gradient}
				/>
			) : (
				gradient
			)}
			{draft.guides?.map((g, i) => {
				const a = toScreen({ x: g.x1, y: g.y1 });
				const b = toScreen({ x: g.x2, y: g.y2 });
				return (
					<line
						// biome-ignore lint/suspicious/noArrayIndexKey: guides have no identity
						key={i}
						x1={a.x}
						y1={a.y}
						x2={b.x}
						y2={b.y}
						className="stroke-fc-guide"
						strokeWidth={1}
					/>
				);
			})}
			{draft.marquee ? (
				<ScreenRect
					rect={draft.marquee}
					view={view}
					className="fill-fc-accent-soft stroke-fc-accent"
				/>
			) : null}
			{draft.create ? (
				<>
					<ScreenRect
						rect={draft.create}
						view={view}
						className="fill-none stroke-fc-accent"
					/>
					<Label
						at={toScreen({
							x: draft.create.x + draft.create.width / 2,
							y: draft.create.y + draft.create.height,
						})}
						text={`${fmt(draft.create.width)} × ${fmt(draft.create.height)}`}
					/>
				</>
			) : null}
			{pen ? <PenOverlay pen={pen} view={view} /> : null}
			{draft.angle ? (
				<Label
					at={{
						...toScreen(draft.angle.at),
						y: toScreen(draft.angle.at).y + 18,
					}}
					text={`${fmt(draft.angle.value)}°`}
				/>
			) : null}
		</svg>
	);
}

function PenOverlay({ pen, view }: { pen: PenDraft; view: View }) {
	const toScreen = (p: Point) => ({
		x: view.x + p.x * view.zoom,
		y: view.y + p.y * view.zoom,
	});
	const screen: PenPath = {
		closed: false,
		points: pen.path.points.map((p) => ({
			...toScreen(p),
			...(p.in ? { in: toScreen(p.in) } : {}),
			...(p.out ? { out: toScreen(p.out) } : {}),
		})),
	};
	const first = screen.points[0];
	const last = screen.points.at(-1);
	const cursor = pen.cursor ? toScreen(pen.cursor) : null;
	const closing =
		!!first &&
		!!cursor &&
		screen.points.length >= 2 &&
		Math.hypot(cursor.x - first.x, cursor.y - first.y) <= 8;
	return (
		<g data-testid="pen-draft" data-points={pen.path.points.length}>
			<path
				d={penPathData(screen)}
				className="fill-none stroke-fc-accent"
				strokeWidth={1.5}
			/>
			{last && cursor ? (
				<path
					d={penPathData({
						closed: false,
						points: [
							last,
							closing && first ? { ...first, out: undefined } : cursor,
						],
					})}
					className="fill-none stroke-fc-accent"
					strokeWidth={1}
					strokeDasharray="4 3"
				/>
			) : null}
			{last?.in && last.out ? (
				<>
					<line
						x1={last.in.x}
						y1={last.in.y}
						x2={last.out.x}
						y2={last.out.y}
						className="stroke-fc-accent"
						strokeWidth={1}
					/>
					{[last.in, last.out].map((h) => (
						<circle
							key={`${h.x},${h.y}`}
							cx={h.x}
							cy={h.y}
							r={3}
							className="fill-white stroke-fc-accent"
							strokeWidth={1}
						/>
					))}
				</>
			) : null}
			{screen.points.map((p, i) => {
				const size = i === 0 && closing ? 10 : 7;
				return (
					<rect
						// biome-ignore lint/suspicious/noArrayIndexKey: anchors are ordered points
						key={i}
						x={p.x - size / 2}
						y={p.y - size / 2}
						width={size}
						height={size}
						className={
							i === screen.points.length - 1
								? "fill-fc-accent stroke-fc-accent"
								: "fill-white stroke-fc-accent"
						}
						strokeWidth={1}
					/>
				);
			})}
		</g>
	);
}

function SelectionBox({
	keys,
	geometry,
	view,
	handles,
	rotate,
	coarse,
	between,
}: {
	keys: string[];
	geometry: LayerGeometry;
	view: View;
	handles: boolean;
	rotate: boolean;
	coarse: boolean;
	/** Drawn over the edge handles and under the corner ones: a gradient's
	 *  default endpoints fall on edge midpoints, and a corner still resizes. */
	between?: ReactNode;
}) {
	const single = keys.length === 1 ? geometry.get(keys[0] as string) : null;
	const box: Rect | null = single
		? single.rect
		: unionRects(
				keys
					.map((k) => {
						const b = geometry.get(k);
						return b ? { ...b.rect } : null;
					})
					.filter((r): r is Rect => r !== null),
			);
	if (!box) return null;
	const ancestors = single ? ancestorRects(keys[0] as string, geometry) : [];
	const corners = worldCorners(box, ancestors).map((p) => ({
		x: view.x + p.x * view.zoom,
		y: view.y + p.y * view.zoom,
	}));
	const [nw, ne, se, sw] = corners as [Point, Point, Point, Point];
	const mid = (a: Point, b: Point) => ({
		x: (a.x + b.x) / 2,
		y: (a.y + b.y) / 2,
	});
	const at: Record<Handle, Point> = {
		nw,
		ne,
		se,
		sw,
		n: mid(nw, ne),
		e: mid(ne, se),
		s: mid(se, sw),
		w: mid(sw, nw),
	};
	const size = coarse ? 14 : 8;
	const angle = single ? single.worldRotation : 0;
	const centre = centreOf({
		x: Math.min(...corners.map((c) => c.x)),
		y: Math.min(...corners.map((c) => c.y)),
		width:
			Math.max(...corners.map((c) => c.x)) -
			Math.min(...corners.map((c) => c.x)),
		height:
			Math.max(...corners.map((c) => c.y)) -
			Math.min(...corners.map((c) => c.y)),
	});
	const small =
		Math.hypot(ne.x - nw.x, ne.y - nw.y) < size * 3 ||
		Math.hypot(sw.x - nw.x, sw.y - nw.y) < size * 3;
	const bottom = corners.reduce((a, c) => (c.y > a.y ? c : a));
	const resizeHandle = (h: Handle) => {
		const p = at[h];
		return (
			<rect
				key={h}
				data-handle={h}
				data-testid={`handle-${h}`}
				x={p.x - size / 2}
				y={p.y - size / 2}
				width={size}
				height={size}
				transform={`rotate(${angle} ${p.x} ${p.y})`}
				className="pointer-events-auto fill-white stroke-fc-accent"
				strokeWidth={1}
				style={{ cursor: HANDLE_CURSOR[h] }}
			/>
		);
	};

	return (
		<g>
			{keys.length > 1 ? (
				<polygon
					points={corners.map((c) => `${c.x},${c.y}`).join(" ")}
					className="fill-none stroke-fc-accent"
					strokeWidth={1}
				/>
			) : null}
			{rotate
				? (["nw", "ne", "se", "sw"] as Handle[]).map((h) => {
						const p = at[h];
						const dx = p.x - centre.x;
						const dy = p.y - centre.y;
						const len = Math.hypot(dx, dy) || 1;
						const off = coarse ? 18 : 12;
						return (
							<circle
								key={`r-${h}`}
								data-handle="rotate"
								cx={p.x + (dx / len) * off}
								cy={p.y + (dy / len) * off}
								r={coarse ? 14 : 10}
								className="pointer-events-auto fill-transparent"
								style={{ cursor: "crosshair" }}
							/>
						);
					})
				: null}
			{handles
				? HANDLES.filter((h) => h.length === 1 && !small).map(resizeHandle)
				: null}
			{between}
			{handles ? HANDLES.filter((h) => h.length === 2).map(resizeHandle) : null}
			<Label
				at={{ x: bottom.x, y: bottom.y + (handles ? size : 0) + 12 }}
				text={`${fmt(box.width)} × ${fmt(box.height)}`}
				accent
			/>
		</g>
	);
}

function Poly({
	points,
	className,
	width,
}: {
	points: Point[] | null;
	className: string;
	width: number;
}) {
	if (!points) return null;
	return (
		<polygon
			points={points.map((p) => `${p.x},${p.y}`).join(" ")}
			className={`fill-none ${className}`}
			strokeWidth={width}
		/>
	);
}

function ScreenRect({
	rect,
	view,
	className,
}: {
	rect: Rect;
	view: View;
	className: string;
}) {
	return (
		<rect
			x={view.x + rect.x * view.zoom}
			y={view.y + rect.y * view.zoom}
			width={rect.width * view.zoom}
			height={rect.height * view.zoom}
			className={className}
			strokeWidth={1}
		/>
	);
}

function Label({
	at,
	text,
	accent,
}: {
	at: Point;
	text: string;
	accent?: boolean;
}) {
	const w = text.length * 6.2 + 10;
	return (
		<g transform={`translate(${at.x - w / 2} ${at.y - 8})`}>
			<rect
				width={w}
				height={16}
				rx={2}
				className={accent ? "fill-fc-accent" : "fill-fc-raised"}
			/>
			<text
				x={w / 2}
				y={11.5}
				textAnchor="middle"
				className={`${accent ? "fill-white" : "fill-fc-text"} font-fc text-fc-xs tabular-nums`}
			>
				{text}
			</text>
		</g>
	);
}

function fmt(n: number): string {
	return String(Math.round(n * 10) / 10);
}
