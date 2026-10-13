import { hasInsets, type Sides, templateBleed } from "@freshcoat-js/coatfile";
import { useEditor } from "~/state/hooks";
import { type View, working } from "~/state/store";
import { useBleedShown } from "./bleed-view";
import {
	type PrintGuideSet,
	printGuidesFor,
	printGuidesOn,
	usePrintGuidesVersion,
} from "./print-guides";

/** How much of the pasteboard covers what lies past the trim. */
export const BLEED_SHADE = 0.6;

/**
 * The trim corners, the safe area and the bleed, drawn on the overlay: the
 * painted side never sees them, so exports, the snapshot hook and thumbnails
 * stay clean. On a CR80 card the corners outside the trim radius are covered
 * in the pasteboard colour, so the artboard reads as the cut card.
 */
export function PrintGuides({ view }: { view: View }) {
	usePrintGuidesVersion();
	const bleedShown = useBleedShown();
	const key = useEditor((s) => {
		const t = working(s);
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
	const hasBleed = hasInsets(bleed);

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
					opacity={hasBleed && bleedShown ? BLEED_SHADE : undefined}
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

/**
 * The pasteboard laid over the painted bleed, so it reads as cut off and the
 * trim stays clear.
 */
export function BleedShade({ view }: { view: View }) {
	const shown = useBleedShown();
	const key = useEditor((s) => {
		const t = working(s);
		if (!t || !shown) return null;
		const b = templateBleed(t);
		return hasInsets(b) ? JSON.stringify([t.width, t.height, b]) : null;
	});
	if (!key) return null;
	const [width, height, b] = JSON.parse(key) as [number, number, Sides];
	const z = view.zoom;
	const x = view.x;
	const y = view.y;
	const w = width * z;
	const h = height * z;
	const ox = x - b.left * z;
	const oy = y - b.top * z;
	const ow = w + (b.left + b.right) * z;
	const oh = h + (b.top + b.bottom) * z;
	return (
		<path
			d={`M${ox} ${oy}H${ox + ow}V${oy + oh}H${ox}ZM${x} ${y}H${x + w}V${y + h}H${x}Z`}
			fillRule="evenodd"
			className="fill-fc-pasteboard"
			opacity={BLEED_SHADE}
			data-testid="bleed-shade"
		/>
	);
}
