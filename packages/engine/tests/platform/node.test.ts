import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
	canvasKitBinDir,
	canvasKitVersion,
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
