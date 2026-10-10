// Work the painter does once per cached line, scene or paint rather than once
// per span, run or nesting level, counted through spies on CanvasKit.
import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { drawableBounds, makeBin, paintScene } from "../src/canvaskit";
import { compileScene } from "../src/compile-scene";
import { deriveFontMetrics } from "../src/font-metrics";
import { createSharedFontProvider } from "../src/font-collection";
import { createPaintCache, type PaintCache } from "../src/index";
import { encodePng } from "../src/png";
import {
	createFrame,
	createImage,
	createRect,
	createText,
	type Node,
} from "../src/node";
import { paintCacheState } from "../src/paint-cache-state";
import { createParagraphEngine } from "../src/paragraph-layout";
import type { Command, FrameFinish, ResolvedFont } from "../src/types";
import { createHeadlessEnv } from "./helpers/headless";

const geist = new Map([["Geist", [testFontBytes("Geist-Regular.ttf")]]]);
const FONT: ResolvedFont = {
	family: "Geist",
	weight: 400,
	style: "normal",
	size: 16,
	lineHeight: 1.2,
};

let ck: any;
beforeAll(async () => {
	ck = await loadCanvasKit();
});
afterEach(() => {
	vi.restoreAllMocks();
});

function compile(
	node: Node,
	width: number,
	height: number,
	finish?: FrameFinish,
): Command[] {
	const textEngine = createParagraphEngine(ck, geist);
	try {
		return compileScene(node, {
			width,
			height,
			textEngine,
			fontMetrics: deriveFontMetrics(geist),
			...(finish ? { finish } : {}),
		});
	} finally {
		textEngine.dispose();
	}
}

async function paint(
	commands: Command[],
	cache?: PaintCache,
	origin?: { x: number; y: number },
) {
	const env = createHeadlessEnv({ fonts: geist, cache });
	const out = await paintScene(ck, commands, env, origin ? { origin } : {});
	const px = out.readPixels?.();
	out.dispose();
	return px?.data as Uint8Array;
}

// Constructions of ck.Font while `run` paints.
async function countFonts(run: () => Promise<unknown>): Promise<number> {
	const Font = ck.Font;
	let n = 0;
	ck.Font = new Proxy(Font, {
		construct(target, args) {
			n++;
			return new target(...args);
		},
	});
	try {
		await run();
		return n;
	} finally {
		ck.Font = Font;
	}
}

const underlined = (spans: number): Node =>
	createFrame({
		pos: { x: 0, y: 0 },
		size: { width: 300, height: 40 },
		children: [
			createText({
				pos: { x: 4, y: 4 },
				size: { width: 290, height: 30 },
				spans: Array.from({ length: spans }, (_, i) => ({
					text: `gypsy jumpy ${i} `,
					font: { decoration: "underline" as const },
					color: i % 2 ? "#101828" : "#b42318",
				})),
				font: FONT,
				color: "#101828",
			}),
		],
	});

describe("skip-ink underlines", () => {
	test("build one font per run, however many spans cross it", async () => {
		const fonts = (spans: number) => {
			const commands = compile(underlined(spans), 300, 40);
			return countFonts(() => paint(commands));
		};
		const one = await fonts(1);
		const many = await fonts(6);
		// Six spans add runs of their own but no font per span and run.
		expect(many).toBeLessThanOrEqual(one + 6);
	});
});

describe("cached shaped lines", () => {
	test("keep their glyph runs and free the typefaces with the line", async () => {
		const commands = compile(underlined(3), 300, 40);
		const cache = createPaintCache();
		const typefaces: any[] = [];
		const lines = ck.Paragraph.prototype.getShapedLines;
		let calls = 0;
		ck.Paragraph.prototype.getShapedLines = function () {
			calls++;
			const out = lines.call(this);
			for (const l of out) for (const r of l.runs) typefaces.push(r.typeface);
			return out;
		};
		try {
			const first = await paint(commands, cache);
			const after = calls;
			expect(after).toBeGreaterThan(0);
			const second = await paint(commands, cache);
			expect(calls).toBe(after);
			expect(second).toEqual(first);
			expect(typefaces.length).toBeGreaterThan(0);
			expect(typefaces.every((t) => !t.isDeleted())).toBe(true);
			cache.clear();
			expect(typefaces.every((t) => t.isDeleted())).toBe(true);
		} finally {
			ck.Paragraph.prototype.getShapedLines = lines;
			cache.dispose();
		}
	});
});

