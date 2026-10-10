// A Painter for print: lowers a compiled scene to one PDF page. Shapes,
// gradients, strokes, clips, masks, blend modes and images map onto PDF's own
// model, and text is drawn with its embedded font file. A layer PDF has no
// operator for (a shadow, a blur, an adjustment, text in a font a PDF cannot
// carry) is painted by the CanvasKit painter into a transparent image at
// `rasterDpi` and placed where it belongs, and reported as `vector_rasterized`.

import type { CanvasKit, GlyphRun, TypefaceFontProvider } from "canvaskit-wasm";
import {
	type Bin,
	collectAssets,
	makeBin,
	paintScene,
	type ShapedTextLine,
	shapeTextLines,
} from "../canvaskit";
import { parseColor } from "../color";
import { compileScene } from "../compile-scene";
import { normalizeDash } from "../dash";
import { fontBytes } from "../font-bytes";
import {
	createSharedFontProvider,
	type SharedFontProvider,
} from "../font-collection";
import { exportPixelSize } from "../export-scale";
import { parseImageInfo } from "../image-info";
import { dataUrlToBytes } from "../loader";
import { outlineGeometry, rectShape } from "../outline";
import { createPaintCache } from "../paint-cache";
import { fitRect, strokeInset } from "../paint-helpers";
import type { PaintTarget } from "../runtime-types";
import { isSvg } from "../svg/sniff";
import { strokeTrim } from "../trim";
import type {
	BlendMode,
	Command,
	DrawCommand,
	DrawImageCommand,
	DrawTextCommand,
	PaintWarning,
	ResolvedFill,
	ShapeMask,
	Stroke,
} from "../types";
import { drawableExtent, shiftDrawable } from "./bounds";
import { FontEmbedder, type FontFile } from "./fonts";
import { cm, type Matrix, outlineOps, pathOps, rotateAbout } from "./geometry";
import {
	name,
	num,
	type PdfDict,
	PdfName,
	PdfRef,
	type PdfValue,
	PdfWriter,
} from "./writer";

export type PdfPaintOptions = {
	/** Design units per inch. Default 72: one unit is one point. */
	dpi?: number;
	/** Pixels per inch of a layer drawn as an image. Default 600. */
	rasterDpi?: number;
	title?: string;
	/** Creation date; fixing it makes the bytes repeatable. */
	date?: Date;
};

export type PdfPaintResult = {
	bytes: Uint8Array;
	warnings: PaintWarning[];
	/** Page size in points. */
	width: number;
	height: number;
};

const BLEND: Partial<Record<BlendMode, string>> = {
	multiply: "Multiply",
	screen: "Screen",
	overlay: "Overlay",
	darken: "Darken",
	lighten: "Lighten",
	"color-dodge": "ColorDodge",
	"color-burn": "ColorBurn",
	"hard-light": "HardLight",
	"soft-light": "SoftLight",
	difference: "Difference",
	exclusion: "Exclusion",
	hue: "Hue",
	saturation: "Saturation",
	color: "Color",
	luminosity: "Luminosity",
};

const CAP = { butt: 0, round: 1, square: 2 } as const;
const JOIN = { miter: 0, round: 1, bevel: 2 } as const;
// Skia's default miter limit.
const MITER_LIMIT = 4;
// The longest edge, in pixels, a layer drawn as an image is painted at.
const MAX_RASTER_EDGE = 8192;
const MAX_SVG_NESTING = 4;
// Device pixels kept around a layer's bounds for antialiasing.
const RASTER_PAD = 2;
// Decoded pixels the layers of one page share.
const RASTER_CACHE_PIXELS = 1 << 26;

type Box = { x: number; y: number; w: number; h: number };
type Rgba = [number, number, number, number];
// A raster is drawn on the unit square; an SVG is a form at its own size.
type ImageEntry = {
	ref: PdfRef;
	width: number;
	height: number;
	vector?: true;
} | null;
type SvgScene = {
	commands: DrawCommand[];
	width: number;
	height: number;
	features: string[];
};
// `x` and `y` place the frame's top-left, in design units.
type Frame = {
	data: Uint8Array;
	width: number;
	height: number;
	scale: number;
	x: number;
	y: number;
};
// A window of the page in device pixels.
type Area = { x: number; y: number; width: number; height: number };
// A layer painted as pixels, placed in design units.
type Patch = { ref: PdfRef; x: number; y: number; w: number; h: number } | null;
type TextRun = { run: GlyphRun; file: FontFile };
type TextPlan = {
	lines: Array<{ line: ShapedTextLine; text: string; runs: TextRun[] }>;
	reason?: string;
};
// Glyphs on one baseline in one colour, shown by one TJ.
type Segment = {
	color: string;
	y: number;
	head: string;
	parts: string[];
	x: number;
	advance: number;
};

function rgba(color: string): Rgba {
	const c = parseColor(color);
	return c && c !== "none" ? c : [0, 0, 0, 1];
}

const rgb = (c: Rgba) =>
	`${num(c[0] / 255)} ${num(c[1] / 255)} ${num(c[2] / 255)}`;

const isDrawable = (c: Command): c is DrawCommand => c.op.startsWith("draw");

