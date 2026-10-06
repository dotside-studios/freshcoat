import { describe, expect, it } from "vitest";
import {
	bindableProperties,
	buildFieldMeta,
	createBindingResolver,
	inferNodeBinding,
	parseMarker,
	parseValue,
	resolveNodeBinding,
} from "~/lib/figma/binding";
import type {
	FigmaImagePaint,
	FigmaRectangleNode,
	FigmaTextNode,
	FigmaVectorNode,
} from "~/lib/figma/types";

const bbox = { x: 0, y: 0, width: 10, height: 10 };

function textNode(name: string, characters = "Sample"): FigmaTextNode {
	return {
		id: "t1",
		name,
		type: "TEXT",
		characters,
		absoluteBoundingBox: bbox,
		style: {
			fontFamily: "Inter",
			fontSize: 16,
			fontWeight: 400,
			textAlignHorizontal: "LEFT",
			textAlignVertical: "TOP",
		},
		fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
	};
}

const IMAGE_FILL: FigmaImagePaint = {
	type: "IMAGE",
	scaleMode: "FILL",
	imageRef: "abc",
};

function rectNode(
	name: string,
	fills: FigmaRectangleNode["fills"],
): FigmaRectangleNode {
	return {
		id: "r1",
		name,
		type: "RECTANGLE",
		absoluteBoundingBox: bbox,
		fills,
	};
}

function shapeNode(
	name: string,
	fills: FigmaVectorNode["fills"],
	extra: Partial<FigmaVectorNode> & Pick<FigmaVectorNode, "type">,
): FigmaVectorNode {
	return { id: "s1", name, absoluteBoundingBox: bbox, fills, ...extra };
}

describe("parseValue (quoting rule)", () => {
	it("bare single token", () => {
		expect(parseValue("{{display_name}}")).toEqual({
			mode: "token",
			id: "display_name",
		});
	});

	it("inner whitespace is trimmed, not 'content with spaces'", () => {
		expect(parseValue("{{ display_name }}")).toEqual({
			mode: "token",
			id: "display_name",
		});
	});

	it("quoted template with literals + multiple tokens", () => {
		expect(parseValue('"{{first}} {{last}}"')).toEqual({
			mode: "template",
			template: "{{first}} {{last}}",
			ids: ["first", "last"],
		});
	});

	it("bare multi-token is ambiguous → null", () => {
		expect(parseValue("{{first}} {{last}}")).toBeNull();
	});

	it("non-token → null", () => {
		expect(parseValue("hello")).toBeNull();
	});

	it("empty quotes → null", () => {
		expect(parseValue('""')).toBeNull();
	});
});

describe("parseMarker", () => {
	it("text marker", () => {
		expect(parseMarker("text:{{display_name}}")).toEqual({
			kind: "text",
			value: { mode: "token", id: "display_name" },
			opts: {},
		});
	});

	it("qr marker with opts", () => {
		const m = parseMarker("qr:{{profile_url}};ec=M;fg=#000");
		expect(m?.kind).toBe("qr");
		expect(m?.opts).toEqual({ ec: "M", fg: "#000" });
	});

	it("a ; inside a quoted value is not split as an opt", () => {
		const m = parseMarker('qr:"{{code}};x";ec=L');
		expect(m?.value).toEqual({
			mode: "template",
			template: "{{code}};x",
			ids: ["code"],
		});
		expect(m?.opts).toEqual({ ec: "L" });
	});

	it("non-marker name → null", () => {
		expect(parseMarker("Layer 1")).toBeNull();
		expect(parseMarker("{{display_name}}")).toBeNull();
	});

	it("unknown kind → null", () => {
		expect(parseMarker("foo:{{x}}")).toBeNull();
	});

	it("bare multi-token marker value → null (must quote)", () => {
		expect(parseMarker("text:{{a}} {{b}}")).toBeNull();
	});
});

