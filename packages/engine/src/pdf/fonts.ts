/// <reference path="./fontkit.d.ts" />

// Glyph outlines for the faces a scene's text shapes with, read with fontkit:
// CanvasKit shapes the text and reports glyph ids, but has no way to hand back
// a glyph's outline.

import type { FontVariations } from "../types";
import { num } from "./writer";

type FkGlyph = {
	path: {
		commands: PathCommand[];
		bbox: { minX: number; minY: number; maxX: number; maxY: number };
	};
};
type FkPoint = { x: number; y: number; onCurve: boolean; endContour: boolean };
type FkAxis = {
	axisTag: string;
	minValue: number;
	defaultValue: number;
	maxValue: number;
};
type FkFont = {
	unitsPerEm: number;
	numGlyphs: number;
	familyName: string;
	"OS/2"?: { usWeightClass: number; fsSelection: { italic: boolean } };
	italicAngle: number;
	fvar?: { axis: FkAxis[] };
	directory: { tables: Record<string, { transformed?: boolean } | undefined> };
	variationCoords: number[] | null;
	_variationProcessor: {
		transformPoints(id: number, points: FkPoint[]): void;
	} | null;
	_transformGlyfTable?(): void;
	_transformedGlyphs?: Array<TransformedGlyph | undefined>;
	getGlyph(id: number): FkGlyph;
	glyphForCodePoint(cp: number): { id: number };
};
type TransformedGlyph = {
	numberOfContours: number;
	points?: FkPoint[];
	components?: Array<{ dx: number; dy: number }>;
};
type Fontkit = { create(bytes: Uint8Array): unknown };

let fontkit: Promise<Fontkit> | null = null;
export function loadFontkit(): Promise<Fontkit> {
	fontkit ??= import("fontkit") as Promise<Fontkit>;
	return fontkit;
}

export type PathCommand = { command: string; args: number[] };

export type GlyphOutline = {
	// In font units, y up.
	commands: PathCommand[];
	bbox: [number, number, number, number];
};

export type Face = {
	key: string;
	unitsPerEm: number;
	glyphId(codePoint: number): number;
	outline(id: number): GlyphOutline | null;
};

type Parsed = {
	font: FkFont;
	weight: [number, number];
	italic: boolean;
	axes: FkAxis[];
};

export type FaceRequest = {
	family: string;
	weight: number;
	italic: boolean;
	variations?: FontVariations;
};

export class FaceIndex {
	private parsed = new Map<Uint8Array, Parsed | null>();
	private faces = new Map<string, Face>();
	private ids = new Map<Uint8Array, number>();

	constructor(
		private fk: Fontkit,
		private byFamily: Map<string, Uint8Array[]>,
	) {}

	// The faces whose name table, or registered family, names `family`,
	// closest to the request first as CSS font matching ranks them: style,
	// then weight. CanvasKit reports a face by the name in its file, which
	// need not be the family it was registered under.
	candidates(req: FaceRequest): Face[] {
		const ranked: Array<{ bytes: Uint8Array; p: Parsed; score: number }> = [];
		for (const [registered, list] of this.byFamily) {
			for (const bytes of list) {
				const p = this.parse(bytes);
				if (
					!p ||
					(registered !== req.family && p.font.familyName !== req.family)
				)
					continue;
				const [lo, hi] = p.weight;
				const distance =
					req.weight < lo
						? lo - req.weight
						: req.weight > hi
							? req.weight - hi
							: 0;
				ranked.push({
					bytes,
					p,
					score: (p.italic === req.italic ? 0 : 10000) + distance,
				});
			}
		}
		ranked.sort((a, b) => a.score - b.score);
		return ranked.map(({ bytes, p }) => this.face(bytes, p, req));
	}

	private parse(bytes: Uint8Array): Parsed | null {
		if (this.parsed.has(bytes)) return this.parsed.get(bytes) ?? null;
		let out: Parsed | null = null;
		try {
			const font = this.fk.create(bytes) as FkFont;
			const axes = font.fvar?.axis ?? [];
			const wght = axes.find((a) => a.axisTag.trim() === "wght");
			const os2 = font["OS/2"];
			out = {
				font,
				weight: wght
					? [wght.minValue, wght.maxValue]
					: [os2?.usWeightClass ?? 400, os2?.usWeightClass ?? 400],
				italic: !!os2?.fsSelection.italic || font.italicAngle !== 0,
				axes,
			};
		} catch {
			out = null;
		}
		this.parsed.set(bytes, out);
		return out;
	}

