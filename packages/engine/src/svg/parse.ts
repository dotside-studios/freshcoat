import { parseColor, type Rgba, toHex } from "../color";
import {
	applyMatrix,
	decompose,
	IDENTITY,
	invert,
	lengthScale,
	type Matrix,
	multiply,
	parseTransform,
	rotate,
	scale,
	translate,
} from "./matrix";
import {
	type Box,
	normalizePath,
	pathBounds,
	type Segment,
	serializePath,
	transformPath,
} from "./path";
import {
	type Declarations,
	indexRules,
	matchRules,
	parseStyleAttr,
	parseStyleSheet,
	type StyleRule,
} from "./style";
import { parseXml, SvgError, textContent, type XmlElement } from "./xml";

export type SvgStop = { offset: number; color: string };

export type SvgPaint =
	| { kind: "solid"; color: string }
	| {
			kind: "linear";
			x1: number;
			y1: number;
			x2: number;
			y2: number;
			stops: SvgStop[];
	  }
	| {
			kind: "radial";
			cx: number;
			cy: number;
			rx: number;
			ry: number;
			rotation: number;
			stops: SvgStop[];
	  };

export type SvgStroke = {
	color: string;
	width: number;
	dash?: number[];
	cap?: "butt" | "round" | "square";
	join?: "round" | "bevel" | "miter";
};

export type SvgShape = {
	kind: "shape";
	id?: string;
	d: string;
	fillRule: "nonzero" | "evenodd";
	fill?: SvgPaint;
	stroke?: SvgStroke;
	opacity?: number;
};

export type SvgGroup = {
	kind: "group";
	id?: string;
	opacity?: number;
	clip?: SvgShape[];
	mask?: SvgItem[];
	children: SvgItem[];
};

export type SvgImage = {
	kind: "image";
	id?: string;
	/** A `data:` URL. */
	href: string;
	/** The image's viewport in drawing space, before `rotation` turns it about
	 *  its centre. */
	x: number;
	y: number;
	width: number;
	height: number;
	rotation?: number;
	fit: "contain" | "cover" | "fill";
	opacity?: number;
};

export type SvgFont = {
	family: string;
	size: number;
	weight: number;
	style: "normal" | "italic";
};

export type SvgTextRun = { text: string; font: SvgFont; color: string };

export type SvgText = {
	kind: "text";
	id?: string;
	/** The start of the baseline in drawing space, which `anchor` aligns the
	 *  line to and `rotation` turns it about. */
	x: number;
	y: number;
	anchor: "start" | "middle" | "end";
	rotation?: number;
	runs: SvgTextRun[];
	opacity?: number;
};

export type SvgItem = SvgShape | SvgGroup | SvgImage | SvgText;

export type SvgWarning = { feature: string; message: string };

export type SvgDrawing = {
	width: number;
	height: number;
	viewBox: Box;
	preserveAspectRatio?: string;
	children: SvgItem[];
	warnings: SvgWarning[];
};

const MAX_DEPTH = 64;
const MAX_ITEMS = 20000;
const MAX_TILES = 1000;

const INHERITED = new Set([
	"fill",
	"fill-rule",
	"fill-opacity",
	"stroke",
	"stroke-width",
	"stroke-opacity",
	"stroke-linecap",
	"stroke-linejoin",
	"stroke-dasharray",
	"visibility",
	"color",
	"clip-rule",
	"font-family",
	"font-size",
	"font-weight",
	"font-style",
	"text-anchor",
	"marker-start",
	"marker-mid",
	"marker-end",
]);

const PRESENTATION = new Set([
	...INHERITED,
	"opacity",
	"display",
	"clip-path",
	"mask",
	"filter",
	"stop-color",
	"stop-opacity",
	"marker",
	"overflow",
]);

const UNSUPPORTED: Record<string, string> = {
	foreignObject: "foreignObject",
	video: "video",
	audio: "audio",
};

const IGNORED = new Set([
	"defs",
	"symbol",
	"clipPath",
	"mask",
	"linearGradient",
	"radialGradient",
	"pattern",
	"filter",
	"marker",
	"style",
	"title",
	"desc",
	"metadata",
	"script",
]);

const UNITS: Record<string, number> = {
	"": 1,
	px: 1,
	pt: 4 / 3,
	pc: 16,
	in: 96,
	cm: 96 / 2.54,
	mm: 96 / 25.4,
	em: 16,
	ex: 8,
};

const FONT_SIZES: Record<string, number> = {
	"xx-small": 9,
	"x-small": 10,
	small: 13,
	medium: 16,
	large: 18,
	"x-large": 24,
	"xx-large": 32,
};

// A rough advance per character, in ems, for sizing a line before it is shaped.
const AVERAGE_ADVANCE = 0.6;

/** A rough width for a line of runs, before any font has shaped it. */
export function estimateTextWidth(runs: SvgTextRun[]): number {
	let width = 0;
	for (const run of runs)
		width += [...run.text].length * run.font.size * AVERAGE_ADVANCE;
	return width;
}

type Axis = "x" | "y" | "d";

type Viewport = { width: number; height: number };

type Context = {
	m: Matrix;
	style: Declarations;
	depth: number;
	uses: Set<string>;
	viewport: Viewport;
};

const PROLOG =
	/^﻿?(?:\s+|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^[>]*(?:\[[\s\S]*?\])?\s*>)*<svg[\s/>]/i;

/** Whether text or bytes look like an SVG document, for sniffing sources. */
export function isSvg(input: string | Uint8Array): boolean {
	const text =
		typeof input === "string"
			? input
			: new TextDecoder().decode(input.subarray(0, 65536));
	return PROLOG.test(text);
}

function localName(name: string): string {
	return name.startsWith("svg:") ? name.slice(4) : name;
}

function numberOf(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const n = Number.parseFloat(value);
	return Number.isFinite(n) ? n : undefined;
}

export function parseLength(
	value: string | undefined,
	axis: Axis,
	viewport: Viewport,
): number | undefined {
	const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*([a-z%]*)\s*$/i.exec(
		value ?? "",
	);
	if (!m) return undefined;
	const n = Number(m[1]);
	const unit = (m[2] ?? "").toLowerCase();
	if (unit === "%") {
		const ref =
			axis === "x"
				? viewport.width
				: axis === "y"
					? viewport.height
					: Math.hypot(viewport.width, viewport.height) / Math.SQRT2;
		return (n / 100) * ref;
	}
	const factor = UNITS[unit];
	return factor === undefined ? undefined : n * factor;
}