export async function paintPdf(
	canvasKit: unknown,
	commands: Command[],
	rt: PaintTarget,
	options: PdfPaintOptions = {},
): Promise<PdfPaintResult> {
	const ck = canvasKit as CanvasKit;
	const create = commands.find((c) => c.op === "createCanvas");
	if (create?.op !== "createCanvas")
		throw new Error("pdf: scene has no createCanvas command");
	const dpi = options.dpi ?? 72;
	if (!(dpi > 0)) throw new Error(`dpi must be positive: ${dpi}`);
	const warnings: PaintWarning[] = [];
	const { fonts, images } = collectAssets(commands);

	const loaded: Array<{ family: string; bytes: Uint8Array }> = [];
	for (const req of fonts) {
		try {
			for (const bytes of await fontBytes(rt.resolveFont(req), rt.loadBytes))
				loaded.push({ family: req.family, bytes });
		} catch (e) {
			warnings.push({
				kind: "font_load_failed",
				family: req.family,
				error: String(e),
			});
		}
	}
	const byFamily = new Map<string, Uint8Array[]>();
	for (const [family, faces] of rt.fonts ?? [])
		byFamily.set(family, [...faces]);
	for (const { family, bytes } of loaded)
		if (!rt.fonts?.has(family))
			byFamily.set(family, [...(byFamily.get(family) ?? []), bytes]);

	const sources = new Map<string, Uint8Array>();
	for (const src of images) {
		try {
			sources.set(src, await rt.loadBytes(src));
		} catch (e) {
			warnings.push({ kind: "image_load_failed", src, error: String(e) });
		}
	}
	const svgScenes = new Map<string, SvgScene>();
	const prepare = async (src: string, bytes: Uint8Array, depth: number) => {
		if (!isSvg(bytes) || svgScenes.has(src) || depth > MAX_SVG_NESTING) return;
		const scene = await svgScene(bytes);
		svgScenes.set(src, scene);
		for (const cmd of scene.commands)
			for (const inner of imageSrcs(cmd)) {
				if (sources.has(inner) || !inner.startsWith("data:")) continue;
				try {
					const data = dataUrlToBytes(inner);
					sources.set(inner, data);
					await prepare(inner, data, depth + 1);
				} catch {
					scene.features.push("image-decode");
				}
			}
	};
	for (const [src, bytes] of [...sources]) await prepare(src, bytes, 0);

	const shared = createSharedFontProvider(ck, loaded);
	(shared.provider as { __families?: string[] }).__families = [
		...new Set(loaded.map((f) => f.family)),
	];
	const bin = makeBin();
	const writer = new PdfWriter();
	const page = new PageBuilder(
		ck,
		shared.provider,
		bin,
		writer,
		new FontEmbedder(ck, byFamily, writer),
		sources,
		svgScenes,
		warnings,
	);
	try {
		const drawables = commands.filter(isDrawable);
		const setup = commands.filter(
			(c) => c.op === "loadFonts" || c.op === "loadImages",
		);
		const finish = commands.find((c) => c.op === "finishFrame");
		// Everything up to the last layer that reads what lies beneath it, or
		// the whole page under a frame finish, is one image.
		let under = finish ? drawables.length : 0;
		for (let i = under; i < drawables.length; i++)
			if (hasBackdrop(drawables[i] as DrawCommand)) under = i + 1;
		if (under > 0) page.rasterized(finish ? "frame finish" : "backdrop blur");
		const rest = drawables.slice(under);
		const scale = Math.min(
			(options.rasterDpi ?? 600) / dpi,
			MAX_RASTER_EDGE / Math.max(create.width, create.height),
		);
		const cache = rt.cache
			? null
			: createPaintCache({ maxImagePixels: RASTER_CACHE_PIXELS });
		// Fonts the shared provider holds need no loading by a layer without text.
		const narrow = loaded.every((f) => rt.fonts?.has(f.family));
		const paint = (layers: Command[], area?: Area) =>
			rasterize(
				ck,
				create,
				scale,
				[...(area && narrow ? usedSetup(setup, layers) : setup), ...layers],
				cache ? { ...rt, cache } : rt,
				shared,
				area,
			);
		let base: Patch = null;
		try {
			base =
				under > 0
					? page.patch(
							await paint([
								...drawables.slice(0, under),
								...(finish ? [finish] : []),
							]),
						)
					: null;
			for (const cmd of page.plan(rest)) {
				const layer = { ...cmd, blendMode: undefined };
				const area = layerArea(ck, layer, create, scale);
				if (area && !(area.width > 0 && area.height > 0)) {
					page.patches.set(cmd, null);
					continue;
				}
				const moved = area
					? shiftDrawable(layer, -area.x / scale, -area.y / scale)
					: layer;
				page.patches.set(cmd, page.patch(await paint([moved], area)));
			}
		} finally {
			cache?.dispose();
		}
		const k = 72 / dpi;
		let content = `q\n${cm([k, 0, 0, -k, 0, create.height * k])}`;
		if (base) content += page.placePatch(base);
		for (const cmd of rest) content += page.drawable(cmd);
		content += "Q\n";
		const bytes = await page.save(
			content,
			create.width * k,
			create.height * k,
			options,
		);
		return {
			bytes,
			warnings,
			width: create.width * k,
			height: create.height * k,
		};
	} finally {
		page.dispose();
		bin.free();
		shared.release();
	}
}

// The device pixels a layer can touch, or nothing where that is not known and it
// is painted over the whole page.
function layerArea(
	ck: CanvasKit,
	cmd: DrawCommand,
	create: Extract<Command, { op: "createCanvas" }>,
	scale: number,
): Area | undefined {
	const extent = drawableExtent(ck, cmd);
	if (!extent) return;
	const device = exportPixelSize(create, scale);
	const x = Math.max(Math.floor(extent[0] * scale) - RASTER_PAD, 0);
	const y = Math.max(Math.floor(extent[1] * scale) - RASTER_PAD, 0);
	const right = Math.min(Math.ceil(extent[2] * scale) + RASTER_PAD, device.width);
	const bottom = Math.min(
		Math.ceil(extent[3] * scale) + RASTER_PAD,
		device.height,
	);
	return { x, y, width: right - x, height: bottom - y };
}

