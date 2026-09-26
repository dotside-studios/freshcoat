import type {
	FigmaBoundingBox,
	FigmaContainerNode,
	FigmaNode,
	FigmaSolidPaint,
} from "../types";
import { figmaColorToHex, figmaPaintToFill, mapStrokeAlign } from "./colors";
import { FlattenFallbackError, placeLocal, placeWorld } from "./coordinates";

const PRIMARY_ALIGN: Record<string, string> = {
	MIN: "start",
	CENTER: "center",
	MAX: "end",
	SPACE_BETWEEN: "space-between",
};
const CROSS_ALIGN: Record<string, string> = {
	MIN: "start",
	CENTER: "center",
	MAX: "end",
	// BASELINE is deferred (spec non-goal) → fall back to start.
	BASELINE: "start",
};
const SIZING: Record<string, "fixed" | "hug" | "fill"> = {
	FIXED: "fixed",
	HUG: "hug",
	FILL: "fill",
};

export function layoutFromContainer(
	node: FigmaContainerNode,
	scale: number,
): Record<string, unknown> | undefined {
	if (node.layoutMode === undefined || node.layoutMode === "NONE")
		return undefined;
	const direction = node.layoutMode === "HORIZONTAL" ? "row" : "column";
	const out: Record<string, unknown> = { direction };
	if (node.itemSpacing) out.gap = Math.round(node.itemSpacing * scale * 2) / 2;
	const wrap = node.layoutWrap === "WRAP";
	if (wrap) out.wrap = true;
	if (wrap && node.counterAxisSpacing != null) {
		out.crossGap = Math.round(node.counterAxisSpacing * scale * 2) / 2;
	}
	const padding = {
		top: Math.round((node.paddingTop ?? 0) * scale * 2) / 2,
		right: Math.round((node.paddingRight ?? 0) * scale * 2) / 2,
		bottom: Math.round((node.paddingBottom ?? 0) * scale * 2) / 2,
		left: Math.round((node.paddingLeft ?? 0) * scale * 2) / 2,
	};
	if (padding.top || padding.right || padding.bottom || padding.left)
		out.padding = padding;
	if (node.primaryAxisAlignItems && node.primaryAxisAlignItems !== "MIN") {
		out.primaryAlign = PRIMARY_ALIGN[node.primaryAxisAlignItems];
	}
	if (node.counterAxisAlignItems && node.counterAxisAlignItems !== "MIN") {
		out.crossAlign = CROSS_ALIGN[node.counterAxisAlignItems];
	}
	return out;
}

export function layoutChildFromNode(
	node: FigmaNode,
	scale: number,
): Record<string, unknown> | undefined {
	const out: Record<string, unknown> = {};
	if (node.layoutSizingHorizontal)
		out.width = SIZING[node.layoutSizingHorizontal];
	if (node.layoutSizingVertical) out.height = SIZING[node.layoutSizingVertical];
	if (node.layoutGrow) out.grow = node.layoutGrow > 0 ? 1 : 0;
	if (node.layoutAlign === "STRETCH") out.align = "stretch";
	if (node.layoutPositioning === "ABSOLUTE") out.absolute = true;
	const min: Record<string, number> = {};
	if (node.minWidth != null) min.width = Math.round(node.minWidth * scale);
	if (node.minHeight != null) min.height = Math.round(node.minHeight * scale);
	if (Object.keys(min).length > 0) out.min = min;
	const max: Record<string, number> = {};
	if (node.maxWidth != null) max.width = Math.round(node.maxWidth * scale);
	if (node.maxHeight != null) max.height = Math.round(node.maxHeight * scale);
	if (Object.keys(max).length > 0) out.max = max;
	return Object.keys(out).length > 0 ? out : undefined;
}

export type TranspileFrameContext = {
	outerFrame: FigmaBoundingBox;
	scale: number;
	worldAnchor?: { x: number; y: number };
	// Set when this frame is inside a rotated ancestor. A rotated frame also
	// freezes itself. Frozen ⇒ omit the live `layout` block so coatfile's
	// (rotation-unaware) auto-layout re-flow doesn't misplace a rotated group;
	// the baked child positions render as-authored under the painter's rotation.
	freezeLayout?: boolean;
};

// Builds the outer shell of a native frame element. Children are filled
// in by the caller after walking the frame's subtree with the frame's
// own bbox as the new local coordinate origin (so children's pos comes
// out frame-local, matching the coatfile schema convention).
export function transpileFrame(
	node: FigmaContainerNode,
	ctx: TranspileFrameContext,
) {
	const placed = ctx.worldAnchor
		? placeWorld(node, ctx.worldAnchor, ctx.scale)
		: placeLocal(node, ctx.scale);
	if ("fallback" in placed) throw new FlattenFallbackError(node.id);
	const visibleFills = (node.fills ?? []).filter((f) => f.visible !== false);

	const out: {
		id: string;
		type: "frame";
		pos: { x: number; y: number };
		size: { width: number; height: number };
		rotation?: number;
		opacity?: number;
		properties: {
			fill?: unknown;
			stroke?: {
				color: string;
				width: number;
				align?: "inside" | "outside";
			};
			cornerRadius?: number;
			clipsContent?: boolean;
			layout?: unknown;
			children: unknown[];
		};
	} = {
		id: node.name.replace(/[^a-zA-Z0-9_]/g, "_") || node.id.replace(":", "_"),
		type: "frame",
		pos: placed.pos,
		size: placed.size,
		...(placed.rotation !== 0 ? { rotation: placed.rotation } : {}),
		properties: { children: [] },
	};

	if (visibleFills.length === 1) {
		const result = figmaPaintToFill(visibleFills[0], placed.size);
		if (result.kind === "solid") {
			out.properties.fill = result.hex;
			if (result.opacity < 1) out.opacity = result.opacity;
		} else {
			out.properties.fill = result.value;
		}
	} else if (visibleFills.length > 1) {
		out.properties.fill = visibleFills.map((f) => {
			const r = figmaPaintToFill(f, placed.size);
			return r.kind === "solid" ? r.hex : r.value;
		});
	}

	if (node.cornerRadius !== undefined && node.cornerRadius > 0) {
		out.properties.cornerRadius =
			Math.round(node.cornerRadius * ctx.scale * 2) / 2;
	}

	if (
		node.strokes &&
		node.strokes.length > 0 &&
		node.strokeWeight !== undefined
	) {
		const stroke = node.strokes[0] as FigmaSolidPaint;
		const align = mapStrokeAlign(node.strokeAlign);
		out.properties.stroke = {
			color: figmaColorToHex(stroke.color),
			width: Math.round(node.strokeWeight * ctx.scale * 2) / 2,
			...(align ? { align } : {}),
		};
	}

	if (node.clipsContent === true) {
		out.properties.clipsContent = true;
	}

	// A rotated frame (or one inside a rotated ancestor) bakes its layout: emit
	// no live `layout` block, since coatfile's auto-layout re-flow isn't
	// rotation-aware and would re-lay-out the group in the wrong space.
	const frozen = ctx.freezeLayout || placed.rotation !== 0;
	const layout = frozen ? undefined : layoutFromContainer(node, ctx.scale);
	if (layout) {
		out.properties.layout = layout;
	}

	return out;
}
