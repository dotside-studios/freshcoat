import {
	FORMAT_VERSION,
	type Template,
	validate,
} from "@freshcoat-js/coatfile";
import { describe, expect, it, vi } from "vitest";
import {
	bindableProperties,
	buildFieldMeta,
	fieldMetaToSchema,
	formatsForProperty,
	inferNodeBinding,
	MARKER_KINDS,
	markerName,
	NAME_MARKED_PROPERTIES,
	parseMarker,
	storedToNodeBinding,
} from "~/lib/figma/binding";
import { reconcileFields } from "~/lib/figma/harvest";
import {
	isBarcodeLayerName,
	parseBarcodeLayerName,
	resolveSymbology,
} from "~/lib/figma/transpiler/barcode-name";
import { classify } from "~/lib/figma/transpiler/classify";
import { transpile } from "~/lib/figma/transpiler/index";
import type {
	FigmaContainerNode,
	FigmaNode,
	FigmaRectangleNode,
} from "~/lib/figma/types";

function layer(
	name: string,
	extra: Partial<FigmaRectangleNode> = {},
): FigmaRectangleNode {
	return {
		id: "5:1",
		name,
		type: "RECTANGLE",
		visible: true,
		opacity: 1,
		blendMode: "NORMAL",
		absoluteBoundingBox: { x: 100, y: 200, width: 300, height: 90 },
		fills: [{ type: "SOLID", color: { r: 0.2, g: 0.2, b: 0.4, a: 1 } }],
		...extra,
	};
}

async function run(...children: FigmaNode[]) {
	const frame: FigmaContainerNode = {
		id: "f:1",
		name: "Front",
		type: "FRAME",
		visible: true,
		opacity: 1,
		blendMode: "NORMAL",
		absoluteBoundingBox: { x: 0, y: 0, width: 1000, height: 600 },
		children,
		fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
	};
	const result = await transpile({
		product: {
			sku: "custom",
			displayName: "Custom",
			width: 1000,
			height: 600,
			frames: [{ name: "front", label: "Front", required: true }],
		},
		sizeMode: "from-design",
		picks: {
			front: {
				fileKey: "FK",
				nodeId: "f:1",
				nodeName: "Front",
				width: 1000,
				height: 600,
			},
		},
		metadata: {
			id: "t",
			name: "T",
			version: "1.0.0",
			formatVersion: FORMAT_VERSION,
		},
		fetchNodeTree: vi.fn(async () => frame),
		renderImage: vi.fn(),
	});
	const template = result.template as Template;
	return {
		template,
		elements: template.template_data[0].elements as Array<
			Record<string, unknown> & { properties: Record<string, unknown> }
		>,
		fields: template.fields,
		warnings: result.warnings,
	};
}

describe("barcode symbologies", () => {
	it("read with case, spaces, hyphens and underscores ignored, and by alias", () => {
		for (const [name, symbology] of [
			["Code-128", "code128"],
			["EAN_13", "ean13"],
			["data matrix", "datamatrix"],
			["UPC-A", "upca"],
			["azteccode", "aztec"],
			["PDF417", "pdf417"],
		]) {
			expect(resolveSymbology(name)).toEqual({ ok: true, symbology });
		}
	});

	it("refuses qr, pointing at the qr: marker", () => {
		const r = resolveSymbology("QR");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.message).toContain("qr:{{id}}");
	});

	it("refuses an unknown name, listing the ones it knows", () => {
		const r = resolveSymbology("code93");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.message).toContain("code128, ean13");
	});
});

describe("parseBarcodeLayerName", () => {
	it("barcode:{{id}} is Code 128, bound to the field", () => {
		expect(parseBarcodeLayerName("barcode:{{member_id}}")).toEqual({
			symbology: "code128",
			value: "{{member_id}}",
			mode: "token",
			ids: ["member_id"],
			options: {},
		});
	});

	it("barcode:<symbology>:{{id}} names the symbology", () => {
		expect(parseBarcodeLayerName("barcode:EAN-13:{{ sku }}")).toMatchObject({
			symbology: "ean13",
			value: "{{sku}}",
			mode: "token",
		});
	});

	it("a literal value binds nothing", () => {
		expect(parseBarcodeLayerName("barcode:ean13:5901234123457")).toEqual({
			symbology: "ean13",
			value: "5901234123457",
			mode: "literal",
			ids: [],
			options: {},
		});
	});

	it("a quoted template may carry fields, colons and semicolons", () => {
		expect(
			parseBarcodeLayerName('barcode:code39:"ID:{{a}};{{b}}";text=0'),
		).toMatchObject({
			symbology: "code39",
			value: "ID:{{a}};{{b}}",
			mode: "template",
			ids: ["a", "b"],
			options: { showText: false },
		});
	});

	it("reads text, fg, bg, margin and ec after ;", () => {
		expect(
			parseBarcodeLayerName(
				"barcode:pdf417:{{x}};text=1;fg=#112233;bg=#ffffff;margin=4;ec=5",
			)?.options,
		).toEqual({
			showText: true,
			foreground: "#112233",
			background: "#ffffff",
			quietZone: 4,
			errorCorrection: 5,
		});
	});

	it("reports an unknown symbology", () => {
		const parsed = parseBarcodeLayerName("barcode:code93:{{x}}");
		expect(parsed?.symbology).toBeNull();
		expect(parsed?.problem).toContain('"code93" is not a barcode type');
	});

	it("reports a symbology with no value", () => {
		expect(parseBarcodeLayerName("barcode:ean13")).toMatchObject({
			symbology: "ean13",
			value: "",
			problem: "The layer name has no value",
		});
	});

	it("is null for any other name", () => {
		expect(parseBarcodeLayerName("qr:{{x}}")).toBeNull();
		expect(parseBarcodeLayerName("Barcode")).toBeNull();
		expect(isBarcodeLayerName("barcode:")).toBe(false);
	});
});

