import { describe, expect, test } from "bun:test";
import {
	canvasKitVersion,
	loadCanvasKit,
	testFontBytes,
	testFontPath,
} from "../src";

describe("loadCanvasKit", () => {
	test("loads the default build", async () => {
		const ck = await loadCanvasKit();
		const surface = ck.MakeSurface(4, 4);
		expect(surface).not.toBeNull();
		surface?.delete();
	});

	test("loads the full build with JPEG encoding", async () => {
		const ck = await loadCanvasKit("full");
		const surface = ck.MakeSurface(4, 4);
		const image = surface?.makeImageSnapshot();
		const jpeg = image?.encodeToBytes(ck.ImageFormat.JPEG, 90);
		expect(jpeg?.[0]).toBe(0xff);
		expect(jpeg?.[1]).toBe(0xd8);
		image?.delete();
		surface?.delete();
	});

	test("reports the installed version", () => {
		expect(canvasKitVersion).toMatch(/^\d+\.\d+\.\d+/);
	});
});

describe("test fonts", () => {
	test("resolves vendored font files", () => {
		expect(testFontPath("Geist-Regular.ttf")).toEndWith(
			"fonts/Geist-Regular.ttf",
		);
		const ttf = testFontBytes("Geist-Regular.ttf");
		expect([...ttf.subarray(0, 4)]).toEqual([0, 1, 0, 0]);
		const woff2 = testFontBytes("VendSans-Variable-latin.woff2");
		expect(new TextDecoder().decode(woff2.subarray(0, 4))).toBe("wOF2");
	});
});
