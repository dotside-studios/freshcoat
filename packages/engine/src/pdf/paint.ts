// A Painter for print: lowers a compiled scene to one PDF page of vector
// operators instead of pixels. Shapes, gradients, strokes, clips, masks, blend
// modes and images map onto PDF's own model and text becomes glyph outlines.
// What PDF has no operator for (shadows, blurs, adjustments, angular and
// pattern fills) is left out and reported as `vector_unsupported`, so a caller
// can render that scene as pixels instead.

import type { CanvasKit, Path, TypefaceFontProvider } from "canvaskit-wasm";
import {
	type Bin,
	collectAssets,
	focalPoint,
	makeBin,
	shapeTextLines,
} from "../canvaskit";
import { parseColor } from "../color";
import { compileScene } from "../compile-scene";
import { normalizeDash } from "../dash";
import { fontBytes } from "../font-bytes";
import { createSharedFontProvider } from "../font-collection";
import { parseImageInfo } from "../image-info";
import { dataUrlToBytes } from "../loader";
import { boxPath, outlineGeometry, rectShape } from "../outline";
import { fitRect, strokeInset } from "../paint-helpers";
import type { PaintTarget } from "../runtime-types";
import { isSvg } from "../svg/sniff";
import { strokeTrim, trimPath } from "../trim";
import type {
	BlendMode,
	Command,
	DrawCommand,
	DrawImageCommand,
	DrawMaskedCommand,
	DrawTextCommand,
	GradientFill,
	PaintWarning,
	ResolvedFill,
	ShapeMask,
	Stroke,
} from "../types";
import { type Face, FaceIndex, glyphOps, loadFontkit } from "./fonts";
import {
	cm,
	type Matrix,
	multiply,
	outlineOps,
	pathOps,
	rotateAbout,
	scaleAbout,
} from "./geometry";
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

const MAX_SVG_NESTING = 4;

function rgba(color: string): Rgba {
	const c = parseColor(color);
	return c && c !== "none" ? c : [0, 0, 0, 1];
}

const rgb = (c: Rgba) =>
	`${num(c[0] / 255)} ${num(c[1] / 255)} ${num(c[2] / 255)}`;

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
	const allCommands = [
		...commands,
		...[...svgScenes.values()].flatMap((s) => s.commands),
	];

	const needsText = allCommands.some(function hasText(c: Command): boolean {
		if (c.op === "drawText") return true;
		if (c.op === "drawGroup") return c.children.some(hasText);
		if (c.op === "drawMasked")
			return hasText(c.mask) || c.children.some(hasText);
		return false;
	});
	const faces = needsText ? new FaceIndex(await loadFontkit(), byFamily) : null;
	const shared = createSharedFontProvider(ck, loaded);
	(shared.provider as { __families?: string[] }).__families = [
		...new Set(loaded.map((f) => f.family)),
	];
	const bin = makeBin();
	const page = new PageBuilder(
		ck,
		shared.provider,
		bin,
		faces,
		sources,
		svgScenes,
		warnings,
	);
	try {
		const scale = 72 / dpi;
		let content = `q\n${cm([scale, 0, 0, -scale, 0, create.height * scale])}`;
		for (const cmd of commands) {
			if (cmd.op === "finishFrame") page.unsupported("frame finish");
			else if (
				cmd.op !== "createCanvas" &&
				cmd.op !== "loadFonts" &&
				cmd.op !== "loadImages"
			)
				content += page.drawable(cmd);
		}
		content += "Q\n";
		const bytes = await page.save(
			content,
			create.width * scale,
			create.height * scale,
			options,
		);
		return {
			bytes,
			warnings,
			width: create.width * scale,
			height: create.height * scale,
		};
	} finally {
		bin.free();
		shared.release();
	}
}

class PageBuilder {
	private w = new PdfWriter();
	private resources = this.w.reserve();
	private extGStates = new Map<string, string>();
	private gsDicts: Record<string, PdfDict> = {};
	private xobjects: Record<string, PdfRef> = {};
	private xobjectIds = new Map<number, string>();
	private shadings: Record<string, PdfRef> = {};
	private glyphs = new Map<string, string | null>();
	private images = new Map<string, ImageEntry>();
	private reported = new Set<string>();
	private layer?: string;

