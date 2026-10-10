import { parseColor, type Rgba, toHex } from "../color";
import { normalizeDash } from "../dash";
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

export { isSvg } from "./sniff";

export type SvgStop = { offset: number; color: string };

export type SvgSpread = "reflect" | "repeat";

export type SvgPaint =
	| { kind: "solid"; color: string }
	| {
			kind: "linear";
			x1: number;
			y1: number;
			x2: number;
			y2: number;
			stops: SvgStop[];
			spread?: SvgSpread;
	  }
	| {
			kind: "radial";
			cx: number;
			cy: number;
			rx: number;
			ry: number;
			rotation: number;
			fx?: number;
			fy?: number;
			fr?: number;
			stops: SvgStop[];
			spread?: SvgSpread;
	  };

export type SvgStroke = {
	// A gradient's first stop when `paint` is set.
	color: string;
	paint?: Exclude<SvgPaint, { kind: "solid" }>;
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
	filter?: SvgFilter;
	children: SvgItem[];
};

/** A primitive's input: the element's graphic or its alpha, or the result of
 *  an earlier primitive by index. */
export type SvgFilterInput = "SourceGraphic" | "SourceAlpha" | number;

export type SvgBlendMode =
	| "normal"
	| "multiply"
	| "screen"
	| "overlay"
	| "darken"
	| "lighten"
	| "color-dodge"
	| "color-burn"
	| "hard-light"
	| "soft-light"
	| "difference"
	| "exclusion"
	| "hue"
	| "saturation"
	| "color"
	| "luminosity";

/** Lengths are in the filter's user space. `linear` is whether the primitive
 *  works in linearRGB rather than sRGB. */
export type SvgFilterPrimitive = { linear: boolean } & (
	| { kind: "blur"; in: SvgFilterInput; sx: number; sy: number }
	| { kind: "offset"; in: SvgFilterInput; dx: number; dy: number }
	| {
			kind: "dropShadow";
			in: SvgFilterInput;
			dx: number;
			dy: number;
			sx: number;
			sy: number;
			color: string;
	  }
	| { kind: "colorMatrix"; in: SvgFilterInput; matrix: number[] }
	| { kind: "flood"; color: string }
	| { kind: "merge"; in: SvgFilterInput[] }
	| {
			kind: "composite";
			operator: "over" | "in" | "out" | "atop" | "xor";
			in: SvgFilterInput;
			in2: SvgFilterInput;
	  }
	| { kind: "blend"; mode: SvgBlendMode; in: SvgFilterInput; in2: SvgFilterInput }
);

