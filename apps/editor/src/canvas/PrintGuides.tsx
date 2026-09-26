import { useEditor } from "~/state/hooks";
import { present, type View } from "~/state/store";
import {
	printGuideMetrics,
	printGuidesOn,
	usePrintGuidesVersion,
} from "./print-guides";

/**
 * The trim corners and the safe area, drawn on the overlay: the painted side
 * never sees them, so exports, the snapshot hook and thumbnails stay clean.
 * The corners outside the trim radius are covered in the pasteboard colour,
 * so the artboard reads as the cut card.
 */
export function PrintGuides({ view }: { view: View }) {
	usePrintGuidesVersion();
	const size = useEditor((s) => {
		const t = present(s);
		if (!t) return null;
		const on = printGuidesOn(s.workspace?.activeTemplateId, t);
		return on ? `${t.width}x${t.height}` : null;
	});
	if (!size) return null;
	const [width, height] = size.split("x").map(Number) as [number, number];
	const { corner, safe } = printGuideMetrics({ width, height });

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
	const inset = safe * z;

	return (
		<g data-testid="print-guides" data-safe={safe} data-corner={corner}>
			<path
				d={`${trim}${rounded}`}
				fillRule="evenodd"
				className="fill-fc-pasteboard"
				data-testid="print-guides-corners"
			/>
			<rect
				x={x + inset}
				y={y + inset}
				width={Math.max(0, w - inset * 2)}
				height={Math.max(0, h - inset * 2)}
				rx={Math.max(0, r - inset)}
				className="fill-none stroke-fc-guide"
				strokeWidth={1}
				strokeDasharray="4 3"
				opacity={0.9}
				data-testid="print-guides-safe"
			/>
		</g>
	);
}
