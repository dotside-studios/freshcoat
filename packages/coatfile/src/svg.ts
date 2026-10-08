import {
	type Box,
	estimateTextWidth,
	type Matrix,
	normalizePath,
	parseSvg,
	pathBounds,
	type Segment,
	type SvgImage,
	type SvgItem,
	type SvgPaint,
	type SvgShape,
	type SvgText,
	type SvgWarning,
	serializePath,
	transformPath,
	viewBoxMatrix,
} from "@freshcoat-js/engine/svg";
import { linearGradientAngle } from "./gradient";
import type {
	Element,
	Fill,
	FontWeight,
	FrameElement,
	ImageElement,
	MaskElement,
	TextElement,
	VectorElement,
} from "./types";

export type SvgToElementsOptions = {
	/** The root frame's id. Default "svg". */
	id?: string;
	/** Turns a wanted id into one not yet used. Default: `-2`, `-3` suffixes
	 *  among the ids this call produces. */
	uniqueId?: (base: string) => string;
	/** Scales the drawing down, keeping its aspect, to fit within this size. */
	maxSize?: { width: number; height: number };
};

export type SvgElements = { element: FrameElement; warnings: SvgWarning[] };

type Placed = { element: Element; box: Box };

// Where a line's baseline sits below its box's top, and the line's height, in
// ems. Close for common fonts at a line height of 1.2.
const BASELINE = 0.95;
const LINE_HEIGHT = 1.2;
// How much wider than its estimated width a line's box is made, so a font that
// runs wider than the estimate does not wrap.
const WIDTH_ALLOWANCE = 1.5;

const round = (n: number) => {
	const r = Math.round(n * 1e4) / 1e4;
	return Object.is(r, -0) ? 0 : r;
};

function color(hex: string): string {
	return hex.length === 9 && hex.endsWith("ff") ? hex.slice(0, 7) : hex;
}

function union(boxes: Box[]): Box | null {
	if (boxes.length === 0) return null;
	const x = Math.min(...boxes.map((b) => b.x));
	const y = Math.min(...boxes.map((b) => b.y));
	return {
		x,
		y,
		width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
		height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
	};
}

/** Converts SVG markup to one frame of editable layers in design px. Throws
 *  SvgError for markup that is not an SVG document. */