// The fonts and images `layers` draw.
function usedSetup(setup: Command[], layers: Command[]): Command[] {
	const families = new Set<string>();
	const srcs = new Set<string>();
	const walk = (cmd: DrawCommand) => {
		if (cmd.op === "drawText")
			for (const line of cmd.layout.lines)
				for (const span of line.spans) families.add(span.font.family);
		if (cmd.op === "drawImage") srcs.add(cmd.src);
		if (cmd.op === "drawGroup" || cmd.op === "drawMasked")
			for (const child of cmd.children) walk(child);
		if (cmd.op === "drawMasked") walk(cmd.mask);
	};
	for (const cmd of layers) if (isDrawable(cmd)) walk(cmd);
	return setup.map((cmd) =>
		cmd.op === "loadFonts"
			? { ...cmd, requests: cmd.requests.filter((r) => families.has(r.family)) }
			: cmd.op === "loadImages"
				? { ...cmd, srcs: cmd.srcs.filter((src) => srcs.has(src)) }
				: cmd,
	);
}

// The layers as the CanvasKit painter draws them, at `scale`, over `area` of
// the page or all of it.
async function rasterize(
	ck: CanvasKit,
	create: Extract<Command, { op: "createCanvas" }>,
	scale: number,
	layers: Command[],
	rt: PaintTarget,
	shared: SharedFontProvider,
	area?: Area,
): Promise<Frame | null> {
	const out = await paintScene(
		ck,
		[
			{
				op: "createCanvas",
				width: area ? area.width / scale : create.width,
				height: area ? area.height / scale : create.height,
				scale,
			},
			...layers,
		],
		rt,
		{ fontProvider: shared },
	);
	try {
		const pixels = out.readPixels?.() ?? null;
		return pixels
			? {
					...pixels,
					scale,
					x: (area?.x ?? 0) / scale,
					y: (area?.y ?? 0) / scale,
				}
			: null;
	} finally {
		out.dispose();
	}
}

class PageBuilder {
	readonly patches = new Map<DrawCommand, Patch>();
	private resources: PdfRef;
	private extGStates = new Map<string, string>();
	private gsDicts: Record<string, PdfDict> = {};
	private xobjects: Record<string, PdfRef> = {};
	private xobjectIds = new Map<number, string>();
	private shadings: Record<string, PdfRef> = {};
	private images = new Map<string, ImageEntry>();
	private texts = new WeakMap<DrawTextCommand, TextPlan>();
	private reported = new Set<string>();

	constructor(
		private ck: CanvasKit,
		private provider: TypefaceFontProvider,
		private bin: Bin,
		private w: PdfWriter,
		private fonts: FontEmbedder,
		private sources: Map<string, Uint8Array>,
		private svgScenes: Map<string, SvgScene>,
		private warnings: PaintWarning[],
	) {
		this.resources = w.reserve();
	}

	rasterized(feature: string, layer?: string) {
		const key = `${feature}\u0000${layer ?? ""}`;
		if (this.reported.has(key)) return;
		this.reported.add(key);
		this.warnings.push({
			kind: "vector_rasterized",
			feature,
			...(layer ? { layer } : {}),
		});
	}

	// The layers to paint as images: each one whose own drawing PDF cannot
	// express, with everything it holds. The others are walked into.
	plan(drawables: DrawCommand[]): DrawCommand[] {
		const out: DrawCommand[] = [];
		const walk = (cmd: DrawCommand, outer?: string) => {
			const layer = cmd.id ?? (cmd.op === "drawImage" ? cmd.src : outer);
			const reason = this.reason(cmd);
			if (reason) {
				this.rasterized(reason, layer);
				out.push(cmd);
				return;
			}
			if (cmd.op === "drawGroup") for (const c of cmd.children) walk(c, layer);
		};
		for (const cmd of drawables) walk(cmd);
		return out;
	}

	// Why `cmd` itself, not its children, has to be drawn as pixels.
	private reason(cmd: DrawCommand): string | null {
		if (cmd.shadow && (!Array.isArray(cmd.shadow) || cmd.shadow.length > 0))
			return "shadow";
		if ((cmd.blur ?? 0) > 0) return "layer blur";
		const a = cmd.adjust;
		if (a && (a.colorMatrix || a.lut || a.lut3d || (a.sharpen ?? 0) > 0))
			return "adjust";
		if (cmd.blendMode && cmd.blendMode !== "normal" && !BLEND[cmd.blendMode])
			return `${cmd.blendMode} blend`;
		switch (cmd.op) {
			case "drawRect":
				return (
					(cmd.fills ?? []).map(fillReason).find(Boolean) ??
					(cmd.stroke
						? strokeReason(
								cmd.stroke,
								rectShape(cmd.cornerRadius, cmd.cornerSmoothing),
							)
						: null)
				);
			case "drawPath":
				return (
					(cmd.fills ?? []).map(fillReason).find(Boolean) ??
					(cmd.stroke
						? strokeReason(cmd.stroke, cmd.strokeD ? null : undefined)
						: null)
				);
			case "drawText":
				if (cmd.arc || cmd.path) return "text on a curve";
				if (cmd.fill && cmd.fill.kind !== "solid") return "gradient text";
				return this.textPlan(cmd).reason ?? null;
			case "drawImage": {
				if (cmd.fit === "tile") return "tiled image";
				const svg = this.svgScenes.get(cmd.src);
				const inner = svg?.features[0]
					? `SVG ${svg.features[0]}`
					: svg?.commands.map((c) => this.deepReason(c)).find(Boolean);
				return (
					inner ??
					(cmd.stroke
						? strokeReason(cmd.stroke, cmd.clip ?? { kind: "rect" })
						: null)
				);
			}
			case "drawMasked":
				return "mask";
			case "drawQr":
				return "drawQr op";
			default:
				return null;
		}
	}

