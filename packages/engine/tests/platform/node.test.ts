import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { testFontBytes } from "@freshcoat-js/test-utils";
import {
	createRenderer as createBaseRenderer,
	type TextNode,
} from "../../src/index";
import {
	canvasKitBinDir,
	canvasKitVersion,
	createRenderer,
	initCanvasKit,
	loadCanvasKit,
} from "../../src/platform/node";

describe("node loader", () => {
	test("locates both builds", () => {
		expect(canvasKitVersion).toMatch(/^\d+\.\d+\.\d+/);
		for (const build of ["default", "full"] as const) {
			const dir = canvasKitBinDir(build);
			expect(existsSync(join(dir, "canvaskit.js"))).toBe(true);
			expect(existsSync(join(dir, "canvaskit.wasm"))).toBe(true);
		}
	});

	test("loadCanvasKit shares an instance per build", async () => {
		const a = await loadCanvasKit();
		expect(await loadCanvasKit()).toBe(a);
		expect(await loadCanvasKit("full")).not.toBe(a);
	});

	test("initCanvasKit creates a new instance", async () => {
		const a = await initCanvasKit();
		expect(await initCanvasKit()).not.toBe(a);
		const surface = a.MakeSurface(2, 2);
		expect(surface).not.toBeNull();
		surface?.delete();
	});

	test("the full build encodes JPEG", async () => {
		const ck = await loadCanvasKit("full");
		const surface = ck.MakeSurface(4, 4);
		const image = surface?.makeImageSnapshot();
		const jpeg = image?.encodeToBytes(ck.ImageFormat.JPEG, 90);
		expect([jpeg?.[0], jpeg?.[1]]).toEqual([0xff, 0xd8]);
		image?.delete();
		surface?.delete();
	});
});

describe("node renderer factory", () => {
	test("forwards font loaders and render settings and preserves shared CanvasKit", async () => {
		const ck = await loadCanvasKit();
		const bytes = testFontBytes("Geist-Regular.ttf");
		const requested: string[] = [];
		const renderer = await createRenderer({
			ck,
			cache: false,
			fonts: { Geist: ["font.ttf"] },
			load: async (src) => {
				requested.push(src);
				return bytes;
			},
		});
		const other = await createBaseRenderer({ ck, fonts: { Geist: [bytes] } });
		const scene: TextNode = {
			kind: "text",
			pos: { x: 0, y: 0 },
			size: { width: 100, height: 40 },
			text: "Hello",
			font: {
				family: "Geist",
				size: 20,
				weight: 400,
				style: "normal",
				lineHeight: 24,
			},
			color: "#000000",
		};
		try {
			expect(renderer.ck).toBe(ck);
			expect(requested).toEqual(["font.ttf"]);
			expect(renderer.fonts.get("Geist")).toEqual([bytes]);
			const result = await renderer.render(scene, {
				width: 100,
				height: 40,
				output: { pixels: true },
			});
			const expected = await other.render(scene, {
				width: 100,
				height: 40,
				output: { pixels: true },
			});
			expect(result.pixels.data).toEqual(expected.pixels.data);
			renderer.dispose();
			expect(() => renderer.render(scene, { width: 100, height: 40 })).toThrow(
				"disposed",
			);
			expect(
				(await other.render(scene, { width: 100, height: 40 })).bytes.length,
			).toBeGreaterThan(0);
		} finally {
			renderer.dispose();
			other.dispose();
		}
	});

	test("loads the requested full build for JPEG output", async () => {
		const renderer = await createRenderer({ build: "full" });
		try {
			const result = await renderer.render(
				{
					kind: "rect",
					size: { width: 4, height: 4 },
					fills: [{ kind: "solid", color: "#ff0000" }],
				},
				{ width: 4, height: 4, output: { encode: { format: "jpeg" } } },
			);
			expect(result.format).toBe("jpeg");
			expect([...result.bytes.slice(0, 2)]).toEqual([0xff, 0xd8]);
		} finally {
			renderer.dispose();
		}
	});
});
