import type { TextElement } from "@freshcoat-js/coatfile";
import { parseMustache } from "@freshcoat-js/coatfile/mustache";
import {
	createSharedFontProvider,
	makeParagraphBuilder,
	resolveDirection,
	type SharedFontProvider,
	spanTextStyle,
	toColor,
} from "@freshcoat-js/engine";
import type { Canvas, CanvasKit, Paragraph, TextAlign } from "canvaskit-wasm";

export type TextProps = TextElement["properties"];
export type Box = { x: number; y: number; width: number; height: number };
export type Caret = { x: number; y: number; height: number };

type Block = {
	start: number;
	end: number;
	top: number;
	para: Paragraph;
	emptyX: number;
};
type Line = { block: Block; start: number; top: number; height: number };

const SHRINK_FLOOR = 8;

let cached: {
	ck: CanvasKit;
	fonts: ReadonlyMap<string, readonly Uint8Array[]>;
	set: SharedFontProvider;
} | null = null;

function fontSet(
	ck: CanvasKit,
	fonts: ReadonlyMap<string, readonly Uint8Array[]>,
): SharedFontProvider {
	if (cached?.ck === ck && cached.fonts === fonts) return cached.set;
	if (cached?.ck === ck && cached.set.extend(fonts)) {
		cached.fonts = fonts;
		return cached.set;
	}
	cached?.set.release();
	cached = { ck, fonts, set: createSharedFontProvider(ck, fonts) };
	return cached.set;
}

/** The raw text with the layer's case applied outside its `{{tokens}}`,
 *  one code point at a time so every index still points at the same
 *  character. */
export function casedText(text: string, mode: TextProps["case"]): string {
	if (mode !== "upper" && mode !== "lower" && mode !== "title") return text;
	let out = "";
	for (const seg of parseMustache(text)) {
		if (seg.kind === "ref") {
			out += seg.raw;
			continue;
		}
		let prev = text[seg.start - 1] ?? "";
		for (const ch of seg.value) {
			const word = mode === "title" && !/[\p{L}\p{N}_]/u.test(prev);
			const next =
				mode === "upper" || word
					? ch.toUpperCase()
					: mode === "lower"
						? ch.toLowerCase()
						: ch;
			out += next.length === ch.length ? next : ch;
			prev = ch;
		}
	}
	return out;
}

/**
 * A text layer's raw template text laid out by CanvasKit's Paragraph, in the
 * layer's own font, so editing shows the shaping and line breaks the render
 * paints. Coordinates are design units from the layer box's top left.
 * One paragraph per hard line, so paragraph spacing sits between them.
 */
export class EditableText {
	text = "";
	height = 0;
	fontSize = 0;
	private blocks: Block[] = [];
	private lines: Line[] = [];
	private set: SharedFontProvider | null = null;

	constructor(private readonly ck: CanvasKit) {}

	layout(
		text: string,
		props: TextProps,
		fonts: ReadonlyMap<string, readonly Uint8Array[]>,
		box: { width: number; height: number },
	): void {
		const set = fontSet(this.ck, fonts);
		if (set !== this.set) {
			set.retain();
			this.release();
			this.set = set;
		}
		this.text = text;
		const families = [...fonts.keys()];
		const shown = casedText(text, props.case);
		const size = props.font.size;
		this.build(shown, props, families, box.width, size);
		if (
			props.fit === "shrink" &&
			size >= SHRINK_FLOOR &&
			this.height > box.height
		) {
			let lo = SHRINK_FLOOR;
			let hi = Math.ceil(size) - 1;
			let best = SHRINK_FLOOR;
			while (lo <= hi) {
				const mid = Math.floor((lo + hi) / 2);
				this.build(shown, props, families, box.width, mid);
				if (this.height <= box.height) {
					best = mid;
					lo = mid + 1;
				} else hi = mid - 1;
			}
			this.build(shown, props, families, box.width, best);
		}
		const room = box.height - this.height;
		const k =
			props.verticalAlign === "middle"
				? 0.5
				: props.verticalAlign === "bottom"
					? 1
					: 0;
		const shift = Math.max(0, room * k);
		for (const b of this.blocks) b.top += shift;
		for (const l of this.lines) l.top += shift;
		this.height = Math.max(box.height, this.height + shift);
	}