	private deepReason(cmd: DrawCommand): string | null {
		const children = cmd.op === "drawGroup" ? cmd.children : [];
		return (
			this.reason(cmd) ??
			children.map((c) => this.deepReason(c)).find(Boolean) ??
			null
		);
	}

	// The text shaped, each run matched to the font file it embeds.
	private textPlan(cmd: DrawTextCommand): TextPlan {
		const hit = this.texts.get(cmd);
		if (hit) return hit;
		const plan: TextPlan = { lines: [] };
		for (const line of shapeTextLines(this.ck, this.provider, this.bin, cmd)) {
			const text = line.line.spans.map((s) => s.text).join("");
			const runs: TextRun[] = [];
			for (const run of line.runs) {
				if (!run.glyphs.length) continue;
				const span = line.line.spans[line.spanAt[run.offsets[0] ?? 0] ?? 0];
				if (!span) continue;
				if (run.fakeBold) plan.reason ??= "synthetic bold";
				const file = this.fonts.file(
					run,
					{
						weight: span.font.weight,
						italic: span.font.style === "italic",
						variations: span.font.variations,
					},
					text,
				);
				if ("reason" in file) plan.reason ??= file.reason;
				else runs.push({ run, file });
			}
			plan.lines.push({ line, text, runs });
		}
		this.texts.set(cmd, plan);
		return plan;
	}

	// The painted part of a frame, cropped, as an image.
	patch(frame: Frame | null): Patch {
		if (!frame) return null;
		const { data, width, height, scale } = frame;
		let [x0, y0, x1, y1] = [width, height, -1, -1];
		for (let y = 0; y < height; y++)
			for (let x = 0; x < width; x++)
				if (data[(y * width + x) * 4 + 3] !== 0) {
					if (x < x0) x0 = x;
					if (x > x1) x1 = x;
					if (y < y0) y0 = y;
					if (y > y1) y1 = y;
				}
		if (x1 < 0) return null;
		const w = x1 - x0 + 1;
		const h = y1 - y0 + 1;
		const crop = new Uint8Array(w * h * 4);
		for (let y = 0; y < h; y++)
			crop.set(
				data.subarray(
					((y0 + y) * width + x0) * 4,
					((y0 + y) * width + x1 + 1) * 4,
				),
				y * w * 4,
			);
		return {
			ref: this.rgbaImage(crop, w, h, true),
			x: frame.x + x0 / scale,
			y: frame.y + y0 / scale,
			w: w / scale,
			h: h / scale,
		};
	}

	placePatch(p: NonNullable<Patch>): string {
		return `q\n${cm([p.w, 0, 0, -p.h, p.x, p.y + p.h])}/${this.xobject(p.ref)} Do\nQ\n`;
	}

	async save(
		content: string,
		width: number,
		height: number,
		options: PdfPaintOptions,
	) {
		const { w } = this;
		const contents = w.flate({}, content);
		const pages = w.reserve();
		const pageRef = w.add({
			Type: name("Page"),
			Parent: pages,
			MediaBox: [0, 0, width, height],
			Resources: this.resources,
			Contents: contents,
			Group: { S: name("Transparency"), CS: name("DeviceRGB") },
		});
		w.set(pages, { Type: name("Pages"), Kids: [pageRef], Count: 1 });
		const ext: PdfDict = {};
		for (const [key, dict] of Object.entries(this.gsDicts)) ext[key] = dict;
		w.set(this.resources, {
			ExtGState: ext,
			XObject: { ...this.xobjects },
			Shading: { ...this.shadings },
			Font: this.fonts.write(),
		});
		const catalog = w.add({ Type: name("Catalog"), Pages: pages });
		const date = pdfDate(options.date ?? new Date());
		const info = w.add({
			Producer: "Freshcoat",
			CreationDate: date,
			ModDate: date,
			...(options.title !== undefined ? { Title: options.title } : {}),
		});
		await w.settle();
		return w.save(catalog, info);
	}

	dispose() {
		this.fonts.dispose();
	}

	private gs(dict: PdfDict): string {
		const key = keyOf(dict);
		let id = this.extGStates.get(key);
		if (!id) {
			id = `G${this.extGStates.size}`;
			this.extGStates.set(key, id);
			this.gsDicts[id] = dict;
		}
		return `/${id} gs\n`;
	}

	private xobject(ref: PdfRef): string {
		let id = this.xobjectIds.get(ref.id);
		if (!id) {
			id = `X${this.xobjectIds.size}`;
			this.xobjectIds.set(ref.id, id);
			this.xobjects[id] = ref;
		}
		return id;
	}

	// A form XObject, as a transparency group when it is composited as one.
	private form(content: string, group = false): string {
		const ref = this.w.flate(
			{
				Type: name("XObject"),
				Subtype: name("Form"),
				BBox: [-1e5, -1e5, 1e5, 1e5],
				Resources: this.resources,
				...(group
					? {
							Group: {
								S: name("Transparency"),
								I: true,
								CS: name("DeviceRGB"),
							},
						}
					: {}),
			},
			content,
		);
		return this.xobject(ref);
	}