export type SvgFilter = {
	/** Maps the filter's user space into drawing space. */
	transform: Matrix;
	/** The filter region, in the filter's user space. */
	region: Box;
	/** The last primitive's result is the filter's output. */
	primitives: SvgFilterPrimitive[];
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

/** The path a line of text follows, from `<textPath>`. `d` is in drawing
 *  space; a percent `startOffset` is a share of the path's length. */
export type SvgTextPath = {
	d: string;
	startOffset: number;
	percent?: boolean;
	side: "left" | "right";
};

export type SvgText = {
	kind: "text";
	id?: string;
	path?: SvgTextPath;
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
const MAX_WALK = 200_000;
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
	"color-interpolation-filters",
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
	"flood-color",
	"flood-opacity",
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
	// The <use> targets being expanded, with their document ancestors, and the
	// markers being drawn.
	uses: Set<XmlElement | string>;
	ancestors: Set<XmlElement>;
	viewport: Viewport;
};

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

function unionBox(a: Box, b: Box): Box {
	const x = Math.min(a.x, b.x);
	const y = Math.min(a.y, b.y);
	return {
		x,
		y,
		width: Math.max(a.x + a.width, b.x + b.width) - x,
		height: Math.max(a.y + a.height, b.y + b.height) - y,
	};
}

function boundsOf(items: SvgItem[]): Box | null {
	let box: Box | null = null;
	const add = (b: Box | null) => {
		if (b) box = box ? unionBox(box, b) : { ...b };
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
	const parents = new Map<XmlElement, XmlElement>();
	const rules: StyleRule[] = [];
	const index = (el: XmlElement) => {
		const id = el.attrs.id;
		if (id && !byId.has(id)) byId.set(id, el);
		if (localName(el.name) === "style")
			rules.push(...parseStyleSheet(textContent(el)));
		for (const c of el.children)
			if (!("text" in c)) {
				parents.set(c, el);
				index(c);
			}
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
	// Element visits, which empty content grows without ever adding to `items`.
	let walked = 0;

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
		const method = attr("spreadMethod")?.trim();
		const spread =
			method === "reflect" || method === "repeat"
				? { spread: method as SvgSpread }
				: {};
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
			return { kind: "linear", x1, y1, x2, y2, stops, ...spread };
		}
		const cxl = len("cx", "50%", "x");
		const cyl = len("cy", "50%", "y");
		const r = len("r", "50%", "d");
		const fxl = attr("fx") === undefined ? cxl : len("fx", "50%", "x");
		const fyl = attr("fy") === undefined ? cyl : len("fy", "50%", "y");
		const frl = Math.max(0, len("fr", "0%", "d"));
		const [cx, cy] = map(cxl, cyl);
		const [a, b, c, d] = total;
		const e11 = a * a + c * c;
		const e12 = a * b + c * d;
		const e22 = b * b + d * d;
		const mean = (e11 + e22) / 2;
		const diff = Math.sqrt(((e11 - e22) / 2) ** 2 + e12 * e12);
		const rotation = (0.5 * Math.atan2(2 * e12, e11 - e22) * 180) / Math.PI;
		const major = Math.sqrt(mean + diff);
		const paint: SvgPaint = {
			kind: "radial",
			cx,
			cy,
			rx: major * r,
			ry: Math.sqrt(Math.max(0, mean - diff)) * r,
			rotation: Object.is(rotation, -0) ? 0 : rotation,
			stops,
			...spread,
		};
		if (fxl !== cxl || fyl !== cyl || frl > 0) {
			const [fx, fy] = map(fxl, fyl);
			paint.fx = fx;
			paint.fy = fy;
			paint.fr = major * frl;
		}
		return paint;
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
		const k = lengthScale(m);
		const width = (parseLength(style["stroke-width"] ?? "1", "d", viewport) ?? 1) * k;
		if (!(width > 0)) return undefined;
		const stroke: SvgStroke =
			paint.kind === "solid"
				? { color: paint.color, width }
				: { color: (paint.stops[0] as SvgStop).color, paint, width };
		const cap = style["stroke-linecap"];
		if (cap === "round" || cap === "square" || cap === "butt") stroke.cap = cap;
		const join = style["stroke-linejoin"];
		if (join === "round" || join === "bevel" || join === "miter")
			stroke.join = join;
		else if (join === "miter-clip" || join === "arcs") stroke.join = "miter";
		const dashRaw = style["stroke-dasharray"];
		if (dashRaw && dashRaw !== "none") {
			const dash = normalizeDash(
				dashRaw
					.split(/[\s,]+/)
					.filter(Boolean)
					.map((v) => parseLength(v, "d", viewport) ?? Number.NaN),
			);
			if (dash) stroke.dash = dash.map((v) => v * k);
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
		type Line = {
			x: number;
			y: number;
			anchor: SvgText["anchor"];
			runs: SvgTextRun[];
			path?: SvgTextPath;
		};
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
		const textPathOf = (node: XmlElement): SvgTextPath | null => {
			let segs: Segment[] = [];
			if (node.attrs.path !== undefined) segs = normalizePath(node.attrs.path);
			else {
				const href = (node.attrs.href ?? node.attrs["xlink:href"])?.trim();
				const target = href?.startsWith("#") ? byId.get(href.slice(1)) : undefined;
				const name = target ? localName(target.name) : "";
				if (!target || !TEXT_PATH_SHAPES.has(name)) {
					warn("textPath", `<textPath> "${href ?? ""}" is not a shape in the document; its text is skipped`);
					return null;
				}
				segs = shapeSegments(target, name, ctx.viewport);
				if (target.attrs.transform)
					segs = transformPath(segs, parseTransform(target.attrs.transform));
			}
			if (segs.length === 0) {
				warn("textPath", "a <textPath> with an empty path is skipped");
				return null;
			}
			const raw = (node.attrs.startOffset ?? "").trim();
			const percent = raw.endsWith("%");
			const value = percent
				? Number.parseFloat(raw)
				: (parseLength(raw || undefined, "d", ctx.viewport) ?? 0);
			const out: SvgTextPath = {
				d: serializePath(transformPath(segs, m)),
				startOffset: Number.isFinite(value) ? (percent ? value : value * k) : 0,
				side: node.attrs.side?.trim() === "right" ? "right" : "left",
			};
			if (percent) out.percent = true;
			return out;
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
					const childStyle = computeStyle(c, own);
					if (childStyle.display === "none") continue;
					const path = textPathOf(c);
					if (!path) continue;
					const before: Line = line;
					line = { x: before.x, y: before.y, anchor: anchorOf(childStyle), runs: [], path };
					lines.push(line);
					visit(c, childStyle, depth + 1);
					line = { x: before.x, y: before.y, anchor: before.anchor, runs: [] };
					lines.push(line);
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
			if (l.path) text.path = l.path;
			else if (similar && rotation) text.rotation = rotation;
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

	const localBounds = (items: SvgItem[], inv: Matrix): Box | null => {
		let out: Box | null = null;
		const add = (segs: Segment[]) => {
			const b = pathBounds(transformPath(segs, inv));
			if (b) out = out ? unionBox(out, b) : b;
		};
		const visit = (list: SvgItem[]) => {
			for (const item of list) {
				if (item.kind === "group") visit(item.children);
				else if (item.kind === "shape") add(normalizePath(item.d));
				else {
					const b = itemBounds(item) as Box;
					add(normalizePath(`M${b.x} ${b.y}h${b.width}v${b.height}h${-b.width}Z`));
				}
			}
		};
		visit(items);
		return out;
	};

	// Undefined draws the content unfiltered; null draws nothing.
	const resolveFilter = (
		value: string,
		ctx: Context,
		m: Matrix,
		content: SvgItem[],
	): SvgFilter | null | undefined => {
		const ref = urlRef(value);
		if (!ref) {
			warn("filter-function", "CSS filter functions are not applied");
			return undefined;
		}
		if (ref.fallback)
			warn("filter-list", "only the first filter in a list is applied");
		const target = ref.id ? byId.get(ref.id) : undefined;
		if (!target || localName(target.name) !== "filter") {
			warn("filter-missing", `"${value}" is not a filter in the document`);
			return undefined;
		}
		const chain = hrefChain(target, (name) => name === "filter");
		const attr = (name: string) => {
			for (const f of chain) if (f.attrs[name] !== undefined) return f.attrs[name];
			return undefined;
		};
		const owner = chain.find((f) => f.children.some((c) => !("text" in c)));
		if (!owner) return null;
		const inv = invert(m);
		if (!inv) return null;
		let bbox: Box | null | undefined;
		const bounds = () => {
			if (bbox === undefined) bbox = localBounds(content, inv);
			return bbox;
		};
		const fraction = (raw: string) =>
			raw.trim().endsWith("%") ? Number.parseFloat(raw) / 100 : (numberOf(raw) ?? 0);

		let region: Box;
		const regionAttr = (name: string, fallback: string) => attr(name) ?? fallback;
		if (attr("filterUnits") === "userSpaceOnUse") {
			region = {
				x: parseLength(regionAttr("x", "-10%"), "x", ctx.viewport) ?? 0,
				y: parseLength(regionAttr("y", "-10%"), "y", ctx.viewport) ?? 0,
				width: parseLength(regionAttr("width", "120%"), "x", ctx.viewport) ?? 0,
				height: parseLength(regionAttr("height", "120%"), "y", ctx.viewport) ?? 0,
			};
		} else {
			const b = bounds();
			if (!b || !(b.width > 0 && b.height > 0)) return null;
			region = {
				x: b.x + fraction(regionAttr("x", "-10%")) * b.width,
				y: b.y + fraction(regionAttr("y", "-10%")) * b.height,
				width: fraction(regionAttr("width", "120%")) * b.width,
				height: fraction(regionAttr("height", "120%")) * b.height,
			};
		}
		if (!(region.width > 0 && region.height > 0)) return null;

		const bboxUnits = attr("primitiveUnits") === "objectBoundingBox";
		if (bboxUnits) {
			const b = bounds();
			if (!b || !(b.width > 0 && b.height > 0)) return null;
		}
		const unitX = () => (bboxUnits ? (bounds() as Box).width : 1);
		const unitY = () => (bboxUnits ? (bounds() as Box).height : 1);
		const pair = (raw: string | undefined, fallback: number): [number, number] => {
			const n = (raw ?? "").trim().split(/[\s,]+/).filter(Boolean).map(Number);
			const a = n[0] !== undefined && Number.isFinite(n[0]) ? n[0] : fallback;
			const b = n[1] !== undefined && Number.isFinite(n[1]) ? n[1] : a;
			return [a, b];
		};

		const ownerStyle = computeStyle(owner, rootStyle);
		const primitives: SvgFilterPrimitive[] = [];
		const results = new Map<string, number>();
		const unsupported = (feature: string, what: string) => {
			warn(`filter-${feature}`, `${what} is not supported, so the filter is not applied`);
			return undefined;
		};
		const input = (raw: string | undefined): SvgFilterInput | string => {
			const v = raw?.trim();
			const previous = primitives.length > 0 ? primitives.length - 1 : "SourceGraphic";
			if (!v) return previous;
			if (v === "SourceGraphic" || v === "SourceAlpha") return v;
			if (FILTER_SOURCES.has(v)) return v;
			return results.get(v) ?? previous;
		};
		for (const c of owner.children) {
			if ("text" in c) continue;
			const name = localName(c.name);
			if (!name.startsWith("fe")) continue;
			const own = computeStyle(c, ownerStyle);
			const space = (own["color-interpolation-filters"] ?? "linearRGB").toLowerCase();
			const linear = space !== "srgb" && space !== "auto";
			const inputs: (SvgFilterInput | string)[] = [];
			const take = (raw: string | undefined) => {
				const i = input(raw);
				inputs.push(i);
				return i as SvgFilterInput;
			};
			const flood = () => {
				const color = parseColor(own["flood-color"] ?? "black", currentColor(own));
				return toHex(Array.isArray(color) ? color : [0, 0, 0, 1], opacityOf(own["flood-opacity"]));
			};
			let p: SvgFilterPrimitive;
			switch (name) {
				case "feGaussianBlur": {
					let [sx, sy] = pair(c.attrs.stdDeviation, 0);
					if (sx < 0 || sy < 0) [sx, sy] = [0, 0];
					p = { kind: "blur", in: take(c.attrs.in), sx: sx * unitX(), sy: sy * unitY(), linear };
					break;
				}
				case "feOffset":
					p = {
						kind: "offset",
						in: take(c.attrs.in),
						dx: (numberOf(c.attrs.dx) ?? 0) * unitX(),
						dy: (numberOf(c.attrs.dy) ?? 0) * unitY(),
						linear,
					};
					break;
				case "feDropShadow": {
					const [sx, sy] = pair(c.attrs.stdDeviation, 2);
					p = {
						kind: "dropShadow",
						in: take(c.attrs.in),
						dx: (numberOf(c.attrs.dx) ?? 2) * unitX(),
						dy: (numberOf(c.attrs.dy) ?? 2) * unitY(),
						sx: Math.max(0, sx) * unitX(),
						sy: Math.max(0, sy) * unitY(),
						color: flood(),
						linear,
					};
					break;
				}
				case "feColorMatrix":
					p = {
						kind: "colorMatrix",
						in: take(c.attrs.in),
						matrix: colorMatrix(c.attrs.type, c.attrs.values),
						linear,
					};
					break;
				case "feFlood":
					p = { kind: "flood", color: flood(), linear };
					break;
				case "feMerge": {
					const list: SvgFilterInput[] = [];
					for (const n of c.children)
						if (!("text" in n) && localName(n.name) === "feMergeNode")
							list.push(take(n.attrs.in));
					p = { kind: "merge", in: list, linear };
					break;
				}
				case "feComposite": {
					const operator = (c.attrs.operator ?? "over").trim();
					if (operator === "arithmetic") return unsupported("feComposite-arithmetic", '<feComposite operator="arithmetic">');
					p = {
						kind: "composite",
						operator: COMPOSITE_OPERATORS.has(operator)
							? (operator as "over")
							: "over",
						in: take(c.attrs.in),
						in2: take(c.attrs.in2),
						linear,
					};
					break;
				}
				case "feBlend": {
					const mode = (c.attrs.mode ?? "normal").trim();
					p = {
						kind: "blend",
						mode: BLEND_MODES.has(mode) ? (mode as SvgBlendMode) : "normal",
						in: take(c.attrs.in),
						in2: take(c.attrs.in2),
						linear,
					};
					break;
				}
				default:
					return unsupported(name, `<${name}>`);
			}
			const source = inputs.find((i) => typeof i === "string" && FILTER_SOURCES.has(i));
			if (source) return unsupported(source as string, `in="${source}"`);
			if (c.attrs.result) results.set(c.attrs.result.trim(), primitives.length);
			primitives.push(p);
		}
		if (primitives.length === 0) return null;
		return { transform: m, region, primitives };
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
		const filter =
			style.filter && style.filter !== "none"
				? resolveFilter(style.filter, ctx, m, content)
				: undefined;
		if (filter === null) return [];
		const opacity = opacityOf(style.opacity);
		const clip = clipShapes(style["clip-path"], ctx, m, content);
		const mask = maskItems(style.mask, ctx, m, content);
		if (clip && clip.length === 0) return [];
		const only = content[0] as SvgItem;
		if (!group && !filter && content.length === 1 && only.kind !== "group") {
			if (opacity < 1) only.opacity = opacity;
			if (!clip && !mask) return content;
			return [{ kind: "group", ...(clip ? { clip } : {}), ...(mask ? { mask } : {}), children: content }];
		}
		if (!group && !filter && !clip && !mask && opacity === 1) return content;
		const g: SvgGroup = { kind: "group", children: content };
		if (el.attrs.id) g.id = el.attrs.id;
		if (opacity < 1) g.opacity = opacity;
		if (clip) g.clip = clip;
		if (mask) g.mask = mask;
		if (filter) g.filter = filter;
		return [g];
	};

	const walkChildren = (el: XmlElement, ctx: Context): SvgItem[] => {
		const out: SvgItem[] = [];
		for (const c of el.children) if (!("text" in c)) out.push(...walk(c, ctx));
		return out;
	};

	const walk = (el: XmlElement, ctx: Context): SvgItem[] => {
		if (ctx.ancestors.has(el)) return walkElement(el, ctx);
		ctx.ancestors.add(el);
		try {
			return walkElement(el, ctx);
		} finally {
			ctx.ancestors.delete(el);
		}
	};

	const walkElement = (el: XmlElement, ctx: Context): SvgItem[] => {
		if (ctx.depth > MAX_DEPTH) {
			warn("depth-limit", `content nested deeper than ${MAX_DEPTH} is skipped`);
			return [];
		}
		if (items >= MAX_ITEMS) {
			warn("item-limit", `drawings are limited to ${MAX_ITEMS} shapes`);
			return [];
		}
		if (++walked > MAX_WALK) {
			warn("walk-limit", `drawings are limited to ${MAX_WALK} elements`);
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
				if (ctx.uses.has(target) || ctx.ancestors.has(target)) {
					warn("use-cycle", `"#${id}" refers to itself`);
					return [];
				}
				const x = parseLength(el.attrs.x, "x", ctx.viewport) ?? 0;
				const y = parseLength(el.attrs.y, "y", ctx.viewport) ?? 0;
				let um = multiply(m, translate(x, y));
				const uses = new Set(ctx.uses);
				for (let e: XmlElement | undefined = target; e && !uses.has(e); e = parents.get(e))
					uses.add(e);
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
		uses: new Set<XmlElement | string>([root]),
		ancestors: new Set(),
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

const FILTER_SOURCES = new Set(["BackgroundImage", "BackgroundAlpha", "FillPaint", "StrokePaint"]);

const COMPOSITE_OPERATORS = new Set(["over", "in", "out", "atop", "xor"]);

const BLEND_MODES = new Set<string>([
	"normal",
	"multiply",
	"screen",
	"overlay",
	"darken",
	"lighten",
	"color-dodge",
	"color-burn",
	"hard-light",
	"soft-light",
	"difference",
	"exclusion",
	"hue",
	"saturation",
	"color",
	"luminosity",
]);

const IDENTITY_COLOR_MATRIX = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];

// feColorMatrix as 20 row-major values, with the offsets in 0..1.
function colorMatrix(type: string | undefined, values: string | undefined): number[] {
	const v = (values ?? "").trim().split(/[\s,]+/).filter(Boolean).map(Number);
	const one = v.length === 1 && Number.isFinite(v[0]) ? (v[0] as number) : undefined;
	switch ((type ?? "matrix").trim()) {
		case "saturate": {
			const s = one ?? 1;
			return [
				0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0, 0,
				0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0, 0,
				0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s, 0, 0,
				0, 0, 0, 1, 0,
			];
		}
		case "hueRotate": {
			const a = ((one ?? 0) * Math.PI) / 180;
			const cos = Math.cos(a);
			const sin = Math.sin(a);
			return [
				0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928, 0, 0,
				0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.14, 0.072 - cos * 0.072 - sin * 0.283, 0, 0,
				0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072, 0, 0,
				0, 0, 0, 1, 0,
			];
		}
		case "luminanceToAlpha":
			return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.2125, 0.7154, 0.0721, 0, 0];
		default:
			return v.length === 20 && v.every(Number.isFinite) ? v : [...IDENTITY_COLOR_MATRIX];
	}
}

const MARKABLE = new Set(["path", "line", "polyline", "polygon"]);
const TEXT_PATH_SHAPES = new Set([
	"path",
	"rect",
	"circle",
	"ellipse",
	"line",
	"polyline",
	"polygon",
]);

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