	private build(
		shown: string,
		props: TextProps,
		families: string[],
		width: number,
		size: number,
	): void {
		this.clear();
		const { ck } = this;
		const font = props.font;
		const rtl =
			(props.direction === "auto"
				? resolveDirection(shown)
				: props.direction) === "rtl";
		const lineHeight =
			typeof font.lineHeight === "number" ? font.lineHeight : undefined;
		const align = props.align ?? (props.direction ? "start" : "left");
		const textAlign: Record<string, TextAlign> = {
			left: ck.TextAlign.Left,
			center: ck.TextAlign.Center,
			right: ck.TextAlign.Right,
			justify: ck.TextAlign.Justify,
			start: ck.TextAlign.Start,
			end: ck.TextAlign.End,
		};
		const style = new ck.ParagraphStyle({
			textAlign: textAlign[align] ?? ck.TextAlign.Left,
			textDirection: rtl ? ck.TextDirection.RTL : ck.TextDirection.LTR,
			textStyle: {
				...spanTextStyle(ck, { ...font, size }, families),
				color: toColor(ck, props.color ?? ""),
				...(lineHeight
					? { heightMultiplier: lineHeight, halfLeading: true }
					: {}),
				...(font.decoration
					? {
							decoration:
								font.decoration === "underline"
									? ck.UnderlineDecoration
									: ck.LineThroughDecoration,
						}
					: {}),
			},
		});
		const edge =
			align === "center"
				? 0.5
				: align === "right" ||
						(align === "end" && !rtl) ||
						(rtl && (align === "start" || align === "justify"))
					? 1
					: 0;
		const emptyX = width * edge;
		const provider = (this.set as SharedFontProvider).provider;
		const spacing = props.paragraphSpacing ?? 0;
		let start = 0;
		let top = 0;
		for (const part of shown.split("\n")) {
			const builder = makeParagraphBuilder(ck, style, provider);
			builder.addText(part);
			const para = builder.build();
			builder.delete();
			para.layout(width);
			const block = { start, end: start + part.length, top, para, emptyX };
			this.blocks.push(block);
			const metrics = para.getLineMetrics();
			for (const lm of metrics)
				this.lines.push({
					block,
					start: lm.startIndex,
					top: top + lm.baseline - lm.ascent,
					height: lm.ascent + lm.descent,
				});
			if (metrics.length === 0)
				this.lines.push({ block, start: 0, top, height: para.getHeight() });
			top += para.getHeight() + spacing;
			start = block.end + 1;
		}
		this.height = top - spacing;
		this.fontSize = size;
	}

	private blockAt(index: number): Block {
		const i = Math.max(0, Math.min(index, this.text.length));
		return (
			this.blocks.find((b) => i <= b.end) ??
			(this.blocks[this.blocks.length - 1] as Block)
		);
	}

	private lineAt(index: number): number {
		const b = this.blockAt(index);
		const local = Math.min(index, b.end) - b.start;
		let found = -1;
		this.lines.forEach((l, i) => {
			if (l.block === b && l.start <= local) found = i;
		});
		return Math.max(0, found);
	}

	/** Where the caret sits before `index`. */
	caret(index: number): Caret {
		const line = this.lines[this.lineAt(index)] as Line;
		const b = line.block;
		const local = Math.max(0, Math.min(index, b.end) - b.start);
		const len = b.end - b.start;
		const rtl = (d: { value: number }) =>
			d.value === this.ck.TextDirection.RTL.value;
		const at = local < len ? b.para.getGlyphInfoAt(local) : null;
		const info = at ?? (local > 0 ? b.para.getGlyphInfoAt(local - 1) : null);
		let x = b.emptyX;
		if (info) {
			const [l, , r] = info.graphemeLayoutBounds as unknown as number[];
			x = ((at ? rtl(info.dir) : !rtl(info.dir)) ? r : l) as number;
		}
		return { x, y: line.top, height: line.height };
	}