function parseViewBox(value: string | undefined): Box | null {
	const parts = (value ?? "").trim().split(/[\s,]+/).map(Number);
	if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
	const [x = 0, y = 0, width = 0, height = 0] = parts;
	return width > 0 && height > 0 ? { x, y, width, height } : null;
}

/** Maps a viewBox into a width by height viewport, as preserveAspectRatio says. */
export function viewBoxMatrix(
	vb: Box,
	width: number,
	height: number,
	preserveAspectRatio = "",
): Matrix {
	const [align = "xMidYMid", meetOrSlice = "meet"] = preserveAspectRatio
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	let sx = width / vb.width;
	let sy = height / vb.height;
	if (align !== "none") {
		const s = meetOrSlice === "slice" ? Math.max(sx, sy) : Math.min(sx, sy);
		sx = s;
		sy = s;
	}
	let tx = -vb.x * sx;
	let ty = -vb.y * sy;
	if (align !== "none") {
		const extraX = width - vb.width * sx;
		const extraY = height - vb.height * sy;
		if (align.includes("xMid")) tx += extraX / 2;
		else if (align.includes("xMax")) tx += extraX;
		if (align.includes("YMid")) ty += extraY / 2;
		else if (align.includes("YMax")) ty += extraY;
	}
	return [sx, 0, 0, sy, tx, ty];
}

function boundsOf(items: SvgItem[]): Box | null {
	let box: Box | null = null;
	const add = (b: Box | null) => {
		if (!b) return;
		if (!box) {
			box = { ...b };
			return;
		}
		const x = Math.min(box.x, b.x);
		const y = Math.min(box.y, b.y);
		box = {
			x,
			y,
			width: Math.max(box.x + box.width, b.x + b.width) - x,
			height: Math.max(box.y + box.height, b.y + b.height) - y,
		};
	};
	for (const item of items) add(itemBounds(item));
	return box;
}

function itemBounds(item: SvgItem): Box | null {
	switch (item.kind) {
		case "shape":
			return pathBounds(normalizePath(item.d));
		case "group":
			return boundsOf(item.children);
		case "image":
			return item;
		case "text": {
			const size = Math.max(...item.runs.map((r) => r.font.size));
			const width = estimateTextWidth(item.runs);
			const shift = item.anchor === "middle" ? width / 2 : item.anchor === "end" ? width : 0;
			return { x: item.x - shift, y: item.y - size, width, height: size * 1.2 };
		}
	}
}

const bboxMatrix = (b: Box): Matrix => [b.width, 0, 0, b.height, b.x, b.y];

function urlRef(value: string | undefined): {
	id: string | null;
	fallback: string;
} | null {
	const m = /^\s*url\(\s*['"]?([^'")]*)['"]?\s*\)\s*(.*)$/.exec(value ?? "");
	if (!m) return null;
	const ref = m[1] ?? "";
	return {
		id: ref.startsWith("#") ? ref.slice(1) : null,
		fallback: (m[2] ?? "").trim(),
	};
}

