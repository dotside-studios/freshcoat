import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { compileScene } from "../src/compile-scene";
import { createText } from "../src/node";
import { createParagraphEngine } from "../src/paragraph-layout";
import { makeRuntime, paintCanvasKit } from "../src/runtime";
import type { DrawTextCommand, ResolvedFont } from "../src/types";

// biome-ignore lint/suspicious/noExplicitAny: CanvasKit instance
let ck: any;
let engine: ReturnType<typeof createParagraphEngine>;
const fonts = new Map([["Geist", [testFontBytes("Geist-Regular.ttf")]]]);

beforeAll(async () => {
	ck = await loadCanvasKit();
	engine = createParagraphEngine(ck, fonts);
});
afterAll(() => engine?.dispose());

const W = 400;
const H = 160;

async function render(text: string, font: Partial<ResolvedFont>) {
	const painter = paintCanvasKit(ck);
	const rt = makeRuntime(
		{
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
	const scene = createText({
		pos: { x: 20, y: 0 },
		size: { width: W - 40, height: H },
		font: {
			family: "Geist",
			weight: 400,
			style: "normal",
			size: 100,
			lineHeight: 1.2,
			...font,
		},
		color: "#000000",
		text,
		align: "left",
	});
	const commands = compileScene(scene, {
		width: W,
		height: H,
		textEngine: engine,
	});
	const draw = commands.find((c) => c.op === "drawText") as DrawTextCommand;
	const line = draw.layout.lines[0];
	const span = line.spans[0];
	const out = await painter(commands, rt);
	const px = out.readPixels?.();
	out.dispose();
	if (!px) throw new Error("no pixels");
	const inked = (x: number, y: number) =>
		px.data[(y * px.width + x) * 4 + 3] > 128;
	return {
		inked,
		baseline: line.baseline ?? line.y,
		x0: Math.ceil(span.x),
		x1: Math.floor(span.x + span.width),
	};
}

// Columns of `row` in [x0, x1) left uninked, grouped into runs.
function clearRuns(
	inked: (x: number, y: number) => boolean,
	row: number,
	x0: number,
	x1: number,
): number {
	let runs = 0;
	let prev = true;
	for (let x = x0; x < x1; x++) {
		const ink = inked(x, row);
		if (!ink && prev) runs++;
		prev = ink;
	}
	return runs;
}

describe("text decoration", () => {
	test("an underline skips the descenders of jumpy", async () => {
		const on = await render("jumpy", { decoration: "underline" });
		const row = Math.round(on.baseline + 10);
		expect(clearRuns(on.inked, row, on.x0, on.x1)).toBeGreaterThanOrEqual(3);

		const off = await render("jumpy", {
			decoration: "underline",
			skipInk: false,
		});
		expect(clearRuns(off.inked, row, off.x0, off.x1)).toBe(0);
	});

	test("an underline without descenders stays whole", async () => {
		const r = await render("mum", { decoration: "underline" });
		expect(clearRuns(r.inked, Math.round(r.baseline + 10), r.x0, r.x1)).toBe(0);
	});

	test("a strikethrough stays continuous", async () => {
		const r = await render("jumpy", { decoration: "line-through" });
		expect(clearRuns(r.inked, Math.round(r.baseline - 31.8), r.x0, r.x1)).toBe(
			0,
		);
	});

	test("decorations sit where the font's metrics put them", async () => {
		const r = await render("a   a", { decoration: "line-through" });
		const x = Math.round((r.x0 + r.x1) / 2);
		const rows: number[] = [];
		for (let y = 0; y < H; y++) if (r.inked(x, y)) rows.push(y);
		expect(rows.length).toBeGreaterThan(0);
		const centre = (rows[0] + (rows.at(-1) as number) + 1) / 2;
		expect(centre - r.baseline).toBeCloseTo(-31.8, 0);
		expect(rows.length).toBe(5);

		const u = await render("a   a", { decoration: "underline" });
		const urows: number[] = [];
		for (let y = 0; y < H; y++) if (u.inked(x, y)) urows.push(y);
		const ucentre = (urows[0] + (urows.at(-1) as number) + 1) / 2;
		expect(ucentre - u.baseline).toBeCloseTo(10, 0);
	});
});
