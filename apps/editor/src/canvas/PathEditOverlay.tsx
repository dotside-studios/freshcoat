import { useMemo } from "react";
import type { Point } from "~/doc/geometry";
import { getElement } from "~/doc/path";
import {
	frameToWorld,
	mapPath,
	parseVectorPath,
	sameRef,
	vectorFrame,
	vectorPathData,
} from "~/doc/vector-edit";
import { useEditor } from "~/state/hooks";
import { working } from "~/state/store";

/** The points of the vector being edited: its outline, every anchor and
 *  handle, and where a click on the path would add a point. */
export function PathEditOverlay({ hover }: { hover?: Point }) {
	const edit = useEditor((s) => s.pathEdit);
	const view = useEditor((s) => s.view);
	const geometry = useEditor((s) => s.geometry);
	const template = useEditor(working);
	const el = template && edit ? getElement(template, edit.key) : undefined;
	const d = el && "type" in el && el.type === "vector" ? el.properties.d : null;
	const paths = useMemo(() => (d === null ? [] : parseVectorPath(d)), [d]);
	const frame =
		template && edit ? vectorFrame(template, edit.key, geometry) : null;
	if (!edit || !frame) return null;

	const toScreen = (p: Point) => {
		const w = frameToWorld(frame, p);
		return { x: view.x + w.x * view.zoom, y: view.y + w.y * view.zoom };
	};
	const screen = paths.map((p) => mapPath(p, toScreen));
	const at = hover
		? { x: view.x + hover.x * view.zoom, y: view.y + hover.y * view.zoom }
		: null;

	return (
		<g
			data-testid="path-edit"
			data-points={paths.flatMap((p) => p.points).length}
		>
			{screen.map((path, i) => (
				<path
					// biome-ignore lint/suspicious/noArrayIndexKey: subpaths are ordered
					key={i}
					d={vectorPathData([path])}
					className="fill-none stroke-fc-accent"
					strokeWidth={1.5}
				/>
			))}
			{screen.flatMap((path, i) =>
				path.points.flatMap((p, j) =>
					[p.in, p.out].map((h, k) =>
						h ? (
							<g
								// biome-ignore lint/suspicious/noArrayIndexKey: handles are ordered per anchor
								key={`h-${i}-${j}-${k}`}
							>
								<line
									x1={p.x}
									y1={p.y}
									x2={h.x}
									y2={h.y}
									className="stroke-fc-accent"
									strokeWidth={1}
								/>
								<circle
									cx={h.x}
									cy={h.y}
									r={3}
									className="fill-white stroke-fc-accent"
									strokeWidth={1}
								/>
							</g>
						) : null,
					),
				),
			)}
			{screen.flatMap((path, i) =>
				path.points.map((p, j) => {
					const picked = edit.selected.some((r) =>
						sameRef(r, { path: i, index: j }),
					);
					return (
						<rect
							// biome-ignore lint/suspicious/noArrayIndexKey: anchors are ordered points
							key={`p-${i}-${j}`}
							data-testid={`path-point-${i}-${j}`}
							data-selected={picked}
							x={p.x - 3.5}
							y={p.y - 3.5}
							width={7}
							height={7}
							className={
								picked
									? "fill-fc-accent stroke-fc-accent"
									: "fill-white stroke-fc-accent"
							}
							strokeWidth={1}
						/>
					);
				}),
			)}
			{at ? (
				<circle
					data-testid="path-hover"
					cx={at.x}
					cy={at.y}
					r={4}
					className="fill-fc-accent-soft stroke-fc-accent"
					strokeWidth={1}
				/>
			) : null}
		</g>
	);
}
