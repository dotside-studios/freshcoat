import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { paintScene } from "../src/canvaskit";
import { createSharedFontProvider } from "../src/font-collection";
import { deriveFontMetrics } from "../src/font-metrics";
import {
	type Command,
	compileScene,
	createFrame,
	createPaintCache,
	createText,
} from "../src/index";
import type { Node } from "../src/node";
import { createParagraphEngine } from "../src/paragraph-layout";
import { initCanvasKit } from "../src/platform/node";
import { createRenderer } from "../src/renderer";
import { createHeadlessEnv } from "./helpers/headless";
import { heapInUse } from "./helpers/heap";

const GEIST = testFontBytes("Geist-Regular.ttf");
const VEND = testFontBytes("VendSans-Variable-latin.woff2");
const SIZE = { width: 120, height: 40 };

let ck: any;
let restore: (() => void)[] = [];

beforeAll(async () => {
	ck = await loadCanvasKit();
});

afterEach(() => {
	for (const undo of restore.reverse()) undo();
	restore = [];
});

type Made = { provider: any; registered: string[]; deleted: number };

// Records every provider made, the families registered into it and how often
// it is deleted, and which provider each FontCollection resolves through.
function trackProviders(on: any = ck) {
	const made: Made[] = [];
	const collections: any[] = [];
	const factory = on.TypefaceFontProvider;
	const make = factory.Make;
	factory.Make = () => {
		const provider = make.call(factory);
		const entry: Made = { provider, registered: [], deleted: 0 };
		const register = provider.registerFont.bind(provider);
		provider.registerFont = (bytes: ArrayBuffer, family: string) => {
			entry.registered.push(family);
			return register(bytes, family);
		};
		const del = provider.delete.bind(provider);
		provider.delete = () => {
			entry.deleted++;
			del();
		};
		made.push(entry);
		return provider;
	};
	const fcFactory = on.FontCollection;
	const makeFc = fcFactory.Make;
	fcFactory.Make = () => {
		const fc = makeFc.call(fcFactory);
		const setDefault = fc.setDefaultFontManager.bind(fc);
		fc.setDefaultFontManager = (provider: any) => {
			collections.push(provider);
			setDefault(provider);
		};
		return fc;
	};
	restore.push(() => {
		factory.Make = make;
		fcFactory.Make = makeFc;
	});
	return { made, collections };
}

function textScene(family: string): Node {
	return createFrame({
		pos: { x: 0, y: 0 },
		size: SIZE,
		children: [
			createText({
				pos: { x: 4, y: 4 },
				size: { width: SIZE.width - 8, height: 24 },
				text: "Membership",
				font: { family, weight: 400, style: "normal", size: 16, lineHeight: 1.2 },
				color: "#101828",
			}),
		],
	});
}

describe("one font provider per renderer", () => {
	for (const cache of [{}, false] as const) {
		test(`layout and paint share it (cache ${cache ? "on" : "off"})`, async () => {
			const { made, collections } = trackProviders();
			const renderer = await createRenderer({
				ck,
				cache,
				fonts: { Geist: [GEIST], Vend: [VEND] },
			});
			const frame = await renderer.render(textScene("Geist"), SIZE);
			expect(frame.warnings).toEqual([]);
			await renderer.render(textScene("Vend"), SIZE);
			expect(made).toHaveLength(1);
			expect(made[0]!.registered).toEqual(["Geist", "Vend"]);
			expect(collections.length).toBeGreaterThan(0);
			expect(collections.every((p) => p === made[0]!.provider)).toBe(true);
			renderer.dispose();
			expect(made[0]!.deleted).toBe(1);
		});
	}

	test("added fonts are registered into it alone", async () => {
		const { made, collections } = trackProviders();
		const renderer = await createRenderer({ ck, fonts: { Geist: [GEIST] } });
		await renderer.render(textScene("Geist"), SIZE);
		await renderer.addFonts({ Vend: [VEND] });
		const frame = await renderer.render(textScene("Vend"), SIZE);
		expect(frame.warnings).toEqual([]);
		expect(made).toHaveLength(1);
		expect(made[0]!.registered).toEqual(["Geist", "Vend"]);
		expect(new Set(collections)).toEqual(new Set([made[0]!.provider]));
		expect(renderer.stats().paintCache?.fontProviderBuilds).toBe(2);
		renderer.dispose();
		expect(made[0]!.deleted).toBe(1);
	});

	test("added fonts lay out and paint as fonts given up front", async () => {
		const upFront = await createRenderer({
			ck,
			fonts: { Geist: [GEIST], Vend: [VEND] },
		});
		const added = await createRenderer({ ck, fonts: { Geist: [GEIST] } });
		const scene = textScene("Vend");
		await added.render(scene, SIZE);
		await added.addFonts({ Vend: [VEND] });
		const want = await upFront.render(scene, { ...SIZE, output: { pixels: true } });
		const got = await added.render(scene, { ...SIZE, output: { pixels: true } });
		expect(got.pixels).toEqual(want.pixels);
		upFront.dispose();
		added.dispose();
	});

	test("replacing a family's bytes rebuilds it once", async () => {
		const { made } = trackProviders();
		const renderer = await createRenderer({ ck, fonts: { Geist: [GEIST] } });
		await renderer.render(textScene("Geist"), SIZE);
		await renderer.addFonts({ Geist: [GEIST.slice()] });
		await renderer.render(textScene("Geist"), SIZE);
		await renderer.render(textScene("Geist"), SIZE);
		expect(made).toHaveLength(2);
		expect(made[0]!.deleted).toBe(1);
		expect(made[1]!.deleted).toBe(0);
		renderer.dispose();
		expect(made[1]!.deleted).toBe(1);
	});

	test("fonts added during a paint do not free the provider it uses", async () => {
		const { made } = trackProviders();
		let unblock = () => {};
		const blocked = new Promise<void>((resolve) => {
			unblock = resolve;
		});
		const renderer = await createRenderer({
			ck,
			fonts: { Geist: [GEIST] },
			load: async () => {
				await blocked;
				return VEND.slice();
			},
		});
		const [canvas, ...rest] = renderer.compile(textScene("Geist"), SIZE);
		const late = renderer.paint([
			canvas!,
			{
				op: "loadFonts",
				requests: [
					{
						family: "Late",
						descriptor: {
							kind: "local",
							family: "Late",
							files: [{ weight: 400, src: "fonts/late.woff2" }],
						},
					},
				],
			} as Command,
			...rest,
		]);
		await renderer.addFonts({ Geist: [GEIST.slice()] });
		renderer.compile(textScene("Geist"), SIZE);
		expect(made[0]!.deleted).toBe(0);
		unblock();
		expect((await late).warnings).toEqual([]);
		expect(made[0]!.deleted).toBe(1);
		renderer.dispose();
		expect(made.every((m) => m.deleted === 1)).toBe(true);
	});
});

