import {
	type Background,
	type Effect,
	type Element,
	effectsOf,
	type Fill,
	type Template,
	type TextProperties,
} from "@freshcoat-js/coatfile";
import { type ElementPatch, updateElement } from "./ops";
import { getElement } from "./path";
import { type OpResult, ok, refuse } from "./result";

type Layer = Element | Background;
type RectLike = Extract<Layer, { type: "rect" | "frame" }>["properties"];
type Stroke = NonNullable<RectLike["stroke"]>;
type CornerRadius = NonNullable<RectLike["cornerRadius"]>;

const TEXT_KEYS = [
	"font",
	"color",
	"fill",
	"align",
	"alignLast",
	"paragraphSpacing",
	"direction",
	"verticalAlign",
	"case",
	"leadingTrim",
] as const satisfies readonly (keyof TextProperties)[];

type TextStyle = Partial<Pick<TextProperties, (typeof TEXT_KEYS)[number]>>;

/** A layer's look, each part present only when the layer has that part.
 *  An undefined value inside a part clears it on paste. */
export type LayerStyle = {
	fill?: { fill: Fill | Fill[] | undefined };
	stroke?: { stroke: Stroke | undefined };
	corners?: {
		cornerRadius: CornerRadius | undefined;
		cornerSmoothing: number | undefined;
	};
	effects: { effects: Effect[] | undefined };
	text?: TextStyle;
};

const hasFill = (el: Layer) =>
	el.type === "rect" ||
	el.type === "vector" ||
	el.type === "frame" ||
	el.type === "text";
const hasCorners = (el: Layer) =>
	el.type === "rect" ||
	el.type === "vector" ||
	el.type === "frame" ||
	el.type === "image";
const hasStroke = (el: Layer) => hasCorners(el) || el.type === "text";

/** A stroke as a text layer takes it: no dash, cap or trim. */
function textStroke(stroke: Stroke | undefined): Stroke | undefined {
	if (!stroke) return undefined;
	const { color, width, join, align } = stroke;
	return {
		color,
		width,
		...(join ? { join } : {}),
		...(align ? { align } : {}),
	};
}

export function readStyle(el: Layer): LayerStyle {
	const p = el.properties as Record<string, unknown>;
	const effects = effectsOf(el);
	const style: LayerStyle = {
		effects: { effects: effects.length > 0 ? effects : undefined },
	};
	if (el.type === "text") {
		const fill = el.properties.fill ?? el.properties.color;
		style.fill = { fill };
		style.text = Object.fromEntries(
			TEXT_KEYS.map((k) => [k, el.properties[k]]),
		) as TextStyle;
	} else if (hasFill(el)) style.fill = { fill: p.fill as Fill | Fill[] };
	if (hasStroke(el)) style.stroke = { stroke: p.stroke as Stroke };
	if (hasCorners(el))
		style.corners = {
			cornerRadius: p.cornerRadius as CornerRadius,
			cornerSmoothing: p.cornerSmoothing as number,
		};
	return style;
}

/** The patch that gives `el` the parts of `style` it can take. */
export function stylePatch(el: Layer, style: LayerStyle): ElementPatch {
	const props: Record<string, unknown> = {};
	if (style.fill && hasFill(el)) {
		if (el.type === "text") {
			if (!style.text) {
				const fills = [style.fill.fill ?? []].flat();
				const top = fills.at(-1);
				props.color = typeof top === "string" ? top : undefined;
				props.fill = typeof top === "string" ? undefined : top;
			}
		} else props.fill = style.fill.fill;
	}
	if (style.stroke && hasStroke(el))
		props.stroke =
			el.type === "text"
				? textStroke(style.stroke.stroke)
				: style.stroke.stroke;
	if (style.corners && hasCorners(el)) {
		const r = style.corners.cornerRadius;
		props.cornerRadius =
			el.type !== "vector" || typeof r !== "object" ? r : r[0];
		if (el.type !== "vector")
			props.cornerSmoothing = style.corners.cornerSmoothing;
	}
	if (style.text && el.type === "text") {
		Object.assign(props, style.text);
		if (el.properties.spans)
			props.spans = el.properties.spans.map((s) => ({ text: s.text }));
	}
	return {
		...style.effects,
		shadow: undefined,
		blur: undefined,
		backdropBlur: undefined,
		properties: props,
	};
}

/** Gives every layer in `keys` the parts of `style` it can take. */
export function pasteStyle(
	t: Template,
	keys: string[],
	style: LayerStyle,
): OpResult {
	let out = t;
	const done: string[] = [];
	for (const key of keys) {
		const el = getElement(out, key);
		if (!el) continue;
		const result = updateElement(out, key, stylePatch(el, style));
		if (!result.ok) return result;
		out = result.template;
		done.push(key);
	}
	if (done.length === 0)
		return refuse("empty_selection", "Select layers to paste the style onto");
	return ok(out, done);
}