describe("cached arc text", () => {
	test("derives its spacing once and paints the same", async () => {
		const node = createFrame({
			pos: { x: 0, y: 0 },
			size: { width: 200, height: 200 },
			children: [
				createText({
					pos: { x: 0, y: 0 },
					size: { width: 200, height: 200 },
					font: { ...FONT, letterSpacing: 2 },
					color: "#000000",
					text: "SEAL OF QUALITY",
					arc: {
						radius: 70,
						startAngle: 0,
						direction: "outside",
						align: "center",
					},
				}),
			],
		});
		const commands = compile(node, 200, 200);
		const cache = createPaintCache();
		const from = Float32Array.from;
		let spacings = 0;
		try {
			const first = await paint(commands, cache);
			Float32Array.from = ((...args: Parameters<typeof from>) => {
				spacings++;
				return from.apply(Float32Array, args);
			}) as typeof from;
			expect(await paint(commands, cache)).toEqual(first);
		} finally {
			Float32Array.from = from;
			cache.dispose();
		}
		expect(spacings).toBe(0);
	});
});

describe("rows culled off screen", () => {
	test("stay cached while another part of the scene is painted", async () => {
		const rows = 20;
		const node = createFrame({
			pos: { x: 0, y: 0 },
			size: { width: 120, height: rows * 20 },
			children: Array.from({ length: rows }, (_, i) =>
				createText({
					pos: { x: 4, y: i * 20 },
					size: { width: 110, height: 20 },
					text: `line number ${i}`,
					font: FONT,
					color: "#101828",
				}),
			),
		});
		const [canvas, ...draws] = compile(node, 120, rows * 20);
		const window = [
			{ ...canvas, width: 120, height: 60 },
			...draws,
		] as Command[];
		const cache = createPaintCache();
		const builds = () => paintCacheState(cache).stats.paragraphBuilds;
		try {
			const top = await paint(window, cache, { x: 0, y: 0 });
			const afterTop = builds();
			await paint(window, cache, { x: 0, y: 240 });
			const afterScroll = builds();
			expect(afterScroll).toBeGreaterThan(afterTop);
			expect(await paint(window, cache, { x: 0, y: 0 })).toEqual(top);
			expect(builds()).toBe(afterScroll);
		} finally {
			cache.dispose();
		}
	});
});

describe("shaping that throws", () => {
	test("frees the builder and the paragraph", async () => {
		const commands = compile(underlined(1), 300, 40);
		const make = ck.ParagraphBuilder.MakeFromFontCollection;
		const freed = { builder: 0, para: 0 };
		ck.ParagraphBuilder.MakeFromFontCollection = (...args: unknown[]) => {
			const builder = make.apply(ck.ParagraphBuilder, args);
			const del = builder.delete.bind(builder);
			builder.delete = () => {
				freed.builder++;
				del();
			};
			const build = builder.build.bind(builder);
			builder.build = () => {
				const para = build();
				const paraDel = para.delete.bind(para);
				para.delete = () => {
					freed.para++;
					paraDel();
				};
				para.layout = () => {
					throw new Error("layout failed");
				};
				return para;
			};
			return builder;
		};
		try {
			await expect(paint(commands)).rejects.toThrow("layout failed");
		} finally {
			ck.ParagraphBuilder.MakeFromFontCollection = make;
		}
		expect(freed).toEqual({ builder: 1, para: 1 });
	});

	test("frees a typeface whose font box cannot be measured", () => {
		const shared = createSharedFontProvider(ck, geist);
		const bin = makeBin();
		const match = shared.provider.matchFamilyStyle.bind(shared.provider);
		const matched: any[] = [];
		shared.provider.matchFamilyStyle = (...args: Parameters<typeof match>) => {
			const typeface = match(...args);
			matched.push(typeface);
			return typeface;
		};
		const cmd = compile(underlined(1), 300, 40).find(
			(c) => c.op === "drawGroup",
		);
		const Font = ck.Font;
		ck.Font = function () {
			throw new Error("no font");
		};
		try {
			expect(() =>
				drawableBounds(ck, shared.provider, bin, cmd as never, 1),
			).toThrow("no font");
		} finally {
			ck.Font = Font;
			bin.free();
			shared.release();
		}
		expect(matched.length).toBeGreaterThan(0);
		expect(matched.every((t) => !t || t.isDeleted())).toBe(true);
	});
});

