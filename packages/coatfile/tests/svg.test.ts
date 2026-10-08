import { createRenderer, decodePixels } from "@freshcoat-js/engine";
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test } from "vitest";
import { renderTemplate } from "../src/render";
import { ElementSchema } from "../src/schemas";
import { svgToElements } from "../src/svg";
import type {
	Element,
	FrameElement,
	MaskElement,
	Template,
	TextElement,
	VectorElement,
} from "../src/types";
import { validate } from "../src/validate";

const svg = (body: string, attrs = 'width="100" height="100"') =>
	`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;

describe("svgToElements", () => {
	test("the root is a frame at the drawing's size", () => {
		const { element, warnings } = svgToElements(
			svg('<rect x="10" y="20" width="30" height="40" fill="red"/>'),
		);
		expect(element).toMatchObject({
			id: "svg",
			type: "frame",
			pos: { x: 0, y: 0 },
			size: { width: 100, height: 100 },
		});
		expect(element.properties.clipsContent).toBeUndefined();
		expect(warnings).toEqual([]);
		expect(element.properties.children).toEqual([
			{
				id: "vector",
				type: "vector",
				pos: { x: 10, y: 20 },
				size: { width: 30, height: 40 },
				properties: { d: "M0 0L30 0L30 40L0 40Z", fill: "#ff0000" },
			},
		]);
	});

	test("the viewBox scales geometry and strokes into design px", () => {
		const { element } = svgToElements(
			svg(
				'<rect x="1" y="1" width="4" height="4" fill="none" stroke="#0000ff80" stroke-width="1" stroke-dasharray="1 1"/>',
				'width="20" height="20" viewBox="0 0 10 10"',
			),
		);
		expect(element.properties.children[0]).toMatchObject({
			pos: { x: 2, y: 2 },
			size: { width: 8, height: 8 },
			properties: {
				d: "M0 0L8 0L8 8L0 8Z",
				stroke: { color: "#0000ff80", width: 2, dash: [2, 2] },
			},
		});
		expect(
			(element.properties.children[0] as VectorElement).properties.fill,
		).toBeUndefined();
	});

	test("maxSize scales the drawing down to fit, never up", () => {
		const art = svg(
			'<rect width="100" height="50" stroke="red" stroke-width="4"/>',
			'width="200" height="100" viewBox="0 0 100 50"',
		);
		const small = svgToElements(art, { maxSize: { width: 100, height: 100 } });
		expect(small.element.size).toEqual({ width: 100, height: 50 });
		expect(small.element.properties.children[0]).toMatchObject({
			size: { width: 100, height: 50 },
			properties: { stroke: { width: 4 } },
		});
		const big = svgToElements(art, { maxSize: { width: 1000, height: 1000 } });
		expect(big.element.size).toEqual({ width: 200, height: 100 });
	});

	test("content past the box clips the root", () => {
		const { element } = svgToElements(svg('<rect x="90" width="20" height="10"/>'));
		expect(element.properties.clipsContent).toBe(true);
	});

	test("groups become frames at their content's box", () => {
		const { element } = svgToElements(
			svg(
				'<g id="logo" opacity="0.5"><rect x="10" y="10" width="10" height="10"/><rect x="30" y="10" width="10" height="20" fill-rule="evenodd"/></g>',
			),
		);
		const g = element.properties.children[0] as FrameElement;
		expect(g).toMatchObject({
			id: "logo",
			type: "frame",
			opacity: 0.5,
			pos: { x: 10, y: 10 },
			size: { width: 30, height: 20 },
		});
		expect(g.properties.children.map((c) => [c.id, c.pos])).toEqual([
			["vector", { x: 0, y: 0 }],
			["vector-2", { x: 20, y: 0 }],
		]);
		expect(
			(g.properties.children[1] as VectorElement).properties.fillRule,
		).toBe("evenodd");
	});

	test("anonymous single-child groups are flattened", () => {
		const { element } = svgToElements(
			svg('<g><g><path id="mark" d="M0 0H5V5Z"/></g></g>'),
		);
		expect(element.properties.children.map((c) => [c.id, c.type])).toEqual([
			["mark", "vector"],
		]);
	});

	test("ids are made unique, through the caller when given", () => {
		const taken = new Set(["vector"]);
		const { element } = svgToElements(
			svg('<path id="a" d="M0 0H5V5Z"/><path id="a" d="M0 0H5V5Z"/><path d="M0 0H5V5Z"/>'),
			{
				id: "art",
				uniqueId: (base) => {
					let id = base;
					for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
					taken.add(id);
					return id;
				},
			},
		);
		expect(element.id).toBe("art");
		expect(element.properties.children.map((c) => c.id)).toEqual([
			"a",
			"a_2",
			"vector_2",
		]);
	});

	test("gradients map onto each vector's own box", () => {
		const { element } = svgToElements(
			svg(
				'<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="10" y1="0" x2="30" y2="0"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient><radialGradient id="r"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></radialGradient><rect x="10" width="20" height="10" fill="url(#g)"/><rect width="40" height="20" fill="url(#r)"/>',
			),
		);
		const [lin, rad] = element.properties.children as VectorElement[];
		expect(lin?.properties.fill).toEqual({
			kind: "linear",
			angle: 0,
			from: [0, 0],
			to: [1, 0],
			stops: [
				{ offset: 0, color: "#ff0000" },
				{ offset: 1, color: "#0000ff" },
			],
		});
		expect(rad?.properties.fill).toMatchObject({
			kind: "radial",
			center: [0.5, 0.5],
			radius: 0.5,
			radiusY: 0.25,
		});
	});

	test("clip paths and masks become mask elements", () => {
		const { element } = svgToElements(
			svg(
				'<clipPath id="c"><circle cx="20" cy="20" r="10"/></clipPath><mask id="m"><rect width="100" height="100" fill="white"/></mask><g clip-path="url(#c)"><rect x="10" y="10" width="40" height="40"/></g><rect mask="url(#m)" width="10" height="10"/>',
			),
		);
		const [clipped, masked] = element.properties.children as MaskElement[];
		expect(clipped).toMatchObject({
			type: "mask",
			pos: { x: 10, y: 10 },
			size: { width: 40, height: 40 },
			properties: {
				mask: { type: "vector", pos: { x: 0, y: 0 }, size: { width: 20, height: 20 } },
				children: [{ type: "vector", pos: { x: 0, y: 0 } }],
			},
		});
		expect(clipped?.properties.channel).toBeUndefined();
		expect(masked).toMatchObject({
			type: "mask",
			properties: {
				channel: "luminance",
				mask: { type: "vector", pos: { x: 0, y: 0 } },
			},
		});
	});

	test("filters warn, since layers cannot carry them", () => {
		const { element, warnings } = svgToElements(
			svg('<filter id="f"><feGaussianBlur stdDeviation="2"/></filter><rect width="10" height="10" fill="red" filter="url(#f)"/>'),
		);
		expect(element.properties.children).toHaveLength(1);
		expect(warnings.map((w) => w.feature)).toEqual(["filter"]);
	});

	test("warnings pass through", () => {
		const { warnings } = svgToElements(svg("<foreignObject/>"));
		expect(warnings.map((w) => w.feature)).toEqual(["foreignObject"]);
	});

	test("an embedded image is an image layer in design px", () => {
		const { element, warnings } = svgToElements(
			svg(
				`<image id="photo" href="${PNG}" x="1" y="2" width="4" height="3" preserveAspectRatio="xMidYMid slice" opacity="0.5"/>`,
				'width="20" height="20" viewBox="0 0 10 10"',
			),
		);
		expect(warnings).toEqual([]);
		expect(element.properties.children).toEqual([
			{
				id: "photo",
				type: "image",
				opacity: 0.5,
				pos: { x: 2, y: 4 },
				size: { width: 8, height: 6 },
				properties: { src: PNG, fit: "cover" },
			},
		]);
	});

	test("text is a text layer whose baseline lands where the SVG's does", () => {
		const { element } = svgToElements(
			svg(
				'<text id="title" x="50" y="40" font-family="Inter" font-size="10" font-weight="600" fill="#123456" text-anchor="middle">Hi there</text>',
				'width="200" height="200" viewBox="0 0 100 100"',
			),
		);
		const text = element.properties.children[0] as TextElement;
		expect(text).toMatchObject({
			id: "title",
			type: "text",
			properties: {
				value: "Hi there",
				font: { family: "Inter", size: 20, weight: 600, lineHeight: 1.2 },
				color: "#123456",
				align: "center",
			},
		});
		const pos = text.pos ?? { x: 0, y: 0 };
		const size = text.size ?? { width: 0, height: 0 };
		expect(pos.x + size.width / 2).toBeCloseTo(100);
		expect(pos.y).toBeCloseTo(80 - 0.95 * 20);
		expect(size.height).toBeCloseTo(24);
		expect(size.width).toBeGreaterThan(8 * 20 * 0.6);
	});

	test("differently styled tspans become spans", () => {
		const { element } = svgToElements(
			svg(
				'<text y="20" font-size="10" font-weight="bold">Total <tspan font-weight="normal" fill="red">42</tspan></text>',
			),
		);
		const text = element.properties.children[0] as TextElement;
		expect(text.properties.value).toBeUndefined();
		expect(text.properties.font.weight).toBe(700);
		expect(text.properties.spans).toEqual([
			{
				text: "Total ",
				font: { family: "sans-serif", size: 10, weight: 700, style: "normal" },
				color: "#000000",
			},
			{
				text: "42",
				font: { family: "sans-serif", size: 10, weight: 400, style: "normal" },
				color: "#ff0000",
			},
		]);
	});

	test("rotated text turns about its baseline start", () => {
		const { element } = svgToElements(
			svg('<text transform="translate(50 50) rotate(90)" font-size="10">ab</text>'),
		);
		const text = element.properties.children[0] as TextElement;
		expect(text.rotation).toBe(90);
		const pos = text.pos ?? { x: 0, y: 0 };
		const size = text.size ?? { width: 0, height: 0 };
		// The box's centre, turned about (50, 50), sits below that point.
		expect(pos.x + size.width / 2).toBeCloseTo(50 + 0.95 * 10 - 6);
		expect(pos.y + size.height / 2).toBeCloseTo(50 + size.width / 2);
	});

	test("markers and patterns arrive as ordinary layers", () => {
		const { element, warnings } = svgToElements(
			svg(
				'<marker id="a" orient="auto" markerWidth="4" markerHeight="4" refX="2" refY="2"><path d="M0 0L4 2L0 4Z"/></marker>' +
					'<pattern id="p" patternUnits="userSpaceOnUse" width="10" height="10"><rect width="5" height="5" fill="red"/></pattern>' +
					'<path d="M10 10H40" stroke="black" marker-end="url(#a)"/><rect y="50" width="20" height="20" fill="url(#p)"/>',
			),
		);
		expect(warnings).toEqual([]);
		const kinds = element.properties.children.map((c) => c.type);
		expect(kinds).toEqual(["vector", "vector", "mask"]);
		const tiles = element.properties.children[2] as MaskElement;
		expect(tiles.properties.children).toHaveLength(4);
		expect(validate(template(element)).ok).toBe(true);
	});

	test("the result is a valid element", () => {
		const { element } = svgToElements(ICON);
		expect(ElementSchema.safeParse(element).success).toBe(true);
		expect(validate(template(element)).ok).toBe(true);
	});
});

const PNG =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR42mM4efoiVsQwtCQA3z2ZQXrXt2kAAAAASUVORK5CYII=";

const ICON = svg(
	'<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#f80"/><stop offset="1" stop-color="#08f"/></linearGradient><clipPath id="c"><rect x="4" y="4" width="40" height="40" rx="8"/></clipPath></defs><g id="badge" clip-path="url(#c)"><rect width="48" height="48" fill="url(#g)"/><circle cx="24" cy="24" r="10" fill="white" stroke="#222" stroke-width="3"/></g><path d="M8 40 L40 8" stroke="black" stroke-width="2" opacity="0.5"/>',
	'width="96" height="96" viewBox="0 0 48 48"',
);

function template(element: Element, extra: Element[] = []): Template {
	return {
		format_version: "1.0",
		version: "1.0.0",
		id: "t",
		name: "T",
		product: "test",
		width: 96,
		height: 96,
		fields: { type: "object", properties: {} },
		template_data: [
			{
				name: "front",
				background: { id: "bg", type: "rect", properties: { fill: "#ffffff" } },
				elements: [element, ...extra],
			},
		],
	};
}

// biome-ignore lint/suspicious/noExplicitAny: CanvasKit is untyped here
let ck: any;
beforeAll(async () => {
	ck = await loadCanvasKit();
});

async function pixels(tpl: Template, markup = ICON) {
	const [frame] = (await renderTemplate(
		await createRenderer({ ck, cache: false }),
		tpl,
		{},
		{ width: 96, height: 96, images: new Map([["icon.svg", new TextEncoder().encode(markup)]]) },
	));
	if (!frame) throw new Error("no frame");
	const d = decodePixels(ck, frame.bytes);
	if (!d) throw new Error("decode failed");
	return d.data;
}

describe("layers and image sources agree", () => {
	test("the same markup renders the same either way", async () => {
		const layers = await pixels(template(svgToElements(ICON).element));
		const image = await pixels(
			template({
				id: "img",
				type: "image",
				pos: { x: 0, y: 0 },
				size: { width: 96, height: 96 },
				properties: { src: "icon.svg", fit: "fill" },
			}),
		);
		const at = (i: number) => [...layers.slice(i * 4, i * 4 + 3)];
		expect(at(48 * 96 + 20)).not.toEqual([255, 255, 255]);
		let off = 0;
		for (let i = 0; i < layers.length; i++)
			if (Math.abs((layers[i] ?? 0) - (image[i] ?? 0)) > 8) off++;
		expect(off / layers.length).toBeLessThan(0.01);
	});

	test("embedded images, markers and patterns agree too", async () => {
		const surface = ck.MakeSurface(4, 4);
		surface.getCanvas().clear(ck.Color(0, 160, 80, 1));
		const snapshot = surface.makeImageSnapshot();
		const png = `data:image/png;base64,${Buffer.from(snapshot.encodeToBytes()).toString("base64")}`;
		snapshot.delete();
		surface.delete();
		const markup = svg(
			`<image href="${png}" x="4" y="4" width="16" height="16" preserveAspectRatio="none"/>` +
				'<marker id="a" orient="auto" markerWidth="4" markerHeight="4" refX="2" refY="2"><path d="M0 0L4 2L0 4Z"/></marker>' +
				'<path d="M24 12H40" stroke="black" stroke-width="2" marker-end="url(#a)"/>' +
				'<pattern id="p" patternUnits="userSpaceOnUse" width="8" height="8"><rect width="4" height="4" fill="#c00"/></pattern>' +
				'<circle cx="24" cy="34" r="10" fill="url(#p)"/>',
			'width="96" height="96" viewBox="0 0 48 48"',
		);
		const layers = await pixels(template(svgToElements(markup).element), markup);
		const image = await pixels(
			template({
				id: "img",
				type: "image",
				pos: { x: 0, y: 0 },
				size: { width: 96, height: 96 },
				properties: { src: "icon.svg", fit: "fill" },
			}),
			markup,
		);
		const at = (px: Uint8Array | Uint8ClampedArray, x: number, y: number) => [
			...px.slice((y * 96 + x) * 4, (y * 96 + x) * 4 + 3),
		];
		expect(at(layers, 24, 24)).toEqual([0, 160, 80]);
		expect(at(image, 24, 24)).toEqual([0, 160, 80]);
		let off = 0;
		for (let i = 0; i < layers.length; i++)
			if (Math.abs((layers[i] ?? 0) - (image[i] ?? 0)) > 8) off++;
		expect(off / layers.length).toBeLessThan(0.01);
	});
});
