import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { buildAdjust } from "../src/adjust";
import { placeOnArc } from "../src/arc-text";
import { auditAdjustedBounds } from "../src/canvaskit";
import { compileScene } from "../src/compile-scene";
import { createFrame, createText, type TextNode } from "../src/node";
import { createParagraphEngine } from "../src/paragraph-layout";
import { makeRuntime, paintCanvasKit } from "../src/runtime";
import type { DrawTextCommand, ResolvedFont, TextArc } from "../src/types";
import { validateCommands } from "../src/validate-commands";

const SIZE = 200;
const font: ResolvedFont = {
	family: "Geist",
	weight: 400,
	style: "normal",
	size: 24,
	lineHeight: 1.2,
};

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

const arcText = (text: string, arc: TextNode["arc"], extra = {}) =>
	createText({
		pos: { x: 0, y: 0 },
		size: { width: SIZE, height: SIZE },
		font,
		color: "#000000",
		text,
		arc,
		...extra,
	});

const compile = (node: TextNode) =>
	compileScene(createFrame({ size: { width: SIZE, height: SIZE }, children: [node] }), {
		width: SIZE,
		height: SIZE,
		textEngine: engine,
		fonts: [{ family: "Geist" }, { family: "Hebrew" }],
	});

function arcCommand(node: TextNode): DrawTextCommand {
	const find = (cmds: unknown[]): DrawTextCommand | undefined => {
		for (const c of cmds as { op: string; children?: unknown[] }[]) {
			if (c.op === "drawText") return c as DrawTextCommand;
			const inner = c.children && find(c.children);
			if (inner) return inner;
		}
	};
	const cmd = find(compile(node));
	if (!cmd) throw new Error("no drawText");
	return cmd;
}

async function paint(node: TextNode) {
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
	const out = await painter(compile(node), rt);
	const px = out.readPixels?.();
	out.dispose();
	if (!px) throw new Error("no pixels");
	return px;
}

// Glyph IDs of every RSXform blob the painter builds.
async function drawnGlyphs(node: TextNode): Promise<number[][]> {
	const calls: number[][] = [];
	const make = ck.TextBlob.MakeFromRSXformGlyphs;
	ck.TextBlob.MakeFromRSXformGlyphs = (g: Uint16Array, ...rest: unknown[]) => {
		calls.push(Array.from(g));
		return make(g, ...rest);
	};
	try {
		await paint(node);
	} finally {
		ck.TextBlob.MakeFromRSXformGlyphs = make;
	}
	return calls;
}

// The glyphs one paragraph shapes for `text`, run by run.
function shapedGlyphs(text: string): number[][] {
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
	const runs = para
		.getShapedLines()[0]
		.runs.map((r: { glyphs: Uint16Array }) => Array.from(r.glyphs));
	para.delete();
	builder.delete();
	collection.delete();
	provider.delete();
	return runs;
}

// Ink in the top and bottom halves of the frame.
async function halves(node: TextNode) {
	const px = await paint(node);
	let top = 0;
	let bottom = 0;
	for (let y = 0; y < px.height; y++)
		for (let x = 0; x < px.width; x++)
			if (px.data[(y * px.width + x) * 4 + 3] > 128) {
				if (y < px.height / 2) top++;
				else bottom++;
			}
	return { top, bottom };
}