	private alpha(fill: number, stroke = fill): string {
		return fill < 1 || stroke < 1 ? this.gs({ ca: fill, CA: stroke }) : "";
	}

	drawable(cmd: DrawCommand): string {
		if (this.patches.has(cmd)) {
			const p = this.patches.get(cmd);
			if (!p) return "";
			const bm = cmd.blendMode ? BLEND[cmd.blendMode] : undefined;
			return `q\n${bm ? this.gs({ BM: name(bm) }) : ""}${this.placePatch(p)}Q\n`;
		}
		let out = "q\n";
		if (cmd.rotation)
			out += cm(
				rotateAbout(
					cmd.rotation,
					cmd.pos.x + cmd.size.width / 2,
					cmd.pos.y + cmd.size.height / 2,
				),
			);
		let inner = "";
		if (cmd.clip && cmd.op !== "drawImage") inner += this.clip(cmd.clip, cmd);
		inner += this.shape(cmd);
		const opacity = Math.max(0, Math.min(1, cmd.opacity ?? 1));
		const bm = cmd.blendMode ? BLEND[cmd.blendMode] : undefined;
		const isolated = cmd.op === "drawGroup" && cmd.isolate === true;
		if (opacity < 1 || bm || isolated) {
			const fm = this.form(inner, true);
			if (opacity < 1 || bm)
				out += this.gs({
					...(opacity < 1 ? { ca: opacity, CA: opacity } : {}),
					...(bm ? { BM: name(bm) } : {}),
				});
			out += `/${fm} Do\n`;
		} else out += inner;
		return `${out}Q\n`;
	}

	private clip(
		shape: ShapeMask,
		cmd: {
			pos: { x: number; y: number };
			size: { width: number; height: number };
		},
	): string {
		const g = outlineGeometry(
			shape,
			cmd.pos.x,
			cmd.pos.y,
			cmd.size.width,
			cmd.size.height,
		);
		if (!g) return "";
		const { ops, evenOdd } = outlineOps(this.ck, g);
		return `${ops}W${evenOdd ? "*" : ""} n\n`;
	}

	private shape(cmd: DrawCommand): string {
		switch (cmd.op) {
			case "drawRect": {
				const { x, y } = cmd.pos;
				const { width: w, height: h } = cmd.size;
				const shape = rectShape(cmd.cornerRadius, cmd.cornerSmoothing);
				const g = outlineGeometry(shape, x, y, w, h);
				let out = "";
				if (g) {
					const { ops, evenOdd } = outlineOps(this.ck, g);
					for (const fill of cmd.fills ?? [])
						out += this.fill(fill, ops, evenOdd, { x, y, w, h });
				}
				if (cmd.stroke) out += this.outlineStroke(shape, cmd, cmd.stroke);
				return out;
			}
			case "drawPath":
				return this.path(cmd);
			case "drawText":
				return this.text(cmd);
			case "drawImage":
				return this.image(cmd);
			case "drawBitmap":
				return this.bitmap(cmd);
			case "drawGroup":
				return cmd.children.map((c) => this.drawable(c)).join("");
			default:
				return "";
		}
	}

	private fill(
		fill: ResolvedFill,
		ops: string,
		evenOdd: boolean,
		box: Box,
	): string {
		if (!ops) return "";
		const star = evenOdd ? "*" : "";
		if (fill.kind === "solid") {
			const c = rgba(fill.color);
			if (c[3] <= 0) return "";
			return `q\n${this.alpha(c[3])}${rgb(c)} rg\n${ops}f${star}\nQ\n`;
		}
		const sh = this.gradient(fill, box);
		return sh ? `q\n${ops}W${star} n\n${sh}Q\n` : "";
	}

	// Paints a linear or radial gradient over the current clip.
	private gradient(fill: ResolvedFill, box: Box): string {
		if (fill.kind !== "linear" && fill.kind !== "radial") return "";
		const { x, y, w, h } = box;
		let geometry: PdfDict;
		if (fill.kind === "linear") {
			geometry = {
				ShadingType: 2,
				Coords: [
					x + fill.from.x * w,
					y + fill.from.y * h,
					x + fill.to.x * w,
					y + fill.to.y * h,
				],
			};
		} else {
			const rx = fill.radius * Math.max(w, h);
			if (!(rx > 0)) return "";
			const cx = x + fill.center.x * w;
			const cy = y + fill.center.y * h;
			geometry = { ShadingType: 3, Coords: [cx, cy, 0, cx, cy, rx] };
		}
		const color = this.shading(
			geometry,
			fill.stops.map((s) => {
				const c = rgba(s.color);
				return { offset: s.offset, c: [c[0] / 255, c[1] / 255, c[2] / 255] };
			}),
		);
		return `/${color} sh\n`;
	}

