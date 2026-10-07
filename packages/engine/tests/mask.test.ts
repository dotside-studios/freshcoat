// Phase 4: the unified mask node. Lowering picks the implementation by what the
// mask IS — a single opaque shape → a drawGroup with a clipPath (fast), anything
// else → a drawMasked offscreen-coverage command (general). Both render.
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test } from "vitest";
import { createHeadlessEnv } from "../src/headless";
import type { MeasureText } from "../src/index";
import {
	autoLayout,
	compileScene,
	createEllipse,
	createGroup,
	createImage,
	createMask,
	createRect,
	resolveLayout,
} from "../src/index";
import type { GroupNode, MaskNode, Node } from "../src/node";
import type { Command, DrawCommand } from "../src/types";

const solid = (color: string) => [{ kind: "solid" as const, color }];
const measure: MeasureText = () => ({ width: 0, height: 0 });
const clipOf = (cmd: DrawCommand) =>
	cmd.op === "drawGroup" && cmd.children[0]?.op === "drawGroup"
		? cmd.children[0].clip
		: undefined;

describe("mask lowering — fast path (shape → clipPath)", () => {
	test("ellipse mask → drawGroup with an ellipse clip at the mask box", () => {
		const scene = createMask(
			createEllipse({
				pos: { x: 5, y: 5 },
				size: { width: 40, height: 40 },
				fills: solid("#fff"),
			}),
			[
				createRect({
					pos: { x: 0, y: 0 },
					size: { width: 50, height: 50 },
					fills: solid("#f00"),
				}),
			],
		);
		const draw = compileScene(scene, { width: 50, height: 50 }).at(-1);
		if (draw?.op !== "drawGroup") throw new Error("expected drawGroup");
		expect(draw.clip).toBeUndefined();
		const inner = draw.children[0];
		if (inner?.op !== "drawGroup") throw new Error("expected inner drawGroup");
		expect(inner.clip).toEqual({ kind: "ellipse" });
		expect(inner.pos).toEqual({ x: 5, y: 5 });
		expect(inner.size).toEqual({ width: 40, height: 40 });
		expect(inner.children[0].op).toBe("drawRect");
	});

	test("rounded rect mask → rounded-rect clip; squircle when smoothed", () => {
		const rounded = compileScene(
			createMask(
				createRect({
					size: { width: 20, height: 20 },
					cornerRadius: 6,
					fills: solid("#fff"),
				}),
				[createRect({ size: { width: 20, height: 20 }, fills: solid("#f00") })],
			),
			{ width: 20, height: 20 },
		).at(-1);
		if (rounded?.op !== "drawGroup") throw new Error("expected drawGroup");
		expect(clipOf(rounded)).toEqual({ kind: "rounded-rect", radius: 6 });

		const squircle = compileScene(
			createMask(
				createRect({
					size: { width: 20, height: 20 },
					cornerRadius: 6,
					cornerSmoothing: 0.6,
					fills: solid("#fff"),
				}),
				[createRect({ size: { width: 20, height: 20 }, fills: solid("#f00") })],
			),
			{ width: 20, height: 20 },
		).at(-1);
		if (squircle?.op !== "drawGroup") throw new Error("expected drawGroup");
		expect(clipOf(squircle)).toEqual({
			kind: "squircle",
			radius: 6,
			smoothing: 0.6,
		});
	});
});

