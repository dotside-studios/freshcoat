// The barcode element: the bwip-js encoder, how compile lays a code out, and
// proof that what renders scans. Every symbology is decoded back with ZXing from
// CanvasKit's pixels, so a module lost anywhere between bwip-js and the painter
// fails here rather than at a till.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { planScene } from "@freshcoat-js/for-print";
import { type BitmapNode, createRenderer, decodePixels, type Node } from "@freshcoat-js/engine";
import {
	AztecCodeReader,
	BarcodeFormat,
	BinaryBitmap,
	DataMatrixReader,
	DecodeHintType,
	HybridBinarizer,
	MultiFormatOneDReader,
	PDF417Reader,
	RGBLuminanceSource,
} from "@zxing/library";
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test } from "vitest";
import { bwipBarcodeEncoder } from "../src/barcode";
import type { BarcodeEncoder } from "../src/barcode-encoder";
import { compile } from "../src/compile";
import { resizeTemplate } from "../src/constraints";
import { collectFontRequests } from "../src/fonts";
import { renderCompiled, renderTemplate } from "../src/render";
import type {
	BarcodeProperties,
	Element,
	Symbology,
	Template,
} from "../src/types";
import { validate } from "../src/validate";

// biome-ignore lint/suspicious/noExplicitAny: ck is the untyped WASM instance
let ck: any;
beforeAll(async () => {
	ck = await loadCanvasKit();
});

type Box = { x: number; y: number; width: number; height: number };

function barcodeTemplate(
	properties: Partial<BarcodeProperties> & { symbology: Symbology },
	box: Box = { x: 20, y: 20, width: 360, height: 120 },
	card: { width: number; height: number } = { width: 400, height: 160 },
	extra: Partial<Element> = {},
): Template {
	return {
		format_version: "1.3",
		version: "1.0.0",
		id: "barcode",
		name: "Barcode",
		product: "test",
		width: card.width,
		height: card.height,
		fields: { type: "object", properties: { code: { type: "string" } } },
		template_data: [
			{
				name: "front",
				background: {
					id: "bg",
					type: "rect",
					properties: { fill: "#ffffff" },
				},
				elements: [
					{
						id: "code",
						type: "barcode",
						pos: { x: box.x, y: box.y },
						size: { width: box.width, height: box.height },
						properties: { value: "{{code}}", ...properties },
						...extra,
					} as Element,
				],
			},
		],
	} as Template;
}

// The barcode element's group, as compile emits it.
function compiledGroup(
	tpl: Template,
	values: Record<string, unknown>,
	barcodeEncoder: BarcodeEncoder | null = bwipBarcodeEncoder,
) {
	const compiled = compile(tpl, values, {
		width: tpl.width,
		height: tpl.height,
		...(barcodeEncoder ? { barcodeEncoder } : {}),
	});
	const [frame] = compiled.frames;
	const group = frame.root.children[1];
	if (group.kind !== "group") throw new Error("expected a group");
	return { frame, group };
}

function findBitmap(node: Node): BitmapNode | undefined {
	if (node.kind === "bitmap") return node;
	if (node.kind === "group") {
		for (const child of node.children) {
			const hit = findBitmap(child);
			if (hit) return hit;
		}
	}
	return undefined;
}

async function paint(
	tpl: Template,
	values: Record<string, unknown>,
	scale = 1,
	supersample = 1,
) {
	const [frame] = (await renderTemplate(
		await createRenderer({ ck, cache: false }),
		tpl,
		values,
		{
			width: tpl.width,
			height: tpl.height,
			exports: [
				{
					constraint: { kind: "scale", value: scale },
					...(supersample > 1 ? { supersample } : {}),
				},
			],
		},
	));
	const pixels = decodePixels(ck, frame.bytes);
	if (!pixels) throw new Error("decode failed");
	return { frame, pixels };
}

const ZXING_FORMAT: Record<Symbology, BarcodeFormat> = {
	code128: BarcodeFormat.CODE_128,
	ean13: BarcodeFormat.EAN_13,
	upca: BarcodeFormat.UPC_A,
	code39: BarcodeFormat.CODE_39,
	itf14: BarcodeFormat.ITF,
	pdf417: BarcodeFormat.PDF_417,
	datamatrix: BarcodeFormat.DATA_MATRIX,
	aztec: BarcodeFormat.AZTEC,
};