	/** The boxes covering `[start, end)`, a hard break included. */
	rects(start: number, end: number): Box[] {
		const out: Box[] = [];
		const { ck } = this;
		for (const b of this.blocks) {
			const from = Math.max(start, b.start);
			const to = Math.min(end, b.end);
			if (from < to)
				for (const r of b.para.getRectsForRange(
					from - b.start,
					to - b.start,
					ck.RectHeightStyle.Max,
					ck.RectWidthStyle.Tight,
				)) {
					const [x0, y0, x1, y1] = r.rect as unknown as number[];
					out.push({
						x: x0 as number,
						y: b.top + (y0 as number),
						width: (x1 as number) - (x0 as number),
						height: (y1 as number) - (y0 as number),
					});
				}
			if (start <= b.end && end > b.end && b.end < this.text.length) {
				const c = this.caret(b.end);
				out.push({
					x: c.x,
					y: c.y,
					width: this.fontSize * 0.3,
					height: c.height,
				});
			}
		}
		return out;
	}

	/** The text index nearest a point. */
	indexAt(x: number, y: number): number {
		const line =
			this.lines.find((l) => y < l.top + l.height) ??
			(this.lines[this.lines.length - 1] as Line);
		return this.indexOnLine(line, x);
	}

	private indexOnLine(line: Line, x: number): number {
		const b = line.block;
		const pos = b.para.getGlyphPositionAtCoordinate(
			x,
			line.top - b.top + line.height / 2,
		).pos;
		return b.start + Math.max(0, Math.min(pos, b.end - b.start));
	}

	/** The index a line up or down from `index`, nearest `x`. Past the first
	 *  or last line, the start or end of the text. */
	vertical(index: number, by: -1 | 1, x: number): number {
		const line = this.lines[this.lineAt(index) + by];
		if (!line) return by < 0 ? 0 : this.text.length;
		return this.indexOnLine(line, x);
	}

	/** The start or end of the visual line holding `index`. */
	lineEdge(index: number, edge: "start" | "end"): number {
		const b = this.blockAt(index);
		const n = this.lineAt(index) - this.lines.findIndex((l) => l.block === b);
		const metrics = b.para.getLineMetrics();
		const lm = metrics[n];
		if (!lm) return edge === "start" ? b.start : b.end;
		if (edge === "start") return b.start + lm.startIndex;
		if (n === metrics.length - 1) return b.end;
		return b.start + lm.endExcludingWhitespaces;
	}

	/** The word around `index`. */
	word(index: number): [number, number] {
		const b = this.blockAt(index);
		const len = b.end - b.start;
		if (len === 0) return [b.start, b.end];
		const local = Math.min(index - b.start, len - 1);
		const w = b.para.getWordBoundary(local);
		return [b.start + w.start, b.start + w.end];
	}

	/** The hard line around `index`. */
	paragraph(index: number): [number, number] {
		const b = this.blockAt(index);
		return [b.start, b.end];
	}

	/** The `{{tokens}}` in the text, as the boxes they cover. */
	tokens(): Box[] {
		return parseMustache(this.text)
			.filter((s) => s.kind === "ref")
			.flatMap((s) => this.rects(s.start, s.end));
	}

	paint(canvas: Canvas): void {
		for (const b of this.blocks) canvas.drawParagraph(b.para, 0, b.top);
	}

	private clear(): void {
		for (const b of this.blocks) b.para.delete();
		this.blocks = [];
		this.lines = [];
	}

	private release(): void {
		this.set?.release();
		this.set = null;
	}

	dispose(): void {
		this.clear();
		this.release();
	}
}