describe("mask lowering — slow path (offscreen coverage)", () => {
	test("image mask → drawMasked carrying mask + children", () => {
		const scene = createMask(
			createImage({
				size: { width: 40, height: 40 },
				src: "mask.png",
				fit: "cover",
			}),
			[createRect({ size: { width: 40, height: 40 }, fills: solid("#f00") })],
			{ channel: "luminance", invert: true },
		);
		const draw = compileScene(scene, { width: 40, height: 40 }).at(-1);
		if (draw?.op !== "drawMasked") throw new Error("expected drawMasked");
		expect(draw.mask.op).toBe("drawImage");
		expect(draw.children[0].op).toBe("drawRect");
		expect(draw.channel).toBe("luminance");
		expect(draw.invert).toBe(true);
	});

	// The fast-path predicate reads the MASK, so a plain shape qualified however
	// the mask NODE was configured, and a clipPath carries neither flag: invert
	// rendered as a normal clip, and an opaque black mask under `luminance` kept
	// the content a zero-luminance mask must drop.
	test("invert disqualifies the fast path even for a plain shape", () => {
		const scene = createMask(
			createRect({ size: { width: 40, height: 40 }, fills: solid("#000") }),
			[createRect({ size: { width: 40, height: 40 }, fills: solid("#f00") })],
			{ invert: true },
		);
		const draw = compileScene(scene, { width: 40, height: 40 }).at(-1);
		if (draw?.op !== "drawMasked")
			throw new Error("expected drawMasked, not a clip");
		expect(draw.invert).toBe(true);
	});

	test("luminance disqualifies it too: an opaque shape's coverage is its colour", () => {
		const scene = createMask(
			createRect({ size: { width: 40, height: 40 }, fills: solid("#000") }),
			[createRect({ size: { width: 40, height: 40 }, fills: solid("#f00") })],
			{ channel: "luminance" },
		);
		const draw = compileScene(scene, { width: 40, height: 40 }).at(-1);
		if (draw?.op !== "drawMasked")
			throw new Error("expected drawMasked, not a clip");
		expect(draw.channel).toBe("luminance");
	});

	test("a gradient-filled shape is not a fast clip (partial alpha) → drawMasked", () => {
		const scene = createMask(
			createRect({
				size: { width: 40, height: 40 },
				fills: [
					{
						kind: "linear",
						stops: [
							{ offset: 0, color: "#fff" },
							{ offset: 1, color: "#000" },
						],
						from: { x: 0, y: 0 },
						to: { x: 1, y: 0 },
					},
				],
			}),
			[createRect({ size: { width: 40, height: 40 }, fills: solid("#00f") })],
		);
		expect(compileScene(scene, { width: 40, height: 40 }).at(-1)?.op).toBe(
			"drawMasked",
		);
	});

	test("transform effects on the mask fall back to the slow path", () => {
		const scene = createMask(
			createEllipse({
				size: { width: 40, height: 40 },
				fills: solid("#fff"),
				opacity: 0.5,
			}),
			[createRect({ size: { width: 40, height: 40 }, fills: solid("#f00") })],
		);
		expect(compileScene(scene, { width: 40, height: 40 }).at(-1)?.op).toBe(
			"drawMasked",
		);
	});

	test("a group mask → drawMasked", () => {
		const scene = createMask(
			createGroup([
				createRect({ size: { width: 40, height: 40 }, fills: solid("#fff") }),
			]),
			[createRect({ size: { width: 40, height: 40 }, fills: solid("#f00") })],
		);
		expect(compileScene(scene, { width: 40, height: 40 }).at(-1)?.op).toBe(
			"drawMasked",
		);
	});
});

describe("mask resolveLayout", () => {
	test("folds the mask node's pos into its mask + children (absolute)", () => {
		const node: MaskNode = {
			kind: "mask",
			pos: { x: 50, y: 50 },
			size: { width: 40, height: 40 },
			mask: createEllipse({
				pos: { x: 0, y: 0 },
				size: { width: 40, height: 40 },
				fills: solid("#fff"),
			}),
			children: [
				createRect({
					pos: { x: 10, y: 10 },
					size: { width: 20, height: 20 },
					fills: solid("#f00"),
				}),
			],
		};
		const out = resolveLayout(node, { measure }) as MaskNode;
		expect(out.mask.pos).toEqual({ x: 50, y: 50 });
		expect(out.children[0].pos).toEqual({ x: 60, y: 60 });
	});

	test("a mask placed by a flex parent resolves absolutely", () => {
		const mask: MaskNode = {
			kind: "mask",
			mask: createEllipse({
				pos: { x: 0, y: 0 },
				size: { width: 20, height: 20 },
				fills: solid("#fff"),
			}),
			children: [
				createRect({
					pos: { x: 0, y: 0 },
					size: { width: 20, height: 20 },
					fills: solid("#f00"),
				}),
			],
			layoutChild: { width: 20, height: 20 },
		};
		const parent = autoLayout(
			createGroup([createRect({ size: { width: 20, height: 20 } }), mask], {
				pos: { x: 100, y: 100 },
				size: { width: 200, height: 40 },
			}),
			{ direction: "row", gap: 10 },
		);
		const out = resolveLayout(parent, { measure }) as GroupNode;
		const placed = out.children[1] as MaskNode;
		expect(placed.pos).toEqual({ x: 130, y: 100 }); // 100 + 20 + 10
		expect(placed.children[0].pos).toEqual({ x: 130, y: 100 });
	});
});