	private shading(
		geometry: PdfDict,
		stops: Array<{ offset: number; c: number[] }>,
	): string {
		const sorted = [...stops].sort((a, b) => a.offset - b.offset);
		const first = sorted[0];
		const last = sorted[sorted.length - 1];
		if (!first || !last) return "";
		if (first.offset > 0) sorted.unshift({ offset: 0, c: first.c });
		if (last.offset < 1) sorted.push({ offset: 1, c: last.c });
		const segment = (a: { c: number[] }, b: { c: number[] }): PdfDict => ({
			FunctionType: 2,
			Domain: [0, 1],
			C0: a.c,
			C1: b.c,
			N: 1,
		});
		let fn: PdfDict;
		if (sorted.length <= 2)
			fn = segment(
				sorted[0] as { c: number[] },
				sorted[sorted.length - 1] as { c: number[] },
			);
		else {
			const functions: PdfValue[] = [];
			const bounds: number[] = [];
			const encode: number[] = [];
			for (let i = 0; i + 1 < sorted.length; i++) {
				functions.push(
					segment(
						sorted[i] as { c: number[] },
						sorted[i + 1] as { c: number[] },
					),
				);
				encode.push(0, 1);
				if (i > 0)
					bounds.push(
						Math.min(1, Math.max(0, (sorted[i] as { offset: number }).offset)),
					);
			}
			fn = {
				FunctionType: 3,
				Domain: [0, 1],
				Functions: functions,
				Bounds: bounds,
				Encode: encode,
			};
		}
		const ref = this.w.add({
			...geometry,
			ColorSpace: name("DeviceRGB"),
			Function: fn,
			Extend: [true, true],
		});
		const id = `S${Object.keys(this.shadings).length}`;
		this.shadings[id] = ref;
		return id;
	}

	private strokeParams(stroke: Stroke): string {
		let out = `${num(stroke.width)} w ${CAP[stroke.cap ?? "butt"]} J ${JOIN[stroke.join ?? "miter"]} j ${MITER_LIMIT} M\n`;
		const dash = normalizeDash(stroke.dash);
		if (dash) out += `[${dash.map(num).join(" ")}] 0 d\n`;
		return out;
	}

	// A solid stroke along the outline `ops` builds.
	private stroke(stroke: Stroke, ops: string): string {
		const c = rgba(stroke.color);
		if (!ops || c[3] <= 0 || stroke.width <= 0) return "";
		return `q\n${this.alpha(1, c[3])}${rgb(c)} RG\n${this.strokeParams(stroke)}${ops}S\nQ\n`;
	}

	// The stroke along `shape`, offset for inside or outside alignment.
	private outlineStroke(
		shape: ShapeMask,
		cmd: {
			pos: { x: number; y: number };
			size: { width: number; height: number };
		},
		stroke: Stroke,
	): string {
		const g = outlineGeometry(
			shape,
			cmd.pos.x,
			cmd.pos.y,
			cmd.size.width,
			cmd.size.height,
			strokeInset(stroke),
		);
		return g ? this.stroke(stroke, outlineOps(this.ck, g).ops) : "";
	}

	private path(cmd: Extract<DrawCommand, { op: "drawPath" }>): string {
		const { ck } = this;
		const path = ck.Path.MakeFromSVGString(cmd.d);
		if (!path) return "";
		try {
			const evenOdd = cmd.fillRule === "evenodd";
			if (evenOdd) path.setFillType(ck.FillType.EvenOdd);
			let out = `q\n${cm([1, 0, 0, 1, cmd.pos.x, cmd.pos.y])}`;
			const vb = cmd.viewBox;
			let boxW = cmd.size.width;
			let boxH = cmd.size.height;
			if (vb && vb.width > 0 && vb.height > 0) {
				out += cm([
					cmd.size.width / vb.width,
					0,
					0,
					cmd.size.height / vb.height,
					0,
					0,
				]);
				if (vb.x || vb.y) out += cm([1, 0, 0, 1, -(vb.x ?? 0), -(vb.y ?? 0)]);
				boxW = vb.width;
				boxH = vb.height;
			}
			const box = { x: 0, y: 0, w: boxW, h: boxH };
			const ops = pathOps(ck, path);
			for (const fill of cmd.fills ?? [])
				out += this.fill(fill, ops, evenOdd, box);
			if (cmd.stroke) {
				const outline = cmd.strokeD
					? ck.Path.MakeFromSVGString(cmd.strokeD)
					: null;
				out += this.stroke(cmd.stroke, outline ? pathOps(ck, outline) : ops);
				outline?.delete();
			}
			return `${out}Q\n`;
		} finally {
			path.delete();
		}
	}

	// Each run in its embedded font, one TJ per stretch of glyphs on one
	// baseline in one colour, every glyph placed where CanvasKit put it.
	private text(cmd: DrawTextCommand): string {
		const plan = this.textPlan(cmd);
		const segments: Segment[] = [];
		let decorations = "";
		for (const { line, text, runs } of plan.lines) {
			const spans = line.line.spans;
			for (const { run, file } of runs) {
				const face = this.fonts.embed(file);
				const { info } = face;
				const sx = (run as { scaleX?: number }).scaleX ?? 1;
				const scale = run.size * sx;
				const skew = run.fakeItalic ? 0.25 * run.size : 0;
				let seg: Segment | null = null;
				for (let i = 0; i < run.glyphs.length; i++) {
					const gid = run.glyphs[i] as number;
					const x = line.x + (run.positions[i * 2] as number);
					const y = line.y + (run.positions[i * 2 + 1] as number);
					const start = run.offsets[i] ?? 0;
					if (!face.used.has(gid))
						face.used.set(gid, text.slice(start, run.offsets[i + 1] ?? start));
					const owner = spans[line.spanAt[start] ?? 0] ?? spans[0];
					const c = rgba(owner?.color ?? cmd.color);
					const color = `${this.alpha(c[3])}${rgb(c)} rg\n`;
					if (seg && seg.color === color && Math.abs(seg.y - y) < 1e-3) {
						const shift = seg.advance - ((x - seg.x) * 1000) / scale;
						if (Math.abs(shift) > 0.01) seg.parts.push(num(shift));
					} else {
						seg = {
							color,
							y,
							head: `/${face.id} 1 Tf\n${num(scale)} 0 ${num(skew)} ${num(-run.size)} ${num(x)} ${num(y)} Tm\n`,
							parts: [],
							x,
							advance: 0,
						};
						segments.push(seg);
					}
					seg.parts.push(`<${gid.toString(16).padStart(4, "0")}>`);
					seg.x = x;
					seg.advance = (info.advance(gid) * 1000) / info.unitsPerEm;
				}
			}
			for (const d of line.decorations) {
				const c = rgba(d.color);
				decorations += `q\n${this.alpha(c[3])}${rgb(c)} rg\n${num(d.x0)} ${num(d.top)} ${num(d.x1 - d.x0)} ${num(d.thickness)} re\nf\nQ\n`;
			}
		}
		return (
			segments
				.map(
					(s) => `q\n${s.color}BT\n${s.head}[${s.parts.join("")}] TJ\nET\nQ\n`,
				)
				.join("") + decorations
		);
	}