describe("shared provider disposal", () => {
	const fonts = new Map([["Geist", [GEIST]]]);
	const layout = (engine: ReturnType<typeof createParagraphEngine>) =>
		engine.measureText(
			"Membership",
			{ family: "Geist", weight: 400, style: "normal", size: 16, lineHeight: 1.2 },
			null,
		);

	const orders = [
		["owner", "engine", "cache"],
		["owner", "cache", "engine"],
		["engine", "owner", "cache"],
		["engine", "cache", "owner"],
		["cache", "owner", "engine"],
		["cache", "engine", "owner"],
	] as const;

	for (const order of orders) {
		test(`released ${order.join(", ")}: freed once, after the last`, async () => {
			const { made } = trackProviders();
			const shared = createSharedFontProvider(ck, fonts);
			const engine = createParagraphEngine(ck, fonts, shared);
			const cache = createPaintCache();
			const env = createHeadlessEnv({ fonts, cache });
			const commands = compileScene(textScene("Geist"), {
				...SIZE,
				textEngine: engine,
				fontMetrics: deriveFontMetrics(fonts),
			});
			const paint = async () =>
				(
					await paintScene(ck, commands, env, { fontProvider: shared })
				).dispose();
			await paint();
			expect(made).toHaveLength(1);

			const release = {
				owner: () => shared.release(),
				engine: () => engine.dispose(),
				cache: () => cache.dispose(),
			};
			const released = new Set<string>();
			for (const who of order) {
				release[who]();
				released.add(who);
				expect(made[0]!.deleted).toBe(released.size === order.length ? 1 : 0);
				if (!released.has("engine"))
					expect(layout(engine).width).toBeGreaterThan(0);
				if (!released.has("cache")) await paint();
			}
			expect(() => shared.retain()).toThrow(/released/);
		});
	}

	test("disposing an engine twice releases once", () => {
		const { made } = trackProviders();
		const shared = createSharedFontProvider(ck, fonts);
		const engine = createParagraphEngine(ck, fonts, shared);
		engine.dispose();
		engine.dispose();
		expect(made[0]!.deleted).toBe(0);
		expect(layout(createParagraphEngine(ck, fonts, shared)).width).toBeGreaterThan(0);
		shared.release();
	});
});

describe("font heap cost", () => {
	test("each font's bytes are copied into the heap once", async () => {
		// A fresh instance, so earlier tests' freed blocks do not hide growth.
		const fresh: any = await initCanvasKit();
		const n = 100;
		const fonts: Record<string, Uint8Array[]> = {};
		for (let i = 0; i < n; i++) fonts[`F${i}`] = [GEIST.slice()];
		const total = n * GEIST.byteLength;
		const before = heapInUse(fresh);
		const renderer = await createRenderer({ ck: fresh, fonts });
		await renderer.render(textScene("F0"), SIZE);
		const growth = heapInUse(fresh) - before;
		expect(growth).toBeGreaterThan(0.9 * total);
		expect(growth).toBeLessThan(1.3 * total);
		renderer.dispose();
	});
});
