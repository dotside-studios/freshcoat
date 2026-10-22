import { describe, expect, test } from "bun:test";
import type { Command, DrawCommand } from "@freshcoat-js/engine";
import {
	BinaryBitmap,
	HybridBinarizer,
	QRCodeReader,
	RGBLuminanceSource,
} from "@zxing/library";
import {
	DEFAULT_QR_STYLE,
	generateMatrix,
	MATRIX_CACHE_BYTES,
	PATH_CACHE_BYTES,
	qrCacheBytes,
	qrSymbol,
} from "../src/qr";
import type { Template } from "../src/types";
import { compileToCommands } from "./helpers/compile-commands";

// Recursively find the first draw command matching `op` (QR lowers to a path
// nested in groups).
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
	test("does not throw and draws no modules", () => {
		const [front] = compileToCommands(
			qrTemplate,
			{},
			{ width: 100, height: 100 },
		);
		expect(findDraw(front.commands, "drawPath")).toBeUndefined();
	});

	test("emits real modules once the value is filled", () => {
		const [front] = compileToCommands(
			qrTemplate,
			{ card_url: "https://example.com/c/abc123" },
			{ width: 100, height: 100 },
		);
		const path = findDraw(front.commands, "drawPath") as {
			d: string;
			viewBox: { width: number };
			fillRule: string;
		};
		expect(path.d.length).toBeGreaterThan(0);
		expect(path.viewBox.width).toBe(
			generateMatrix("https://example.com/c/abc123").length,
		);
		expect(path.fillRule).toBe("evenodd");
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
		for (let i = 0; i < 80; i++) {
			const { size } = qrSymbol(v40(i), "L");
			expect(size).toBe(177);
			const { matrices, paths } = qrCacheBytes();
			expect(matrices).toBeLessThanOrEqual(MATRIX_CACHE_BYTES);
			expect(paths).toBeLessThanOrEqual(PATH_CACHE_BYTES);
		}
		expect(qrCacheBytes().paths).toBeGreaterThan(PATH_CACHE_BYTES / 2);
	});

	test("keys paths by value, level and style", () => {
		const a = qrSymbol("https://example.com/memo", "Q");
		expect(qrSymbol("https://example.com/memo", "Q").d).toBe(a.d);
		expect(qrSymbol("https://example.com/memo", "L").d).not.toBe(a.d);
		expect(
			qrSymbol("https://example.com/memo", "Q", {
				...DEFAULT_QR_STYLE,
				moduleShape: "dot",
			}).d,
		).not.toBe(a.d);
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