	private image(cmd: DrawImageCommand): string {
		const { pos, size } = cmd;
		let out = "";
		const img = this.imageEntry(cmd.src);
		if (img) {
			out += "q\n";
			if (cmd.clip) out += this.clip(cmd.clip, cmd);
			const r = fitRect(
				img.width,
				img.height,
				pos.x,
				pos.y,
				size.width,
				size.height,
				cmd.fit === "tile" ? "fill" : cmd.fit,
				cmd,
			);
			const kx = r.dw / r.sw;
			const ky = r.dh / r.sh;
			const x0 = r.dx - r.sx * kx;
			const y0 = r.dy - r.sy * ky;
			const place: Matrix = img.vector
				? [kx, 0, 0, ky, x0, y0]
				: [img.width * kx, 0, 0, -img.height * ky, x0, y0 + img.height * ky];
			out += `${num(r.dx)} ${num(r.dy)} ${num(r.dw)} ${num(r.dh)} re W n\n${cm(place)}/${this.xobject(img.ref)} Do\nQ\n`;
		}
		if (cmd.stroke)
			out += this.outlineStroke(cmd.clip ?? { kind: "rect" }, cmd, cmd.stroke);
		return out;
	}

	private imageEntry(src: string): ImageEntry {
		if (this.images.has(src)) return this.images.get(src) ?? null;
		const entry = this.loadImage(src);
		this.images.set(src, entry);
		return entry;
	}

	private loadImage(src: string): ImageEntry {
		const bytes = this.sources.get(src);
		if (!bytes) return null;
		const svg = this.svgScenes.get(src);
		if (svg) {
			const content = svg.commands.map((c) => this.drawable(c)).join("");
			return {
				ref: this.xobjects[this.form(content)] as PdfRef,
				width: svg.width,
				height: svg.height,
				vector: true,
			};
		}
		if (isSvg(bytes)) return null;
		const jpeg = jpegFrame(bytes);
		const info = jpeg ? parseImageInfo(bytes) : null;
		if (
			jpeg &&
			(jpeg.components === 1 || jpeg.components === 3) &&
			(info?.orientation ?? 1) === 1
		)
			return {
				ref: this.w.stream(
					{
						Type: name("XObject"),
						Subtype: name("Image"),
						Width: jpeg.width,
						Height: jpeg.height,
						ColorSpace: name(
							jpeg.components === 1 ? "DeviceGray" : "DeviceRGB",
						),
						BitsPerComponent: 8,
						Filter: name("DCTDecode"),
					},
					bytes,
				),
				width: jpeg.width,
				height: jpeg.height,
			};
		const { ck } = this;
		const img = ck.MakeImageFromEncoded(bytes);
		if (!img) {
			this.warnings.push({
				kind: "image_load_failed",
				src,
				error: "decode failed",
			});
			return null;
		}
		try {
			const width = img.width();
			const height = img.height();
			const pixels = img.readPixels(0, 0, {
				width,
				height,
				colorType: ck.ColorType.RGBA_8888,
				alphaType: ck.AlphaType.Unpremul,
				colorSpace: ck.ColorSpace.SRGB,
			}) as Uint8Array | null;
			if (!pixels) {
				this.warnings.push({
					kind: "image_load_failed",
					src,
					error: "decode failed",
				});
				return null;
			}
			return {
				ref: this.rgbaImage(pixels, width, height, true),
				width,
				height,
			};
		} finally {
			img.delete();
		}
	}

	private rgbaImage(
		pixels: Uint8Array,
		width: number,
		height: number,
		interpolate: boolean,
	): PdfRef {
		const n = width * height;
		const color = new Uint8Array(n * 3);
		const alpha = new Uint8Array(n);
		let opaque = true;
		for (let i = 0; i < n; i++) {
			color[i * 3] = pixels[i * 4] as number;
			color[i * 3 + 1] = pixels[i * 4 + 1] as number;
			color[i * 3 + 2] = pixels[i * 4 + 2] as number;
			const a = pixels[i * 4 + 3] as number;
			alpha[i] = a;
			if (a !== 255) opaque = false;
		}
		const base = {
			Type: name("XObject"),
			Subtype: name("Image"),
			Width: width,
			Height: height,
			BitsPerComponent: 8,
			...(interpolate ? {} : { Interpolate: false }),
		};
		const smask = opaque
			? undefined
			: this.w.flate({ ...base, ColorSpace: name("DeviceGray") }, alpha);
		return this.w.flate(
			{ ...base, ColorSpace: name("DeviceRGB"), SMask: smask },
			color,
		);
	}