	constructor(
		private ck: CanvasKit,
		private provider: TypefaceFontProvider,
		private bin: Bin,
		private faces: FaceIndex | null,
		private sources: Map<string, Uint8Array>,
		private svgScenes: Map<string, SvgScene>,
		private warnings: PaintWarning[],
	) {}

	unsupported(feature: string) {
		const key = `${feature}\u0000${this.layer ?? ""}`;
		if (this.reported.has(key)) return;
		this.reported.add(key);
		this.warnings.push({
			kind: "vector_unsupported",
			feature,
			...(this.layer ? { layer: this.layer } : {}),
		});
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
		const outer = this.layer;
		this.layer = cmd.id ?? (cmd.op === "drawImage" ? cmd.src : outer);
		try {
			return this.paintDrawable(cmd);
		} finally {
			this.layer = outer;
		}
	}

	private paintDrawable(cmd: DrawCommand): string {
		if (cmd.shadow && (!Array.isArray(cmd.shadow) || cmd.shadow.length > 0))
			this.unsupported("shadow");
		if ((cmd.blur ?? 0) > 0) this.unsupported("layer blur");
		if ((cmd.backdropBlur ?? 0) > 0) this.unsupported("backdrop blur");
		const a = cmd.adjust;
		if (a && (a.colorMatrix || a.lut || a.lut3d || (a.sharpen ?? 0) > 0))
			this.unsupported("adjust");
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
		const mode =
			cmd.blendMode && cmd.blendMode !== "normal" ? cmd.blendMode : null;
		const bm = mode ? BLEND[mode] : undefined;
		if (mode && !bm) this.unsupported(`${mode} blend`);
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
			case "drawMasked":
				return this.masked(cmd);
			default:
				this.unsupported(`${(cmd as { op: string }).op} op`);
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

	// Paints the gradient over the current clip.
	private gradient(fill: ResolvedFill, box: Box): string {
		if (fill.kind === "pattern") {
			this.unsupported("pattern fill");
			return "";
		}
		if (fill.kind === "angular") {
			this.unsupported("angular gradient");
			return "";
		}
		if (fill.kind === "solid") return "";
		if (fill.spread && fill.spread !== "pad")
			this.unsupported(`${fill.spread} gradient spread`);
		const { x, y, w, h } = box;
		let matrix: Matrix | null = null;
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
			const cx = x + fill.center.x * w;
			const cy = y + fill.center.y * h;
			const longest = Math.max(w, h);
			const rx = fill.radius * longest;
			const ry = (fill.radiusY ?? fill.radius) * longest;
			if (!(rx > 0 && ry > 0)) return "";
			const rotation = fill.rotation ?? 0;
			if (!(ry === rx && rotation % 180 === 0))
				matrix = multiply(
					scaleAbout(1, ry / rx, cx, cy),
					rotateAbout(rotation, cx, cy),
				);
			const focus = focalPoint(fill, cx, cy, w, h, rx, ry, rotation);
			const fr = (fill.focusRadius ?? 0) * longest;
			geometry = {
				ShadingType: 3,
				Coords: focus
					? [focus[0], focus[1], fr, cx, cy, rx]
					: [cx, cy, 0, cx, cy, rx],
			};
		}
		const stops = fill.stops.map((s) => ({
			offset: s.offset,
			color: rgba(s.color),
		}));
		const color = this.shading(
			geometry,
			"DeviceRGB",
			stops.map((s) => ({
				offset: s.offset,
				c: [s.color[0] / 255, s.color[1] / 255, s.color[2] / 255],
			})),
		);
		let out = matrix ? cm(matrix) : "";
		if (stops.some((s) => s.color[3] < 1)) {
			const mask = this.shading(
				geometry,
				"DeviceGray",
				stops.map((s) => ({ offset: s.offset, c: [s.color[3]] })),
			);
			const g = this.form(`/${mask} sh\n`, true);
			out += this.gs({
				SMask: {
					Type: name("Mask"),
					S: name("Luminosity"),
					G: this.xobjects[g] as PdfRef,
				},
			});
		}
		return `${out}/${color} sh\n`;
	}

