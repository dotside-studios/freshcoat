// @vitest-environment node
import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import type { CanvasKit } from "canvaskit-wasm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { casedText, EditableText, type TextProps } from "~/canvas/text-layout";

let ck: CanvasKit;
const fonts = new Map([["Geist", [testFontBytes("Geist-Regular.ttf")]]]);
const live: EditableText[] = [];

beforeAll(async () => {
	ck = await loadCanvasKit();
});

afterEach(() => {
	for (const t of live.splice(0)) t.dispose();
});

function laid(
	text: string,
	props: Partial<TextProps> = {},
	box = { width: 200, height: 40 },
) {
	const t = new EditableText(ck);
	live.push(t);
	t.layout(
		text,
		{ font: { family: "Geist", size: 20, lineHeight: 1.5 }, ...props },
		fonts,
		box,
	);
	return t;
}

describe("EditableText", () => {
	it("advances the caret through the text on one line", () => {
		const t = laid("Hello");
		const xs = [0, 1, 2, 5].map((i) => t.caret(i).x);
		expect(xs[0]).toBeCloseTo(0);
		expect(xs[1]).toBeGreaterThan(xs[0] as number);
		expect(xs[3]).toBeGreaterThan(xs[2] as number);
		expect(t.caret(0).y).toBeCloseTo(t.caret(5).y);
		expect(t.caret(0).height).toBeCloseTo(30, 0);
	});

	it("maps a point back to the index the caret sits at", () => {
		const t = laid("Hello world");
		for (const i of [0, 3, 6, 11]) {
			const c = t.caret(i);
			expect(t.indexAt(c.x + 0.1, c.y + c.height / 2)).toBe(i);
		}
	});

	it("wraps as the box does and moves between lines", () => {
		const t = laid(
			"one two three four five six",
			{},
			{ width: 80, height: 40 },
		);
		expect(t.height).toBeGreaterThan(40);
		const first = t.caret(0);
		const down = t.vertical(0, 1, first.x);
		expect(t.caret(down).y).toBeGreaterThan(first.y);
		expect(t.vertical(down, -1, first.x)).toBe(0);
		expect(t.vertical(0, -1, first.x)).toBe(0);
		expect(t.lineEdge(0, "start")).toBe(0);
		const end = t.lineEdge(0, "end");
		expect(end).toBeGreaterThan(0);
		expect(end).toBeLessThan(down + 4);
	});

	it("stacks hard lines with paragraph spacing between them", () => {
		const plain = laid("a\nb");
		const spaced = laid("a\nb", { paragraphSpacing: 10 });
		expect(spaced.caret(2).y - plain.caret(2).y).toBeCloseTo(10);
		expect(plain.caret(2).y).toBeGreaterThan(plain.caret(0).y);
		expect(plain.vertical(0, 1, 0)).toBe(2);
		expect(plain.paragraph(3)).toEqual([2, 3]);
	});

	it("places the caret on an empty last line", () => {
		const t = laid("a\n");
		expect(t.caret(2).y).toBeGreaterThan(t.caret(0).y);
		expect(t.indexAt(0, t.caret(2).y + 1)).toBe(2);
	});

	it("covers a selection and the fields with boxes", () => {
		const t = laid("Hi {{ name }}!");
		const [token] = t.tokens();
		const sel = t.rects(3, 13);
		expect(token?.x).toBeCloseTo(sel[0]?.x as number);
		expect(token?.width).toBeGreaterThan(0);
		expect(t.word(1)).toEqual([0, 2]);
	});

	it("aligns lines and the box vertically", () => {
		const t = laid(
			"Hi",
			{ align: "right", verticalAlign: "bottom" },
			{
				width: 200,
				height: 100,
			},
		);
		const c = t.caret(2);
		expect(c.x).toBeCloseTo(200, 0);
		expect(c.y + c.height).toBeCloseTo(100, 0);
	});

	it("shrinks to fit like the render", () => {
		const t = laid(
			"one two three four five six seven",
			{ fit: "shrink" },
			{
				width: 80,
				height: 40,
			},
		);
		expect(t.fontSize).toBeLessThan(20);
		expect(t.height).toBeLessThanOrEqual(40);
	});
});

describe("EditableText stroke", () => {
	// Red and black pixels on a row through the stem of an "I", at 4x.
	function redColumns(align: "center" | "outside" | "inside") {
		const t = laid(
			"I",
			{
				font: { family: "Geist", size: 80, lineHeight: 1 },
				color: "#000000",
				stroke: { color: "#ff0000", width: 2, align },
			},
			{ width: 60, height: 80 },
		);
		const surface = ck.MakeSurface(240, 320);
		if (!surface) throw new Error("no surface");
		const canvas = surface.getCanvas();
		canvas.clear(ck.WHITE);
		canvas.scale(4, 4);
		t.paint(canvas);
		const info = {
			width: 240,
			height: 1,
			colorType: ck.ColorType.RGBA_8888,
			alphaType: ck.AlphaType.Unpremul,
			colorSpace: ck.ColorSpace.SRGB,
		};
		const row = canvas.readPixels(0, 160, info) as Uint8Array;
		surface.delete();
		const red: number[] = [];
		const black: number[] = [];
		for (let x = 0; x < 240; x++) {
			const [r, g] = [row[x * 4] as number, row[x * 4 + 1] as number];
			if (r > 200 && g < 60) red.push(x);
			if (r < 60) black.push(x);
		}
		return { red, black };
	}

	it("layers the stroke by its alignment", () => {
		const center = redColumns("center");
		const outside = redColumns("outside");
		const inside = redColumns("inside");
		for (const c of [center, outside, inside]) {
			expect(c.red.length).toBeGreaterThan(0);
			expect(c.black.length).toBeGreaterThan(0);
		}
		const left = (c: { red: number[] }) => Math.min(...c.red);
		expect(left(outside)).toBeLessThan(left(center));
		expect(left(center)).toBeLessThan(left(inside));
		expect(Math.min(...inside.black)).toBeGreaterThan(left(inside));
	});
});

describe("casedText", () => {
	it("keeps tokens and indices", () => {
		expect(casedText("hi {{ name }} there", "upper")).toBe(
			"HI {{ name }} THERE",
		);
		expect(casedText("hello big world", "title")).toBe("Hello Big World");
		expect(casedText("straße", "upper")).toBe("STRAßE");
	});
});
