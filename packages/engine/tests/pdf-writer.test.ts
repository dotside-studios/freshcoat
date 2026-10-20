import { createHash } from "node:crypto";
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test } from "vitest";
import { createFrame, createRect } from "../src/node";
import { md5 } from "../src/pdf/md5";
import { num, PdfBytes, PdfWriter } from "../src/pdf/writer";
import { createRenderer, type Renderer } from "../src/renderer";

let renderer: Renderer;
beforeAll(async () => {
	renderer = await createRenderer({ ck: await loadCanvasKit(), fonts: {} });
});

const scene = createFrame({
	pos: { x: 0, y: 0 },
	size: { width: 40, height: 40 },
	children: [],
	background: createRect({
		pos: { x: 0, y: 0 },
		size: { width: 40, height: 40 },
		fills: [{ kind: "solid", color: "#e63946" }],
	}),
});
const date = new Date("2026-01-01T00:00:00Z");
const source = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);
const render = async (title?: string) =>
	source((await renderer.renderPdf(scene, { width: 40, height: 40, dpi: 72, date, title })).bytes);

describe("pdf text strings", () => {
	test("keeps printable ASCII literal and escaped", async () => {
		expect(await render("Plain (a\\b)")).toContain("/Title (Plain \\(a\\\\b\\))");
	});

	test("encodes accented and CJK titles as UTF-16BE", async () => {
		expect(await render("Café")).toContain("/Title <FEFF00430061006600E9>");
		expect(await render("日本語")).toContain("/Title <FEFF65E5672C8A9E>");
	});

	test("emits astral characters as surrogate pairs", async () => {
		expect(await render("😀")).toContain("/Title <FEFFD83DDE00>");
	});

	test("replaces lone surrogates instead of failing", async () => {
		expect(await render("a\ud83d")).toContain("/Title <FEFF0061FFFD>");
		expect(await render("\ude00b")).toContain("/Title <FEFFFFFD0062>");
	});

	test("writes byte strings as plain hex", () => {
		const w = new PdfWriter();
		const ref = w.add({ B: new PdfBytes(new Uint8Array([0, 0xab, 0xff])) });
		expect(source(w.save(ref))).toContain("/B <00abff>");
	});
});

describe("pdf trailer ID", () => {
	test("is a pair of equal digests, stable for the same input", async () => {
		const a = await renderer.renderPdf(scene, { width: 40, height: 40, dpi: 72, date });
		const b = await renderer.renderPdf(scene, { width: 40, height: 40, dpi: 72, date });
		expect(b.bytes).toEqual(a.bytes);
		const m = /\/ID \[<([0-9a-f]{32})> <([0-9a-f]{32})>\]/.exec(source(a.bytes));
		expect(m).not.toBeNull();
		expect(m?.[1]).toBe(m?.[2]);
	});

	test("changes with the content", async () => {
		const id = (s: string) => /\/ID \[<([0-9a-f]+)>/.exec(s)?.[1];
		expect(id(await render("one"))).not.toBe(id(await render("two")));
	});

	test("md5 matches a reference implementation", () => {
		for (const n of [0, 1, 55, 56, 63, 64, 65, 1000]) {
			const data = Uint8Array.from({ length: n }, (_, i) => (i * 7) & 0xff);
			expect(Buffer.from(md5(data)).toString("hex")).toBe(
				createHash("md5").update(data).digest("hex"),
			);
		}
	});
});

describe("num", () => {
	test("prints large magnitudes without an exponent", () => {
		expect(num(1e21)).toBe("1000000000000000000000");
		expect(num(1.5e22)).toBe("15000000000000000000000");
		expect(num(-1e25)).toBe("-10000000000000000905969664");
	});

	test("prints small magnitudes without an exponent", () => {
		expect(num(1e-7)).toBe("0");
		expect(num(-1e-7)).toBe("0");
		expect(num(0.00005)).toBe("0.0001");
		expect(num(-0)).toBe("0");
	});

	test("trims trailing zeros", () => {
		expect(num(12)).toBe("12");
		expect(num(100)).toBe("100");
		expect(num(1.5)).toBe("1.5");
		expect(num(-0.25)).toBe("-0.25");
		expect(num(Number.NaN)).toBe("0");
		expect(num(Number.POSITIVE_INFINITY)).toBe("0");
	});
});