	private shading(
		geometry: PdfDict,
		space: string,
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
			ColorSpace: name(space),
			Function: fn,
			Extend: [true, true],
		});
		const id = `S${Object.keys(this.shadings).length}`;
		this.shadings[id] = ref;
		return id;
	}

	private strokeParams(stroke: Stroke, width: number): string {
		let out = `${num(width)} w ${CAP[stroke.cap ?? "butt"]} J ${JOIN[stroke.join ?? "miter"]} j ${MITER_LIMIT} M\n`;
		const dash = normalizeDash(stroke.dash);
		if (dash) out += `[${dash.map(num).join(" ")}] 0 d\n`;
		return out;
	}

	// `stroke` along `path` at `width`, trimmed.
	private strokePath(
		path: Path,
		stroke: Stroke,
		width: number,
		box: Box,
	): string {
		const { ck } = this;
		const trim = strokeTrim(stroke);
		let owned: Path | null = null;
		if (trim) {
			const copy = path.copy();
			owned = trimPath(ck, copy, trim);
			if (owned !== copy) copy.delete();
			if (!owned) return "";
			path = owned;
		}
		try {
			if (!stroke.gradient) {
				const c = rgba(stroke.color);
				if (c[3] <= 0 || width <= 0) return "";
				return `q\n${this.alpha(1, c[3])}${rgb(c)} RG\n${this.strokeParams(stroke, width)}${pathOps(ck, path)}S\nQ\n`;
			}
			if (normalizeDash(stroke.dash))
				this.unsupported("dashed gradient stroke");
			const base = path.copy();
			const outline = base.makeStroked({
				width,
				cap: ck.StrokeCap[
					({ butt: "Butt", round: "Round", square: "Square" } as const)[
						stroke.cap ?? "butt"
					]
				],
				join: ck.StrokeJoin[
					({ miter: "Miter", round: "Round", bevel: "Bevel" } as const)[
						stroke.join ?? "miter"
					]
				],
				miter_limit: MITER_LIMIT,
			});
			if (outline !== base) base.delete();
			if (!outline) return "";
			try {
				const sh = this.gradient(stroke.gradient as GradientFill, box);
				return sh ? `q\n${pathOps(ck, outline)}W n\n${sh}Q\n` : "";
			} finally {
				outline.delete();
			}
		} finally {
			owned?.delete();
		}
	}

	// An inside or outside stroke along an outline that has no offset of its
	// own: twice the width, cut to the inside or the outside of `path`.
	private clippedStroke(path: Path, stroke: Stroke, box: Box): string {
		const ops = pathOps(this.ck, path);
		const evenOdd = path.getFillType() === this.ck.FillType.EvenOdd;
		const cut =
			stroke.align === "inside"
				? `${ops}W${evenOdd ? "*" : ""} n\n`
				: `-1e5 -1e5 2e5 2e5 re\n${ops}W* n\n`;
		return `q\n${cut}${this.strokePath(path, stroke, stroke.width * 2, box)}Q\n`;
	}

	private outlineStroke(
		shape: ShapeMask,
		cmd: {
			pos: { x: number; y: number };
			size: { width: number; height: number };
		},
		stroke: Stroke,
	): string {
		const { ck } = this;
		const { x, y } = cmd.pos;
		const { width: w, height: h } = cmd.size;
		const box = { x, y, w, h };
		const fromTop = strokeTrim(stroke) !== null;
		const g = outlineGeometry(shape, x, y, w, h, strokeInset(stroke), fromTop);
		const whole = g ?? outlineGeometry(shape, x, y, w, h, 0, fromTop);
		if (!whole) return "";
		const path =
			whole.kind === "path"
				? ck.Path.MakeFromSVGString(whole.d)
				: boxPath(
						ck,
						whole.ltrb,
						whole.kind === "rrect" ? whole.radii : undefined,
					);
		if (!path) return "";
		try {
			return g
				? this.strokePath(path, stroke, stroke.width, box)
				: this.clippedStroke(path, stroke, box);
		} finally {
			path.delete();
		}
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
				try {
					out +=
						!outline && strokeInset(cmd.stroke) !== 0
							? this.clippedStroke(path, cmd.stroke, box)
							: this.strokePath(
									outline ?? path,
									cmd.stroke,
									cmd.stroke.width,
									box,
								);
				} finally {
					outline?.delete();
				}
			}
			return `${out}Q\n`;
		} finally {
			path.delete();
		}
	}

	private text(cmd: DrawTextCommand): string {
		if (cmd.arc || cmd.path) {
			this.unsupported("text on a curve");
			return "";
		}
		if (!this.faces) return "";
		const lines = shapeTextLines(this.ck, this.provider, this.bin, cmd);
		const gradient = cmd.fill && cmd.fill.kind !== "solid" ? cmd.fill : null;
		let out = "";
		let clip = "";
		for (const line of lines) {
			const source = line.line;
			const text = source.spans.map((s) => s.text).join("");
			for (const run of line.runs) {
				const glyphs = run.glyphs;
				if (!glyphs.length) continue;
				const span = source.spans[line.spanAt[run.offsets[0] ?? 0] ?? 0];
				if (!span) continue;
				if (run.fakeBold) this.unsupported("synthetic bold");
				const face = this.face(run, span.font, text);
				if (!face) {
					this.unsupported(`glyphs of ${span.font.family}`);
					continue;
				}
				const s = run.size / face.unitsPerEm;
				const sx = (run as { scaleX?: number }).scaleX ?? 1;
				const skew = run.fakeItalic ? 0.25 * s : 0;
				let color = "";
				for (let i = 0; i < glyphs.length; i++) {
					const gid = glyphs[i] as number;
					const px = line.x + (run.positions[i * 2] as number);
					const py = line.y + (run.positions[i * 2 + 1] as number);
					const m: Matrix = [s * sx, 0, skew, -s, px, py];
					if (gradient) {
						const o = face.outline(gid);
						if (o) clip += glyphOps(o.commands, m);
						continue;
					}
					const id = this.glyph(face, gid);
					if (!id) continue;
					const owner =
						source.spans[line.spanAt[run.offsets[i] ?? 0] ?? 0] ?? span;
					const c = rgba(owner.color ?? cmd.color);
					const next = `${this.alpha(c[3])}${rgb(c)} rg\n`;
					if (next !== color) {
						if (color) out += "Q\n";
						out += `q\n${next}`;
						color = next;
					}
					out += `q\n${cm(m)}/${id} Do\nQ\n`;
				}
				if (color) out += "Q\n";
			}
			for (const d of line.decorations) {
				const rect = `${num(d.x0)} ${num(d.top)} ${num(d.x1 - d.x0)} ${num(d.thickness)} re\n`;
				if (gradient) clip += rect;
				else {
					const c = rgba(d.color);
					out += `q\n${this.alpha(c[3])}${rgb(c)} rg\n${rect}f\nQ\n`;
				}
			}
		}
		if (gradient && clip) {
			const sh = this.gradient(gradient, {
				x: cmd.pos.x,
				y: cmd.pos.y,
				w: cmd.size.width,
				h: cmd.size.height,
			});
			if (sh) out += `q\n${clip}W n\n${sh}Q\n`;
		}
		return out;
	}

	// The face CanvasKit shaped `run` with: the family's closest face whose
	// character map agrees with the run's typeface.
	private face(
		run: {
			typeface: {
				getFamilyName(): string;
				getGlyphIDs(s: string): Uint16Array;
			} | null;
			glyphs: Uint16Array;
			offsets: Uint32Array;
		},
		font: DrawTextCommand["layout"]["font"],
		text: string,
	): Face | null {
		const family = run.typeface?.getFamilyName() || font.family;
		const candidates = (this.faces as FaceIndex).candidates({
			family,
			weight: font.weight,
			italic: font.style === "italic",
			variations: font.variations,
		});
		const probes: number[] = [];
		for (let i = 0; i < run.glyphs.length && probes.length < 4; i++) {
			const cp = text.codePointAt(run.offsets[i] ?? 0);
			if (cp === undefined || cp <= 0x20) continue;
			const id = run.typeface?.getGlyphIDs(String.fromCodePoint(cp))[0];
			if (id !== undefined && id === run.glyphs[i]) probes.push(cp, id);
		}
		return (
			candidates.find((face) => {
				for (let i = 0; i < probes.length; i += 2)
					if (face.glyphId(probes[i] as number) !== probes[i + 1]) return false;
				return true;
			}) ?? null
		);
	}

	private glyph(face: Face, gid: number): string | null {
		const key = `${face.key}/${gid}`;
		if (this.glyphs.has(key)) return this.glyphs.get(key) ?? null;
		const o = face.outline(gid);
		let id: string | null = null;
		if (o) {
			const ref = this.w.flate(
				{
					Type: name("XObject"),
					Subtype: name("Form"),
					BBox: o.bbox,
				},
				`${glyphOps(o.commands)}f\n`,
			);
			id = this.xobject(ref);
		}
		this.glyphs.set(key, id);
		return id;
	}

	private image(cmd: DrawImageCommand): string {
		const { pos, size } = cmd;
		let out = "";
		const img = this.imageEntry(cmd.src);
		if (img) {
			out += "q\n";
			if (cmd.clip) out += this.clip(cmd.clip, cmd);
			if (cmd.fit === "tile") this.unsupported("tiled image");
			else {
				const r = fitRect(
					img.width,
					img.height,
					pos.x,
					pos.y,
					size.width,
					size.height,
					cmd.fit,
					cmd,
				);
				const kx = r.dw / r.sw;
				const ky = r.dh / r.sh;
				const x0 = r.dx - r.sx * kx;
				const y0 = r.dy - r.sy * ky;
				const place: Matrix = img.vector
					? [kx, 0, 0, ky, x0, y0]
					: [img.width * kx, 0, 0, -img.height * ky, x0, y0 + img.height * ky];
				out += `${num(r.dx)} ${num(r.dy)} ${num(r.dw)} ${num(r.dh)} re W n\n${cm(place)}/${this.xobject(img.ref)} Do\n`;
			}
			out += "Q\n";
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
			for (const feature of svg.features) this.unsupported(`SVG ${feature}`);
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

	// A bitmap of a few flat colours, as a code is, becomes rectangles so its
	// modules stay sharp at any size; anything else is an image drawn without
	// smoothing.
	private bitmap(cmd: Extract<DrawCommand, { op: "drawBitmap" }>): string {
		const { pixels, pixelWidth: pw, pixelHeight: ph, pos, size } = cmd;
		if (pw <= 0 || ph <= 0) return "";
		const kx = size.width / pw;
		const ky = size.height / ph;
		const runs = new Map<number, string[]>();
		let flat = true;
		for (let y = 0; y < ph && flat; y++) {
			let x = 0;
			while (x < pw) {
				const i = (y * pw + x) * 4;
				const a = pixels[i + 3] as number;
				if (a !== 0 && a !== 255) {
					flat = false;
					break;
				}
				const key =
					((pixels[i] as number) << 16) |
					((pixels[i + 1] as number) << 8) |
					(pixels[i + 2] as number);
				let end = x + 1;
				while (end < pw) {
					const j = (y * pw + end) * 4;
					if (
						pixels[j + 3] !== a ||
						(a !== 0 &&
							(pixels[j] !== pixels[i] ||
								pixels[j + 1] !== pixels[i + 1] ||
								pixels[j + 2] !== pixels[i + 2]))
					)
						break;
					end++;
				}
				if (a === 255) {
					let list = runs.get(key);
					if (!list) {
						if (runs.size >= 4) {
							flat = false;
							break;
						}
						list = [];
						runs.set(key, list);
					}
					list.push(
						`${num(pos.x + x * kx)} ${num(pos.y + y * ky)} ${num((end - x) * kx)} ${num(ky)} re`,
					);
				}
				x = end;
			}
		}
		if (flat) {
			let out = "";
			for (const [key, rects] of runs)
				out += `${num(((key >> 16) & 255) / 255)} ${num(((key >> 8) & 255) / 255)} ${num((key & 255) / 255)} rg\n${rects.join("\n")}\nf\n`;
			return out;
		}
		const ref = this.rgbaImage(pixels, pw, ph, false);
		return `q\n${cm([size.width, 0, 0, -size.height, pos.x, pos.y + size.height])}/${this.xobject(ref)} Do\nQ\n`;
	}

	private masked(cmd: DrawMaskedCommand): string {
		const content = this.form(
			cmd.children.map((c) => this.drawable(c)).join(""),
			true,
		);
		const mask = this.form(this.drawable(cmd.mask), true);
		const luminance = cmd.channel === "luminance";
		return `q\n${this.gs({
			SMask: {
				Type: name("Mask"),
				S: name(luminance ? "Luminosity" : "Alpha"),
				G: this.xobjects[mask] as PdfRef,
				...(luminance ? { BC: [0, 0, 0] } : {}),
				...(cmd.invert
					? { TR: { FunctionType: 2, Domain: [0, 1], C0: [1], C1: [0], N: 1 } }
					: {}),
			},
		})}/${content} Do\nQ\n`;
	}
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
	}).filter((c): c is DrawCommand => c.op.startsWith("draw"));
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