function scan(
	pixels: { data: Uint8Array | Uint8ClampedArray; width: number; height: number },
	symbology: Symbology,
): string {
	const { data, width, height } = pixels;
	const luminance = new Uint8ClampedArray(width * height);
	for (let i = 0; i < width * height; i++) {
		const a = data[i * 4 + 3] / 255;
		const over = (c: number) => c * a + 255 * (1 - a);
		luminance[i] =
			(over(data[i * 4]) * 299 +
				over(data[i * 4 + 1]) * 587 +
				over(data[i * 4 + 2]) * 114) /
			1000;
	}
	const source = new RGBLuminanceSource(
		luminance,
		width,
		height,
		width,
		height,
		0,
		0,
	);
	const hints = new Map<DecodeHintType, unknown>([
		[DecodeHintType.POSSIBLE_FORMATS, [ZXING_FORMAT[symbology]]],
	]);
	// One reader per kind, rather than MultiFormatReader, so a miss is this
	// symbology's miss and not the last of every reader's.
	const reader =
		symbology === "pdf417"
			? new PDF417Reader()
			: symbology === "datamatrix"
				? new DataMatrixReader()
				: symbology === "aztec"
					? new AztecCodeReader()
					: new MultiFormatOneDReader(hints);
	return reader
		.decode(new BinaryBitmap(new HybridBinarizer(source)), hints)
		.getText();
}

