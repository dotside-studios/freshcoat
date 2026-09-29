import type {
	FigmaBoundingBox,
	FigmaRectangleNode,
	FigmaSolidPaint,
} from "../types";
import {
	figmaColorToHex,
	fillsToElement,
	mapStrokeAlign,
	mapStrokeCap,
	mapStrokeJoin,
} from "./colors";
import { FlattenFallbackError, placeLocal, placeWorld } from "./coordinates";

export type TranspileRectContext = {
	frame: FigmaBoundingBox;
	scale: number;
	worldAnchor?: { x: number; y: number };
};

export function transpileRect(
	node: FigmaRectangleNode,
	ctx: TranspileRectContext,
) {
	const placed = ctx.worldAnchor
		? placeWorld(node, ctx.worldAnchor, ctx.scale)
		: placeLocal(node, ctx.scale);
	if ("fallback" in placed) {
		throw new FlattenFallbackError(node.id);
	}
	const { pos, size, rotation } = placed;

	const out: {
		id: string;
		type: "rect";
		pos: { x: number; y: number };
		size: { width: number; height: number };
		rotation?: number;
		opacity?: number;
		properties: {
			fill?: unknown;
			stroke?: {
				color: string;
				width: number;
				cap?: "round" | "square";
				join?: "round" | "bevel";
				align?: "inside" | "outside";
			};
			cornerRadius?: number | [number, number, number, number];
		};
	} = {
		id: node.name.replace(/[^a-zA-Z0-9_]/g, "_") || node.id.replace(":", "_"),
		type: "rect",
		pos,
		size,
		...(rotation !== 0 ? { rotation } : {}),
		properties: {},
	};

	const painted = fillsToElement(node.fills, size);
	if (painted.fill !== undefined) out.properties.fill = painted.fill;
	if (painted.opacity !== undefined) out.opacity = painted.opacity;

	// Per-corner rounding survives as a [topLeft, topRight, bottomRight,
	// bottomLeft] tuple: a shape with three square corners and one rounded is
	// common enough that collapsing it to a single number, or dropping it for
	// not being one, visibly changes the design.
	const corners = scaleCorners(node.cornerRadius, ctx.scale);
	if (corners !== undefined) out.properties.cornerRadius = corners;

	if (
		node.strokes &&
		node.strokes.length > 0 &&
		node.strokeWeight !== undefined
	) {
		const stroke = node.strokes[0] as FigmaSolidPaint;
		const cap = mapStrokeCap(node.strokeCap);
		const join = mapStrokeJoin(node.strokeJoin);
		const align = mapStrokeAlign(node.strokeAlign);
		out.properties.stroke = {
			color: figmaColorToHex(stroke.color),
			width: Math.round(node.strokeWeight * ctx.scale * 2) / 2,
			...(cap ? { cap } : {}),
			...(join ? { join } : {}),
			...(align ? { align } : {}),
		};
	}

	return out;
}

const halfPx = (n: number, scale: number): number =>
	Math.round(n * scale * 2) / 2;

export function scaleCorners(
	cornerRadius: number | [number, number, number, number] | undefined,
	scale: number,
): number | [number, number, number, number] | undefined {
	if (typeof cornerRadius === "number") {
		return cornerRadius > 0 ? halfPx(cornerRadius, scale) : undefined;
	}
	if (!Array.isArray(cornerRadius)) return undefined;
	if (!cornerRadius.some((c) => c > 0)) return undefined;
	const [tl, tr, br, bl] = cornerRadius;
	return [
		halfPx(tl, scale),
		halfPx(tr, scale),
		halfPx(br, scale),
		halfPx(bl, scale),
	];
}