describe("the CPU finish", () => {
	const frame = (color: string) =>
		createFrame({
			pos: { x: 0, y: 0 },
			size: { width: 64, height: 64 },
			children: [
				createRect({
					pos: { x: 0, y: 0 },
					size: { width: 32, height: 64 },
					fills: [{ kind: "solid", color }],
				}),
			],
		});

	// Calls to `method` of ck.Canvas while `run` paints.
	async function countCalls(
		method: "readPixels" | "writePixels",
		run: () => Promise<unknown>,
	) {
		const proto = ck.Canvas.prototype;
		const real = proto[method];
		let n = 0;
		proto[method] = function (...args: unknown[]) {
			n++;
			return real.apply(this, args);
		};
		try {
			await run();
			return n;
		} finally {
			proto[method] = real;
		}
	}

	test("stops reading back a frame that had translucent pixels", async () => {
		const scene = frame("#2f6fed80");
		const reads = async (finish?: FrameFinish) => {
			const commands = compile(scene, 64, 64, finish);
			const cache = createPaintCache();
			try {
				await paint(commands, cache);
				return await countCalls("readPixels", async () => {
					for (let i = 0; i < 10; i++) await paint(commands, cache);
				});
			} finally {
				cache.dispose();
			}
		};
		// Eight paints skip the read, the ninth looks again.
		expect((await reads({ whiteClamp: 200 })) - (await reads())).toBe(1);
	});

	test("takes an opaque frame again once it looks", async () => {
		const finish = { whiteClamp: 200 };
		const translucent = compile(frame("#2f6fed80"), 64, 64, finish);
		const opaque = compile(frame("#2f6fed"), 64, 64, finish);
		const cache = createPaintCache();
		try {
			await paint(translucent, cache);
			const writes = await countCalls("writePixels", async () => {
				for (let i = 0; i < 12; i++) await paint(opaque, cache);
			});
			expect(writes).toBeGreaterThan(0);
		} finally {
			cache.dispose();
		}
	});
});

describe("tiled images", () => {
	const SVG = new TextEncoder().encode(
		'<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="4" height="8" fill="#b42318"/></svg>',
	);

	async function tiles(src: string, bytes: Uint8Array) {
		const tile = (x: number) =>
			createImage({
				pos: { x, y: 0 },
				size: { width: 30, height: 30 },
				src,
				fit: "tile",
			});
		const commands = compile(
			createFrame({
				pos: { x: 0, y: 0 },
				size: { width: 64, height: 32 },
				children: [tile(0), tile(32)],
			}),
			64,
			32,
		);
		const cache = createPaintCache();
		const env = createHeadlessEnv({
			fonts: geist,
			images: new Map([[src, bytes]]),
			cache,
		});
		try {
			const frames: Uint8Array[] = [];
			for (let i = 0; i < 3; i++) {
				const out = await paintScene(ck, commands, env);
				frames.push(out.readPixels?.()?.data as Uint8Array);
				out.dispose();
			}
			expect(frames[1]).toEqual(frames[0]);
			expect(frames[2]).toEqual(frames[0]);
		} finally {
			cache.dispose();
		}
	}

	// Calls to `method` of `proto` while `run` goes.
	async function countCalls(proto: any, method: string, run: () => Promise<void>) {
		const real = proto[method];
		let n = 0;
		proto[method] = function (...args: unknown[]) {
			n++;
			return real.apply(this, args);
		};
		try {
			await run();
			return n;
		} finally {
			proto[method] = real;
		}
	}

	test("build a raster's shader once for the cache", async () => {
		const px = new Uint8Array(4 * 4 * 4).map((_, i) => (i % 4 === 3 ? 255 : i * 9));
		const png = await encodePng(px, 4, 4);
		const made = await countCalls(ck.Image.prototype, "makeShaderOptions", () =>
			tiles("img://tile.png", png),
		);
		expect(made).toBe(1);
	});

	test("build a picture's shader once for the cache", async () => {
		const made = await countCalls(ck.Picture.prototype, "makeShader", () =>
			tiles("img://tile.svg", SVG),
		);
		expect(made).toBe(1);
	});
});
