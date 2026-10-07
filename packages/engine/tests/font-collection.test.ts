import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { paintScene } from "../src/canvaskit";
import { createHeadlessEnv } from "./helpers/headless";
import {
	type Command,
	compileScene,
	createFrame,
	createPaintCache,
	createText,
} from "../src/index";
import { deriveFontMetrics } from "../src/font-metrics";
import type { Node } from "../src/node";
import { createParagraphEngine } from "../src/paragraph-layout";

const GEIST = testFontBytes("Geist-Regular.ttf");
const VEND = testFontBytes("VendSans-Variable-latin.woff2");
const SIZE = { width: 240, height: 120 };

let ck: any;
let restore: (() => void)[] = [];

beforeAll(async () => {
	ck = await loadCanvasKit();
});

afterEach(() => {
	for (const undo of restore.reverse()) undo();
	restore = [];
});

type Made = { fc: any; provider: any; deleted: number };

// Records every FontCollection made and how often each is deleted.
function trackCollections(): Made[] {
	const made: Made[] = [];
	const factory = ck.FontCollection;
	const make = factory.Make;
	factory.Make = () => {
		const fc = make.call(factory);
		const entry: Made = { fc, provider: null, deleted: 0 };
		const setDefault = fc.setDefaultFontManager.bind(fc);
		fc.setDefaultFontManager = (provider: any) => {
			entry.provider = provider;
			setDefault(provider);
		};
		const del = fc.delete.bind(fc);
		fc.delete = () => {
			entry.deleted++;
			del();
		};
		made.push(entry);
		return fc;
	};
	restore.push(() => {
		factory.Make = make;
	});
	return made;
}

// Builds every paragraph the way it was built before the shared collection:
// a fresh collection per paragraph, from the provider.
function perParagraphCollections(): void {
	const made = trackCollections();
	const builder = ck.ParagraphBuilder;
	const fromCollection = builder.MakeFromFontCollection;
	builder.MakeFromFontCollection = (style: any, fc: any) => {
		const entry = made.find((m) => m.fc === fc);
		return builder.MakeFromFontProvider(style, entry?.provider);
	};
	restore.push(() => {
		builder.MakeFromFontCollection = fromCollection;
	});
}

function textScene(family: string, weights: number[]): Node {
	return createFrame({
		pos: { x: 0, y: 0 },
		size: SIZE,
		children: weights.map((weight, i) =>
			createText({
				pos: { x: 4, y: 4 + i * 28 },
				size: { width: SIZE.width - 8, height: 24 },
				text: `Membership ${weight}`,
				font: {
					family,
					weight,
					style: "normal",
					size: 20,
					lineHeight: 1.2,
				},
				color: "#101828",
			}),
		),
	});
}

function compile(node: Node, fonts: Map<string, Uint8Array[]>): Command[] {
	const textEngine = createParagraphEngine(ck, fonts);
	try {
		return compileScene(node, {
			...SIZE,
			textEngine,
			fontMetrics: deriveFontMetrics(fonts),
		});
	} finally {
		textEngine.dispose();
	}
}

async function render(node: Node, fonts: Map<string, Uint8Array[]>) {
	const commands = compile(node, fonts);
	const out = await paintScene(ck, commands, createHeadlessEnv({ fonts }));
	expect(out.warnings).toEqual([]);
	const px = out.readPixels?.();
	out.dispose();
	if (!px) throw new Error("no pixels");
	return px;
}

describe("shared FontCollection", () => {
	test("a text engine makes one collection and deletes it on dispose", () => {
		const made = trackCollections();
		const engine = createParagraphEngine(ck, new Map([["Geist", [GEIST]]]));
		const font = {
			family: "Geist",
			weight: 400,
			style: "normal" as const,
			size: 16,
			lineHeight: 1.2,
		};
		for (const text of ["one", "two", "three"])
			engine.measureText(text, font, null);
		engine.layoutText({
			value: "a wrapped line of text",
			font,
			maxWidth: 40,
			maxHeight: 1000,
			lineHeight: 1.2,
			fit: undefined,
		});
		expect(made).toHaveLength(1);
		expect(made[0]!.deleted).toBe(0);
		engine.dispose();
		expect(made[0]!.deleted).toBe(1);
	});

	test("a paint cache keeps one collection per provider and frees it with the provider", async () => {
		const fontsA = new Map([["Geist", [GEIST]]]);
		const commands = compile(textScene("Geist", [400, 700]), fontsA);
		const made = trackCollections();
		const cache = createPaintCache();
		const paint = async (fonts: Map<string, Uint8Array[]>) =>
			(
				await paintScene(ck, commands, createHeadlessEnv({ fonts, cache }))
			).dispose();

		await paint(fontsA);
		await paint(fontsA);
		expect(made).toHaveLength(1);
		expect(made[0]!.deleted).toBe(0);

		await paint(new Map([["Geist", [GEIST.slice()]]]));
		expect(made).toHaveLength(2);
		expect(made[0]!.deleted).toBe(1);
		expect(made[1]!.deleted).toBe(0);

		cache.dispose();
		expect(made[1]!.deleted).toBe(1);
	});

	test("an uncached paint frees its collection", async () => {
		const fonts = new Map([["Geist", [GEIST]]]);
		const commands = compile(textScene("Geist", [400]), fonts);
		const made = trackCollections();
		(await paintScene(ck, commands, createHeadlessEnv({ fonts }))).dispose();
		expect(made).toHaveLength(1);
		expect(made[0]!.deleted).toBe(1);
	});

	test("a variable font with a wght axis renders as it did per paragraph", async () => {
		const fonts = new Map([["Vend Sans", [VEND]]]);
		const node = textScene("Vend Sans", [300, 400, 600, 800]);
		const shared = await render(node, fonts);
		perParagraphCollections();
		const before = await render(node, fonts);
		expect(shared).toEqual(before);
	});
});
