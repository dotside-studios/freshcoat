import { useEditor } from "~/state/hooks";
import { present, type View } from "~/state/store";
import {
	type PrintGuideSet,
	printGuidesFor,
	printGuidesOn,
	usePrintGuidesVersion,
} from "./print-guides";

/**
 * The trim corners, the safe area and the bleed, drawn on the overlay: the
 * painted side never sees them, so exports, the snapshot hook and thumbnails
 * stay clean. On a CR80 card the corners outside the trim radius are covered
 * in the pasteboard colour, so the artboard reads as the cut card.
 */
export function PrintGuides({ view }: { view: View }) {
	usePrintGuidesVersion();
	const key = useEditor((s) => {
		const t = present(s);
		if (!t || !printGuidesOn(s.workspace?.activeTemplateId, t)) return null;
		return JSON.stringify([t.width, t.height, printGuidesFor(t)]);
	});
	if (!key) return null;
	const [width, height, { corner, safe, bleed }] = JSON.parse(key) as [
		number,
		number,
		PrintGuideSet,
	];

	const z = view.zoom;
	const x = view.x;
	const y = view.y;
	const w = width * z;
	const h = height * z;
	const r = corner * z;
	const trim = `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
	const rounded =
		`M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}` +
		`V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}` +
		`H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}` +
		`V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
	const hasBleed =
		bleed.top > 0 || bleed.right > 0 || bleed.bottom > 0 || bleed.left > 0;

	return (
		<g
			data-testid="print-guides"
			data-safe={safe?.top}
			data-corner={corner}
			data-bleed={hasBleed ? bleed.top : undefined}
		>
			{r > 0 ? (
				<path
					d={`${trim}${rounded}`}
					fillRule="evenodd"
					className="fill-fc-pasteboard"
					data-testid="print-guides-corners"
				/>
			) : null}
			{hasBleed ? (
				<rect
					x={x - bleed.left * z}
					y={y - bleed.top * z}
					width={w + (bleed.left + bleed.right) * z}
					height={h + (bleed.top + bleed.bottom) * z}
					className="fill-none stroke-fc-guide"
					strokeWidth={1}
					strokeDasharray="2 3"
					opacity={0.9}
					data-testid="print-guides-bleed"
				/>
			) : null}
			{safe ? (
				<rect
					x={x + safe.left * z}
					y={y + safe.top * z}
					width={Math.max(0, w - (safe.left + safe.right) * z)}
					height={Math.max(0, h - (safe.top + safe.bottom) * z)}
					rx={Math.max(
						0,
						r - Math.min(safe.top, safe.right, safe.bottom, safe.left) * z,
					)}
					className="fill-none stroke-fc-guide"
					strokeWidth={1}
					strokeDasharray="4 3"
					opacity={0.9}
					data-testid="print-guides-safe"
				/>
			) : null}
		</g>
	);
}