export function parseSvg(markup: string): SvgDrawing {
	const root = parseXml(markup);
	if (localName(root.name) !== "svg")
		throw new SvgError("svg: the root element is not <svg>");

	const warnings = new Map<string, SvgWarning>();
	const warn = (feature: string, message: string) => {
		if (!warnings.has(feature)) warnings.set(feature, { feature, message });
	};

	const byId = new Map<string, XmlElement>();
	const rules: StyleRule[] = [];
	const index = (el: XmlElement) => {
		const id = el.attrs.id;
		if (id && !byId.has(id)) byId.set(id, el);
		if (localName(el.name) === "style")
			rules.push(...parseStyleSheet(textContent(el)));
		for (const c of el.children) if (!("text" in c)) index(c);
	};
	index(root);
	const ruleIndex = indexRules(rules);

	const vb = parseViewBox(root.attrs.viewBox);
	const noViewport = { width: 0, height: 0 };
	const rawW = root.attrs.width?.trim().endsWith("%")
		? undefined
		: parseLength(root.attrs.width, "x", noViewport);
	const rawH = root.attrs.height?.trim().endsWith("%")
		? undefined
		: parseLength(root.attrs.height, "y", noViewport);
	const w = rawW && rawW > 0 ? rawW : undefined;
	const h = rawH && rawH > 0 ? rawH : undefined;
	let width: number;
	let height: number;
	if (w && h) [width, height] = [w, h];
	else if (vb) {
		if (w) [width, height] = [w, (w * vb.height) / vb.width];
		else if (h) [width, height] = [(h * vb.width) / vb.height, h];
		else [width, height] = [vb.width, vb.height];
	} else [width, height] = [w ?? 300, h ?? 150];
	const viewBox = vb ?? { x: 0, y: 0, width, height };

	let items = 0;

	const computeStyle = (el: XmlElement, parent: Declarations): Declarations => {
		const out: Declarations = {};
		for (const [k, v] of Object.entries(parent))
			if (INHERITED.has(k)) out[k] = v;
		for (const [k, v] of Object.entries(el.attrs))
			if (PRESENTATION.has(k)) out[k] = v.trim();
		const classes = (el.attrs.class ?? "").split(/\s+/).filter(Boolean);
		Object.assign(
			out,
			matchRules(ruleIndex, localName(el.name), el.attrs.id, classes),
		);
		if (el.attrs.style) Object.assign(out, parseStyleAttr(el.attrs.style));
		for (const [k, v] of Object.entries(out))
			if (v === "inherit") {
				const p = parent[k];
				if (p === undefined) delete out[k];
				else out[k] = p;
			}
		return out;
	};
	const rootStyle = computeStyle(root, {});

	const currentColor = (style: Declarations): Rgba => {
		const c = parseColor(style.color ?? "black");
		return Array.isArray(c) ? c : [0, 0, 0, 1];
	};

	const opacityOf = (value: string | undefined): number => {
		if (value === undefined) return 1;
		const n = value.trim().endsWith("%")
			? Number.parseFloat(value) / 100
			: Number.parseFloat(value);
		return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
	};

	const hrefChain = (
		el: XmlElement,
		follows: (name: string) => boolean,
	): XmlElement[] => {
		const chain = [el];
		const seen = new Set([el]);
		for (;;) {
			const last = chain[chain.length - 1] as XmlElement;
			const href = last.attrs.href ?? last.attrs["xlink:href"];
			const next = href?.startsWith("#") ? byId.get(href.slice(1)) : undefined;
			if (!next || seen.has(next) || !follows(localName(next.name)))
				return chain;
			chain.push(next);
			seen.add(next);
		}
	};

	const gradientChain = (el: XmlElement) =>
		hrefChain(el, (name) => name.endsWith("Gradient"));

	const gradientStops = (
		chain: XmlElement[],
		opacity: number,
		parentStyle: Declarations,
	): SvgStop[] => {
		const owner = chain.find((g) =>
			g.children.some((c) => !("text" in c) && localName(c.name) === "stop"),
		);
		if (!owner) return [];
		const ownerStyle = computeStyle(owner, parentStyle);
		let last = 0;
		const stops: SvgStop[] = [];
		for (const c of owner.children) {
			if ("text" in c || localName(c.name) !== "stop") continue;
			const style = computeStyle(c, ownerStyle);
			const raw = c.attrs.offset?.trim() ?? "0";
			let offset = raw.endsWith("%")
				? Number.parseFloat(raw) / 100
				: Number.parseFloat(raw);
			if (!Number.isFinite(offset)) offset = 0;
			offset = Math.max(last, Math.min(1, Math.max(0, offset)));
			last = offset;
			const color = parseColor(style["stop-color"] ?? "black", currentColor(style));
			const rgba: Rgba = Array.isArray(color) ? color : [0, 0, 0, 0];
			stops.push({
				offset,
				color: toHex(rgba, opacityOf(style["stop-opacity"]) * opacity),
			});
		}
		return stops;
	};

	const gradientPaint = (
		el: XmlElement,
		opacity: number,
		style: Declarations,
		m: Matrix,
		localBox: () => Box | null,
		viewport: Viewport,
	): SvgPaint | undefined => {
		const chain = gradientChain(el);
		const attr = (name: string) => {
			for (const g of chain) if (g.attrs[name] !== undefined) return g.attrs[name];
			return undefined;
		};
		const stops = gradientStops(chain, opacity, style);
		if (stops.length === 0) return undefined;
		if (stops.length === 1)
			return { kind: "solid", color: (stops[0] as SvgStop).color };
		const bbox = attr("gradientUnits") !== "userSpaceOnUse";
		let total = m;
		if (bbox) {
			const b = localBox();
			if (!b || b.width <= 0 || b.height <= 0)
				return { kind: "solid", color: (stops.at(-1) as SvgStop).color };
			total = multiply(total, bboxMatrix(b));
		}
		const gt = attr("gradientTransform");
		if (gt) total = multiply(total, parseTransform(gt));
		const spread = attr("spreadMethod");
		if (spread && spread !== "pad")
			warn("gradient-spread", `spreadMethod="${spread}" is drawn as pad`);
		const unitViewport = bbox ? { width: 1, height: 1 } : viewport;
		const len = (name: string, fallback: string, axis: Axis) => {
			const raw = attr(name) ?? fallback;
			if (bbox && !raw.trim().endsWith("%")) return numberOf(raw) ?? 0;
			return parseLength(raw, axis, unitViewport) ?? 0;
		};
		const map = (x: number, y: number): [number, number] => [
			total[0] * x + total[2] * y + total[4],
			total[1] * x + total[3] * y + total[5],
		];
		if (localName(el.name) === "linearGradient") {
			const [x1, y1] = map(len("x1", "0%", "x"), len("y1", "0%", "y"));
			const [x2, y2] = map(len("x2", "100%", "x"), len("y2", "0%", "y"));
			return { kind: "linear", x1, y1, x2, y2, stops };
		}
		const cxl = len("cx", "50%", "x");
		const cyl = len("cy", "50%", "y");
		const r = len("r", "50%", "d");
		const fx = attr("fx");
		const fy = attr("fy");
		if (
			(fx !== undefined && len("fx", fx, "x") !== cxl) ||
			(fy !== undefined && len("fy", fy, "y") !== cyl)
		)
			warn("radial-focal", "radial gradient focal points are drawn centred");
		const [cx, cy] = map(cxl, cyl);
		const [a, b, c, d] = total;
		const e11 = a * a + c * c;
		const e12 = a * b + c * d;
		const e22 = b * b + d * d;
		const mean = (e11 + e22) / 2;
		const diff = Math.sqrt(((e11 - e22) / 2) ** 2 + e12 * e12);
		const rotation = (0.5 * Math.atan2(2 * e12, e11 - e22) * 180) / Math.PI;
		return {
			kind: "radial",
			cx,
			cy,
			rx: Math.sqrt(mean + diff) * r,
			ry: Math.sqrt(Math.max(0, mean - diff)) * r,
			rotation: Object.is(rotation, -0) ? 0 : rotation,
			stops,
		};
	};

	const resolvePaint = (
		value: string | undefined,
		opacity: number,
		style: Declarations,
		m: Matrix,
		localBox: () => Box | null,
		viewport: Viewport,
	): SvgPaint | undefined => {
		if (value === undefined || value === "none") return undefined;
		const ref = urlRef(value);
		if (ref) {
			const target = ref.id ? byId.get(ref.id) : undefined;
			const name = target ? localName(target.name) : "";
			if (target && (name === "linearGradient" || name === "radialGradient"))
				return gradientPaint(target, opacity, style, m, localBox, viewport);
			if (name === "pattern")
				warn("pattern", "pattern paints use their fallback color");
			return ref.fallback
				? resolvePaint(ref.fallback, opacity, style, m, localBox, viewport)
				: undefined;
		}
		const c = parseColor(value, currentColor(style));
		if (c === "none") return undefined;
		return { kind: "solid", color: toHex(c ?? [0, 0, 0, 1], opacity) };
	};

	const resolveStroke = (
		style: Declarations,
		m: Matrix,
		localBox: () => Box | null,
		viewport: Viewport,
	): SvgStroke | undefined => {
		const paint = resolvePaint(
			style.stroke,
			opacityOf(style["stroke-opacity"]),
			style,
			m,
			localBox,
			viewport,
		);
		if (!paint) return undefined;
		let color: string;
		if (paint.kind === "solid") color = paint.color;
		else {
			warn("gradient-stroke", "gradient strokes use their first stop color");
			color = (paint.stops[0] as SvgStop).color;
		}
		const k = lengthScale(m);
		const width = (parseLength(style["stroke-width"] ?? "1", "d", viewport) ?? 1) * k;
		if (!(width > 0)) return undefined;
		const stroke: SvgStroke = { color, width };
		const cap = style["stroke-linecap"];
		if (cap === "round" || cap === "square" || cap === "butt") stroke.cap = cap;
		const join = style["stroke-linejoin"];
		if (join === "round" || join === "bevel" || join === "miter")
			stroke.join = join;
		else if (join === "miter-clip" || join === "arcs") stroke.join = "miter";
		const dashRaw = style["stroke-dasharray"];
		if (dashRaw && dashRaw !== "none") {
			const dash = dashRaw
				.split(/[\s,]+/)
				.filter(Boolean)
				.map((v) => parseLength(v, "d", viewport) ?? Number.NaN);
			if (
				dash.length > 0 &&
				dash.every((v) => Number.isFinite(v) && v >= 0) &&
				dash.some((v) => v > 0)
			) {
				const full = dash.length % 2 ? [...dash, ...dash] : dash;
				stroke.dash = full.map((v) => v * k);
			}
		}
		return stroke;
	};

	const fontOf = (style: Declarations, k: number): SvgFont => {
		const family =
			(style["font-family"] ?? "")
				.split(",")
				.map((f) => f.trim().replace(/^['"]|['"]$/g, ""))
				.find(Boolean) ?? "sans-serif";
		const rawSize = (style["font-size"] ?? "medium").trim();
		let size: number | undefined = FONT_SIZES[rawSize];
		if (size === undefined)
			size = rawSize.endsWith("%")
				? (Number.parseFloat(rawSize) / 100) * 16
				: parseLength(rawSize, "d", { width: 0, height: 0 });
		if (!(size !== undefined && size > 0)) size = 16;
		const rawWeight = (style["font-weight"] ?? "normal").trim();
		const numeric = Number(rawWeight);
		const weight =
			rawWeight === "bold" || rawWeight === "bolder"
				? 700
				: rawWeight === "lighter"
					? 300
					: Number.isFinite(numeric) && rawWeight !== ""
						? Math.min(900, Math.max(100, Math.round(numeric / 100) * 100))
						: 400;
		const fontStyle = style["font-style"]?.trim();
		return {
			family,
			size: size * k,
			weight,
			style: fontStyle === "italic" || fontStyle === "oblique" ? "italic" : "normal",
		};
	};

	const buildText = (
		el: XmlElement,
		style: Declarations,
		ctx: Context,
		m: Matrix,
	): SvgText[] => {
		const { sx, sy, rotation, similar } = decompose(m);
		if (!similar || Math.abs(sx - sy) > 1e-9 * Math.max(1, sx))
			warn("text-transform", "skewed, mirrored or stretched text is drawn upright");
		const k = Math.sqrt(sx * sy);
		type Line = { x: number; y: number; anchor: SvgText["anchor"]; runs: SvgTextRun[] };
		const lines: Line[] = [];
		let line: Line | null = null;
		const first = (node: XmlElement, attr: string, axis: Axis) => {
			const values = (node.attrs[attr] ?? "").trim().split(/[\s,]+/).filter(Boolean);
			if (values.length > 1)
				warn("text-glyph-position", "per-character positions use the first only");
			return values[0] === undefined ? undefined : parseLength(values[0], axis, ctx.viewport);
		};
		const anchorOf = (s: Declarations): SvgText["anchor"] => {
			const a = s["text-anchor"];
			return a === "middle" || a === "end" ? a : "start";
		};
		const visit = (node: XmlElement, own: Declarations, depth: number) => {
			if (depth > MAX_DEPTH) return;
			const x = first(node, "x", "x");
			const y = first(node, "y", "y");
			const dx = first(node, "dx", "x") ?? 0;
			const dy = first(node, "dy", "y") ?? 0;
			const moved = x !== undefined || y !== undefined || dx !== 0 || dy !== 0;
			if (!line || moved) {
				const drawn = line?.runs.some((r) => r.text.trim()) ?? false;
				if (line && drawn && x === undefined)
					warn("text-position", "a tspan placed after text on its line starts at the line's x");
				const next: Line = {
					x: (x ?? line?.x ?? 0) + dx,
					y: (y ?? line?.y ?? 0) + dy,
					anchor: anchorOf(own),
					runs: [],
				};
				if (line && !drawn) lines[lines.length - 1] = next;
				else lines.push(next);
				line = next;
			}
			for (const c of node.children) {
				if ("text" in c) {
					if (own.visibility === "hidden" || own.visibility === "collapse") continue;
					const paint = resolvePaint(
						own.fill ?? "black",
						opacityOf(own["fill-opacity"]),
						own,
						m,
						() => null,
						ctx.viewport,
					);
					if (own.stroke && own.stroke !== "none")
						warn("text-stroke", "text strokes are not drawn");
					if (!paint) continue;
					let color: string;
					if (paint.kind === "solid") color = paint.color;
					else {
						warn("text-gradient", "gradient text uses its first stop color");
						color = (paint.stops[0] as SvgStop).color;
					}
					line.runs.push({ text: c.text, font: fontOf(own, k), color });
					continue;
				}
				const name = localName(c.name);
				if (name === "textPath") {
					warn("textPath", "<textPath> is not supported");
					continue;
				}
				if (name !== "tspan" && name !== "a") continue;
				const childStyle = computeStyle(c, own);
				if (childStyle.display === "none") continue;
				visit(c, childStyle, depth + 1);
			}
		};
		visit(el, style, ctx.depth);

		const out: SvgText[] = [];
		for (const l of lines) {
			const runs: SvgTextRun[] = [];
			let spaced = true;
			for (const r of l.runs) {
				let text = r.text.replace(/\s+/g, " ");
				if (spaced) text = text.replace(/^ /, "");
				if (!text) continue;
				spaced = text.endsWith(" ");
				runs.push({ ...r, text });
			}
			while (runs.length) {
				const last = runs[runs.length - 1] as SvgTextRun;
				const text = last.text.replace(/ $/, "");
				if (text) {
					last.text = text;
					break;
				}
				runs.pop();
			}
			if (runs.length === 0) continue;
			const [x, y] = applyMatrix(m, l.x, l.y);
			const text: SvgText = { kind: "text", x, y, anchor: l.anchor, runs };
			if (el.attrs.id) text.id = el.attrs.id;
			if (similar && rotation) text.rotation = rotation;
			out.push(text);
		}
		return out;
	};

	const imageHref = (el: XmlElement, depth: number): string | undefined => {
		const href = (el.attrs.href ?? el.attrs["xlink:href"])?.trim();
		if (!href) return undefined;
		if (/^data:image\//i.test(href))
			return href.includes(";base64,") ? href.replace(/\s+/g, "") : href;
		if (href.startsWith("#")) {
			const target = byId.get(href.slice(1));
			if (target && target !== el && depth < MAX_DEPTH && localName(target.name) === "image")
				return imageHref(target, depth + 1);
			warn("image-missing", `"${href}" is not an image in the document`);
			return undefined;
		}
		warn("image-external", "images from other files are skipped");
		return undefined;
	};

	const buildImage = (
		el: XmlElement,
		style: Declarations,
		ctx: Context,
		m: Matrix,
	): SvgImage | null => {
		if (style.visibility === "hidden" || style.visibility === "collapse")
			return null;
		const w = parseLength(el.attrs.width, "x", ctx.viewport);
		const h = parseLength(el.attrs.height, "y", ctx.viewport);
		if (w === undefined || h === undefined) {
			warn("image-size", "images without a width and height are skipped");
			return null;
		}
		if (!(w > 0 && h > 0)) return null;
		const href = imageHref(el, 0);
		if (!href) return null;
		const x = parseLength(el.attrs.x, "x", ctx.viewport) ?? 0;
		const y = parseLength(el.attrs.y, "y", ctx.viewport) ?? 0;
		const { sx, sy, rotation, similar } = decompose(m);
		let [cx, cy] = applyMatrix(m, x + w / 2, y + h / 2);
		let width = w * sx;
		let height = h * sy;
		if (!similar) {
			warn("image-transform", "skewed or mirrored images are drawn upright in their bounds");
			const b = pathBounds(
				transformPath(normalizePath(`M${x} ${y}H${x + w}V${y + h}H${x}Z`), m),
			) as Box;
			[cx, cy, width, height] = [b.x + b.width / 2, b.y + b.height / 2, b.width, b.height];
		}
		const [align = "xMidYMid", meetOrSlice = "meet"] = (el.attrs.preserveAspectRatio ?? "")
			.trim()
			.split(/\s+/)
			.filter(Boolean);
		if (align !== "none" && align !== "xMidYMid")
			warn("image-align", "images are centred in their viewport");
		const image: SvgImage = {
			kind: "image",
			href,
			x: cx - width / 2,
			y: cy - height / 2,
			width,
			height,
			fit: align === "none" ? "fill" : meetOrSlice === "slice" ? "cover" : "contain",
		};
		if (el.attrs.id) image.id = el.attrs.id;
		if (similar && rotation) image.rotation = rotation;
		return image;
	};

	const patternFill = (
		el: XmlElement,
		style: Declarations,
		ctx: Context,
		m: Matrix,
		local: Segment[],
	): SvgGroup | null => {
		const chain = hrefChain(el, (name) => name === "pattern");
		const attr = (name: string) => {
			for (const p of chain) if (p.attrs[name] !== undefined) return p.attrs[name];
			return undefined;
		};
		const content = chain.find((p) => p.children.some((c) => !("text" in c)));
		const box = pathBounds(local);
		if (!content || !box) return null;
		const bbox = attr("patternUnits") !== "userSpaceOnUse";
		if (bbox && !(box.width > 0 && box.height > 0)) return null;
		const len = (name: string, axis: "x" | "y") => {
			const raw = attr(name) ?? "0";
			if (!bbox) return parseLength(raw, axis, ctx.viewport) ?? 0;
			const f = raw.trim().endsWith("%")
				? Number.parseFloat(raw) / 100
				: (numberOf(raw) ?? 0);
			return f * (axis === "x" ? box.width : box.height);
		};
		const x = len("x", "x") + (bbox ? box.x : 0);
		const y = len("y", "y") + (bbox ? box.y : 0);
		const w = len("width", "x");
		const h = len("height", "y");
		if (!(w > 0 && h > 0)) return null;
		const transform = attr("patternTransform");
		const pt = transform ? parseTransform(transform) : IDENTITY;
		const inverse = invert(pt);
		if (!inverse) return null;
		const vb = parseViewBox(attr("viewBox"));
		const contentMatrix = vb
			? viewBoxMatrix(vb, w, h, attr("preserveAspectRatio"))
			: attr("patternContentUnits") === "objectBoundingBox"
				? scale(box.width, box.height)
				: IDENTITY;
		const corners = [
			applyMatrix(inverse, box.x, box.y),
			applyMatrix(inverse, box.x + box.width, box.y),
			applyMatrix(inverse, box.x, box.y + box.height),
			applyMatrix(inverse, box.x + box.width, box.y + box.height),
		];
		const xs = corners.map((c) => c[0]);
		const ys = corners.map((c) => c[1]);
		const i0 = Math.floor((Math.min(...xs) - x) / w);
		const i1 = Math.ceil((Math.max(...xs) - x) / w);
		const j0 = Math.floor((Math.min(...ys) - y) / h);
		const j1 = Math.ceil((Math.max(...ys) - y) / h);
		if ((i1 - i0) * (j1 - j0) > MAX_TILES) {
			warn("pattern-tiles", `patterns of more than ${MAX_TILES} tiles use their fallback color`);
			return null;
		}
		const contentStyle = computeStyle(content, rootStyle);
		const children: SvgItem[] = [];
		for (let j = j0; j < j1; j++)
			for (let i = i0; i < i1; i++)
				children.push(
					...walkChildren(content, {
						...ctx,
						m: multiply(m, multiply(pt, multiply(translate(x + i * w, y + j * h), contentMatrix))),
						style: contentStyle,
						depth: ctx.depth + 1,
						viewport: vb ?? ctx.viewport,
					}),
				);
		if (children.length === 0) return null;
		const clip: SvgShape = {
			kind: "shape",
			d: serializePath(transformPath(local, m)),
			fillRule: style["fill-rule"] === "evenodd" ? "evenodd" : "nonzero",
			fill: { kind: "solid", color: "#000000ff" },
		};
		const group: SvgGroup = { kind: "group", clip: [clip], children };
		const opacity = opacityOf(style["fill-opacity"]);
		if (opacity < 1) group.opacity = opacity;
		return group;
	};

	const markers = (
		style: Declarations,
		ctx: Context,
		m: Matrix,
		local: Segment[],
	): SvgItem[] => {
		const vertices = markerVertices(local);
		if (vertices.length === 0) return [];
		const strokeWidth = parseLength(style["stroke-width"] ?? "1", "d", ctx.viewport) ?? 1;
		const out: SvgItem[] = [];
		const place = (position: "start" | "mid" | "end", at: MarkerVertex[]) => {
			const ref = urlRef(style[`marker-${position}`] ?? style.marker);
			if (!ref?.id || at.length === 0) return;
			const marker = byId.get(ref.id);
			if (!marker || localName(marker.name) !== "marker") return;
			const key = `marker:${ref.id}`;
			if (ctx.uses.has(key)) return;
			const markerWidth = parseLength(marker.attrs.markerWidth ?? "3", "x", ctx.viewport) ?? 3;
			const markerHeight = parseLength(marker.attrs.markerHeight ?? "3", "y", ctx.viewport) ?? 3;
			if (!(markerWidth > 0 && markerHeight > 0)) return;
			const vb = parseViewBox(marker.attrs.viewBox);
			const vbm = vb
				? viewBoxMatrix(vb, markerWidth, markerHeight, marker.attrs.preserveAspectRatio)
				: IDENTITY;
			const markerViewport = vb ?? { width: markerWidth, height: markerHeight };
			const [refX, refY] = applyMatrix(
				vbm,
				parseLength(marker.attrs.refX, "x", markerViewport) ?? 0,
				parseLength(marker.attrs.refY, "y", markerViewport) ?? 0,
			);
			const units = marker.attrs.markerUnits === "userSpaceOnUse" ? 1 : strokeWidth;
			const orient = (marker.attrs.orient ?? "0").trim();
			const fixed = parseAngle(orient);
			const markerStyle = computeStyle(marker, rootStyle);
			const uses = new Set(ctx.uses).add(key);
			for (const v of at) {
				const angle =
					orient === "auto"
						? v.angle
						: orient === "auto-start-reverse"
							? position === "start"
								? v.angle + 180
								: v.angle
							: fixed;
				const mm = multiply(
					m,
					multiply(
						translate(v.x, v.y),
						multiply(rotate(angle), multiply(scale(units), multiply(translate(-refX, -refY), vbm))),
					),
				);
				out.push(
					...walkChildren(marker, {
						...ctx,
						m: mm,
						style: markerStyle,
						uses,
						depth: ctx.depth + 1,
						viewport: markerViewport,
					}),
				);
			}
		};
		place("start", vertices.slice(0, 1));
		place("mid", vertices.slice(1, -1));
		place("end", vertices.length > 1 ? vertices.slice(-1) : vertices);
		return out;
	};

	const shapeSegments = (
		el: XmlElement,
		name: string,
		viewport: Viewport,
	): Segment[] => {
		const L = (attr: string, axis: Axis, fallback = 0) =>
			parseLength(el.attrs[attr], axis, viewport) ?? fallback;
		switch (name) {
			case "path":
				return normalizePath(el.attrs.d ?? "");
			case "rect": {
				const x = L("x", "x");
				const y = L("y", "y");
				const w = L("width", "x");
				const h = L("height", "y");
				if (!(w > 0 && h > 0)) return [];
				let rx = parseLength(el.attrs.rx, "x", viewport);
				let ry = parseLength(el.attrs.ry, "y", viewport);
				if (rx === undefined || rx < 0) rx = ry;
				if (ry === undefined || ry < 0) ry = rx;
				rx = Math.min(rx ?? 0, w / 2);
				ry = Math.min(ry ?? 0, h / 2);
				if (!(rx > 0 && ry > 0))
					return normalizePath(`M${x} ${y}H${x + w}V${y + h}H${x}Z`);
				return normalizePath(
					`M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`,
				);
			}
			case "circle":
			case "ellipse": {
				const cx = L("cx", "x");
				const cy = L("cy", "y");
				const rx = name === "circle" ? L("r", "d") : L("rx", "x");
				const ry = name === "circle" ? rx : L("ry", "y");
				if (!(rx > 0 && ry > 0)) return [];
				return normalizePath(
					`M${cx + rx} ${cy}A${rx} ${ry} 0 0 1 ${cx} ${cy + ry}A${rx} ${ry} 0 0 1 ${cx - rx} ${cy}A${rx} ${ry} 0 0 1 ${cx} ${cy - ry}A${rx} ${ry} 0 0 1 ${cx + rx} ${cy}Z`,
				);
			}
			case "line":
				return normalizePath(
					`M${L("x1", "x")} ${L("y1", "y")}L${L("x2", "x")} ${L("y2", "y")}`,
				);
			case "polyline":
			case "polygon": {
				const n = (el.attrs.points ?? "")
					.trim()
					.split(/[\s,]+|(?=-)/)
					.filter(Boolean)
					.map(Number);
				const pts: number[] = [];
				for (const v of n) {
					if (!Number.isFinite(v)) break;
					pts.push(v);
				}
				if (pts.length < 4) return [];
				let d = `M${pts[0]} ${pts[1]}`;
				for (let i = 2; i + 1 < pts.length; i += 2) d += `L${pts[i]} ${pts[i + 1]}`;
				return normalizePath(name === "polygon" ? `${d}Z` : d);
			}
		}
		return [];
	};

	const buildShape = (
		el: XmlElement,
		name: string,
		style: Declarations,
		ctx: Context,
		m: Matrix,
	): SvgItem[] => {
		if (style.visibility === "hidden" || style.visibility === "collapse")
			return [];
		const local = shapeSegments(el, name, ctx.viewport);
		if (!local.some((s) => s.op !== "M")) return [];
		let box: Box | null | undefined;
		const localBox = () => {
			if (box === undefined) box = pathBounds(local);
			return box;
		};
		const out: SvgItem[] = [];
		const fillRef = urlRef(style.fill);
		const fillTarget = fillRef?.id ? byId.get(fillRef.id) : undefined;
		const pattern =
			name !== "line" && fillTarget && localName(fillTarget.name) === "pattern"
				? patternFill(fillTarget, style, ctx, m, local)
				: null;
		if (pattern) out.push(pattern);
		const fill =
			name === "line" || pattern
				? undefined
				: resolvePaint(
						style.fill ?? "black",
						opacityOf(style["fill-opacity"]),
						style,
						m,
						localBox,
						ctx.viewport,
					);
		const stroke = resolveStroke(style, m, localBox, ctx.viewport);
		if (fill || stroke) {
			const shape: SvgShape = {
				kind: "shape",
				d: serializePath(transformPath(local, m)),
				fillRule: style["fill-rule"] === "evenodd" ? "evenodd" : "nonzero",
			};
			if (el.attrs.id) shape.id = el.attrs.id;
			if (fill) shape.fill = fill;
			if (stroke) shape.stroke = stroke;
			out.push(shape);
		}
		if (MARKABLE.has(name)) out.push(...markers(style, ctx, m, local));
		return out;
	};

	const clipShapes = (
		value: string | undefined,
		ctx: Context,
		m: Matrix,
		content: SvgItem[],
	): SvgShape[] | undefined => {
		const ref = urlRef(value);
		const clip = ref?.id ? byId.get(ref.id) : undefined;
		if (!clip || localName(clip.name) !== "clipPath") return undefined;
		let cm = m;
		if (clip.attrs.transform) cm = multiply(cm, parseTransform(clip.attrs.transform));
		if (clip.attrs.clipPathUnits === "objectBoundingBox") {
			const b = boundsOf(content);
			if (!b) return [];
			cm = multiply(bboxMatrix(b), clip.attrs.transform ? parseTransform(clip.attrs.transform) : IDENTITY);
		}
		const clipStyle = computeStyle(clip, ctx.style);
		const out: SvgShape[] = [];
		const collect = (el: XmlElement, style: Declarations, mm: Matrix, depth: number) => {
			if (depth > MAX_DEPTH) return;
			const name = localName(el.name);
			const own = computeStyle(el, style);
			if (own.display === "none") return;
			const em = el.attrs.transform ? multiply(mm, parseTransform(el.attrs.transform)) : mm;
			if (name === "use") {
				const href = el.attrs.href ?? el.attrs["xlink:href"];
				const target = href?.startsWith("#") ? byId.get(href.slice(1)) : undefined;
				if (!target || target === el) return;
				const x = parseLength(el.attrs.x, "x", ctx.viewport) ?? 0;
				const y = parseLength(el.attrs.y, "y", ctx.viewport) ?? 0;
				collect(target, own, multiply(em, translate(x, y)), depth + 1);
				return;
			}
			if (name in UNSUPPORTED) {
				warn(UNSUPPORTED[name] as string, `<${name}> is not supported`);
				return;
			}
			if (name === "text" || name === "image") {
				warn(`clip-${name}`, `<${name}> in a clip path is skipped`);
				return;
			}
			const local = shapeSegments(el, name, ctx.viewport);
			if (!local.some((s) => s.op !== "M")) return;
			out.push({
				kind: "shape",
				d: serializePath(transformPath(local, em)),
				fillRule: own["clip-rule"] === "evenodd" ? "evenodd" : "nonzero",
				fill: { kind: "solid", color: "#000000ff" },
			});
		};
		for (const c of clip.children)
			if (!("text" in c)) collect(c, clipStyle, cm, ctx.depth + 1);
		return out;
	};

	const maskItems = (
		value: string | undefined,
		ctx: Context,
		m: Matrix,
		content: SvgItem[],
	): SvgItem[] | undefined => {
		const ref = urlRef(value);
		const mask = ref?.id ? byId.get(ref.id) : undefined;
		if (!mask || localName(mask.name) !== "mask") return undefined;
		let mm = m;
		if (mask.attrs.maskContentUnits === "objectBoundingBox") {
			const b = boundsOf(content);
			if (!b) return [];
			mm = bboxMatrix(b);
		}
		const style = computeStyle(mask, ctx.style);
		return walkChildren(mask, { ...ctx, m: mm, style, depth: ctx.depth + 1 });
	};

	const decorate = (
		el: XmlElement,
		style: Declarations,
		ctx: Context,
		m: Matrix,
		content: SvgItem[],
		group: boolean,
	): SvgItem[] => {
		if (content.length === 0) return [];
		if (style.filter && style.filter !== "none")
			warn("filter", "filters are not applied");
		const opacity = opacityOf(style.opacity);
		const clip = clipShapes(style["clip-path"], ctx, m, content);
		const mask = maskItems(style.mask, ctx, m, content);
		if (clip && clip.length === 0) return [];
		const only = content[0] as SvgItem;
		if (!group && content.length === 1 && only.kind !== "group") {
			if (opacity < 1) only.opacity = opacity;
			if (!clip && !mask) return content;
			return [{ kind: "group", ...(clip ? { clip } : {}), ...(mask ? { mask } : {}), children: content }];
		}
		if (!group && !clip && !mask && opacity === 1) return content;
		const g: SvgGroup = { kind: "group", children: content };
		if (el.attrs.id) g.id = el.attrs.id;
		if (opacity < 1) g.opacity = opacity;
		if (clip) g.clip = clip;
		if (mask) g.mask = mask;
		return [g];
	};

	const walkChildren = (el: XmlElement, ctx: Context): SvgItem[] => {
		const out: SvgItem[] = [];
		for (const c of el.children) if (!("text" in c)) out.push(...walk(c, ctx));
		return out;
	};

	const walk = (el: XmlElement, ctx: Context): SvgItem[] => {
		if (ctx.depth > MAX_DEPTH) {
			warn("depth-limit", `content nested deeper than ${MAX_DEPTH} is skipped`);
			return [];
		}
		if (items >= MAX_ITEMS) {
			warn("item-limit", `drawings are limited to ${MAX_ITEMS} shapes`);
			return [];
		}
		const name = localName(el.name);
		if (IGNORED.has(name)) return [];
		if (name in UNSUPPORTED) {
			warn(UNSUPPORTED[name] as string, `<${name}> is not supported`);
			return [];
		}
		const style = computeStyle(el, ctx.style);
		if (style.display === "none") return [];
		if (opacityOf(style.opacity) === 0) return [];
		const m = el.attrs.transform
			? multiply(ctx.m, parseTransform(el.attrs.transform))
			: ctx.m;
		const inner: Context = { ...ctx, m, style, depth: ctx.depth + 1 };

		switch (name) {
			case "g":
			case "a":
			case "switch":
				return decorate(el, style, ctx, m, walkChildren(el, inner), true);
			case "svg": {
				const x = parseLength(el.attrs.x, "x", ctx.viewport) ?? 0;
				const y = parseLength(el.attrs.y, "y", ctx.viewport) ?? 0;
				const w = parseLength(el.attrs.width ?? "100%", "x", ctx.viewport) ?? 0;
				const h = parseLength(el.attrs.height ?? "100%", "y", ctx.viewport) ?? 0;
				if (!(w > 0 && h > 0)) return [];
				const own = parseViewBox(el.attrs.viewBox);
				const origin = multiply(ctx.m, translate(x, y));
				const nm = own
					? multiply(origin, viewBoxMatrix(own, w, h, el.attrs.preserveAspectRatio))
					: origin;
				const children = walkChildren(el, {
					...inner,
					m: nm,
					viewport: own ?? { width: w, height: h },
				});
				if (children.length === 0) return [];
				const clip: SvgShape = {
					kind: "shape",
					d: serializePath(
						transformPath(normalizePath(`M0 0H${w}V${h}H0Z`), origin),
					),
					fillRule: "nonzero",
					fill: { kind: "solid", color: "#000000ff" },
				};
				const g: SvgGroup = { kind: "group", clip: [clip], children };
				if (el.attrs.id) g.id = el.attrs.id;
				const opacity = opacityOf(style.opacity);
				if (opacity < 1) g.opacity = opacity;
				return [g];
			}
			case "use": {
				const href = el.attrs.href ?? el.attrs["xlink:href"];
				if (!href) return [];
				if (!href.startsWith("#")) {
					warn("use-external", "references to other files are ignored");
					return [];
				}
				const id = href.slice(1);
				const target = byId.get(id);
				if (!target) {
					warn("use-missing", `"#${id}" is not in the document`);
					return [];
				}
				if (ctx.uses.has(id) || target === el || contains(target, el)) {
					warn("use-cycle", `"#${id}" refers to itself`);
					return [];
				}
				const x = parseLength(el.attrs.x, "x", ctx.viewport) ?? 0;
				const y = parseLength(el.attrs.y, "y", ctx.viewport) ?? 0;
				let um = multiply(m, translate(x, y));
				const uses = new Set(ctx.uses).add(id);
				let content: SvgItem[];
				if (localName(target.name) === "symbol") {
					const tStyle = computeStyle(target, style);
					const own = parseViewBox(target.attrs.viewBox);
					const w =
						parseLength(el.attrs.width ?? target.attrs.width ?? "100%", "x", ctx.viewport) ?? 0;
					const h =
						parseLength(el.attrs.height ?? target.attrs.height ?? "100%", "y", ctx.viewport) ?? 0;
					if (own && w > 0 && h > 0)
						um = multiply(um, viewBoxMatrix(own, w, h, target.attrs.preserveAspectRatio));
					content = walkChildren(target, {
						...inner,
						m: um,
						style: tStyle,
						uses,
						viewport: own ?? ctx.viewport,
					});
				} else content = walk(target, { ...inner, m: um, uses });
				return decorate(el, style, ctx, m, content, false);
			}
		}
		const drawn =
			name === "text"
				? buildText(el, style, inner, m)
				: name === "image"
					? [buildImage(el, style, ctx, m)].filter((i): i is SvgImage => !!i)
					: buildShape(el, name, style, ctx, m);
		if (drawn.length === 0) return [];
		items++;
		return decorate(el, style, ctx, m, drawn, false);
	};

	const children = walkChildren(root, {
		m: IDENTITY,
		style: rootStyle,
		depth: 0,
		uses: new Set(),
		viewport: viewBox,
	});
	const drawing: SvgDrawing = {
		width,
		height,
		viewBox,
		children,
		warnings: [...warnings.values()],
	};
	if (root.attrs.preserveAspectRatio)
		drawing.preserveAspectRatio = root.attrs.preserveAspectRatio;
	return drawing;
}

const MARKABLE = new Set(["path", "line", "polyline", "polygon"]);

type MarkerVertex = { x: number; y: number; angle: number };

// Every vertex a marker can sit on, with the direction SVG gives it: the
// bisector of the incoming and outgoing tangents, or whichever one exists.
function markerVertices(segs: Segment[]): MarkerVertex[] {
	type Vertex = { x: number; y: number; in?: [number, number]; out?: [number, number] };
	const vertices: Vertex[] = [];
	let cx = 0;
	let cy = 0;
	let start: Vertex | null = null;
	const nonzero = (...dirs: [number, number][]) =>
		dirs.find(([dx, dy]) => Math.hypot(dx, dy) > 1e-12) ?? dirs[dirs.length - 1];
	const to = (x: number, y: number, out: [number, number], inDir: [number, number]) => {
		const last = vertices[vertices.length - 1];
		if (last && !last.out) last.out = out;
		const v: Vertex = { x, y, in: inDir };
		vertices.push(v);
		cx = x;
		cy = y;
		return v;
	};
	for (const s of segs) {
		if (s.op === "M") {
			start = { x: s.x, y: s.y };
			vertices.push(start);
			cx = s.x;
			cy = s.y;
		} else if (s.op === "L") {
			const d: [number, number] = [s.x - cx, s.y - cy];
			to(s.x, s.y, d, d);
		} else if (s.op === "C") {
			const out = nonzero([s.x1 - cx, s.y1 - cy], [s.x2 - cx, s.y2 - cy], [s.x - cx, s.y - cy]) as [number, number];
			const inDir = nonzero([s.x - s.x2, s.y - s.y2], [s.x - s.x1, s.y - s.y1], [s.x - cx, s.y - cy]) as [number, number];
			to(s.x, s.y, out, inDir);
		} else if (start) {
			const d: [number, number] = [start.x - cx, start.y - cy];
			const end = to(start.x, start.y, d, d);
			end.out = start.out;
			start.in = d;
		}
	}
	const angle = ([dx, dy]: [number, number]) => Math.atan2(dy, dx);
	return vertices.map((v) => {
		let a = 0;
		if (v.in && v.out) {
			const a1 = angle(v.in);
			const a2 = angle(v.out);
			a = (a1 + a2) / 2;
			if (Math.abs(a2 - a1) > Math.PI) a += Math.PI;
		} else if (v.in || v.out) a = angle((v.in ?? v.out) as [number, number]);
		return { x: v.x, y: v.y, angle: (a * 180) / Math.PI };
	});
}

// An SVG <angle>: degrees unless it names rad, grad or turn.
function parseAngle(value: string): number {
	const m = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)(deg|rad|grad|turn)?$/i.exec(value);
	if (!m) return 0;
	const n = Number(m[1]);
	switch ((m[2] ?? "deg").toLowerCase()) {
		case "rad":
			return (n * 180) / Math.PI;
		case "grad":
			return n * 0.9;
		case "turn":
			return n * 360;
		default:
			return n;
	}
}

function contains(ancestor: XmlElement, el: XmlElement): boolean {
	for (const c of ancestor.children)
		if (!("text" in c) && (c === el || contains(c, el))) return true;
	return false;
}