	private face(bytes: Uint8Array, p: Parsed, req: FaceRequest): Face {
		const settings: Record<string, number> = {
			wght: req.weight,
			...req.variations,
		};
		const coords = p.axes.map((a) => {
			const v = settings[a.axisTag.trim()];
			return v === undefined
				? a.defaultValue
				: Math.min(a.maxValue, Math.max(a.minValue, v));
		});
		const varied = coords.some((c, i) => c !== p.axes[i]?.defaultValue);
		let id = this.ids.get(bytes);
		if (id === undefined) {
			id = this.ids.size;
			this.ids.set(bytes, id);
		}
		const key = varied ? `${id}:${coords.join(",")}` : `${id}`;
		const hit = this.faces.get(key);
		if (hit) return hit;
		const font = varied ? this.instance(bytes, coords) : p.font;
		const outlines = new Map<number, GlyphOutline | null>();
		const face: Face = {
			key,
			unitsPerEm: font.unitsPerEm,
			glyphId: (cp) => font.glyphForCodePoint(cp).id,
			outline: (gid) => {
				if (outlines.has(gid)) return outlines.get(gid) ?? null;
				let o: GlyphOutline | null = null;
				if (gid >= 0 && gid < font.numGlyphs) {
					const { commands, bbox } = font.getGlyph(gid).path;
					o = commands.length
						? { commands, bbox: [bbox.minX, bbox.minY, bbox.maxX, bbox.maxY] }
						: null;
				}
				outlines.set(gid, o);
				return o;
			},
		};
		this.faces.set(key, face);
		return face;
	}

	// A fresh parse at these axis coordinates. fontkit's own getVariation
	// cannot read a WOFF2 font, and its WOFF2 glyphs skip variation deltas, so
	// a WOFF2 instance has the deltas applied to its decoded glyphs here.
	private instance(bytes: Uint8Array, coords: number[]): FkFont {
		const font = this.fk.create(bytes) as FkFont;
		if (!font.directory.tables.glyf?.transformed || !font._transformGlyfTable) {
			font.variationCoords = coords;
			return font;
		}
		font._transformGlyfTable();
		const deltas = this.fk.create(bytes) as FkFont;
		deltas.variationCoords = coords;
		const processor = deltas._variationProcessor;
		const base = font._transformedGlyphs ?? [];
		const Point = base.find((g) => g?.points?.length)?.points?.[0]
			?.constructor as
			| (new (
					onCurve: boolean,
					endContour: boolean,
					x: number,
					y: number,
			  ) => FkPoint)
			| undefined;
		if (!processor || !Point) return font;
		const phantom = () => [0, 1, 2, 3].map(() => new Point(false, true, 0, 0));
		const varied: Array<TransformedGlyph | undefined> = [];
		font._transformedGlyphs = new Proxy(base, {
			get(target, key) {
				const gid = typeof key === "string" ? Number(key) : Number.NaN;
				if (!Number.isInteger(gid)) return Reflect.get(target, key);
				if (varied[gid]) return varied[gid];
				const g = target[gid];
				if (!g) return g;
				const out: TransformedGlyph = { ...g };
				if (g.numberOfContours > 0 && g.points) {
					const points = g.points.map(
						(q) => new Point(q.onCurve, q.endContour, q.x, q.y),
					);
					processor.transformPoints(gid, [...points, ...phantom()]);
					out.points = points;
				} else if (g.numberOfContours < 0 && g.components) {
					const points = g.components.map(
						(c) => new Point(true, true, c.dx, c.dy),
					);
					processor.transformPoints(gid, [...points, ...phantom()]);
					out.components = g.components.map((c, i) => ({
						...c,
						dx: points[i]?.x ?? c.dx,
						dy: points[i]?.y ?? c.dy,
					}));
				}
				varied[gid] = out;
				return out;
			},
		});
		return font;
	}
}

// A glyph's outline as construction operators, mapped through `m` when given.
export function glyphOps(
	commands: PathCommand[],
	m?: [number, number, number, number, number, number],
): string {
	const out: string[] = [];
	let x = 0;
	let y = 0;
	const p = (a: number, b: number) =>
		m
			? `${num(m[0] * a + m[2] * b + m[4])} ${num(m[1] * a + m[3] * b + m[5])}`
			: `${num(a)} ${num(b)}`;
	for (const { command, args: a } of commands) {
		if (command === "moveTo") {
			[x, y] = a as [number, number];
			out.push(`${p(x, y)} m`);
		} else if (command === "lineTo") {
			[x, y] = a as [number, number];
			out.push(`${p(x, y)} l`);
		} else if (command === "quadraticCurveTo") {
			const [qx, qy, ex, ey] = a as [number, number, number, number];
			out.push(
				`${p(x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y))} ${p(ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey))} ${p(ex, ey)} c`,
			);
			x = ex;
			y = ey;
		} else if (command === "bezierCurveTo") {
			const [c1x, c1y, c2x, c2y, ex, ey] = a as [
				number,
				number,
				number,
				number,
				number,
				number,
			];
			out.push(`${p(c1x, c1y)} ${p(c2x, c2y)} ${p(ex, ey)} c`);
			x = ex;
			y = ey;
		} else if (command === "closePath") out.push("h");
	}
	return out.length ? `${out.join("\n")}\n` : "";
}