describe("inferNodeBinding", () => {
	it("text marker on a text node seeds default from characters", () => {
		const b = inferNodeBinding(
			textNode("text:{{display_name}}", "Aurora Member"),
		);
		expect(b?.bind).toEqual({ text: "{{display_name}}" });
		expect(b?.fields).toEqual([
			{ id: "display_name", format: "text", default: "Aurora Member" },
		]);
	});

	it("image marker on an image-fill rect (square → [1,1] aspect)", () => {
		const b = inferNodeBinding(rectNode("image:{{avatar}}", [IMAGE_FILL]));
		expect(b?.bind).toEqual({ image: "{{avatar}}" });
		expect(b?.fields[0]).toMatchObject({
			id: "avatar",
			format: "image",
			imageAspect: [1, 1],
		});
	});

	it("infers a non-square image aspect from the node box", () => {
		const node: FigmaRectangleNode = {
			id: "r2",
			name: "{{banner}}",
			type: "RECTANGLE",
			absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 80 },
			fills: [IMAGE_FILL],
		};
		const b = inferNodeBinding(node);
		expect(b?.fields[0]).toMatchObject({
			id: "banner",
			format: "image",
			imageAspect: [200, 80],
		});
	});

	it("color marker on a shape → fill", () => {
		const b = inferNodeBinding(rectNode("color:{{brand}}", []));
		expect(b?.bind).toEqual({ fill: "{{brand}}" });
		expect(b?.fields[0]).toMatchObject({ id: "brand", format: "color" });
	});

	it("color marker on a text node → text color", () => {
		const b = inferNodeBinding(textNode("color:{{brand}}"));
		expect(b?.bind).toEqual({ textColor: "{{brand}}" });
		expect(b?.fields[0]).toMatchObject({ id: "brand", format: "color" });
	});

	it("qr marker carries opts", () => {
		const b = inferNodeBinding(rectNode("qr:{{url}};ec=M", []));
		expect(b?.bind).toEqual({ qr: "{{url}}" });
		expect(b?.qrOpts).toEqual({ ec: "M" });
		expect(b?.fields[0]).toMatchObject({ id: "url", format: "url" });
	});

	it("unmarked whole-name token on a text node → text", () => {
		const b = inferNodeBinding(textNode("{{member_id}}", "00123"));
		expect(b?.bind).toEqual({ text: "{{member_id}}" });
		expect(b?.fields[0]).toMatchObject({ id: "member_id", format: "text" });
	});

	it("unmarked whole-name token on an image-fill rect → image", () => {
		const b = inferNodeBinding(rectNode("{{logo}}", [IMAGE_FILL]));
		expect(b?.bind).toEqual({ image: "{{logo}}" });
		expect(b?.fields[0]).toMatchObject({ id: "logo", format: "image" });
	});

	it("unmarked token on a plain shape → ignored (no odd text coercion)", () => {
		expect(inferNodeBinding(rectNode("{{thing}}", []))).toBeNull();
	});

	it("text: marker on a non-text layer → ignored", () => {
		expect(inferNodeBinding(rectNode("text:{{thing}}", []))).toBeNull();
	});

	it("inline content tokens on a text node → text fields", () => {
		const b = inferNodeBinding(textNode("Greeting", "Hi {{first}} {{last}}"));
		expect(b?.bind).toEqual({ text: "Hi {{first}} {{last}}" });
		expect(b?.fields.map((f) => f.id)).toEqual(["first", "last"]);
	});

	it("plain layer, no tokens → null", () => {
		expect(inferNodeBinding(rectNode("Background", []))).toBeNull();
	});

	it("quoted template marker mints multiple fields", () => {
		const b = inferNodeBinding(
			textNode('text:"{{first}} {{last}}"', "John Doe"),
		);
		expect(b?.bind).toEqual({ text: "{{first}} {{last}}" });
		expect(b?.fields.map((f) => f.id)).toEqual(["first", "last"]);
	});
});

