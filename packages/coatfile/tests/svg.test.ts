import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePixels } from "@freshcoat-js/engine";
import { createHeadlessEnv } from "@freshcoat-js/engine/headless";
import CanvasKitInit from "canvaskit-wasm";
import { beforeAll, describe, expect, test } from "vitest";
import type { EncodedPaintedFrame } from "../src/render";
import { render } from "../src/render";
import { ElementSchema } from "../src/schemas";
import { svgToElements } from "../src/svg";
import type {
	Element,
	FrameElement,
	MaskElement,
	Template,
	VectorElement,
} from "../src/types";
import { validate } from "../src/validate";

const CK_BIN = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	"node_modules",
	"canvaskit-wasm",
	"bin",
);

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

	test("warnings pass through", () => {
		const { warnings } = svgToElements(svg("<text>x</text>"));
		expect(warnings.map((w) => w.feature)).toEqual(["text"]);
	});

	test("the result is a valid element", () => {
		const { element } = svgToElements(ICON);
		expect(ElementSchema.safeParse(element).success).toBe(true);
		expect(validate(template(element)).ok).toBe(true);
	});
});

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
	ck = await (CanvasKitInit as (o: unknown) => Promise<unknown>)({
		locateFile: (f: string) => join(CK_BIN, f),
	});
});

async function pixels(tpl: Template) {
	const [frame] = (await render(
		tpl,
		{},
		{ width: 96, height: 96 },
		{
			ck,
			env: createHeadlessEnv({
				images: new Map([["icon.svg", new TextEncoder().encode(ICON)]]),
			}),
		},
	)) as EncodedPaintedFrame[];
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
});
