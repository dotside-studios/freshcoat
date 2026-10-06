import { scalePathData } from "@freshcoat-js/engine/path";
import type { FigmaBoundingBox, FigmaVectorNode } from "../types";
import { vectorFillRule } from "./classify";
import { type ElementStroke, fillsToElement, strokeToElement } from "./colors";
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
			stroke?: ElementStroke;
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

	const stroke = strokeToElement(node, ctx.scale);
	if (stroke) out.properties.stroke = stroke;

	return out;
}
