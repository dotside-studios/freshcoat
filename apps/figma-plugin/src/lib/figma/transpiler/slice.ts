import type { TemplateWarning } from "@freshcoat-js/coatfile";
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
