import type { GroupNode, MaskNode, Node, PathNode } from "../node";
import type { ResolvedFill, Size, Stroke, ViewBox } from "../types";
import { translate } from "./matrix";
import {
	type SvgDrawing,
	type SvgItem,
	type SvgPaint,
	type SvgShape,
	viewBoxMatrix,
} from "./parse";
import { normalizePath, serializePath, transformPath } from "./path";

/** Lowers a drawing to a scene subtree at the origin, sized to `size` (default
 *  the drawing's own). Content outside the box is clipped, as SVG's root is. */
export function svgToNode(drawing: SvgDrawing, size?: Size): GroupNode {
	const box = size ?? { width: drawing.width, height: drawing.height };
	const [sx, , , sy, tx, ty] = viewBoxMatrix(
		drawing.viewBox,
		box.width,
		box.height,
		drawing.preserveAspectRatio,
	);
	const ox = -tx / sx;
	const oy = -ty / sy;
	const viewBox: ViewBox = {
		x: 0,
		y: 0,
		width: box.width / sx,
		height: box.height / sy,
	};
	const shift = translate(-ox, -oy);
	const origin = { x: 0, y: 0 };

	const fill = (p: SvgPaint): ResolvedFill => {
		if (p.kind === "solid") return p;
		const fx = (x: number) => (x - ox) / viewBox.width;
		const fy = (y: number) => (y - oy) / viewBox.height;
		if (p.kind === "linear")
			return {
				kind: "linear",
				from: { x: fx(p.x1), y: fy(p.y1) },
				to: { x: fx(p.x2), y: fy(p.y2) },
				stops: p.stops,
			};
		const longest = Math.max(viewBox.width, viewBox.height);
		return {
			kind: "radial",
			center: { x: fx(p.cx), y: fy(p.cy) },
			radius: p.rx / longest,
			radiusY: p.ry / longest,
			rotation: p.rotation,
			stops: p.stops,
		};
	};

	const path = (s: SvgShape): PathNode => {
		const node: PathNode = {
			kind: "path",
			pos: origin,
			size: box,
			viewBox,
			d: serializePath(transformPath(normalizePath(s.d), shift)),
			fills: s.fill ? [fill(s.fill)] : [],
		};
		if (s.id) node.id = s.id;
		if (s.fillRule === "evenodd") node.fillRule = "evenodd";
		if (s.stroke) node.stroke = s.stroke satisfies Stroke;
		if (s.opacity !== undefined) node.opacity = s.opacity;
		return node;
	};

	const group = (children: Node[]): GroupNode => ({
		kind: "group",
		pos: origin,
		size: box,
		children,
	});

	const lower = (item: SvgItem): Node => {
		if (item.kind === "shape") return path(item);
		const children = item.children.map(lower);
		let node: Node | null = null;
		if (item.clip)
			node = {
				kind: "mask",
				pos: origin,
				size: box,
				mask: group(item.clip.map(path)),
				children,
			} satisfies MaskNode;
		if (item.mask)
			node = {
				kind: "mask",
				pos: origin,
				size: box,
				mask: group(item.mask.map(lower)),
				children: node ? [node] : children,
				channel: "luminance",
			} satisfies MaskNode;
		node ??= group(children);
		if (item.id) node.id = item.id;
		if (item.opacity !== undefined) node.opacity = item.opacity;
		return node;
	};

	return { ...group(drawing.children.map(lower)), clip: true };
}