	// Drawn without smoothing, so a code's modules stay sharp at any size.
	private bitmap(cmd: Extract<DrawCommand, { op: "drawBitmap" }>): string {
		const { pixels, pixelWidth: pw, pixelHeight: ph, pos, size } = cmd;
		if (pw <= 0 || ph <= 0) return "";
		const ref = this.rgbaImage(pixels, pw, ph, false);
		return `q\n${cm([size.width, 0, 0, -size.height, pos.x, pos.y + size.height])}/${this.xobject(ref)} Do\nQ\n`;
	}
}

// Fills drawn as vectors: solid, linear, and radial gradients that are
// circles about their centre, all with opaque stops.
function fillReason(fill: ResolvedFill): string | null {
	if (fill.kind === "solid") return null;
	if (fill.kind === "pattern") return "pattern fill";
	if (fill.kind === "angular") return "angular gradient";
	if (fill.spread && fill.spread !== "pad")
		return `${fill.spread} gradient spread`;
	if (fill.stops.some((s) => rgba(s.color)[3] < 1))
		return "transparent gradient stop";
	if (
		fill.kind === "radial" &&
		((fill.radiusY !== undefined && fill.radiusY !== fill.radius) ||
			(fill.rotation ?? 0) % 180 !== 0 ||
			fill.focus ||
			(fill.focusRadius ?? 0) > 0)
	)
		return "elliptical or focal radial gradient";
	return null;
}

// Strokes drawn as vectors: a solid colour along the outline, or along its
// offset when the stroke is aligned. `shape` is the outline an aligned stroke
// offsets, null when the command carries its own, undefined when it has none.
function strokeReason(
	stroke: Stroke,
	shape: ShapeMask | null | undefined,
): string | null {
	if (stroke.gradient) return "gradient stroke";
	if (strokeTrim(stroke)) return "stroke trim";
	if (strokeInset(stroke) === 0 || shape === null) return null;
	if (!shape || !outlineGeometry(shape, 0, 0, 100, 100, strokeInset(stroke)))
		return "aligned stroke";
	return null;
}

function hasBackdrop(cmd: DrawCommand): boolean {
	if ((cmd.backdropBlur ?? 0) > 0) return true;
	if (cmd.op === "drawGroup") return cmd.children.some(hasBackdrop);
	if (cmd.op === "drawMasked")
		return hasBackdrop(cmd.mask) || cmd.children.some(hasBackdrop);
	return false;
}

async function svgScene(bytes: Uint8Array): Promise<SvgScene> {
	const svg = await import("../svg/index");
	const drawing = svg.parseSvg(new TextDecoder().decode(bytes));
	const features = drawing.warnings.map((w) => w.feature);
	const walk = (items: typeof drawing.children) => {
		for (const item of items) {
			if (item.kind === "text" && !features.includes("text"))
				features.push("text");
			if (item.kind !== "group") continue;
			if (item.filter && !features.includes("filter")) features.push("filter");
			walk(item.children);
			if (item.mask) walk(item.mask);
		}
	};
	walk(drawing.children);
	const { width, height } = drawing;
	const commands = compileScene(svg.svgToNode(drawing), {
		width,
		height,
	}).filter(isDrawable);
	return { commands, width, height, features };
}

function imageSrcs(cmd: DrawCommand): string[] {
	if (cmd.op === "drawImage") return [cmd.src];
	if (cmd.op === "drawGroup") return cmd.children.flatMap(imageSrcs);
	if (cmd.op === "drawMasked")
		return [...imageSrcs(cmd.mask), ...cmd.children.flatMap(imageSrcs)];
	return [];
}

// The size and component count of a baseline or progressive JPEG.
function jpegFrame(
	b: Uint8Array,
): { width: number; height: number; components: number } | null {
	if (b[0] !== 0xff || b[1] !== 0xd8) return null;
	let i = 2;
	while (i + 9 < b.length) {
		if (b[i] !== 0xff) return null;
		const marker = b[i + 1] as number;
		if (
			marker === 0xd8 ||
			(marker >= 0xd0 && marker <= 0xd7) ||
			marker === 0x01
		) {
			i += 2;
			continue;
		}
		const length = ((b[i + 2] as number) << 8) | (b[i + 3] as number);
		if (
			marker >= 0xc0 &&
			marker <= 0xcf &&
			marker !== 0xc4 &&
			marker !== 0xc8 &&
			marker !== 0xcc
		) {
			if (marker !== 0xc0 && marker !== 0xc1 && marker !== 0xc2) return null;
			return {
				height: ((b[i + 5] as number) << 8) | (b[i + 6] as number),
				width: ((b[i + 7] as number) << 8) | (b[i + 8] as number),
				components: b[i + 9] as number,
			};
		}
		i += 2 + length;
	}
	return null;
}

function keyOf(v: PdfValue | undefined): string {
	if (v instanceof PdfRef) return `#${v.id}`;
	if (v instanceof PdfName) return `/${v.name}`;
	if (Array.isArray(v)) return `[${v.map(keyOf).join(",")}]`;
	if (v && typeof v === "object")
		return `{${Object.entries(v)
			.map(([k, e]) => `${k}:${keyOf(e)}`)
			.join(",")}}`;
	return JSON.stringify(v ?? null);
}

function pdfDate(d: Date): string {
	const p = (n: number) => String(n).padStart(2, "0");
	return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}
