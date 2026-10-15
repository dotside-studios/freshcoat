import {
	type DrawCommand,
	MM_PER_INCH,
	parseColor,
	type ResolvedFont,
	type Stroke,
	type TextStroke,
} from "@freshcoat-js/engine";
import {
	extendable,
	rotatedBox,
	type SafeAreaEdge,
	templateBleed,
	trimEdgesTouched,
} from "./bleed";
import { DEFAULT_IMAGE_DPI_UNITS } from "./image-dpi";
import { hasToken } from "./mustache";
import { describeQrIssue, type QrIssue, qrIssues } from "./qr-checks";
import type { Element, Template, TextElement } from "./types";

export const POINTS_PER_INCH = 72;

/** Thresholds the print checks hold a layer to, at print size. */
export type PrintCheckOptions = {
	/** Design units per inch. Default 300. */
	dpi?: number;
	/** Smallest font size, in points. Default 6. */
	minTextPt?: number;
	/** Smallest font size for a light weight (300 or less) or a thin family.
	 *  Default 7. */
	minLightTextPt?: number;
	/** Thinnest stroke, in points. Default 0.25. */
	minStrokePt?: number;
	/** Text below this size, in points, is checked for a rich-black fill.
	 *  Default 12. */
	richBlackTextPt?: number;
};

export const PRINT_CHECK_DEFAULTS: Required<PrintCheckOptions> = {
	dpi: DEFAULT_IMAGE_DPI_UNITS,
	minTextPt: 6,
	minLightTextPt: 7,
	minStrokePt: 0.25,
	richBlackTextPt: 12,
};

export type PrintIssue =
	| QrIssue
	| { code: "small_text"; sizePt: number; minPt: number; light: boolean }
	| { code: "hairline_stroke"; widthPt: number; minPt: number }
	| { code: "rich_black_text"; color: string; sizePt: number; maxPt: number }
	| { code: "short_of_bleed"; edges: SafeAreaEdge[] };

export type PrintIssueCode = PrintIssue["code"];

/** A layer that may not print as it looks on screen. */
export type PrintHint = {
	kind: "print";
	/** Frame index in `template_data`. */
	side: number;
	sideName: string;
	/** Child indices from the frame's `elements` down to the layer. */
	path: number[];
	id: string;
	issue: PrintIssue;
};

/** A print issue found in a rendered side, after fields, fit and scaling. */
export type PrintCheckWarning = {
	kind: "print_check";
	layer?: string;
	issue: PrintIssue;
};

function resolveOptions(o: PrintCheckOptions): Required<PrintCheckOptions> {
	return { ...PRINT_CHECK_DEFAULTS, ...o };
}

/** A length in design units at `dpi`, in points. */
export function unitsToPt(units: number, dpi: number): number {
	return (units / dpi) * POINTS_PER_INCH;
}

/** A length in design units at `dpi`, in millimetres. */
export function unitsToMm(units: number, dpi: number): number {
	return (units / dpi) * MM_PER_INCH;
}

const THIN_FAMILY = /\b(thin|hairline|extra ?light|ultra ?light|light)\b/i;

/** Whether a face is drawn with thin strokes: weight 300 or less, or a family
 *  named as thin or light. */
export function isLightFace(family: string, weight: number | undefined): boolean {
	return (weight ?? 400) <= 300 || THIN_FAMILY.test(family);
}

// The pipeline is sRGB only, so which inks a colour separates into is not
// known. A dark colour that is not a neutral grey is likely to come out as a
// mix of all four inks (rich black) when converted, where a neutral grey or
// pure black can print from black ink alone.
const RICH_BLACK_MAX_CHANNEL = 64;
const NEUTRAL_SPREAD = 8;

/** Whether a colour is a near-black mixed from unequal channels. Pure black
 *  and neutral greys are not. Advisory: the real separation is the printer's. */
