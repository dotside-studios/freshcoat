import { scalePathData } from "@freshcoat-js/engine/path";
import type {
	FigmaBoundingBox,
	FigmaSolidPaint,
	FigmaVectorNode,
} from "../types";
import { vectorFillRule } from "./classify";
import {
	figmaColorToHex,
	fillsToElement,
	mapStrokeAlign,
	mapStrokeCap,
	mapStrokeJoin,
} from "./colors";
import { FlattenFallbackError, placeLocal, placeWorld } from "./coordinates";

export type TranspileVectorContext = {
	frame: FigmaBoundingBox;
	scale: number;
	worldAnchor?: { x: number; y: number };
};

export function transpileVector(
	node: FigmaVectorNode,
	ctx: TranspileVectorContext,
) {
	const placed = ctx.worldAnchor
		? placeWorld(node, ctx.worldAnchor, ctx.scale)
		: placeLocal(node, ctx.scale);
	if ("fallback" in placed) {
		throw new FlattenFallbackError(node.id);
	}
	const { pos, size, rotation } = placed;
	// fillGeometry paths are in node-local pixel coords (Figma's bounding-box
	// local space). Scale by ctx.scale to land in author-space; the
	// coatfile element's pos handles where the path origin sits, so we
	// don't shift the path itself, only scale it. Every region joins one `d`:
	// classify() only lets a vector through when they share a fill rule.
	const geometry = node.fillGeometry ?? [];
	const d = geometry.map((g) => scalePathData(g.path, ctx.scale)).join(" ");
	const fillRule = vectorFillRule(geometry);

	const out: {
		id: string;
		type: "vector";
		pos: { x: number; y: number };
		size: { width: number; height: number };
		rotation?: number;
		opacity?: number;
		properties: {
			d: string;
			fillRule?: "evenodd";
			fill?: unknown;
			stroke?: {
				color: string;
				width: number;
				cap?: "round" | "square";
				join?: "round" | "bevel";
				align?: "inside" | "outside";
			};
		};
	} = {
		id: node.name.replace(/[^a-zA-Z0-9_]/g, "_") || node.id.replace(":", "_"),
		type: "vector",
		pos,
		size,
		...(rotation !== 0 ? { rotation } : {}),
		properties: { d, ...(fillRule ? { fillRule } : {}) },
	};

	const painted = fillsToElement(node.fills, size);
	if (painted.fill !== undefined) out.properties.fill = painted.fill;
	if (painted.opacity !== undefined) out.opacity = painted.opacity;

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
