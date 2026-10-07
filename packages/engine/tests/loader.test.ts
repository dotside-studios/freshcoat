import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import { describe, expect, test } from "vitest";
import { clearFontBytesCache, fontBytes } from "../src/font-bytes";
import { createHeadlessEnv, renderSceneToPng } from "../src/headless";
import { dataUrlToBytes, fetchLoader, mapLoader } from "../src/loader";
import { createRect } from "../src/node";
import type { Command, EncodedPaintResult, FontResolution } from "../src/types";

const local = (src: string): FontResolution => ({
	kind: "descriptor",
	descriptor: {
		kind: "local",
		family: "Local",
		files: [{ src, weight: 400, style: "normal" }],
	},
});

describe("fetchLoader", () => {
	test("decodes data: URLs without fetching", async () => {
		expect([...(await fetchLoader("data:text/plain;base64,AQID"))]).toEqual([
			1, 2, 3,
		]);
		expect(dataUrlToBytes("data:,hi")).toEqual(new TextEncoder().encode("hi"));
	});
});

describe("mapLoader", () => {
	test("serves mapped bytes and falls back to the next loader", async () => {
		const mapped = new Uint8Array([1]);
		const fallback = new Uint8Array([2]);
		const seen: string[] = [];
		const load = mapLoader(new Map([["a", mapped]]), async (src) => {
			seen.push(src);
			return fallback;
		});
		expect(await load("a")).toBe(mapped);
		expect(await load("b")).toBe(fallback);
		expect(seen).toEqual(["b"]);
	});

	test("reads entries added to the map after it was made", async () => {
		const map = new Map<string, Uint8Array>();
		const load = mapLoader(map, async () => {
			throw new Error("miss");
		});
		const bytes = new Uint8Array([3]);
		map.set("late", bytes);
		expect(await load("late")).toBe(bytes);
	});
});

describe("fontBytes with a loader", () => {
	test("loads local font files through the loader once per src", async () => {
		clearFontBytesCache();
		const bytes = new Uint8Array([7]);
		let calls = 0;
		const load = async (src: string) => {
			calls++;
			expect(src).toBe("fonts/a.ttf");
			return bytes;
		};
		const [a] = await fontBytes(local("fonts/a.ttf"), load);
		const [b] = await fontBytes(local("fonts/a.ttf"), load);
		expect(a).toBe(bytes);
		expect(b).toBe(bytes);
		expect(calls).toBe(1);
	});

	test("retries a local file whose load failed", async () => {
		clearFontBytesCache();
		let fail = true;
		const load = async () => {
			if (fail) throw new Error("missing");
			return new Uint8Array([1]);
		};
		await expect(fontBytes(local("x.ttf"), load)).rejects.toThrow("missing");
		fail = false;
		expect(await fontBytes(local("x.ttf"), load)).toHaveLength(1);
	});
});

describe("createHeadlessEnv({ load })", () => {
	test("paints local fonts and images from the loader", async () => {
		clearFontBytesCache();
		const ck = await loadCanvasKit();
		const logo = await renderSceneToPng(
			createRect({
				size: { width: 4, height: 4 },
				fills: [{ kind: "solid", color: "#ff0000" }],
			}),
			{ width: 4, height: 4, ck },
		);
		const files = new Map([
			["fonts/geist.ttf", testFontBytes("Geist-Regular.ttf")],
			["logo.png", logo.bytes],
		]);
		const requested: string[] = [];
		const env = createHeadlessEnv({
			load: async (src) => {
				requested.push(src);
				const bytes = files.get(src);
				if (!bytes) throw new Error(`no ${src}`);
				return bytes;
			},
		});
		const commands: Command[] = [
			{ op: "createCanvas", width: 4, height: 4 },
			{
				op: "loadFonts",
				requests: [
					{
						family: "Geist",
						descriptor: {
							kind: "local",
							family: "Geist",
							files: [
								{ src: "fonts/geist.ttf", weight: 400, style: "normal" },
							],
						},
					},
				],
			},
			{ op: "loadImages", srcs: ["logo.png"] },
		];
		const result = (await env.paint(commands, ck)) as EncodedPaintResult;
		expect(result.warnings).toEqual([]);
		expect(requested.sort()).toEqual(["fonts/geist.ttf", "logo.png"]);
	});
});