describe("bwipBarcodeEncoder", () => {
	test("encodes a 1D code as its modules, without the quiet zone", () => {
		const result = bwipBarcodeEncoder("code128", "LC 0001", {});
		if (!result.ok) throw new Error(result.message);
		expect(result.encoding.kind).toBe("linear");
		if (result.encoding.kind !== "linear") return;
		// Start B, 6 symbols, check, then the 13-module stop.
		expect(result.encoding.modules.length).toBe(101);
		expect(result.encoding.modules[0]).toBe(true);
		expect(result.encoding.modules.at(-1)).toBe(true);
		expect(result.encoding.text).toBe("LC 0001");
	});

	test("encodes a 2D code as rows of modules", () => {
		const result = bwipBarcodeEncoder("datamatrix", "hello", {});
		if (!result.ok || result.encoding.kind !== "matrix") throw new Error();
		const { rows } = result.encoding;
		expect(rows.length).toBe(12);
		expect(rows.every((r) => r.length === 12)).toBe(true);
		// The finder: a solid left column and bottom row, an alternating top.
		expect(rows.every((r) => r[0])).toBe(true);
		expect(rows[11].every(Boolean)).toBe(true);
		expect(rows[0].map((m) => (m ? 1 : 0)).join("")).toBe("101010101010");
	});

	test("adds a missing GS1 check digit, and keeps it in the text", () => {
		const cases: Array<[Symbology, string, string]> = [
			["ean13", "590123412345", "5901234123457"],
			["upca", "03600029145", "036000291452"],
			["itf14", "1234567890123", "12345678901231"],
		];
		for (const [symbology, value, text] of cases) {
			const result = bwipBarcodeEncoder(symbology, value, {});
			if (!result.ok || result.encoding.kind !== "linear")
				throw new Error(symbology);
			expect(result.encoding.text).toBe(text);
			const full = bwipBarcodeEncoder(symbology, text, {});
			expect(full).toEqual(result);
		}
	});

	test("refuses a wrong check digit, naming the right one", () => {
		expect(bwipBarcodeEncoder("ean13", "5901234123458", {})).toEqual({
			ok: false,
			message: "EAN-13 check digit should be 7",
		});
		expect(bwipBarcodeEncoder("upca", "036000291453", {})).toEqual({
			ok: false,
			message: "UPC-A check digit should be 2",
		});
		expect(bwipBarcodeEncoder("itf14", "12345678901234", {})).toEqual({
			ok: false,
			message: "ITF-14 check digit should be 1",
		});
	});

	test("uppercases Code 39", () => {
		const result = bwipBarcodeEncoder("code39", "abc-123", {});
		if (!result.ok || result.encoding.kind !== "linear") throw new Error();
		expect(result.encoding.text).toBe("ABC-123");
	});

	test("each 1D code refuses what it can't carry, in words", () => {
		const cases: Array<[Symbology, string, string]> = [
			["ean13", "12a", "EAN-13 must be 12 or 13 digits"],
			["ean13", "123", "EAN-13 must be 12 or 13 digits"],
			["upca", "1", "UPC-A must be 11 or 12 digits"],
			["itf14", "12", "ITF-14 must be 13 or 14 digits"],
			[
				"code39",
				"a_b",
				"Code 39 must contain only digits, capital letters, spaces and the symbols -.$/+%",
			],
			[
				"code128",
				"日本",
				"Code 128 must contain only ASCII and Latin-1 characters",
			],
		];
		for (const [symbology, value, message] of cases) {
			const result = bwipBarcodeEncoder(symbology, value, {});
			expect(result).toEqual({ ok: false, message });
			// No bwipp.xxx#nnnn prefix reaches a person.
			if (!result.ok) expect(result.message).not.toMatch(/bwipp|#\d/);
		}
	});

	test("error correction changes the symbol where it applies", () => {
		const size = (ec: number | undefined) => {
			const result = bwipBarcodeEncoder("pdf417", "hello world", {
				errorCorrection: ec,
			});
			if (!result.ok || result.encoding.kind !== "matrix") throw new Error();
			return result.encoding.rows.length * result.encoding.rows[0].length;
		};
		expect(size(8)).toBeGreaterThan(size(0));
	});
});

describe("decode round trip", () => {
	const cases: Array<{
		symbology: Symbology;
		value: string;
		decoded?: string;
		box?: Box;
		card?: { width: number; height: number };
	}> = [
		{ symbology: "code128", value: "FRESHCOAT-0042" },
		{
			symbology: "code128",
			value: "https://davi.social/t/9f2c7a1e-44b0-4d8e-a3f1-2b6c9e0d7f15",
			box: { x: 20, y: 20, width: 760, height: 120 },
			card: { width: 800, height: 160 },
		},
		{ symbology: "ean13", value: "590123412345", decoded: "5901234123457" },
		{ symbology: "upca", value: "036000291452" },
		{ symbology: "code39", value: "davi-39", decoded: "DAVI-39" },
		{ symbology: "itf14", value: "1234567890123", decoded: "12345678901231" },
		{
			symbology: "pdf417",
			value: "Freshcoat PDF417 ".repeat(12).slice(0, 200),
			box: { x: 20, y: 20, width: 560, height: 280 },
			card: { width: 600, height: 320 },
		},
		{
			symbology: "datamatrix",
			value: "DM-0001 Davi",
			box: { x: 20, y: 20, width: 120, height: 120 },
			card: { width: 160, height: 160 },
		},
		{
			symbology: "aztec",
			value: "Aztec 0001",
			box: { x: 20, y: 20, width: 120, height: 120 },
			card: { width: 160, height: 160 },
		},
	];
	for (const { symbology, value, decoded, box, card } of cases) {
		test(`${symbology}: ${value.length > 30 ? `${value.length} characters` : value}`, async () => {
			const tpl = barcodeTemplate(
				{ symbology, showText: false },
				box,
				card,
			);
			const { frame, pixels } = await paint(tpl, { code: value }, 3);
			expect(frame.warnings).toEqual([]);
			expect(scan(pixels, symbology)).toBe(decoded ?? value);
		});
	}

	for (const bearerBars of ["frame", "horizontal"] as const) {
		test(`itf14 with ${bearerBars} bearer bars`, async () => {
			const tpl = barcodeTemplate({ symbology: "itf14", bearerBars });
			const { frame, pixels } = await paint(tpl, { code: "1234567890123" }, 3);
			expect(frame.warnings).toEqual([]);
			expect(scan(pixels, "itf14")).toBe("12345678901231");
		});
	}

	test("a 1D code still scans with its text line under it", async () => {
		const tpl = barcodeTemplate({ symbology: "ean13" });
		const { pixels } = await paint(tpl, { code: "590123412345" }, 3);
		expect(scan(pixels, "ean13")).toBe("5901234123457");
	});
});

describe("compile", () => {
	test("keeps the quiet zone inside the box", () => {
		// LC 0001 is 101 modules; 10 each side makes 121 across 363 px, so 3 px a
		// module and 30 px of quiet zone.
		const tpl = barcodeTemplate(
			{ symbology: "code128", showText: false },
			{ x: 0, y: 0, width: 363, height: 100 },
		);
		const { group } = compiledGroup(tpl, { code: "LC 0001" });
		const bitmap = findBitmap(group);
		expect(bitmap?.pos).toEqual({ x: 30, y: 0 });
		expect(bitmap?.size).toEqual({ width: 303, height: 100 });
		expect(bitmap?.pixelWidth).toBe(101);
		expect(bitmap?.pixelHeight).toBe(1);
		expect(bitmap?.role).toBe("barcode");

		const wider = barcodeTemplate(
			{ symbology: "code128", showText: false, quietZone: 0 },
			{ x: 0, y: 0, width: 363, height: 100 },
		);
		const zero = findBitmap(compiledGroup(wider, { code: "LC 0001" }).group);
		expect(zero?.pos?.x).toBe(0);
		expect(zero?.size?.width).toBe(363);
	});

	test("1D bars fill the height the text line leaves", () => {
		const tpl = barcodeTemplate(
			{ symbology: "code128", textSize: 20 },
			{ x: 0, y: 0, width: 360, height: 120 },
		);
		const { group } = compiledGroup(tpl, { code: "ABC" });
		const bitmap = findBitmap(group);
		const text = group.children.find((c) => c.kind === "text");
		expect(text).toMatchObject({
			kind: "text",
			text: "ABC",
			align: "center",
			font: { size: 20 },
		});
		if (!bitmap?.size || !text?.pos) throw new Error();
		expect(bitmap.size.height).toBeCloseTo(120 - 20 * 1.2 - 20 * 0.15);
		expect(text.pos.y).toBeCloseTo(bitmap.size.height + 3);
	});

	test("2D codes keep square modules, centred in the box", () => {
		// A 12x12 Data Matrix with its 1-module quiet zone is 14 modules: 10 px
		// each in a 140 px square, centred in a 300 px wide box.
		const tpl = barcodeTemplate(
			{ symbology: "datamatrix" },
			{ x: 0, y: 0, width: 300, height: 140 },
		);
		const bitmap = findBitmap(compiledGroup(tpl, { code: "hello" }).group);
		expect(bitmap?.size).toEqual({ width: 120, height: 120 });
		expect(bitmap?.pos).toEqual({ x: 90, y: 10 });
	});

	test("ITF-14's bearer frame sits outside the quiet zone, 5 modules thick", () => {
		// 135 modules, 10 of quiet zone and 5 of bearer each side: 165 modules
		// across 330 px, so 2 px a module and a 10 px bar.
		const tpl = barcodeTemplate(
			{ symbology: "itf14", showText: false, bearerBars: "frame" },
			{ x: 0, y: 0, width: 330, height: 100 },
		);
		const { group } = compiledGroup(tpl, { code: "1234567890123" });
		const bitmap = findBitmap(group);
		expect(bitmap?.pos).toEqual({ x: 30, y: 10 });
		expect(bitmap?.size).toEqual({ width: 270, height: 80 });
		const bars = group.children
			.filter((c) => c.kind === "rect")
			.map((c) => ({ ...c.pos, ...c.size }));
		expect(bars).toEqual([
			{ x: 0, y: 0, width: 330, height: 10 },
			{ x: 0, y: 90, width: 330, height: 10 },
			{ x: 0, y: 10, width: 10, height: 80 },
			{ x: 320, y: 10, width: 10, height: 80 },
		]);
	});

	test("horizontal bearer bars span the quiet zone above and below", () => {
		const tpl = barcodeTemplate(
			{ symbology: "itf14", showText: false, bearerBars: "horizontal" },
			{ x: 0, y: 0, width: 310, height: 100 },
		);
		const { group } = compiledGroup(tpl, { code: "1234567890123" });
		const bitmap = findBitmap(group);
		expect(bitmap?.pos).toEqual({ x: 20, y: 10 });
		expect(bitmap?.size).toEqual({ width: 270, height: 80 });
		const bars = group.children
			.filter((c) => c.kind === "rect")
			.map((c) => ({ ...c.pos, ...c.size }));
		expect(bars).toEqual([
			{ x: 0, y: 0, width: 310, height: 10 },
			{ x: 0, y: 90, width: 310, height: 10 },
		]);
	});

	test("bearer bars apply to ITF-14 only", () => {
		const tpl = barcodeTemplate(
			{ symbology: "code128", showText: false, bearerBars: "frame" },
			{ x: 0, y: 0, width: 363, height: 100 },
		);
		const { group } = compiledGroup(tpl, { code: "LC 0001" });
		expect(group.children.some((c) => c.kind === "rect")).toBe(false);
		expect(findBitmap(group)?.pos).toEqual({ x: 30, y: 0 });
	});

	test("draws the background behind the quiet zone", () => {
		const tpl = barcodeTemplate({
			symbology: "code128",
			background: "#fafafa",
			foreground: "#123456",
		});
		const { group } = compiledGroup(tpl, { code: "ABC" });
		expect(group.children[0]).toMatchObject({
			kind: "rect",
			pos: { x: 0, y: 0 },
			size: { width: 360, height: 120 },
			fills: [{ kind: "solid", color: "#fafafa" }],
		});
		const bitmap = findBitmap(group);
		if (!bitmap) throw new Error();
		const set = [...bitmap.pixels].slice(0, 4);
		expect(set).toEqual([0x12, 0x34, 0x56, 255]);
	});

	test("the text line uses the template's first font, and requests it", () => {
		const tpl = {
			...barcodeTemplate({ symbology: "code128" }),
			fonts: [
				{
					family: "Vend Sans",
					kind: "google",
					url: "https://fonts.googleapis.com/css2?family=Vend+Sans",
				},
			],
		} as Template;
		expect(validate(tpl).ok).toBe(true);
		const { frame, group } = compiledGroup(tpl, { code: "ABC" });
		const text = group.children.find((c) => c.kind === "text");
		expect(text).toMatchObject({ font: { family: "Vend Sans" } });
		expect(frame.assets.fonts.map((f) => f.family)).toEqual(["Vend Sans"]);
		expect(collectFontRequests(tpl).map((f) => f.family)).toEqual([
			"Vend Sans",
		]);
	});
});

describe("placeholders", () => {
	const hasHatch = (node: Node): boolean =>
		node.kind === "path" ||
		(node.kind === "group" && node.children.some(hasHatch));

	test("with no encoder: a labelled hatch, and barcode_unavailable", async () => {
		const tpl = barcodeTemplate({ symbology: "ean13" });
		const { frame, group } = compiledGroup(
			tpl,
			{ code: "590123412345" },
			null,
		);
		expect(findBitmap(group)).toBeUndefined();
		expect(hasHatch(group)).toBe(true);
		expect(JSON.stringify(group)).toContain('"text":"EAN-13"');
		expect(frame.warnings).toEqual([
			{ kind: "barcode_unavailable", symbology: "ean13", layer: "code" },
		]);
		// renderCompiled() hands the warning on with the painter's own.
		const [painted] = await renderCompiled(
			await createRenderer({ ck, cache: false }),
			compile(tpl, { code: "590123412345" }, { width: tpl.width, height: tpl.height }),
		);
		expect(painted?.warnings).toContainEqual({
			kind: "barcode_unavailable",
			symbology: "ean13",
			layer: "code",
		});
	});

	test("renderTemplate() loads the encoder when the template draws a barcode", async () => {
		const tpl = barcodeTemplate({ symbology: "ean13" });
		const { frame } = await paint(tpl, { code: "590123412345" });
		expect(frame.warnings).toEqual([]);
	});

	test("renderTemplate() draws placeholders when the encoder is null", async () => {
		const tpl = barcodeTemplate({ symbology: "ean13" });
		const [frame] = await renderTemplate(
			await createRenderer({ ck, cache: false }),
			tpl,
			{ code: "590123412345" },
			{ barcodeEncoder: null },
		);
		expect(frame?.warnings).toContainEqual({
			kind: "barcode_unavailable",
			symbology: "ean13",
			layer: "code",
		});
	});

	test("renderTemplate() encodes with the encoder it is given", async () => {
		const seen: string[] = [];
		const spy: BarcodeEncoder = (symbology, value, opts) => {
			seen.push(value);
			return bwipBarcodeEncoder(symbology, value, opts);
		};
		await renderTemplate(
			await createRenderer({ ck, cache: false }),
			barcodeTemplate({ symbology: "ean13" }),
			{ code: "590123412345" },
			{ barcodeEncoder: spy },
		);
		expect(seen).toEqual(["590123412345"]);
	});

	test("with an invalid value: a placeholder, and the encoder's message", () => {
		const tpl = barcodeTemplate({ symbology: "ean13" });
		const { frame, group } = compiledGroup(tpl, { code: "5901234123458" });
		expect(findBitmap(group)).toBeUndefined();
		expect(hasHatch(group)).toBe(true);
		expect(frame.warnings).toEqual([
			{
				kind: "barcode_invalid",
				symbology: "ean13",
				value: "5901234123458",
				message: "EAN-13 check digit should be 7",
				layer: "code",
			},
		]);
	});

	test("the label reads at the card's zoom and fits across the box", () => {
		const label = (symbology: Symbology, box: Box) => {
			const { group } = compiledGroup(
				barcodeTemplate({ symbology }, box, { width: 800, height: 400 }),
				{ code: "x" },
				null,
			);
			const find = (node: Node): Node | undefined =>
				node.kind === "text"
					? node
					: node.kind === "group"
						? node.children.map(find).find(Boolean)
						: undefined;
			const text = find(group);
			if (text?.kind !== "text") throw new Error("no label");
			return text.font.size;
		};
		// A fifth of the height in a wide box.
		expect(label("ean13", { x: 0, y: 0, width: 420, height: 150 })).toBe(30);
		// Narrowed so "Data Matrix" fits across a small square.
		expect(label("datamatrix", { x: 0, y: 0, width: 150, height: 150 })).toBe(
			150 / (11 * 0.75),
		);
		// Never under 8.
		expect(label("code128", { x: 0, y: 0, width: 40, height: 20 })).toBe(8);
	});

	test("with an empty value: the code's shape, faint, and no warning", () => {
		for (const encoder of [null, bwipBarcodeEncoder]) {
			const oneD = compiledGroup(
				barcodeTemplate({ symbology: "code128" }),
				{},
				encoder,
			);
			expect(oneD.frame.warnings).toBeUndefined();
			expect(findBitmap(oneD.group)).toBeUndefined();
			expect(hasHatch(oneD.group)).toBe(false);
			// The bar area and the text line.
			expect(oneD.group.children).toHaveLength(2);
			expect(oneD.group.children.every((c) => c.kind === "rect")).toBe(true);

			const square = compiledGroup(
				barcodeTemplate(
					{ symbology: "aztec" },
					{ x: 0, y: 0, width: 200, height: 100 },
				),
				{},
				encoder,
			);
			expect(square.group.children).toEqual([
				expect.objectContaining({
					kind: "rect",
					pos: { x: 50, y: 0 },
					size: { width: 100, height: 100 },
				}),
			]);
		}
	});
});

describe("crisp at export", () => {
	// One row across the bars: every pixel is a bar or the white card (a grey
	// one is an edge that fell between two pixels), and every bar and space is a
	// whole number of one module width (nearest-neighbour scaling never greys an
	// edge, but it draws a one-module bar two pixels wide here and three there).
	function barRow(
		pixels: { data: Uint8Array | Uint8ClampedArray; width: number },
		row: number,
	) {
		const values: number[] = [];
		for (let x = 0; x < pixels.width; x++) {
			values.push(pixels.data[(row * pixels.width + x) * 4]);
		}
		const partial = values.filter((v) => v !== 0 && v !== 255).length;
		const first = values.indexOf(0);
		const last = values.lastIndexOf(0);
		const runs: number[] = [];
		let run = 1;
		for (let x = first + 1; x <= last + 1; x++) {
			if (x <= last && values[x] === values[x - 1]) run++;
			else {
				runs.push(run);
				run = 1;
			}
		}
		return { partial, span: last - first + 1, runs };
	}

	const modules = (() => {
		const result = bwipBarcodeEncoder("code128", "FRESHCOAT", {});
		if (!result.ok || result.encoding.kind !== "linear") throw new Error();
		return result.encoding.modules.length;
	})();

	for (const { scale, supersample } of [
		{ scale: 1, supersample: 1 },
		{ scale: 3, supersample: 1 },
		{ scale: 1, supersample: 2 },
	]) {
		test(`Code 128 at ${scale}x${supersample > 1 ? `, supersampled ${supersample}x` : ""} lands on whole pixels`, async () => {
			// A fractional position and a width that is no whole number of
			// modules, so nothing lines up unless the painter snaps it.
			const tpl = barcodeTemplate(
				{ symbology: "code128", showText: false },
				{ x: 20.3, y: 20, width: 357.7, height: 120 },
			);
			const { pixels } = await paint(
				tpl,
				{ code: "FRESHCOAT" },
				scale,
				supersample,
			);
			const { partial, span, runs } = barRow(pixels, Math.round(80 * scale));
			expect(partial).toBe(0);
			const module = span / modules;
			expect(Number.isInteger(module)).toBe(true);
			expect(runs.filter((r) => r % module !== 0)).toEqual([]);
			// Floored, not rounded up: the code never outgrows its box.
			expect(module).toBe(Math.floor((357.7 * scale) / (modules + 20)));
			expect(scan(pixels, "code128")).toBe("FRESHCOAT");
		});
	}
});

describe("constraints", () => {
	const scaled = (symbology: Symbology) =>
		barcodeTemplate(
			{ symbology },
			{ x: 100, y: 20, width: 100, height: 100 },
			{ width: 400, height: 160 },
			{
				constraints: { horizontal: "scale", vertical: "scale" },
			} as Partial<Element>,
		);

	test("Data Matrix and Aztec stay square, as QR does", () => {
		for (const symbology of ["datamatrix", "aztec"] as const) {
			const out = resizeTemplate(scaled(symbology), 800, 160);
			const el = out.template_data[0].elements[0];
			expect(el.size).toEqual({ width: 100, height: 100 });
			// Centred where the stretched box would have been.
			expect(el.pos).toEqual({ x: 250, y: 20 });
		}
	});

	test("1D codes and PDF417 stretch like any box", () => {
		for (const symbology of ["code128", "pdf417"] as const) {
			const out = resizeTemplate(scaled(symbology), 800, 160);
			expect(out.template_data[0].elements[0].size).toEqual({
				width: 200,
				height: 100,
			});
		}
	});
});

describe("print-kit", () => {
	test("a barcode is code, and planning leaves it alone", () => {
		const tpl = barcodeTemplate({ symbology: "code128" });
		const { frame } = compiledGroup(tpl, { code: "ABC" });
		const planned = planScene(frame.root);
		const bitmap = findBitmap(planned);
		expect(bitmap).toBeDefined();
		expect(bitmap && "adjust" in bitmap ? bitmap.adjust : undefined).toBe(
			undefined,
		);
	});
});

describe("main entry", () => {
	test("does not bundle bwip-js", async () => {
		const entry = join(
			fileURLToPath(new URL(".", import.meta.url)),
			"..",
			"src",
			"index.ts",
		);
		const result = await Bun.build({ entrypoints: [entry], target: "browser" });
		expect(result.success).toBe(true);
		const code = await result.outputs[0].text();
		// Make sure the bundle really holds the kit, so an empty build can't pass.
		expect(code).toContain("isLinearSymbology");
		expect(code).not.toMatch(/bwipp|bwip-js|BWIPP_VERSION/);
	}, 30_000);
});
