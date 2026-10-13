import { resolveInsets } from "./bleed";
import { fieldContext, prepareTemplate } from "./prepare";
import type { Sides, SliceElement, Template } from "./types";
import { pruneHiddenElements } from "./visibility";

export type ResolveSlicesOptions = {
	/** The side to read. Default: the first. */
	frameName?: string;
	values?: Record<string, unknown>;
	variantId?: string;
	/** Lay the design out at this size first, as `compile` does. */
	resize?: { width: number; height: number };
};

export type ResolvedSlice = {
	id: string;
	name: string;
	/** In trim coordinates. */
	box: { x: number; y: number; width: number; height: number };
	/** The closed outline of the shape, in trim coordinates. */
	path: string;
	fillRule: "nonzero" | "evenodd";
	output: "piece" | "none";
	edge: "none" | "through" | "kiss" | "score" | "perforate";
	bleed: Sides;
	/** `properties.order`, or the slice's index among the side's elements. */
	order: number;
};

/**
 * The shown slices of one side, as a render would resolve them: after the
 * variant, `resize`, and the values' visibility conditions. Sorted by `order`,
 * then document order.
 */
export function resolveSlices(
	template: Template,
	options: ResolveSlicesOptions = {},
): ResolvedSlice[] {
	const prepared = prepareTemplate(template, {
		variantId: options.variantId,
		resize: options.resize,
	});
	const frame =
		options.frameName === undefined
			? prepared.template_data[0]
			: prepared.template_data.find((f) => f.name === options.frameName);
	if (!frame) throw new Error(`no side named "${options.frameName}"`);

	const shown = pruneHiddenElements(
		frame.elements,
		fieldContext(prepared, options.values ?? {}),
		prepared.fields.properties,
	);
	const shownIds = new Set(shown.map((el) => el.id));
	const slices: (ResolvedSlice & { index: number })[] = [];
	frame.elements.forEach((el, index) => {
		if (el.type === "slice" && shownIds.has(el.id))
			slices.push({ ...resolveSlice(el, index), index });
	});
	return slices
		.sort((a, b) => a.order - b.order || a.index - b.index)
		.map(({ index: _index, ...slice }) => slice);
}

function resolveSlice(el: SliceElement, index: number): ResolvedSlice {
	const props = el.properties;
	const x = el.pos?.x ?? 0;
	const y = el.pos?.y ?? 0;
	const width = el.size?.width ?? 0;
	const height = el.size?.height ?? 0;
	const shape = props.shape ?? { kind: "rect" as const };
	return {
		id: el.id,
		name: props.name ?? el.id,
		box: { x, y, width, height },
		path:
			shape.kind === "path"
				? translatePath(shape.d, x, y)
				: roundedRectPath(x, y, width, height, shape.cornerRadius),
		fillRule: shape.kind === "path" ? (shape.fillRule ?? "nonzero") : "nonzero",
		output: props.output ?? "piece",
		edge: props.edge ?? "none",
		bleed: resolveInsets(props.bleed),
		order: props.order ?? index,
	};
}

// Corners are clamped together so neighbours never overlap, as a rect's are
// when painted.
function roundedRectPath(
	x: number,
	y: number,
	w: number,
	h: number,
	cornerRadius: number | [number, number, number, number] | undefined,
): string {
	const cr = cornerRadius ?? 0;
	const [a, b, c, d] = typeof cr === "number" ? [cr, cr, cr, cr] : cr;
	const fit = Math.min(
		1,
		w / (a + b) || 1,
		h / (b + c) || 1,
		w / (c + d) || 1,
		h / (d + a) || 1,
	);
	const [tl, tr, br, bl] = [a, b, c, d].map((r) => Math.max(0, r) * fit);
	const r = x + w;
	const bt = y + h;
	const arc = (rad: number, ex: number, ey: number) =>
		rad > 0 ? ` A ${rad} ${rad} 0 0 1 ${ex} ${ey}` : "";
	return (
		`M ${x + tl} ${y} H ${r - tr}${arc(tr, r, y + tr)}` +
		` V ${bt - br}${arc(br, r - br, bt)}` +
		` H ${x + bl}${arc(bl, x, bt - bl)}` +
		`${tl > 0 ? ` V ${y + tl}${arc(tl, x + tl, y)}` : ""} Z`
	);
}

const ARITY: Record<string, number> = {
	M: 2,
	L: 2,
	T: 2,
	H: 1,
	V: 1,
	C: 6,
	S: 4,
	Q: 4,
	A: 7,
	Z: 0,
};

const AXIS: Record<string, ("x" | "y" | null)[]> = {
	M: ["x", "y"],
	L: ["x", "y"],
	T: ["x", "y"],
	H: ["x"],
	V: ["y"],
	C: ["x", "y", "x", "y", "x", "y"],
	S: ["x", "y", "x", "y"],
	Q: ["x", "y", "x", "y"],
	A: ["x", "y", null, null, null, "x", "y"],
	Z: [],
};

const TOKEN = /[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;

// Path data moved by (dx, dy). Absolute commands move; relative ones follow
// the pen, except a leading `m`, which is absolute.
function translatePath(d: string, dx: number, dy: number): string {
	const parts: string[] = [];
	let i = 0;
	let cmd = "";
	let slot = 0;
	let started = false;
	const skip = () => {
		while (i < d.length && /[\s,]/.test(d[i] as string)) i++;
	};
	skip();
	while (i < d.length) {
		const ch = d[i] as string;
		if (/[a-zA-Z]/.test(ch)) {
			if (!(ch.toUpperCase() in ARITY))
				throw new Error(`slice path: unknown command "${ch}"`);
			started ||= cmd !== "";
			cmd = ch;
			slot = 0;
			parts.push(ch);
			i++;
			skip();
			continue;
		}
		const upper = cmd.toUpperCase();
		const arity = ARITY[upper];
		if (!cmd || !arity) throw new Error("slice path: number without a command");
		const s = slot % arity;
		let token: string;
		if (upper === "A" && (s === 3 || s === 4)) {
			if (ch !== "0" && ch !== "1")
				throw new Error(`slice path: bad arc flag "${ch}"`);
			token = ch;
			i++;
		} else {
			TOKEN.lastIndex = i;
			const m = TOKEN.exec(d);
			if (!m) throw new Error("slice path: unreadable number");
			token = m[0];
			i += token.length;
		}
		const axis = AXIS[upper]?.[s];
		const moves =
			axis && (cmd === upper || (cmd === "m" && !started && slot < 2));
		parts.push(
			moves
				? String(Number.parseFloat(token) + (axis === "x" ? dx : dy))
				: token,
		);
		slot++;
		skip();
	}
	return parts.join(" ");
}
