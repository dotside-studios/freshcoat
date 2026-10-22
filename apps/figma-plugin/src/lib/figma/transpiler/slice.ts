import type { Element, TemplateWarning } from "@freshcoat-js/coatfile";
import { isOpenVector } from "@freshcoat-js/coatfile/internal";
import type { FigmaContainerNode, FigmaNode, FigmaSliceNode } from "../types";
import { isContainerNode, isSliceNode } from "../types";
import { FlattenFallbackError, placeWorld } from "./coordinates";
import { withoutGuides } from "./guides";

export type ImportedSlice = {
	node: FigmaSliceNode;
	el: Record<string, unknown>;
};

const elementId = (n: FigmaNode, name: string): string =>
	name.replace(/[^a-zA-Z0-9_]/g, "_") || n.id.replace(":", "_");

function placedSlice(
	n: FigmaSliceNode,
	anchor: { x: number; y: number },
	scale: number,
	warnings: TemplateWarning[],
): ImportedSlice | undefined {
	const placed = placeWorld(n, anchor, scale);
	if ("fallback" in placed) throw new FlattenFallbackError(n.id);
	const { pos, size, rotation } = placed;
	if (size.width <= 0 || size.height <= 0) {
		warnings.push({
			severity: "warn",
			code: "slice_empty",
			message: `Slice "${n.name}" covers no area, so it was skipped.`,
			nodeId: n.id,
		});
		return undefined;
	}
	const name = n.name.trim() || n.id.replace(":", "_");
	return {
		node: n,
		el: {
			id: elementId(n, name),
			type: "rect",
			pos,
			size,
			...(rotation !== 0 ? { rotation } : {}),
			properties: { slice: { name } },
		},
	};
}

/** Every visible Figma slice in the frame, however deep, as a top-level rect
 *  in the frame's own coordinates. A slice is an export region and paints
 *  nothing, so it is lifted out of the layer stack it was drawn in. */
export function importSlices(
	frame: FigmaContainerNode,
	scale: number,
	warnings: TemplateWarning[],
): ImportedSlice[] {
	const anchor = {
		x: frame.absoluteBoundingBox.x,
		y: frame.absoluteBoundingBox.y,
	};
	const found: ImportedSlice[] = [];
	const visit = (children: FigmaNode[]): void => {
		for (const n of children) {
			if (n.visible === false) continue;
			if (isSliceNode(n)) {
				try {
					const slice = placedSlice(n, anchor, scale, warnings);
					if (slice) found.push(slice);
				} catch (e) {
					if (!(e instanceof FlattenFallbackError)) throw e;
					warnings.push({
						severity: "warn",
						code: "slice_transform_unsupported",
						message: `Slice "${n.name}" is skewed or non-uniformly scaled, so it was skipped.`,
						nodeId: n.id,
					});
				}
			} else if (isContainerNode(n)) visit(n.children);
		}
	};
	visit(withoutGuides(frame.children ?? []));
	return found;
}

type SliceProps = { slice?: { name?: string } };

/** A slice name has to be unique on its side. The later of two that agree
 *  becomes `Name-2`, `Name-3`, skipping any name already taken. */
export function dedupeSliceNames(
	elements: unknown[],
	warnings: TemplateWarning[],
): void {
	const taken = new Set<string>();
	const sliced = elements.filter(
		(e): e is { id: string; properties: SliceProps } =>
			typeof e === "object" &&
			e !== null &&
			(e as { properties?: SliceProps }).properties?.slice !== undefined,
	);
	for (const el of sliced) {
		const slice = el.properties.slice;
		if (slice) taken.add(slice.name ?? el.id);
	}
	const seen = new Set<string>();
	for (const el of sliced) {
		const slice = el.properties.slice;
		if (!slice) continue;
		const name = slice.name ?? el.id;
		if (!seen.has(name)) {
			seen.add(name);
			continue;
		}
		let n = 2;
		while (taken.has(`${name}-${n}`)) n++;
		const renamed = `${name}-${n}`;
		taken.add(renamed);
		seen.add(renamed);
		slice.name = renamed;
		warnings.push({
			severity: "warn",
			code: "slice_name_renamed",
			message: `More than one slice is named "${name}". This one was renamed "${renamed}" so each piece keeps its own file name.`,
		});
	}
}