describe("mask render smoke", () => {
	let ck: any;
	async function initCk() {
		if (!ck)
			ck = await loadCanvasKit();
		return ck;
	}
	async function paint(scene: Parameters<typeof compileScene>[0]) {
		const k = await initCk();
		const commands = compileScene(scene, { width: 40, height: 40 });
		const result = await createHeadlessEnv().paint(commands, k);
		return (result as { bytes: Uint8Array }).bytes;
	}

	test("fast path (ellipse clip) paints to PNG", async () => {
		const png = await paint(
			createMask(
				createEllipse({
					size: { width: 40, height: 40 },
					fills: solid("#fff"),
				}),
				[
					createRect({
						size: { width: 40, height: 40 },
						fills: solid("#f97316"),
					}),
				],
			),
		);
		expect([png[0], png[1], png[2], png[3]]).toEqual([137, 80, 78, 71]);
	});

	test("slow path (offscreen coverage) paints to PNG", async () => {
		const png = await paint(
			createMask(
				createRect({
					size: { width: 40, height: 40 },
					fills: [
						{
							kind: "linear",
							stops: [
								{ offset: 0, color: "#fff" },
								{ offset: 1, color: "#000" },
							],
							from: { x: 0, y: 0 },
							to: { x: 1, y: 0 },
						},
					],
				}),
				[
					createRect({
						size: { width: 40, height: 40 },
						fills: solid("#00b4d8"),
					}),
				],
			),
		);
		expect([png[0], png[1], png[2], png[3]]).toEqual([137, 80, 78, 71]);
	});
});