describe("arc text", () => {
	test("draws the shaped ligature glyphs", async () => {
		const shaped = shapedGlyphs("office");
		expect(shaped.flat().length).toBeLessThan("office".length);
		const drawn = await drawnGlyphs(arcText("office", {}));
		expect(drawn.flat()).toEqual(shaped.flat());
	});

	test("falls back per glyph across scripts", async () => {
		const text = "ab שלום";
		const shaped = shapedGlyphs(text);
		expect(shaped.length).toBeGreaterThan(1);
		const drawn = await drawnGlyphs(arcText(text, {}));
		expect(drawn.flat()).not.toContain(0);
		expect(drawn.flat().sort()).toEqual(shaped.flat().sort());
	});

	test("outside text sits on top, inside text on the bottom", async () => {
		const outside = await halves(
			arcText("SEAL OF QUALITY", { direction: "outside", startAngle: 0 }),
		);
		expect(outside.top).toBeGreaterThan(0);
		expect(outside.bottom).toBe(0);
		const inside = await halves(
			arcText("SEAL OF QUALITY", { direction: "inside", startAngle: 180 }),
		);
		expect(inside.bottom).toBeGreaterThan(0);
		expect(inside.top).toBe(0);
	});

	test("the default radius keeps the glyphs inside the box", async () => {
		for (const direction of ["outside", "inside"] as const) {
			const px = await paint(
				arcText("A RING OF TEXT ALL THE WAY AROUND THE SEAL", { direction }),
			);
			for (let x = 0; x < px.width; x++) {
				expect(px.data[x * 4 + 3]).toBeLessThan(128);
				expect(px.data[((px.height - 1) * px.width + x) * 4 + 3]).toBeLessThan(
					128,
				);
			}
		}
	});

	test("both directions read left to right and upright", () => {
		const run = {
			glyphs: new Uint16Array([1, 2, 3]),
			positions: new Float32Array([0, 10, 10, 10, 20, 10, 30, 10]),
		} as never;
		const place = (direction: TextArc["direction"], startAngle: number) =>
			placeOnArc(
				[{ runs: [run], baseline: 10, offset: 0 }],
				{ radius: 100, startAngle, direction, align: "center" },
				0,
				0,
			)[0]?.[0] as Float32Array;
		for (const [direction, angle, y] of [
			["outside", 0, -100],
			["inside", 180, 100],
		] as const) {
			const x = place(direction, angle);
			expect(x[4]).toBeCloseTo(1, 6);
			expect(x[5]).toBeCloseTo(0, 6);
			expect(x[6]).toBeCloseTo(-5, 4);
			expect(x[7]).toBeCloseTo(y, 4);
			expect(x[2]).toBeLessThan(x[6] as number);
			expect(x[10]).toBeGreaterThan(x[6] as number);
		}
	});

	test("align anchors the line at startAngle", () => {
		const run = {
			glyphs: new Uint16Array([1, 2]),
			positions: new Float32Array([0, 0, 10, 0, 20, 0]),
		} as never;
		const angle = (align: TextArc["align"], i: number) => {
			const x = placeOnArc(
				[{ runs: [run], baseline: 0, offset: 0 }],
				{ radius: 50, startAngle: 90, direction: "outside", align },
				0,
				0,
			)[0]?.[0] as Float32Array;
			return Math.atan2(x[4 * i + 1] as number, x[4 * i] as number);
		};
		const half = 5 / 50;
		expect(angle("start", 0)).toBeCloseTo(Math.PI / 2 + half, 6);
		expect(angle("end", 1)).toBeCloseTo(Math.PI / 2 - half, 6);
		expect(angle("center", 0)).toBeCloseTo(Math.PI / 2 - half, 6);
	});

	test("sweep spreads the line across the given angle", () => {
		const run = {
			glyphs: new Uint16Array([1, 2]),
			positions: new Float32Array([0, 0, 10, 0, 20, 0]),
		} as never;
		const x = placeOnArc(
			[{ runs: [run], baseline: 0, offset: 0 }],
			{ radius: 50, startAngle: 0, direction: "outside", align: "center", sweep: 90 },
			0,
			0,
		)[0]?.[0] as Float32Array;
		const a0 = Math.atan2(x[1] as number, x[0] as number);
		const a1 = Math.atan2(x[5] as number, x[4] as number);
		expect(a1 - a0).toBeCloseTo(Math.PI / 4, 6);
	});

	test("later lines step toward the center outside and away inside", () => {
		const out = arcCommand(arcText("ONE\nTWO", { direction: "outside" }));
		const inn = arcCommand(arcText("ONE\nTWO", { direction: "inside" }));
		expect(out.layout.lines).toHaveLength(2);
		expect(out.arc?.radius).toBeGreaterThan(inn.arc?.radius ?? 0);
	});

	test("arc text is not wrapped to the box", () => {
		const cmd = arcCommand(
			arcText("A LONG LINE THAT WOULD WRAP IN A SMALL BOX", {}, {
				size: { width: 60, height: 60 },
			}),
		);
		expect(cmd.layout.lines).toHaveLength(1);
	});

	test("predicted layer bounds hold the drawn glyphs", async () => {
		const pairs: { predicted: number[] | null; recorded: number[] }[] = [];
		auditAdjustedBounds((predicted, recorded) =>
			pairs.push({ predicted, recorded }),
		);
		try {
			for (const direction of ["outside", "inside"] as const)
				await paint(
					arcText(
						"ab שלום office",
						{ direction, startAngle: 30, align: "start" },
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

	test("validation rejects a bad arc", () => {
		const cmd = arcCommand(arcText("X", {}));
		const issues = validateCommands([
			{ ...cmd, arc: { ...(cmd.arc as TextArc), radius: Number.NaN } },
		]);
		expect(issues.map((i) => i.code)).toContain("bad_arc");
	});
});