describe("image inference on ellipses and polygons", () => {
	it("infers a bare token on an image-fill ellipse as an image", () => {
		const b = inferNodeBinding(
			shapeNode("{{avatar}}", [IMAGE_FILL], { type: "ELLIPSE" }),
		);
		expect(b?.bind).toEqual({ image: "{{avatar}}" });
	});

	it("infers a bare token on an image-fill polygon as an image", () => {
		const b = inferNodeBinding(
			shapeNode("{{badge}}", [IMAGE_FILL], { type: "POLYGON", pointCount: 6 }),
		);
		expect(b?.bind).toEqual({ image: "{{badge}}" });
	});

	it("binds an image marker on a solid ellipse", () => {
		const b = inferNodeBinding(
			shapeNode(
				"image:{{avatar}}",
				[{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.9, a: 1 } }],
				{ type: "ELLIPSE" },
			),
		);
		expect(b?.bind).toEqual({ image: "{{avatar}}" });
	});

	it("ignores a bare token on a partial arc", () => {
		const b = inferNodeBinding(
			shapeNode("{{avatar}}", [IMAGE_FILL], {
				type: "ELLIPSE",
				arcData: { startingAngle: 0, endingAngle: Math.PI, innerRadius: 0 },
			}),
		);
		expect(b).toBeNull();
	});
});

describe("bindableProperties", () => {
	it("text node → text + textColor", () => {
		expect(bindableProperties(textNode("Title"))).toEqual([
			{ property: "text", format: "text" },
			{ property: "textColor", format: "color" },
		]);
	});

	it("image-fill rect → image", () => {
		expect(bindableProperties(rectNode("Avatar", [IMAGE_FILL]))).toEqual([
			{ property: "image", format: "image" },
		]);
	});

	it("image-fill ellipse → image", () => {
		expect(
			bindableProperties(
				shapeNode("Avatar", [IMAGE_FILL], { type: "ELLIPSE" }),
			),
		).toEqual([{ property: "image", format: "image" }]);
	});

	it("plain rectangle → fill + image + qr + barcode", () => {
		expect(bindableProperties(rectNode("Box", []))).toEqual([
			{ property: "fill", format: "color" },
			{ property: "image", format: "image" },
			{ property: "qr", format: "url" },
			{ property: "barcode", format: "text" },
		]);
	});
});

describe("buildFieldMeta", () => {
	it("applies title-case, required, source defaults", () => {
		expect(buildFieldMeta({ id: "display_name", format: "text" })).toEqual({
			id: "display_name",
			format: "text",
			title: "Display Name",
			required: true,
			source: "user",
		});
	});

	it("carries a seeded default and honors overrides", () => {
		const m = buildFieldMeta(
			{ id: "url", format: "url", default: "https://x" },
			{ required: false, title: "Profile URL" },
		);
		expect(m).toMatchObject({
			default: "https://x",
			required: false,
			title: "Profile URL",
		});
	});
});

describe("createBindingResolver", () => {
	it("resolves each node once and matches resolveNodeBinding", () => {
		const resolve = createBindingResolver();
		const bound = textNode("{{name}}");
		const stored = {
			...textNode("Plain"),
			binding: { bind: { text: "{{tier}}" } },
		};
		const plain = textNode("Plain");

		const first = resolve(bound);
		expect(first).toEqual(resolveNodeBinding(bound));
		expect(resolve(bound)).toBe(first);
		expect(resolve(stored)).toEqual(resolveNodeBinding(stored));
		expect(resolve(stored)).toBe(resolve(stored));
		expect(resolve(plain)).toBeNull();
		expect(resolve(plain)).toBeNull();
	});

	it("keeps nothing between resolvers", () => {
		const node = textNode("{{name}}");
		expect(createBindingResolver()(node)).not.toBe(
			createBindingResolver()(node),
		);
	});
});