describe("classify (barcode)", () => {
	it("marks any layer named barcode:, before its paint or effects are read", () => {
		expect(classify(layer("barcode:{{x}}"))).toEqual({
			kind: "native-barcode",
		});
		expect(
			classify(
				layer("barcode:{{x}}", {
					blendMode: "LINEAR_BURN",
					effects: [{ type: "BACKGROUND_BLUR", visible: true, radius: 3 }],
				}),
			),
		).toEqual({ kind: "native-barcode" });
		expect(
			classify({
				...layer("barcode:{{x}}"),
				type: "VECTOR",
				fillGeometry: [],
			} as FigmaNode),
		).toEqual({ kind: "native-barcode" });
	});
});

describe("transpile (barcode)", () => {
	it("emits a barcode element in the layer's box, drawn in its fill", async () => {
		const { elements, fields, warnings } = await run(
			layer("barcode:{{member_id}}"),
		);
		expect(warnings).toEqual([]);
		expect(elements).toEqual([
			{
				id: "member_id",
				type: "barcode",
				pos: { x: 100, y: 200 },
				size: { width: 300, height: 90 },
				properties: {
					value: "{{member_id}}",
					symbology: "code128",
					foreground: "#333366",
				},
			},
		]);
		// Inferred as text, entered as a barcode.
		expect(fields.properties.member_id).toEqual({
			type: "string",
			title: "Member Id",
			"x-widget": "barcode",
		});
		expect(fields.required).toEqual(["member_id"]);
	});

	it("carries the marker's options onto the element", async () => {
		const { elements } = await run(
			layer("barcode:pdf417:{{x}};text=0;fg=#000000;bg=#ffffff;margin=2;ec=4"),
		);
		expect(elements[0].properties).toEqual({
			value: "{{x}}",
			symbology: "pdf417",
			foreground: "#000000",
			background: "#ffffff",
			showText: false,
			quietZone: 2,
			errorCorrection: 4,
		});
	});

	it("leaves ec off a symbology that has no error correction to set", async () => {
		const { elements } = await run(layer("barcode:code128:{{x}};ec=4"));
		expect(elements[0].properties.errorCorrection).toBeUndefined();
	});

	it("falls back to black when the layer has no single solid fill", async () => {
		const { elements } = await run(layer("barcode:{{x}}", { fills: [] }));
		expect(elements[0].properties.foreground).toBe("#000000");
	});

	it("a valid literal exports as is, and asks for no field", async () => {
		const { elements, fields, warnings } = await run(
			layer("barcode:ean13:5901234123457"),
		);
		expect(warnings).toEqual([]);
		expect(elements[0]).toMatchObject({
			id: "5_1",
			properties: { value: "5901234123457", symbology: "ean13" },
		});
		expect(fields.properties).toEqual({});
	});

	it("an invalid literal warns with the encoder's message and keeps its value", async () => {
		const { elements, warnings } = await run(
			layer("barcode:ean13:5901234123458"),
		);
		expect(warnings).toEqual([
			{
				severity: "error",
				code: "barcode_invalid_value",
				message:
					'Barcode layer "barcode:ean13:5901234123458": EAN-13 check digit should be 7',
				nodeId: "5:1",
			},
		]);
		expect(elements[0].properties.value).toBe("5901234123458");
	});

	it("an unknown symbology warns and exports a placeholder with no field", async () => {
		const { elements, fields, warnings } = await run(
			layer("barcode:code93:{{x}}"),
		);
		expect(warnings).toMatchObject([
			{
				severity: "error",
				code: "barcode_unknown_symbology",
				nodeId: "5:1",
			},
		]);
		expect(warnings[0].message).toContain('"code93" is not a barcode type');
		expect(elements[0].properties).toMatchObject({
			value: "",
			symbology: "code128",
		});
		expect(fields.properties).toEqual({});
	});

	it("warns when a barcode layer is hidden", async () => {
		const { elements, warnings } = await run(
			layer("barcode:{{x}}", { visible: false }),
		);
		expect(elements).toEqual([]);
		expect(warnings).toMatchObject([
			{ severity: "warn", code: "barcode_layer_hidden", nodeId: "5:1" },
		]);
	});

	it("the template validates", async () => {
		const { template } = await run(
			layer("barcode:ean13:{{sku}};text=1"),
			layer("barcode:aztec:{{ticket}};ec=33", { id: "5:2" }),
		);
		const result = validate(template);
		expect(result.ok, JSON.stringify(!result.ok && result.errors)).toBe(true);
	});

	it("keeps x-widget barcode over stored field metadata written without it", async () => {
		const frame: FigmaContainerNode = {
			id: "f:1",
			name: "Front",
			type: "FRAME",
			absoluteBoundingBox: { x: 0, y: 0, width: 1000, height: 600 },
			children: [layer("barcode:{{x}}")],
			fieldMeta: {
				x: {
					id: "x",
					format: "text",
					title: "Card number",
					required: true,
					source: "user",
				},
			},
		};
		const result = await transpile({
			product: {
				sku: "custom",
				displayName: "Custom",
				width: 1000,
				height: 600,
				frames: [{ name: "front", label: "Front", required: true }],
			},
			sizeMode: "from-design",
			picks: {
				front: {
					fileKey: "FK",
					nodeId: "f:1",
					nodeName: "Front",
					width: 1000,
					height: 600,
				},
			},
			metadata: { id: "t", name: "T", version: "1", formatVersion: "1.3" },
			fetchNodeTree: vi.fn(async () => frame),
			renderImage: vi.fn(),
		});
		expect((result.template as Template).fields.properties.x).toEqual({
			type: "string",
			title: "Card number",
			"x-widget": "barcode",
		});
	});
});

