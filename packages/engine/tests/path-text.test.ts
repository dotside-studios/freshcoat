import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { buildAdjust } from "../src/adjust";
import { placeOnPath } from "../src/arc-text";
import { auditAdjustedBounds } from "../src/canvaskit";
import { compileScene } from "../src/compile-scene";
import {
	createFrame,
	createText,
	type Node,
	type TextNode,
} from "../src/node";
import { createParagraphEngine } from "../src/paragraph-layout";
import { withPathMeasure } from "../src/path-measure";
import { makeRuntime, paintCanvasKit } from "../src/runtime";
import type { DrawTextCommand, PaintWarning, ResolvedFont } from "../src/types";
import { validateCommands } from "../src/validate-commands";

const SIZE = 200;
const font: ResolvedFont = {
	family: "Geist",
	weight: 400,
	style: "normal",
	size: 16,
	lineHeight: 1.2,
};
const CUBIC = "M10 150 C 60 20 140 20 190 150";

// biome-ignore lint/suspicious/noExplicitAny: CanvasKit instance
let ck: any;
let engine: ReturnType<typeof createParagraphEngine>;
let fonts: Map<string, Uint8Array[]>;

beforeAll(async () => {
	ck = await loadCanvasKit();
	fonts = new Map([
		["Geist", [testFontBytes("Geist-Regular.ttf")]],
		["Hebrew", [testFontBytes("NotoSansHebrew-Regular.ttf")]],
	]);
	engine = createParagraphEngine(ck, fonts);
});
afterAll(() => engine?.dispose());

const pathText = (
	text: string,
	path: TextNode["path"],
	extra: Partial<TextNode> = {},
) =>
	createText({
		id: "label",
		pos: { x: 0, y: 0 },
		size: { width: SIZE, height: SIZE },
		font,
		color: "#000000",
		text,
		path,
		...extra,
	});

const compile = (...children: Node[]) =>
	compileScene(createFrame({ size: { width: SIZE, height: SIZE }, children }), {
		width: SIZE,
		height: SIZE,
		textEngine: engine,
		fonts: [{ family: "Geist" }, { family: "Hebrew" }],
	});

function textCommand(...children: Node[]): DrawTextCommand {
	const find = (cmds: unknown[]): DrawTextCommand | undefined => {
		for (const c of cmds as { op: string; children?: unknown[] }[]) {
			if (c.op === "drawText") return c as DrawTextCommand;
			const inner = c.children && find(c.children);
			if (inner) return inner;
		}
	};
	const cmd = find(compile(...children));
	if (!cmd) throw new Error("no drawText");
	return cmd;
}

async function paint(...children: Node[]) {
	const painter = paintCanvasKit(ck);
	const rt = makeRuntime(
		{
			fonts,
			resolveFont: (req) => {
				const family = typeof req === "string" ? req : req.family;
				const bytes = fonts.get(family);
				return bytes ? { kind: "bytes", bytes } : { kind: "none" };
			},
			loadBytes: async () => new Uint8Array(),
		},
		"encode",
		undefined,
		painter,
	);
	const out = await painter(compile(...children), rt);
	const px = out.readPixels?.();
	const warnings = (out as { warnings?: PaintWarning[] }).warnings ?? [];
	out.dispose();
	if (!px) throw new Error("no pixels");
	return { px, warnings };
}

async function drawnGlyphs(...children: Node[]) {
	const calls: number[][] = [];
	const make = ck.TextBlob.MakeFromRSXformGlyphs;
	ck.TextBlob.MakeFromRSXformGlyphs = (g: Uint16Array, ...rest: unknown[]) => {
		calls.push(Array.from(g));
		return make(g, ...rest);
	};
	try {
		const { warnings } = await paint(...children);
		return { glyphs: calls.flat(), warnings };
	} finally {
		ck.TextBlob.MakeFromRSXformGlyphs = make;
	}
}

function shapedGlyphs(text: string): number[] {
	const provider = ck.TypefaceFontProvider.Make();
	for (const [family, list] of fonts)
		for (const b of list)
			provider.registerFont(
				b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
				family,
			);
	const collection = ck.FontCollection.Make();
	collection.setDefaultFontManager(provider);
	collection.enableFontFallback();
	const builder = ck.ParagraphBuilder.MakeFromFontCollection(
		new ck.ParagraphStyle({
			textStyle: { fontFamilies: ["Geist", "Hebrew"], fontSize: font.size },
		}),
		collection,
	);
	builder.addText(text);
	const para = builder.build();
	para.layout(1e6);
	const glyphs = para
		.getShapedLines()[0]
		.runs.flatMap((r: { glyphs: Uint16Array }) => Array.from(r.glyphs));
	para.delete();
	builder.delete();
	collection.delete();
	provider.delete();
	return glyphs;
}

// A run of `n` glyphs 10px apart on a baseline at 0.
const evenRun = (n: number) =>
	({
		glyphs: new Uint16Array(n).fill(1),
		positions: Float32Array.from({ length: 2 * n + 2 }, (_, i) =>
			i % 2 ? 0 : 5 * i,
		),
	}) as never;

