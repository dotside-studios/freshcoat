import {
	BinaryBitmap,
	HybridBinarizer,
	QRCodeReader,
	RGBLuminanceSource,
} from "@zxing/library";
import { describe, expect, test } from "vitest";
import {
	generateMatrix,
	generatePixels,
	MATRIX_CACHE_BYTES,
	PIXEL_CACHE_BYTES,
	qrCacheBytes,
} from "../src/qr";
import type { Command, DrawCommand, Template } from "../src/types";
import { compileToCommands } from "./helpers/compile-commands";

// Recursively find the first draw command matching `op` (QR lowers to a bitmap
// nested in a group).
function findDraw(commands: Command[], op: string): DrawCommand | undefined {
	for (const c of commands) {
		if ("op" in c && c.op === op) return c as DrawCommand;
		if ("op" in c && c.op === "drawGroup") {
			const hit = findDraw((c as { children: DrawCommand[] }).children, op);
			if (hit) return hit;
		}
	}
	return undefined;
}

describe("generateMatrix", () => {
	test("empty payload yields an empty matrix instead of throwing", () => {
		// The unfilled-field state must degrade to a blank QR, not a crash.
		expect(generateMatrix("")).toEqual([]);
	});

	test("non-empty payload yields a square boolean matrix", () => {
		const m = generateMatrix("https://example.com/c/abc123");
		expect(m.length).toBeGreaterThan(0);
		expect(m.every((row) => row.length === m.length)).toBe(true);
	});
});

// A QR bound to a field that resolves empty (e.g. the skeleton/preview pass that
// compiles with no customizations) must not take down the whole compile.
const qrTemplate: Template = {
	format_version: "1.0",
	version: "1.0.0",
	id: "qr",
	name: "QR",
	product: "card_cr80",
	width: 100,
	height: 100,
	fields: { type: "object", properties: { card_url: { type: "string" } } },
	template_data: [
		{
			name: "front",
			background: {
				id: "bg",
				type: "rect",
				pos: { x: 0, y: 0 },
				size: { width: 100, height: 100 },
				properties: { fill: "#ffffff" },
			},
			elements: [
				{
					id: "card_url",
					type: "qr_code",
					pos: { x: 10, y: 10 },
					size: { width: 80, height: 80 },
					properties: { value: "{{card_url}}" },
				},
			],
		},
	],
} as unknown as Template;

describe("compile with an empty QR value", () => {
	test("does not throw and emits a QR bitmap with no modules", () => {
		const [front] = compileToCommands(
			qrTemplate,
			{},
			{ width: 100, height: 100 },
		);
		const bmp = findDraw(front.commands, "drawBitmap");
		expect(bmp).toBeDefined();
		// empty matrix → 0×0 bitmap
		expect((bmp as { pixelWidth: number }).pixelWidth).toBe(0);
	});

	test("emits real modules once the value is filled", () => {
		const [front] = compileToCommands(
			qrTemplate,
			{ card_url: "https://example.com/c/abc123" },
			{ width: 100, height: 100 },
		);
		const bmp = findDraw(front.commands, "drawBitmap");
		expect(bmp).toBeDefined();
		expect((bmp as { pixelWidth: number }).pixelWidth).toBeGreaterThan(0);
	});
});

const version = (m: boolean[][]) => (m.length - 17) / 4;

describe("generateMatrix symbol version", () => {
	const url = `https://example.com/p/${"1234567890".repeat(4)}`;

	test.each([
		[url, "M", 3],
		[url, "H", 5],
		[`ORDER-${"0".repeat(20)}`, "L", 1],
		["https://freshcoat.app/c/AB12CD", "M", 3],
	] as const)("%s at %s is version %i", (value, ec, expected) => {
		expect(version(generateMatrix(value, ec))).toBe(expected);
	});

	test("a long digit-run URL encodes at M", () => {
		const m = generateMatrix(`https://example.com/p/${"7".repeat(4000)}`, "M");
		expect(version(m)).toBeLessThanOrEqual(40);
	});
});

describe("QR memo", () => {
	const v40 = (i: number) => `${i}:${"x".repeat(2900)}`;

	test("stays within its byte budgets across many version-40 symbols", () => {
		for (let i = 0; i < 200; i++) {
			const { size } = generatePixels(v40(i), "L", [0, 0, 0]);
			expect(size).toBe(177);
			const { matrices, pixels } = qrCacheBytes();
			expect(matrices).toBeLessThanOrEqual(MATRIX_CACHE_BYTES);
			expect(pixels).toBeLessThanOrEqual(PIXEL_CACHE_BYTES);
		}
		expect(qrCacheBytes().pixels).toBeGreaterThan(PIXEL_CACHE_BYTES / 2);
	});

	test("keys pixel buffers by value, level and colour", () => {
		const a = generatePixels("https://example.com/memo", "Q", [0, 0, 0]);
		expect(
			generatePixels("https://example.com/memo", "Q", [0, 0, 0]).pixels,
		).toBe(a.pixels);
		expect(
			generatePixels("https://example.com/memo", "L", [0, 0, 0]).pixels,
		).not.toBe(a.pixels);
		expect(
			generatePixels("https://example.com/memo", "Q", [255, 0, 0]).pixels,
		).not.toBe(a.pixels);
	});

	test("reuses the pixel buffer on repeated compiles", () => {
		const pixelsOf = () => {
			const [front] = compileToCommands(
				qrTemplate,
				{ card_url: "https://example.com/c/reuse" },
				{ width: 100, height: 100 },
			);
			return (findDraw(front.commands, "drawBitmap") as { pixels: Uint8Array })
				.pixels;
		};
		const first = pixelsOf();
		const copy = first.slice();
		const second = pixelsOf();
		expect(second).toBe(first);
		expect(second).toEqual(copy);
	});

	test("matches the boolean matrix", () => {
		const value = "https://example.com/c/abc123";
		const m = generateMatrix(value, "M");
		const { size, pixels } = generatePixels(value, "M", [1, 2, 3]);
		expect(size).toBe(m.length);
		for (let y = 0; y < size; y++)
			for (let x = 0; x < size; x++) {
				const i = (y * size + x) * 4;
				expect([...pixels.subarray(i, i + 4)]).toEqual(
					m[y][x] ? [1, 2, 3, 255] : [0, 0, 0, 0],
				);
			}
	});
});

function decode(matrix: boolean[][]): string {
	const scale = 4;
	const side = (matrix.length + 8) * scale;
	const luma = new Uint8ClampedArray(side * side).fill(255);
	for (let y = 0; y < side; y++)
		for (let x = 0; x < side; x++)
			if (matrix[Math.floor(y / scale) - 4]?.[Math.floor(x / scale) - 4])
				luma[y * side + x] = 0;
	const source = new RGBLuminanceSource(luma, side, side);
	return new QRCodeReader()
		.decode(new BinaryBitmap(new HybridBinarizer(source)))
		.getText();
}

describe("generateMatrix decodes", () => {
	test.each([
		["https://freshcoat.app/c/AB12CD", "L"],
		[`https://example.com/p/${"1234567890".repeat(4)}`, "M"],
		[`ORDER-${"0".repeat(20)}`, "Q"],
		["Café ✓ https://x.io/ü", "H"],
	] as const)("%s at %s", (value, ec) => {
		expect(decode(generateMatrix(value, ec))).toBe(value);
	});
});
