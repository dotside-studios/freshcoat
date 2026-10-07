import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test } from "vitest";
import { buildAdjust } from "../src/adjust";
import { auditAdjustedBounds, setLayerBounds } from "../src/canvaskit";
import { compileScene } from "../src/compile-scene";
import { renderSceneToPng } from "../src/headless";
import {
	createEllipse,
	createFrame,
	createGroup,
	createRect,
	type Node,
} from "../src/node";
import type { DrawCommand, EncodedPaintResult } from "../src/types";
import { validateCommands } from "../src/validate-commands";

const W = 80;
const H = 80;

let ck: any;
beforeAll(async () => {
	ck = await loadCanvasKit();
});

type RGBA = [number, number, number, number];

function decode(png: Uint8Array): (x: number, y: number) => RGBA {
	const img = ck.MakeImageFromEncoded(png);
	const w = img.width();
	const buf = img.readPixels(
		0,
		0,
		{
			width: w,
			height: img.height(),
			colorType: ck.ColorType.RGBA_8888,
			alphaType: ck.AlphaType.Unpremul,
			colorSpace: ck.ColorSpace.SRGB,
		},
		undefined,
		w * 4,
	) as Uint8Array;
	img.delete();
	return (x, y) => {
		const o = (y * w + x) * 4;
		return [buf[o], buf[o + 1], buf[o + 2], buf[o + 3]] as RGBA;
	};
}

// Black on the left half, white on the right, with `over` painted on top.
function stripes(over: Node[], left = "#000000"): Node {
	return createFrame({
		pos: { x: 0, y: 0 },
		size: { width: W, height: H },
		children: [
			createRect({
				pos: { x: 0, y: 0 },
				size: { width: W / 2, height: H },
				fills: [{ kind: "solid", color: left }],
			}),
			createRect({
				pos: { x: W / 2, y: 0 },
				size: { width: W / 2, height: H },
				fills: [{ kind: "solid", color: "#ffffff" }],
			}),
			...over,
		],
	});
}

async function paint(node: Node) {
	const r = (await renderSceneToPng(node, {
		width: W,
		height: H,
		ck,
	})) as EncodedPaintResult;
	expect(r.warnings).toEqual([]);
	return decode(r.bytes);
}

const glass = (extra: Partial<Parameters<typeof createRect>[0]> = {}) =>
	createRect({
		pos: { x: 20, y: 20 },
		size: { width: 40, height: 40 },
		backdropBlur: 12,
		...extra,
	});

