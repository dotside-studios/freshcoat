import { useMemo } from "react";
import { activeVariantId } from "~/doc/variant-edit";
import { useEditor } from "~/state/hooks";
import { present, type View } from "~/state/store";
import {
	collectSeparations,
	toggleInkHidden,
	useHiddenInks,
	useSeparationsShown,
} from "./separations";

function useSeparations() {
	const shown = useSeparationsShown();
	const template = useEditor((s) => (shown ? present(s) : null));
	const side = useEditor((s) => s.side);
	const variantId = useEditor((s) => s.variantId);
	const values = useEditor((s) => s.values);
	return useMemo(() => {
		const frameName = template?.template_data[side]?.name;
		if (!template || frameName === undefined) return null;
		try {
			return collectSeparations(template, {
				frameName,
				values,
				variantId: activeVariantId(template, variantId),
			});
		} catch {
			return null;
		}
	}, [template, side, variantId, values]);
}

/**
 * Each fill and stroke the active side prints in a spot ink, outlined and
 * tinted in the ink's preview color on the overlay. The painted side never
 * sees it, so exports and thumbnails stay clean.
 */
export function SeparationsPreview({ view }: { view: View }) {
	const separations = useSeparations();
	const hidden = useHiddenInks();
	if (!separations) return null;
	const colors = new Map(separations.inks.map((i) => [i.name, i.color]));
	const shapes = separations.shapes.filter((s) => !hidden.has(s.ink));
	if (shapes.length === 0) return null;
	return (
		<g
			data-testid="separations-preview"
			transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}
		>
			{shapes.map((s) => {
				const color = colors.get(s.ink);
				return s.paint === "fill" ? (
					<path
						key={`${s.id}-fill`}
						d={s.path}
						fill={color}
						fillOpacity={0.4}
						fillRule={s.fillRule}
						stroke={color}
						strokeWidth={1}
						vectorEffect="non-scaling-stroke"
						data-ink={s.ink}
						data-paint="fill"
						data-layer-id={s.id}
					/>
				) : (
					<path
						key={`${s.id}-stroke`}
						d={s.path}
						fill="none"
						stroke={color}
						strokeWidth={3}
						strokeOpacity={0.8}
						vectorEffect="non-scaling-stroke"
						data-ink={s.ink}
						data-paint="stroke"
						data-layer-id={s.id}
					/>
				);
			})}
		</g>
	);
}

/** The active side's inks, each a button that shows or hides its plate in
 *  the preview. */
export function SeparationsLegend() {
	const separations = useSeparations();
	const hidden = useHiddenInks();
	if (!separations) return null;
	return (
		<div
			className="absolute top-2 right-2 z-10 flex max-w-52 flex-col gap-0.5 rounded-[3px] border border-fc-border bg-fc-panel p-1 text-fc-sm shadow-(--shadow-fc-popover)"
			data-testid="separations-legend"
			data-canvas-control
		>
			{separations.inks.length === 0 ? (
				<span className="px-1 py-0.5 text-fc-faint">No spot inks</span>
			) : (
				separations.inks.map((ink) => {
					const off = hidden.has(ink.name);
					return (
						<button
							key={ink.name}
							type="button"
							aria-pressed={!off}
							onClick={() => toggleInkHidden(ink.name)}
							className="flex items-center gap-2 rounded-[3px] px-1 py-0.5 text-left text-fc-text hover:bg-fc-hover"
							data-testid="separations-ink"
							data-ink={ink.name}
						>
							<span
								className="size-3 shrink-0 rounded-full border"
								style={{
									background: off ? "transparent" : ink.color,
									borderColor: ink.color,
								}}
							/>
							<span className={`truncate ${off ? "text-fc-faint" : ""}`}>
								{ink.name}
							</span>
							{ink.overprint && (
								<span className="ml-auto shrink-0 text-fc-faint">
									Overprint
								</span>
							)}
						</button>
					);
				})
			)}
		</div>
	);
}
