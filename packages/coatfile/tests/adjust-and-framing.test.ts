import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	buildAdjust,
	decodePixels,
	type GroupNode,
	type ImageNode,
} from "@freshcoat-js/engine";
import { createHeadlessEnv } from "@freshcoat-js/engine/headless";
import CanvasKitInit from "canvaskit-wasm";
import { beforeAll, describe, expect, test } from "vitest";
import { compile } from "../src/compile";
import { formatImageFocus, parseImageFocus } from "../src/image-focus";
import type { EncodedPaintedFrame } from "../src/render";
import { render } from "../src/render";
import type { Element, Template } from "../src/types";
import { validate } from "../src/validate";

const CK_BIN = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	"node_modules",
	"canvaskit-wasm",
	"bin",
);

function template(elements: Element[], fields: string[] = []): Template {
	return {
		format_version: "1.5",
		id: "t",
		name: "T",
		width: 40,
		height: 40,
		fields: {
			type: "object",
			properties: Object.fromEntries(
				fields.map((f) => [f, { type: "string" as const }]),
			),
		},
		template_data: [
			{
				name: "front",
				background: {
					id: "bg",
					type: "rect",
					properties: { fill: "#ffffff" },
				},
				elements,
			},
		],
	};
}

const errorCodes = (tpl: Template) => {
	const v = validate(tpl);
	return v.ok ? [] : v.errors.map((e) => e.code);
};

const photo = (props: Record<string, unknown>, extra = {}): Element =>
	({
		id: "photo",
		type: "image",
		pos: { x: 0, y: 0 },
		size: { width: 40, height: 40 },
		properties: { src: "x.png", fit: "cover", ...props },
		...extra,
	}) as Element;

const compiledImage = (tpl: Template, values: Record<string, unknown> = {}) =>
	compile(tpl, values, { width: 40, height: 40 }).frames[0].root
		.children[1] as ImageNode;

describe("element adjust", () => {
	test("maps through buildAdjust on any element", () => {
		const tpl = template([
			photo({}, { adjust: { saturation: 0, contrast: 1.2, gamma: 0.8 } }),
			{
				id: "box",
				type: "frame",
				size: { width: 10, height: 10 },
				adjust: { brightness: 1.1, sharpen: 0.5, preserveHue: true },
				properties: { children: [] },
			} as Element,
		]);
		expect(validate(tpl).ok).toBe(true);
		const root = compile(tpl, {}, { width: 40, height: 40 }).frames[0].root;
		expect(root.children[1].adjust).toEqual(
			buildAdjust({ saturation: 0, contrast: 1.2, gamma: 0.8 }),
		);
		expect((root.children[2] as GroupNode).adjust).toEqual(
			buildAdjust({ brightness: 1.1, sharpen: 0.5, preserveHue: true }),
		);
	});

	test("identity values leave no adjust behind", () => {
		const tpl = template([
			photo({}, { adjust: { saturation: 1, contrast: 1, sharpen: 0 } }),
		]);
		expect(compiledImage(tpl).adjust).toBeUndefined();
	});

	test("rejects out-of-range factors", () => {
		for (const adjust of [
			{ saturation: -1 },
			{ gamma: 0 },
			{ sharpen: -0.5 },
		])
			expect(errorCodes(template([photo({}, { adjust })]))).toContain(
				"invalid_shape",
			);
	});
});

