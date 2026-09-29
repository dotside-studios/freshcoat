import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { useEditor } from "~/state/hooks";
import { RULER_SIZE, rulerLabel, rulerTicks, selectionExtent } from "./rulers";

type Axis = "x" | "y";

const EDGE_LABEL_ROOM = 30;

/** Top and left rulers in design px, over the canvas's edges. */
export function Rulers() {
	const on = useEditor((s) => s.rulers && s.doc !== null);
	if (!on) return null;
	return (
		<>
			<Ruler axis="x" />
			<Ruler axis="y" />
			<div
				data-testid="ruler-corner"
				aria-hidden="true"
				className="absolute top-0 left-0 z-10 border-fc-border border-r border-b bg-fc-panel"
				style={{ width: RULER_SIZE, height: RULER_SIZE }}
				onPointerDown={(e) => e.stopPropagation()}
			/>
		</>
	);
}

function Ruler({ axis }: { axis: Axis }) {
	const ref = useRef<HTMLDivElement>(null);
	const length = useLength(ref, axis);
	const view = useEditor((s) => s.view);
	const selection = useEditor((s) => s.selection);
	const geometry = useEditor((s) => s.geometry);
	const extent = useMemo(() => {
		const e = selectionExtent(selection, geometry);
		return e ? e[axis] : null;
	}, [selection, geometry, axis]);

	const origin = axis === "x" ? view.x : view.y;
	const ticks = rulerTicks(origin, view.zoom, length);
	const toScreen = (v: number) => origin + v * view.zoom;
	const edges = extent?.map(toScreen) ?? [];
	const horizontal = axis === "x";
	const S = RULER_SIZE;

	return (
		<div
			ref={ref}
			data-testid={`ruler-${axis}`}
			data-zoom={view.zoom}
			data-origin={origin}
			className={
				horizontal
					? "absolute top-0 right-0 left-0 z-10 overflow-hidden border-fc-border border-b bg-fc-panel"
					: "absolute top-0 bottom-0 left-0 z-10 overflow-hidden border-fc-border border-r bg-fc-panel"
			}
			style={horizontal ? { height: S } : { width: S }}
			onPointerDown={(e) => e.stopPropagation()}
		>
			<svg
				aria-hidden="true"
				className="absolute inset-0 size-full"
				data-testid={`ruler-${axis}-ticks`}
			>
				{extent ? (
					<rect
						data-testid={`ruler-${axis}-selection`}
						data-from={extent[0]}
						data-to={extent[1]}
						className="fill-fc-accent-soft"
						{...(horizontal
							? {
									x: edges[0],
									y: 0,
									width: Math.max(1, (edges[1] ?? 0) - (edges[0] ?? 0)),
									height: S,
								}
							: {
									x: 0,
									y: edges[0],
									width: S,
									height: Math.max(1, (edges[1] ?? 0) - (edges[0] ?? 0)),
								})}
					/>
				) : null}
				{ticks.map((t) => {
					const len = t.major ? S : S / 4;
					return (
						<line
							key={t.value}
							{...(horizontal
								? { x1: t.at, x2: t.at, y1: S - len, y2: S }
								: { y1: t.at, y2: t.at, x1: S - len, x2: S })}
							className={
								t.major ? "stroke-fc-faint" : "stroke-fc-border-strong"
							}
							strokeWidth={1}
							shapeRendering="crispEdges"
						/>
					);
				})}
				{ticks
					.filter(
						(t) =>
							t.major &&
							t.at > S &&
							!edges.some((e) => Math.abs(e - t.at) < EDGE_LABEL_ROOM),
					)
					.map((t) => (
						<text
							key={`l${t.value}`}
							{...(horizontal
								? { x: t.at + 3, y: 9 }
								: {
										x: 14,
										y: t.at + 3,
										textAnchor: "end",
										transform: `rotate(-90 14 ${t.at + 3})`,
									})}
							className="fill-fc-muted font-fc text-[9px] tabular-nums"
						>
							{rulerLabel(t.value)}
						</text>
					))}
				{extent
					? extent.map((v, i) => {
							const at = edges[i] as number;
							return (
								<g key={i === 0 ? "from" : "to"}>
									<line
										{...(horizontal
											? { x1: at, x2: at, y1: 0, y2: S }
											: { y1: at, y2: at, x1: 0, x2: S })}
										className="stroke-fc-accent"
										strokeWidth={1}
										shapeRendering="crispEdges"
									/>
									<EdgeLabel
										horizontal={horizontal}
										at={at}
										before={i === 0}
										text={rulerLabel(Math.round(v * 10) / 10)}
									/>
								</g>
							);
						})
					: null}
			</svg>
		</div>
	);
}

function EdgeLabel({
	horizontal,
	at,
	before,
	text,
}: {
	horizontal: boolean;
	at: number;
	before: boolean;
	text: string;
}) {
	const w = text.length * 5.4 + 6;
	const along = before ? at - w - 1 : at + 1;
	const box = horizontal
		? { x: along, y: 2, width: w, height: 11 }
		: { x: 2, y: along, width: 11, height: w };
	const cx = box.x + box.width / 2;
	const cy = box.y + box.height / 2;
	return (
		<g>
			<rect {...box} rx={2} className="fill-fc-accent" />
			<text
				x={cx}
				y={cy + 3}
				textAnchor="middle"
				transform={horizontal ? undefined : `rotate(-90 ${cx} ${cy})`}
				className="fill-white font-fc text-[9px] tabular-nums"
			>
				{text}
			</text>
		</g>
	);
}

function useLength(ref: RefObject<HTMLDivElement | null>, axis: Axis): number {
	const [length, setLength] = useState(0);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const measure = () => {
			const r = el.getBoundingClientRect();
			setLength(axis === "x" ? r.width : r.height);
		};
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, [ref, axis]);
	return length;
}