function place(d: string, spec: Partial<Parameters<typeof placeOnPath>[1]>, n: number) {
	const path = ck.Path.MakeFromSVGString(d);
	try {
		return withPathMeasure(ck, path, (m) => ({
			length: m.length,
			xforms: placeOnPath(
				[{ runs: [evenRun(n)], baseline: 0, offset: 0 }],
				{ d, startOffset: 0, side: "left", align: "start", ...spec },
				m,
			)[0]?.[0] as Float32Array,
		}));
	} finally {
		path.delete();
	}
}

// Glyph i's advance middle on the baseline, where placement put it.
const centre = (x: Float32Array, i: number) => ({
	x: (x[4 * i + 2] as number) + 5 * (x[4 * i] as number),
	y: (x[4 * i + 3] as number) + 5 * (x[4 * i + 1] as number),
	angle: Math.atan2(x[4 * i + 1] as number, x[4 * i] as number),
});

const hidden = (x: Float32Array) => {
	let n = 0;
	for (let i = 0; i < x.length; i += 4) if (x[i] === 0 && x[i + 1] === 0) n++;
	return n;
};

describe("text on a path", () => {
	test("glyph centres sit on a cubic, turned to its tangent", () => {
		const cubic = (t: number) => {
			const u = 1 - t;
			return {
				x: u * u * u * 10 + 3 * u * u * t * 60 + 3 * u * t * t * 140 + t * t * t * 190,
				y: u * u * u * 150 + 3 * u * u * t * 20 + 3 * u * t * t * 20 + t * t * t * 150,
				dx: 3 * u * u * 50 + 6 * u * t * 80 + 3 * t * t * 50,
				dy: 3 * u * u * -130 + 0 + 3 * t * t * 130,
			};
		};
		const { xforms } = place(CUBIC, { startOffset: 20 }, 12);
		expect(hidden(xforms)).toBe(0);
		for (let i = 0; i < 12; i++) {
			const c = centre(xforms, i);
			let best = { dist: Number.POSITIVE_INFINITY, angle: 0 };
			for (let k = 0; k <= 4000; k++) {
				const p = cubic(k / 4000);
				const dist = Math.hypot(p.x - c.x, p.y - c.y);
				if (dist < best.dist) best = { dist, angle: Math.atan2(p.dy, p.dx) };
			}
			expect(best.dist).toBeLessThan(0.1);
			expect(c.angle).toBeCloseTo(best.angle, 2);
		}
	});

	test("align and side anchor the text at startOffset", () => {
		const line = "M0 0 L200 0";
		const start = place(line, { startOffset: 50 }, 4).xforms;
		expect(centre(start, 0).x).toBeCloseTo(55, 4);
		const middle = place(line, { startOffset: 50, percent: true, align: "center" }, 4).xforms;
		expect(centre(middle, 0).x).toBeCloseTo(85, 4);
		expect(centre(middle, 3).x).toBeCloseTo(115, 4);
		const end = place(line, { startOffset: 100, align: "end" }, 4).xforms;
		expect(centre(end, 3).x).toBeCloseTo(95, 4);
		const right = place(line, { startOffset: 50, side: "right" }, 4).xforms;
		expect(centre(right, 0).x).toBeCloseTo(145, 4);
		expect(centre(right, 1).x).toBeLessThan(centre(right, 0).x);
		expect(Math.abs(centre(right, 0).angle)).toBeCloseTo(Math.PI, 4);
	});

	test("on a closed path the text wraps past the start point", () => {
		const square = "M0 0 H100 V100 H0 Z";
		const { length, xforms } = place(square, { startOffset: 390 }, 4);
		expect(length).toBeCloseTo(400, 3);
		expect(hidden(xforms)).toBe(0);
		expect(centre(xforms, 0).y).toBeCloseTo(5, 4);
		expect(centre(xforms, 1).x).toBeCloseTo(5, 4);
		expect(centre(xforms, 1).y).toBeCloseTo(0, 4);
		const lap = place(square, {}, 45).xforms;
		expect(hidden(lap)).toBe(5);
	});

	test("glyphs past an open path's end are hidden", () => {
		const { xforms } = place("M0 0 L42 0", {}, 8);
		expect(hidden(xforms)).toBe(4);
		const before = place("M0 0 L200 0", { startOffset: 100, align: "end" }, 12).xforms;
		expect(hidden(before)).toBe(2);
	});

	test("paints text along a cubic", async () => {
		const { px, warnings } = await paint(pathText("ALONG A CURVE", { d: CUBIC, startOffset: "50%", align: "center" }));
		expect(warnings).toEqual([]);
		let ink = 0;
		for (let i = 3; i < px.data.length; i += 4) if ((px.data[i] as number) > 128) ink++;
		expect(ink).toBeGreaterThan(50);
	});

	test("overflow hides glyphs and reports the layer", async () => {
		const text = "MUCH TOO LONG FOR THIS PATH";
		const { glyphs, warnings } = await drawnGlyphs(pathText(text, { d: "M20 100 L80 100" }));
		expect(glyphs.length).toBeGreaterThan(0);
		expect(glyphs.length).toBeLessThan(shapedGlyphs(text).length);
		expect(warnings).toContainEqual({ kind: "text_path_overflow", layer: "label" });
	});

	test("a path too short for any glyph draws nothing", async () => {
		const { glyphs, warnings } = await drawnGlyphs(pathText("A", { ref: "missing" }));
		expect(glyphs).toEqual([]);
		expect(warnings.map((w) => w.kind)).toContain("text_path_overflow");
	});

	test("draws the shaped ligature glyphs", async () => {
		const shaped = shapedGlyphs("office");
		expect(shaped.length).toBeLessThan("office".length);
		const { glyphs } = await drawnGlyphs(pathText("office", { d: CUBIC }));
		expect(glyphs).toEqual(shaped);
	});

	test("falls back per glyph across scripts", async () => {
		const text = "ab שלום";
		const { glyphs, warnings } = await drawnGlyphs(pathText(text, { d: CUBIC, startOffset: 30 }));
		expect(warnings).toEqual([]);
		expect(glyphs).not.toContain(0);
		expect([...glyphs].sort()).toEqual([...shapedGlyphs(text)].sort());
	});

	test("deletes every ContourMeasure and iterator", async () => {
		const Iter = ck.ContourMeasureIter;
		const made: { isDeleted(): boolean }[] = [];
		ck.ContourMeasureIter = function (...args: unknown[]) {
			const iter = new Iter(...args);
			const next = iter.next.bind(iter);
			iter.next = () => {
				const c = next();
				if (c) made.push(c);
				return c;
			};
			made.push(iter);
			return iter;
		};
		try {
			await paint(
				pathText("ONE\nTWO", { d: "M10 40 H190 M10 120 C 60 60 140 60 190 120" }),
			);
		} finally {
			ck.ContourMeasureIter = Iter;
		}
		expect(made.length).toBeGreaterThanOrEqual(3);
		for (const o of made) expect(o.isDeleted()).toBe(true);
	});

	test("a ref follows a sibling vector into the text's frame", () => {
		const vector: Node = {
			kind: "path",
			id: "curve",
			pos: { x: 50, y: 60 },
			size: { width: 100, height: 0 },
			d: "M0 0 L100 0",
		};
		const cmd = textCommand(vector, pathText("X", { ref: "curve" }, { pos: { x: 10, y: 20 } }));
		expect(cmd.path?.d).toBe("M40 40L140 40");
		expect(cmd.arc).toBeUndefined();
		const turned = textCommand(
			{ ...vector, rotation: 90 },
			pathText("X", { ref: "curve" }, { pos: { x: 0, y: 0 } }),
		);
		expect(turned.path?.d).toBe("M100 10L100 110");
	});

	test("percent and numeric offsets resolve onto the command", () => {
		const pct = textCommand(pathText("X", { d: CUBIC, startOffset: "25%", side: "right" }));
		expect(pct.path).toEqual({ d: CUBIC, startOffset: 25, percent: true, side: "right", align: "start" });
		const px = textCommand(pathText("X", { d: CUBIC, startOffset: 12, align: "end" }));
		expect(px.path).toEqual({ d: CUBIC, startOffset: 12, side: "left", align: "end" });
	});

	test("predicted layer bounds hold the drawn glyphs", async () => {
		const pairs: { predicted: number[] | null; recorded: number[] }[] = [];
		auditAdjustedBounds((predicted, recorded) => pairs.push({ predicted, recorded }));
		try {
			for (const side of ["left", "right"] as const)
				await paint(
					pathText(
						"ab שלום office",
						{ d: CUBIC, side, startOffset: "10%" },
						{ adjust: buildAdjust({ gamma: 1.8 }) },
					),
				);
		} finally {
			auditAdjustedBounds(undefined);
		}
		expect(pairs).toHaveLength(2);
		for (const { predicted: p, recorded: r } of pairs) {
			expect(p).not.toBeNull();
			const q = p as number[];
			expect(q[0]).toBeLessThanOrEqual(r[0] + 1e-3);
			expect(q[1]).toBeLessThanOrEqual(r[1] + 1e-3);
			expect(q[2]).toBeGreaterThanOrEqual(r[2] - 1e-3);
			expect(q[3]).toBeGreaterThanOrEqual(r[3] - 1e-3);
		}
	});

	test("validation rejects a bad text path", () => {
		const cmd = textCommand(pathText("X", { d: CUBIC }));
		const issues = validateCommands([
			{ ...cmd, path: { ...(cmd.path as NonNullable<DrawTextCommand["path"]>), startOffset: Number.NaN } },
		]);
		expect(issues.map((i) => i.code)).toContain("bad_text_path");
	});
});