describe("barcode bindings", () => {
	it("inferNodeBinding binds the barcode property to the field", () => {
		expect(inferNodeBinding(layer("barcode:ean13:{{sku}}"))).toEqual({
			bind: { barcode: "{{sku}}" },
			fields: [{ id: "sku", format: "text", widget: "barcode" }],
			symbology: "ean13",
		});
	});

	it("a literal barcode binds nothing", () => {
		expect(inferNodeBinding(layer("barcode:ean13:5901234123457"))).toBeNull();
		expect(parseMarker("barcode:ean13:5901234123457")).toBeNull();
	});

	it("parseMarker reads the symbology into opts", () => {
		expect(parseMarker("barcode:upca:{{code}}")).toEqual({
			kind: "barcode",
			value: { mode: "token", id: "code" },
			opts: { symbology: "upca" },
		});
	});

	it("a stored barcode binding carries the widget to its field", () => {
		expect(storedToNodeBinding({ bind: { barcode: "{{a}}" } }).fields).toEqual([
			{ id: "a", format: "text", widget: "barcode" },
		]);
	});

	it("lowers to a text field with x-widget barcode", () => {
		expect(
			fieldMetaToSchema(
				buildFieldMeta({ id: "a", format: "text", widget: "barcode" }),
			),
		).toEqual({ type: "string", title: "A", "x-widget": "barcode" });
	});

	it("harvest refreshes the widget on a field it did not know was a barcode", () => {
		const { meta } = reconcileFields(
			{ a: buildFieldMeta({ id: "a", format: "text" }) },
			[{ id: "a", format: "text", widget: "barcode" }],
		);
		expect(meta.a.widget).toBe("barcode");
	});

	it("is offered wherever a QR is", () => {
		const props = (n: FigmaNode) =>
			bindableProperties(n).map((t) => t.property);
		expect(props(layer("Box"))).toContain("barcode");
		expect(
			props({ ...layer("Frame"), type: "FRAME", children: [] } as FigmaNode),
		).toContain("barcode");
	});

	it("exports what the Layer tab needs to offer and mark one", () => {
		expect(MARKER_KINDS).toContain("barcode");
		expect(NAME_MARKED_PROPERTIES.has("barcode")).toBe(true);
		expect(formatsForProperty("barcode")).toEqual(["text"]);
		expect(markerName("barcode", "sku")).toBe("barcode:{{sku}}");
		expect(markerName("barcode", "sku", { symbology: "code128" })).toBe(
			"barcode:{{sku}}",
		);
		expect(markerName("barcode", "sku", { symbology: "ean13" })).toBe(
			"barcode:ean13:{{sku}}",
		);
		expect(markerName("qr", "url")).toBe("qr:{{url}}");
		// The name it writes reads back as the same binding.
		expect(
			inferNodeBinding(
				layer(markerName("barcode", "sku", { symbology: "itf14" })),
			)?.bind,
		).toEqual({ barcode: "{{sku}}" });
	});
});