describe("backdrop blur", () => {
	test("blurs what lies beneath the shape and nothing outside it", async () => {
		const px = await paint(stripes([glass()]));
		const edge = px(W / 2, H / 2)[0];
		expect(edge).toBeGreaterThan(60);
		expect(edge).toBeLessThan(200);
		expect(px(W / 2 - 3, H / 2)[0]).toBeGreaterThan(10);
		expect(px(W / 2, 10)).toEqual([255, 255, 255, 255]);
		expect(px(W / 2 - 1, 10)).toEqual([0, 0, 0, 255]);
	});

	test("updates when the content beneath changes", async () => {
		const black = await paint(stripes([glass()]));
		const red = await paint(stripes([glass()], "#ff0000"));
		expect(black(W / 2 - 3, H / 2)[0]).toBeLessThan(red(W / 2 - 3, H / 2)[0]);
		expect(red(W / 2 - 3, H / 2)[1]).toBe(red(W / 2 - 3, H / 2)[2]);
	});

	test("is painted under the layer's own fill", async () => {
		const px = await paint(
			stripes([glass({ fills: [{ kind: "solid", color: "#0000ff80" }] })]),
		);
		const [r, , b] = px(W / 2, H / 2);
		expect(b).toBeGreaterThan(r);
		expect(r).toBeGreaterThan(30);
	});

	test("follows a rounded corner", async () => {
		const px = await paint(
			stripes([glass({ cornerRadius: 20, backdropBlur: 40 })]),
		);
		expect(px(58, 21)).toEqual([255, 255, 255, 255]);
		expect(px(58, H / 2)[0]).toBeLessThan(250);
	});

	test("follows an ellipse outline", async () => {
		const px = await paint(
			stripes([
				createEllipse({
					pos: { x: 20, y: 20 },
					size: { width: 40, height: 40 },
					backdropBlur: 12,
				}),
			]),
		);
		expect(px(W / 2 + 18, 22)).toEqual([255, 255, 255, 255]);
		expect(px(W / 2, H / 2)[0]).toBeLessThan(255);
	});

	test("opacity mixes the blur with the sharp backdrop", async () => {
		const full = await paint(stripes([glass()]));
		const half = await paint(stripes([glass({ opacity: 0.5 })]));
		const at = (p: (x: number, y: number) => RGBA) => p(W / 2 + 2, H / 2)[0];
		expect(at(half)).toBeGreaterThan(at(full));
		expect(at(half)).toBeLessThan(255);
	});

	test("a group blurs its rounded box", async () => {
		const px = await paint(
			stripes([
				createGroup([], {
					pos: { x: 20, y: 20 },
					size: { width: 40, height: 40 },
					cornerRadius: 20,
					backdropBlur: 40,
				}),
			]),
		);
		expect(px(58, 21)).toEqual([255, 255, 255, 255]);
		expect(px(58, H / 2)[0]).toBeLessThan(250);
	});

	test("inside an isolated group it reads only the group's own content", async () => {
		const px = await paint(
			stripes([createGroup([glass()], { isolate: true })]),
		);
		expect(px(W / 2, H / 2)).toEqual([255, 255, 255, 255]);
		expect(px(W / 2 - 1, H / 2)).toEqual([0, 0, 0, 255]);
	});

	test("zero is no backdrop", async () => {
		const plain = await paint(stripes([]));
		const zero = await paint(stripes([glass({ backdropBlur: 0 })]));
		for (const [x, y] of [
			[W / 2, H / 2],
			[W / 2 - 1, H / 2],
		] as const)
			expect(zero(x, y)).toEqual(plain(x, y));
	});

	test("a group without a clip lowers its corners to backdropClip", () => {
		const commands = compileScene(
			createGroup([], {
				pos: { x: 0, y: 0 },
				size: { width: 10, height: 10 },
				cornerRadius: 4,
				backdropBlur: 2,
			}),
			{ width: 10, height: 10 },
		);
		const group = commands.find((c) => c.op === "drawGroup") as DrawCommand;
		expect(group.backdropBlur).toBe(2);
		expect(group.backdropClip).toEqual({ kind: "rounded-rect", radius: 4 });
	});

	test("a negative backdropBlur is refused", () => {
		const issues = validateCommands([
			{ op: "createCanvas", width: 10, height: 10 },
			{
				op: "drawRect",
				pos: { x: 0, y: 0 },
				size: { width: 10, height: 10 },
				backdropBlur: -1,
			},
		]);
		expect(issues.map((i) => i.code)).toContain("bad_backdrop_blur");
	});

	test("an adjusted group's offscreen holds a backdrop child", async () => {
		const pairs: [number[] | null, number[]][] = [];
		auditAdjustedBounds((predicted, recorded) =>
			pairs.push([predicted, recorded]),
		);
		try {
			const px = await paint(
				stripes([
					createGroup(
						[
							createRect({
								pos: { x: 10, y: 10 },
								size: { width: 30, height: 30 },
								fills: [{ kind: "solid", color: "#ff0000" }],
							}),
							glass(),
						],
						{ adjust: buildAdjust({ gamma: 1.4, sharpen: 0.5 }) },
					),
				]),
			);
			expect(px(42, 30)[0]).toBe(255);
			expect(px(42, 30)[1]).toBeLessThan(250);
		} finally {
			auditAdjustedBounds(undefined);
		}
		expect(pairs.length).toBeGreaterThan(0);
		for (const [p, r] of pairs) {
			expect(p).not.toBeNull();
			const [pl, pt, pr, pb] = p as number[];
			expect(pl <= r[0] && pt <= r[1] && pr >= r[2] && pb >= r[3]).toBe(true);
		}
	});

	test("bounded and unbounded layers paint a backdrop child the same", async () => {
		const scene = stripes([
			createGroup(
				[
					createRect({
						pos: { x: 10, y: 10 },
						size: { width: 30, height: 30 },
						fills: [{ kind: "solid", color: "#ff0000" }],
					}),
					glass({ rotation: 15 }),
				],
				{ opacity: 0.8 },
			),
		]);
		const bytes = async () =>
			(
				(await renderSceneToPng(scene, {
					width: W,
					height: H,
					ck,
				})) as EncodedPaintResult
			).bytes;
		const bounded = await bytes();
		setLayerBounds(false);
		try {
			expect(await bytes()).toEqual(bounded);
		} finally {
			setLayerBounds(true);
		}
	});
});
