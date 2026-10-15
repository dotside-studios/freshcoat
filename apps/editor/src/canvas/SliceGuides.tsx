import { type ResolvedSlice, resolveSlices } from "@freshcoat-js/coatfile";
import { useMemo } from "react";
import { activeVariantId } from "~/doc/variant-edit";
import { useEditor } from "~/state/hooks";
import { present, type View } from "~/state/store";
import { useSeparationsShown } from "./separations";
import { SLICE_EDGE, useSlicesShown } from "./slice-guides";

const LABEL_SIZE = 10;

/**
 * Every slice of the active side outlined on the overlay, as an export would
 * resolve them for the current record and variant: the painted side never sees
 * them (also while the separations preview is on), so exports, the snapshot hook and thumbnails stay clean. Pieces carry
 * their name above the top-left corner of their box.
 */
export function SliceGuides({ view }: { view: View }) {
	const slicesOn = useSlicesShown();
	const shown = useSeparationsShown() || slicesOn;
	const template = useEditor((s) => (shown ? present(s) : null));
	const side = useEditor((s) => s.side);
	const variantId = useEditor((s) => s.variantId);
	const values = useEditor((s) => s.values);
	const slices = useMemo(() => {
		const frameName = template?.template_data[side]?.name;
		if (!template || frameName === undefined) return [];
		try {
			return resolveSlices(template, {
				frameName,
				values,
				variantId: activeVariantId(template, variantId),
			});
		} catch {
			return [];
		}
	}, [template, side, variantId, values]);
	if (slices.length === 0) return null;

	const { x, y, zoom } = view;
	return (
		<g data-testid="slice-guides">
			<g transform={`translate(${x} ${y}) scale(${zoom})`}>
				{slices.map((s) => (
					<path
						key={s.id}
						d={s.path}
						className={`fill-none ${SLICE_EDGE[s.edge].stroke}`}
						strokeWidth={1}
						strokeDasharray={SLICE_EDGE[s.edge].dash}
						vectorEffect="non-scaling-stroke"
						data-slice-id={s.id}
						data-slice-edge={s.edge}
						data-slice-output={s.output}
					/>
				))}
			</g>
			{slices.map((s) => (
				<SliceLabel key={s.id} slice={s} view={view} />
			))}
		</g>
	);
}

function SliceLabel({ slice, view }: { slice: ResolvedSlice; view: View }) {
	if (slice.output !== "piece") return null;
	return (
		<text
			x={view.x + slice.box.x * view.zoom}
			y={view.y + slice.box.y * view.zoom - 3}
			fontSize={LABEL_SIZE}
			className={`font-sans ${SLICE_EDGE[slice.edge].text}`}
			data-testid="slice-label"
			data-slice-id={slice.id}
		>
			{slice.name}
		</text>
	);
}