export function svgToElements(
	markup: string,
	options: SvgToElementsOptions = {},
): SvgElements {
	const drawing = parseSvg(markup);
	const fit = options.maxSize
		? Math.min(
				1,
				options.maxSize.width / drawing.width,
				options.maxSize.height / drawing.height,
			)
		: 1;
	const width = drawing.width * fit;
	const height = drawing.height * fit;
	const m: Matrix = viewBoxMatrix(
		drawing.viewBox,
		width,
		height,
		drawing.preserveAspectRatio,
	);
	const [sx, , , sy] = m;
	const k = Math.sqrt(Math.abs(sx * sy));
	const used = new Set<string>();
	const uniqueId =
		options.uniqueId ??
		((base: string) => {
			let id = base;
			for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
			used.add(id);
			return id;
		});

	const rootId = uniqueId(options.id ?? "svg");

	const fill = (p: SvgPaint, b: Box): Fill => {
		if (p.kind === "solid") return color(p.color);
		const stops = p.stops.map((s) => ({ offset: s.offset, color: color(s.color) }));
		const w = b.width || 1;
		const h = b.height || 1;
		const at = (x: number, y: number): [number, number] => [
			round((sx * x + m[4] - b.x) / w),
			round((sy * y + m[5] - b.y) / h),
		];
		if (p.kind === "linear") {
			const from = at(p.x1, p.y1);
			const to = at(p.x2, p.y2);
			return {
				kind: "linear",
				angle: round(linearGradientAngle(from, to)),
				from,
				to,
				stops,
				...(p.spread ? { spread: p.spread } : {}),
			};
		}
		const longest = Math.max(w, h);
		return {
			kind: "radial",
			center: at(p.cx, p.cy),
			radius: round((p.rx * Math.abs(sx)) / longest),
			radiusY: round((p.ry * Math.abs(sy)) / longest),
			...(p.rotation ? { rotation: round(p.rotation) } : {}),
			...(p.fx !== undefined && p.fy !== undefined
				? { focus: at(p.fx, p.fy) }
				: {}),
			...(p.fr ? { focusRadius: round((p.fr * Math.abs(sx)) / longest) } : {}),
			stops,
			...(p.spread ? { spread: p.spread } : {}),
		};
	};

	const shape = (s: SvgShape): Placed | null => {
		const segs: Segment[] = transformPath(normalizePath(s.d), m);
		const b = pathBounds(segs);
		if (!b) return null;
		const props: VectorElement["properties"] = {
			d: serializePath(transformPath(segs, [1, 0, 0, 1, -b.x, -b.y])),
		};
		if (s.fillRule === "evenodd") props.fillRule = "evenodd";
		if (s.fill) props.fill = fill(s.fill, b);
		if (s.stroke) {
			const { color: c, width, dash, cap, join } = s.stroke;
			props.stroke = {
				color: color(c),
				width: round(width * k),
				...(dash ? { dash: dash.map((d) => round(d * k)) } : {}),
				...(cap ? { cap } : {}),
				...(join ? { join } : {}),
			};
		}
		const element: VectorElement = {
			id: uniqueId(s.id ?? "vector"),
			type: "vector",
			pos: { x: round(b.x), y: round(b.y) },
			size: { width: round(b.width), height: round(b.height) },
			properties: props,
		};
		if (s.opacity !== undefined) element.opacity = s.opacity;
		return { element, box: b };
	};

	const at = (x: number, y: number): [number, number] => [
		sx * x + m[4],
		sy * y + m[5],
	];

	// A box turned about `pivot` by `rotation`, as an element turned about its
	// own centre.
	const turned = (box: Box, rotation: number | undefined, pivot: [number, number]): Box => {
		if (!rotation) return box;
		const r = (rotation * Math.PI) / 180;
		const cx = box.x + box.width / 2 - pivot[0];
		const cy = box.y + box.height / 2 - pivot[1];
		return {
			...box,
			x: pivot[0] + cx * Math.cos(r) - cy * Math.sin(r) - box.width / 2,
			y: pivot[1] + cx * Math.sin(r) + cy * Math.cos(r) - box.height / 2,
		};
	};

	const image = (i: SvgImage): Placed => {
		const [x, y] = at(i.x, i.y);
		const box = { x, y, width: i.width * Math.abs(sx), height: i.height * Math.abs(sy) };
		const element: ImageElement = {
			id: uniqueId(i.id ?? "image"),
			type: "image",
			pos: { x: round(box.x), y: round(box.y) },
			size: { width: round(box.width), height: round(box.height) },
			properties: { src: i.href, fit: i.fit },
		};
		if (i.rotation) element.rotation = round(i.rotation);
		if (i.opacity !== undefined) element.opacity = i.opacity;
		return { element, box };
	};

	const text = (t: SvgText): Placed => {
		const runs = t.runs.map((r) => ({
			...r,
			font: { ...r.font, size: r.font.size * k },
		}));
		const base = runs[0] as (typeof runs)[number];
		const size = Math.max(...runs.map((r) => r.font.size));
		const width = estimateTextWidth(runs) * WIDTH_ALLOWANCE + size;
		const anchor = at(t.x, t.y);
		const left =
			t.anchor === "middle"
				? anchor[0] - width / 2
				: t.anchor === "end"
					? anchor[0] - width
					: anchor[0];
		const box = turned(
			{ x: left, y: anchor[1] - BASELINE * size, width, height: LINE_HEIGHT * size },
			t.rotation,
			anchor,
		);
		const fontOf = (f: (typeof runs)[number]["font"]) => ({
			family: f.family,
			size: round(f.size),
			...(f.weight !== 400 ? { weight: f.weight as FontWeight } : {}),
			...(f.style === "italic" ? { style: "italic" as const } : {}),
		});
		const same = runs.every(
			(r) =>
				r.color === base.color &&
				r.font.family === base.font.family &&
				r.font.size === base.font.size &&
				r.font.weight === base.font.weight &&
				r.font.style === base.font.style,
		);
		const properties: TextElement["properties"] = {
			font: { ...fontOf(base.font), lineHeight: LINE_HEIGHT },
			color: color(base.color),
			align: t.anchor === "middle" ? "center" : t.anchor === "end" ? "right" : "left",
		};
		if (same) properties.value = runs.map((r) => r.text).join("");
		else
			properties.spans = runs.map((r) => ({
				text: r.text,
				font: {
					family: r.font.family,
					size: round(r.font.size),
					weight: r.font.weight as FontWeight,
					style: r.font.style,
				},
				color: color(r.color),
			}));
		const element: TextElement = {
			id: uniqueId(t.id ?? "text"),
			type: "text",
			pos: { x: round(box.x), y: round(box.y) },
			size: { width: round(box.width), height: round(box.height) },
			properties,
		};
		if (t.rotation) element.rotation = round(t.rotation);
		if (t.opacity !== undefined) element.opacity = t.opacity;
		return { element, box };
	};

	const relative = (p: Placed, origin: Box): Element => ({
		...p.element,
		pos: { x: round(p.box.x - origin.x), y: round(p.box.y - origin.y) },
	});

	// Several items become one element: the item itself, or a frame of them.
	const single = (items: Placed[], id: string): Placed | null => {
		if (items.length === 1) return items[0] as Placed;
		const box = union(items.map((p) => p.box));
		if (!box) return null;
		return {
			box,
			element: {
				id: uniqueId(id),
				type: "frame",
				pos: { x: round(box.x), y: round(box.y) },
				size: { width: round(box.width), height: round(box.height) },
				properties: { children: items.map((p) => relative(p, box)) },
			},
		};
	};

	const item = (it: SvgItem): Placed | null => {
		if (it.kind === "shape") return shape(it);
		if (it.kind === "image") return image(it);
		if (it.kind === "text") return text(it);
		if (!it.id && it.opacity === undefined && !it.clip && !it.mask && it.children.length === 1)
			return item(it.children[0] as SvgItem);
		const children = it.children.map(item).filter((p): p is Placed => !!p);
		const box = union(children.map((p) => p.box));
		if (!box) return null;
		const size = { width: round(box.width), height: round(box.height) };
		const pos = { x: round(box.x), y: round(box.y) };
		let placed: Placed | null = null;
		const maskOf = (content: Placed[], id: string, luminance: boolean, inner: Placed[]): Placed | null => {
			const cover = single(content, id);
			if (!cover) return null;
			const element: MaskElement = {
				id: uniqueId("mask"),
				type: "mask",
				pos,
				size,
				properties: {
					mask: relative(cover, box),
					children: inner.map((p) => relative(p, box)),
					...(luminance ? { channel: "luminance" as const } : {}),
				},
			};
			return { element, box };
		};
		if (it.clip) {
			const clips = it.clip.map((c) => shape(c)).filter((p): p is Placed => !!p);
			placed = maskOf(clips, "clip", false, children);
		}
		if (it.mask) {
			const content = it.mask.map(item).filter((p): p is Placed => !!p);
			placed = maskOf(content, "mask-content", true, placed ? [placed] : children);
		}
		if (!placed)
			placed = {
				box,
				element: {
					id: uniqueId(it.id ?? "group"),
					type: "frame",
					pos,
					size,
					properties: { children: children.map((p) => relative(p, box)) },
				},
			};
		if (it.opacity !== undefined) placed.element.opacity = it.opacity;
		return placed;
	};

	const children = drawing.children.map(item).filter((p): p is Placed => !!p);
	const bounds = union(children.map((p) => p.box));
	const spills =
		!!bounds &&
		(bounds.x < -1e-6 ||
			bounds.y < -1e-6 ||
			bounds.x + bounds.width > width + 1e-6 ||
			bounds.y + bounds.height > height + 1e-6);
	const origin = { x: 0, y: 0, width, height };
	const element: FrameElement = {
		id: rootId,
		type: "frame",
		pos: { x: 0, y: 0 },
		size: { width: round(width), height: round(height) },
		properties: {
			children: children.map((p) => relative(p, origin)),
			...(spills ? { clipsContent: true } : {}),
		},
	};
	return { element, warnings: drawing.warnings };
}