describe("mask fast path preserves pixels", () => {
	let ck: any;
	beforeAll(async () => {
		ck = await loadCanvasKit();
	});
	const W = 80;
	const H = 80;

	async function pixels(scene: MaskNode): Promise<Uint8Array> {
		return paintPixels(compileScene(scene, { width: W, height: H }));
	}

	// The general path for a mask the fast path would take: lower it with
	// `luminance` to get a drawMasked, then paint it on the alpha channel.
	function generalCommands(scene: MaskNode): Command[] {
		const commands = compileScene(
			{ ...scene, channel: "luminance" },
			{ width: W, height: H },
		);
		const last = commands.at(-1);
		if (last?.op !== "drawMasked") throw new Error("expected drawMasked");
		return [...commands.slice(0, -1), { ...last, channel: undefined }];
	}

	async function paintPixels(commands: Command[]): Promise<Uint8Array> {
		const { bytes } = (await createHeadlessEnv().paint(commands, ck)) as {
			bytes: Uint8Array;
		};
		const img = ck.MakeImageFromEncoded(bytes);
		const buf = img.readPixels(
			0,
			0,
			{
				width: W,
				height: H,
				colorType: ck.ColorType.RGBA_8888,
				alphaType: ck.AlphaType.Unpremul,
				colorSpace: ck.ColorSpace.SRGB,
			},
			undefined,
			W * 4,
		) as Uint8Array;
		img.delete();
		return buf;
	}

	const at = (buf: Uint8Array, x: number, y: number) =>
		Array.from(buf.slice((y * W + x) * 4, (y * W + x) * 4 + 4));

	function alphaDiff(a: Uint8Array, b: Uint8Array) {
		let max = 0;
		let total = 0;
		for (let i = 3; i < a.length; i += 4) {
			const d = Math.abs(a[i] - b[i]);
			max = Math.max(max, d);
			total += d;
		}
		return { max, total };
	}

	const content = () => [
		createRect({
			pos: { x: 0, y: 0 },
			size: { width: W, height: H },
			fills: solid("#ff0000"),
		}),
	];

	const shapes: [string, () => Node][] = [
		[
			"rect",
			() =>
				createRect({
					pos: { x: 22, y: 14 },
					size: { width: 34, height: 26 },
					fills: solid("#fff"),
				}),
		],
		[
			"rounded rect",
			() =>
				createRect({
					pos: { x: 22, y: 14 },
					size: { width: 34, height: 26 },
					cornerRadius: 8,
					fills: solid("#fff"),
				}),
		],
		[
			"squircle",
			() =>
				createRect({
					pos: { x: 22, y: 14 },
					size: { width: 34, height: 26 },
					cornerRadius: 8,
					cornerSmoothing: 0.6,
					fills: solid("#fff"),
				}),
		],
		[
			"ellipse",
			() =>
				createEllipse({
					pos: { x: 22, y: 14 },
					size: { width: 34, height: 26 },
					fills: solid("#fff"),
				}),
		],
	];

	for (const [name, shape] of shapes) {
		for (const rotation of [undefined, 30]) {
			test(`${name}${rotation ? " rotated" : ""}: fast and general paths match`, async () => {
				const opts = {
					pos: { x: 10, y: 10 },
					size: { width: 60, height: 60 },
					rotation,
				};
				const fast = createMask(shape(), content(), opts);
				expect(compileScene(fast, { width: W, height: H }).at(-1)?.op).toBe(
					"drawGroup",
				);
				const a = await pixels(fast);
				const b = await paintPixels(generalCommands(fast));
				const d = alphaDiff(a, b);
				expect(d.max).toBeLessThanOrEqual(8);
			});
		}
	}

	test("a rotated mask pivots around the mask node's box", async () => {
		const opts = {
			pos: { x: 10, y: 10 },
			size: { width: 60, height: 60 },
			rotation: 90,
		};
		const mask = () =>
			createRect({
				pos: { x: 10, y: 10 },
				size: { width: 20, height: 20 },
				fills: solid("#fff"),
			});
		const buf = await pixels(createMask(mask(), content(), opts));
		expect(at(buf, 60, 20)[3]).toBe(255);
		expect(at(buf, 20, 20)[3]).toBe(0);
	});

	const single = (fills: ReturnType<typeof solid> | undefined, extra = {}) =>
		createMask(
			createRect({
				pos: { x: 20, y: 20 },
				size: { width: 40, height: 40 },
				fills,
				...extra,
			}),
			content(),
		);

	test.each([
		["#ffffff80", 128],
		["#fff8", 136],
		["rgba(255, 255, 255, 0.5)", 128],
		["transparent", 0],
	])("solid fill %s lowers to drawMasked with its alpha", async (color, a) => {
		const scene = single(solid(color));
		expect(compileScene(scene, { width: W, height: H }).at(-1)?.op).toBe(
			"drawMasked",
		);
		const alpha = at(await pixels(scene), 40, 40)[3];
		expect(Math.abs(alpha - a)).toBeLessThanOrEqual(1);
	});

	test("a fill-less mask lowers to drawMasked and covers nothing", async () => {
		const scene = single(undefined);
		expect(compileScene(scene, { width: W, height: H }).at(-1)?.op).toBe(
			"drawMasked",
		);
		expect(at(await pixels(scene), 40, 40)[3]).toBe(0);
	});

	test("a stroked mask lowers to drawMasked and its stroke adds coverage", async () => {
		const scene = single(solid("#fff"), {
			stroke: { color: "#fff", width: 8, align: "outside" },
		});
		expect(compileScene(scene, { width: W, height: H }).at(-1)?.op).toBe(
			"drawMasked",
		);
		const buf = await pixels(scene);
		expect(at(buf, 40, 40)[3]).toBe(255);
		expect(at(buf, 16, 40)[3]).toBe(255);
		expect(at(buf, 8, 40)[3]).toBe(0);
	});

	test("an adjusted mask lowers to drawMasked and its alpha terms apply", async () => {
		const colorMatrix = [
			1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0.5, 0,
		];
		const scene = single(solid("#fff"), { adjust: { colorMatrix } });
		expect(compileScene(scene, { width: W, height: H }).at(-1)?.op).toBe(
			"drawMasked",
		);
		const alpha = at(await pixels(scene), 40, 40)[3];
		expect(Math.abs(alpha - 128)).toBeLessThanOrEqual(1);
	});
});