type MarkerEdge = "none" | "through" | "kiss" | "score" | "perforate";
export type SliceMarker = { name: string; edge: MarkerEdge };

const EDGE_OF: Record<string, MarkerEdge> = {
	slice: "none",
	cut: "through",
	kiss: "kiss",
	score: "score",
	perforate: "perforate",
};

const SLICE_MARKER = /^(.*?)\s*#(slice|cut|kiss|score|perforate)\s*$/is;

/** Reads a trailing `#slice`, `#cut`, `#kiss`, `#score` or `#perforate` off a
 *  layer name. The name that is left over is the slice's. */
export function parseSliceMarker(layerName: string): SliceMarker | null {
	const m = SLICE_MARKER.exec(layerName);
	if (!m) return null;
	return { name: m[1].trim(), edge: EDGE_OF[m[2].toLowerCase()] };
}

/** Marks a rect or vector as a slice, if the layer is one and sits directly in
 *  the frame. Anything else keeps its name and says why the marker did nothing. */
export function applySliceMarker(
	n: FigmaNode,
	el: Record<string, unknown>,
	marker: SliceMarker,
	topLevel: boolean,
	warnings: TemplateWarning[],
): void {
	const warn = (code: string, message: string): void => {
		warnings.push({ severity: "warn", code, message, nodeId: n.id });
	};
	if (el.type !== "rect" && el.type !== "vector") {
		warnSliceMarkerOnNonShape(n, warnings);
		return;
	}
	if (!topLevel) {
		warn(
			"slice_marker_not_top_level",
			`Layer "${n.name}" is marked as a slice, but a slice has to sit directly in the frame, not inside a group, frame or mask. The marker was ignored.`,
		);
		return;
	}
	const name = marker.name || n.id.replace(":", "_");
	const open = isOpenVector(el as Element);
	if (open) thickenFlatBox(el);
	el.id = elementId(n, name);
	(el.properties as Record<string, unknown>).slice = {
		name,
		...(open ? { output: "none" } : {}),
		...(marker.edge !== "none" ? { edge: marker.edge } : {}),
	};
	if (open && marker.edge === "none")
		warn(
			"slice_open_path_piece",
			`Layer "${n.name}" is an open path, which has no region to make a piece of. Mark it #cut, #kiss, #score or #perforate to make it a cut line.`,
		);
}

// A straight line has no extent across itself, and a slice needs a box with
// area. The box grows to one unit across, with the path left on its first
// edge, and turning about the new center would move a rotated line, so the
// box is nudged back until the line sits where it did.
function thickenFlatBox(el: Record<string, unknown>): void {
	const size = el.size as { width: number; height: number };
	const pos = el.pos as { x: number; y: number };
	if (size.width > 0 && size.height > 0) return;
	const grow = { x: size.width > 0 ? 0 : 0.5, y: size.height > 0 ? 0 : 0.5 };
	const rad = (((el.rotation as number | undefined) ?? 0) * Math.PI) / 180;
	const turned = {
		x: grow.x * Math.cos(rad) - grow.y * Math.sin(rad),
		y: grow.x * Math.sin(rad) + grow.y * Math.cos(rad),
	};
	el.pos = { x: pos.x - (grow.x - turned.x), y: pos.y - (grow.y - turned.y) };
	el.size = {
		width: size.width > 0 ? size.width : 1,
		height: size.height > 0 ? size.height : 1,
	};
}

export function warnSliceMarkerOnNonShape(
	n: FigmaNode,
	warnings: TemplateWarning[],
): void {
	warnings.push({
		severity: "warn",
		code: "slice_marker_not_shape",
		message: `Layer "${n.name}" is marked as a slice, but only a shape that becomes a rectangle or a vector can be one. The marker was ignored.`,
		nodeId: n.id,
	});
}