describe("image focus and crop", () => {
	test("compile carries a focus pair and a crop onto the image node", () => {
		const node = compiledImage(
			template([
				photo({
					focus: [0.25, 0.75],
					crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 },
				}),
			]),
		);
		expect(node.focus).toEqual({ x: 0.25, y: 0.75 });
		expect(node.crop).toEqual({ x: 0.1, y: 0.2, width: 0.5, height: 0.6 });
	});

	test("a field can supply the focal point per record", () => {
		const tpl = template([photo({ focus: "{{photo_focus}}" })], ["photo_focus"]);
		expect(validate(tpl).ok).toBe(true);
		expect(compiledImage(tpl, { photo_focus: "0.2, 0.9" }).focus).toEqual({
			x: 0.2,
			y: 0.9,
		});
		expect(compiledImage(tpl, {}).focus).toBeUndefined();
		expect(compiledImage(tpl, { photo_focus: "nope" }).focus).toBeUndefined();
	});

	test("validation rejects a crop outside the image and unreadable focus text", () => {
		expect(
			errorCodes(
				template([photo({ crop: { x: 0.6, y: 0, width: 0.5, height: 1 } })]),
			),
		).toContain("image_crop_out_of_range");
		expect(
			errorCodes(
				template([photo({ crop: { x: 0, y: 0, width: 0, height: 1 } })]),
			),
		).toContain("invalid_shape");
		expect(errorCodes(template([photo({ focus: "left" })]))).toContain(
			"invalid_image_focus",
		);
		expect(errorCodes(template([photo({ focus: [1.5, 0] })]))).toContain(
			"invalid_shape",
		);
		expect(errorCodes(template([photo({ focus: "0.5,0.1" })]))).toEqual([]);
	});

	test("parse and format round-trip", () => {
		expect(parseImageFocus([0, 1])).toEqual({ x: 0, y: 1 });
		expect(parseImageFocus("0.3 0.4")).toEqual({ x: 0.3, y: 0.4 });
		expect(parseImageFocus("1.2,0")).toBeUndefined();
		expect(parseImageFocus("")).toBeUndefined();
		expect(formatImageFocus({ x: 1 / 3, y: 0.5 })).toBe("0.333,0.5");
		expect(parseImageFocus(formatImageFocus({ x: 0.125, y: 0.9 }))).toEqual({
			x: 0.125,
			y: 0.9,
		});
	});
});

describe("adjust and framing paint", () => {
	// biome-ignore lint/suspicious/noExplicitAny: CanvasKit is untyped here
	let ck: any;
	let bands: string;
	beforeAll(async () => {
		ck = await (CanvasKitInit as (o: unknown) => Promise<unknown>)({
			locateFile: (f: string) => join(CK_BIN, f),
		});
		// 80×20: red, green, blue and white bands, 20px each.
		const surface = ck.MakeSurface(80, 20);
		const canvas = surface.getCanvas();
		const paint = new ck.Paint();
		[
			[255, 0, 0],
			[0, 255, 0],
			[0, 0, 255],
			[255, 255, 255],
		].forEach(([r, g, b], i) => {
			paint.setColor(ck.Color(r, g, b, 1));
			canvas.drawRect(ck.XYWHRect(i * 20, 0, 20, 20), paint);
		});
		const img = surface.makeImageSnapshot();
		bands = `data:image/png;base64,${Buffer.from(img.encodeToBytes()).toString("base64")}`;
		img.delete();
		paint.delete();
		surface.delete();
	});

	async function centre(el: Element, values: Record<string, unknown> = {}) {
		const tpl = template([el], ["photo_focus"]);
		const [frame] = (await render(
			tpl,
			values,
			{ width: 40, height: 40 },
			{ ck, env: createHeadlessEnv() },
		)) as EncodedPaintedFrame[];
		const d = decodePixels(ck, frame.bytes);
		if (!d) throw new Error("decode failed");
		const i = (20 * d.width + 20) * 4;
		return Array.from(d.data.slice(i, i + 3));
	}

	const near = (actual: number[], want: number[]) =>
		want.forEach((v, i) => expect(Math.abs(actual[i] - v)).toBeLessThan(12));

	test("focus chooses which band a square cover shows", async () => {
		near(await centre(photo({ src: bands, focus: [0, 0.5] })), [255, 0, 0]);
		near(await centre(photo({ src: bands, focus: [1, 0.5] })), [255, 255, 255]);
		near(
			await centre(photo({ src: bands, focus: "{{photo_focus}}" }), {
				photo_focus: "0.375,0.5",
			}),
			[0, 255, 0],
		);
	});

	test("crop draws the chosen region", async () => {
		near(
			await centre(
				photo({
					src: bands,
					fit: "fill",
					crop: { x: 0.5, y: 0, width: 0.25, height: 1 },
				}),
			),
			[0, 0, 255],
		);
	});

	test("adjust desaturates the painted layer", async () => {
		const [r, g, b] = await centre(
			photo(
				{ src: bands, focus: [0, 0.5] },
				{ adjust: { saturation: 0 } },
			),
		);
		expect(Math.abs(r - g)).toBeLessThan(3);
		expect(Math.abs(g - b)).toBeLessThan(3);
		expect(r).toBeGreaterThan(40);
		expect(r).toBeLessThan(70);
	});
});