export function isRichBlack(color: string): boolean {
	const c = parseColor(color);
	if (!c || c === "none" || c[3] < 0.5) return false;
	const [r, g, b] = c;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	return max <= RICH_BLACK_MAX_CHANNEL && max - min >= NEUTRAL_SPREAD;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

type TextRun = { size: number; family: string; weight?: number; color?: string };

function textIssues(
	runs: readonly TextRun[],
	o: Required<PrintCheckOptions>,
): PrintIssue[] {
	const out: PrintIssue[] = [];
	let small: Extract<PrintIssue, { code: "small_text" }> | undefined;
	let rich: Extract<PrintIssue, { code: "rich_black_text" }> | undefined;
	for (const run of runs) {
		const sizePt = round2(unitsToPt(run.size, o.dpi));
		const light = isLightFace(run.family, run.weight);
		const minPt = light ? o.minLightTextPt : o.minTextPt;
		if (sizePt < minPt && (!small || sizePt < small.sizePt))
			small = { code: "small_text", sizePt, minPt, light };
		if (
			run.color !== undefined &&
			sizePt < o.richBlackTextPt &&
			isRichBlack(run.color) &&
			(!rich || sizePt < rich.sizePt)
		)
			rich = {
				code: "rich_black_text",
				color: run.color,
				sizePt,
				maxPt: o.richBlackTextPt,
			};
	}
	if (small) out.push(small);
	if (rich) out.push(rich);
	return out;
}

function strokeIssue(
	width: number | undefined,
	o: Required<PrintCheckOptions>,
): PrintIssue | null {
	if (width === undefined || !(width > 0)) return null;
	const widthPt = round2(unitsToPt(width, o.dpi));
	return widthPt < o.minStrokePt
		? { code: "hairline_stroke", widthPt, minPt: o.minStrokePt }
		: null;
}

function solidText(el: TextElement): string | undefined {
	const { fill, color } = el.properties;
	if (fill !== undefined) return typeof fill === "string" ? fill : undefined;
	return color ?? "#000000";
}

const staticColor = (c: string | undefined) =>
	c === undefined || hasToken(c) ? undefined : c;

function templateTextRuns(el: TextElement): TextRun[] {
	const { font, spans } = el.properties;
	const base = solidText(el);
	const gradient = el.properties.fill !== undefined && base === undefined;
	if (!spans?.length)
		return [
			{
				size: font.size,
				family: font.family,
				weight: font.weight,
				color: staticColor(base),
			},
		];
	return spans.map((span) => {
		const color = gradient ? undefined : (span.color ?? base);
		return {
			size: span.font?.size ?? font.size,
			family: span.font?.family ?? font.family,
			weight: span.font?.weight ?? font.weight,
			color: staticColor(color),
		};
	});
}

type SideWidths = Partial<Record<"top" | "right" | "bottom" | "left", number>>;

/** The thinnest side a stroke draws: its width, or with a width per side, the
 *  narrowest side that has one. */
function thinnestStroke(width: number | SideWidths | undefined): number | undefined {
	if (width === undefined || typeof width === "number") return width;
	const drawn = Object.values(width).filter((w): w is number => (w ?? 0) > 0);
	return drawn.length > 0 ? Math.min(...drawn) : undefined;
}

function elementStrokeWidth(el: Element): number | undefined {
	const stroke = (el.properties as { stroke?: { width: number | SideWidths } })
		.stroke;
	return thinnestStroke(stroke?.width);
}

function layerIssues(el: Element, o: Required<PrintCheckOptions>): PrintIssue[] {
	const out: PrintIssue[] = [];
	if (el.type === "text") out.push(...textIssues(templateTextRuns(el), o));
	if (el.type === "qr_code") out.push(...qrIssues(el));
	const stroke = strokeIssue(elementStrokeWidth(el), o);
	if (stroke) out.push(stroke);
	return out;
}

function children(el: Element): Element[] {
	if (el.type === "frame") return el.properties.children;
	if (el.type === "mask") return el.properties.children;
	return [];
}

const EDGE = 0.5;

const BLEED_TYPES = new Set<Element["type"]>(["rect", "image", "frame"]);

/** Top-level rects, images and frames that run to a trim edge with bleed but
 *  stop short of the bleed line, and are not grown into it at render. */
function shortOfBleed(
	t: Pick<Template, "width" | "height" | "bleed">,
	el: Element,
): SafeAreaEdge[] {
	if (!BLEED_TYPES.has(el.type)) return [];
	const box = rotatedBox(el);
	if (!box) return [];
	const bleed = templateBleed(t);
	const trim = { width: t.width, height: t.height };
	const reach = {
		left: -box[0],
		top: -box[1],
		right: box[2] - t.width,
		bottom: box[3] - t.height,
	};
	const grown = extendable(el) ? trimEdgesTouched(box, trim) : [];
	const edges: SafeAreaEdge[] = ["left", "top", "right", "bottom"];
	return edges.filter((edge) => {
		const b = bleed[edge];
		const r = reach[edge];
		return b > 0 && r >= -EDGE && r < b - EDGE && !grown.includes(edge);
	});
}

/**
 * Layers that may not print as they look: text too small to read, strokes
 * too thin to hold, small text in a rich black, and art that runs to the trim
 * but not into the bleed. Sizes are read at `dpi`. Text whose content or
 * colour comes from a field is checked as authored; a render checks it again
 * with its values.
 */
export function printHints(
	t: Template,
	options: PrintCheckOptions = {},
): PrintHint[] {
	const o = resolveOptions(options);
	const out: PrintHint[] = [];
	t.template_data.forEach((frame, side) => {
		const visit = (el: Element, path: number[]) => {
			if (el.hidden) return;
			const push = (issue: PrintIssue) =>
				out.push({ kind: "print", side, sideName: frame.name, path, id: el.id, issue });
			for (const issue of layerIssues(el, o)) push(issue);
			if (path.length === 1) {
				const edges = shortOfBleed(t, el);
				if (edges.length > 0) push({ code: "short_of_bleed", edges });
			}
			children(el).forEach((c, i) => visit(c, [...path, i]));
		};
		frame.elements.forEach((el, i) => visit(el, [i]));
	});
	return out;
}

function commandStrokeScale(cmd: DrawCommand): number {
	if (cmd.op !== "drawPath" || !cmd.viewBox) return 1;
	const { width, height } = cmd.viewBox;
	if (!(width > 0 && height > 0)) return 1;
	return Math.min(cmd.size.width / width, cmd.size.height / height);
}

function fontRun(font: ResolvedFont, color: string | undefined): TextRun {
	return { size: font.size, family: font.family, weight: font.weight, color };
}

/**
 * The print checks on a side's lowered commands, in the units they are drawn
 * in, `dpi` to the inch. Text is read as laid out, after fields are filled and
 * `fit` has shrunk it, and a stroke as scaled by its path's viewBox. A part
 * drawn without an id of its own, such as a barcode's caption, is reported as
 * the layer it is in. One warning per layer and check, the worst.
 */
export function printCheckWarnings(
	commands: readonly { op: string }[],
	options: PrintCheckOptions = {},
): PrintCheckWarning[] {
	const o = resolveOptions(options);
	const found = new Map<string, PrintCheckWarning>();
	const add = (layer: string | undefined, issue: PrintIssue) => {
		const key = `${layer ?? ""}|${issue.code}`;
		const prev = found.get(key)?.issue;
		if (prev && measure(prev) <= measure(issue)) return;
		found.set(key, { kind: "print_check", ...(layer ? { layer } : {}), issue });
	};
	const visit = (cmd: DrawCommand, parent: string | undefined) => {
		if (cmd.opacity === 0) return;
		const layer = cmd.id ?? parent;
		if (cmd.op === "drawGroup" || cmd.op === "drawMasked")
			for (const c of cmd.children) visit(c, layer);
		if (cmd.op === "drawText") {
			const solid = cmd.fill === undefined || cmd.fill.kind === "solid";
			const runs = cmd.layout.lines.flatMap((line) =>
				line.spans.map((s) => fontRun(s.font, solid ? s.color : undefined)),
			);
			const all =
				runs.length > 0
					? runs
					: [fontRun(cmd.layout.font, solid ? cmd.color : undefined)];
			for (const issue of textIssues(all, o)) add(layer, issue);
		}
		const stroke = (cmd as { stroke?: Stroke | TextStroke }).stroke;
		const width = thinnestStroke(
			stroke && "sides" in stroke && stroke.sides ? stroke.sides : stroke?.width,
		);
		const issue = strokeIssue(
			width === undefined ? undefined : width * commandStrokeScale(cmd),
			o,
		);
		if (issue) add(layer, issue);
	};
	for (const cmd of commands)
		if (cmd.op.startsWith("draw")) visit(cmd as DrawCommand, undefined);
	return [...found.values()];
}

function measure(issue: PrintIssue): number {
	switch (issue.code) {
		case "small_text":
		case "rich_black_text":
			return issue.sizePt;
		case "hairline_stroke":
			return issue.widthPt;
		case "short_of_bleed":
			return -issue.edges.length;
		default:
			return 0;
	}
}

function andList(items: readonly string[]): string {
	return items.length < 2
		? items.join("")
		: `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** A print issue as one line of readable text. */
export function describePrintIssue(issue: PrintIssue): string {
	switch (issue.code) {
		case "qr_low_contrast":
		case "qr_inverted":
		case "qr_quiet_zone":
		case "qr_logo_large":
			return describeQrIssue(issue);
		case "small_text":
			return `Text is ${issue.sizePt} pt at print size, below ${issue.minPt} pt${issue.light ? " for a light face" : ""}`;
		case "hairline_stroke":
			return `Stroke is ${issue.widthPt} pt at print size, below ${issue.minPt} pt; it may not print`;
		case "rich_black_text":
			return `${issue.sizePt} pt text in ${issue.color} may print as rich black and blur if plates are out of register; pure black (#000000) is safer`;
		case "short_of_bleed":
			return `Runs to the trim on the ${andList(issue.edges)} but not into the bleed; a cut that drifts shows a white edge`;
	}
}
