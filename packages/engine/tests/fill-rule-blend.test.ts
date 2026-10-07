// PathNode.fillRule keeps a two-subpath ring's hole, and every BlendMode reaches
// Skia as a real mode rather than falling back to normal compositing.
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test } from "vitest";
import { createHeadlessEnv } from "./helpers/headless";
import {
	compileScene,
	createFrame,
	createPath,
	createRect,
	type Node,
} from "../src/index";
import type { BlendMode } from "../src/types";

const solid = (color: string) => [{ kind: "solid" as const, color }];

let ck: any;
beforeAll(async () => {
	ck = await loadCanvasKit();
});

async function pixelAt(children: Node[], x: number, y: number) {
	const frame = createFrame({
		pos: { x: 0, y: 0 },
		size: { width: 100, height: 100 },
		background: createRect({
			pos: { x: 0, y: 0 },
			size: { width: 100, height: 100 },
			fills: solid("#b04020"),
		}),
		children,
	});
	const commands = compileScene(frame, { width: 100, height: 100 });
	const result = (await createHeadlessEnv().paint(commands, ck)) as {
		bytes: Uint8Array;
	};
	const img = ck.MakeImageFromEncoded(result.bytes);
	const px = img.readPixels(x, y, {
		width: 1,
		height: 1,
		colorType: ck.ColorType.RGBA_8888,
		alphaType: ck.AlphaType.Unpremul,
		colorSpace: ck.ColorSpace.SRGB,
	});
	img.delete();
	return Array.from(px as Uint8Array);
}

// Two squares wound the same way: nonzero fills the inner one, evenodd cuts it.
const ring = "M0 0 H100 V100 H0 Z M25 25 H75 V75 H25 Z";

describe("PathNode.fillRule", () => {
	test("lowers onto drawPath only when set", () => {
		const draw = compileScene(
			createFrame({
				children: [
					createPath({
						pos: { x: 0, y: 0 },
						size: { width: 100, height: 100 },
						d: ring,
						fillRule: "evenodd",
					}),
				],
			}),
			{ width: 100, height: 100 },
		).at(-1);
		if (draw?.op !== "drawGroup") throw new Error("expected drawGroup");
		const path = draw.children[0];
		if (path?.op !== "drawPath") throw new Error("expected drawPath");
		expect(path.fillRule).toBe("evenodd");
	});

	test("evenodd keeps the hole, nonzero fills it", async () => {
		const path = (fillRule?: "evenodd") =>
			createPath({
				pos: { x: 0, y: 0 },
				size: { width: 100, height: 100 },
				d: ring,
				fills: solid("#ff0000"),
				...(fillRule ? { fillRule } : {}),
			});
		expect(await pixelAt([path("evenodd")], 50, 50)).toEqual([
			176, 64, 32, 255,
		]);
		expect(await pixelAt([path()], 50, 50)).toEqual([255, 0, 0, 255]);
	});
});

describe("blend modes", () => {
	const modes: BlendMode[] = [
		"color-dodge",
		"color-burn",
		"hard-light",
		"soft-light",
		"difference",
		"exclusion",
		"hue",
		"saturation",
		"color",
		"luminosity",
		"plus",
		"linear-burn",
	];

	test.each(modes)("%s composites differently from normal", async (mode) => {
		const layer = (blendMode?: BlendMode) =>
			createRect({
				pos: { x: 0, y: 0 },
				size: { width: 100, height: 100 },
				fills: solid("#3366cc"),
				...(blendMode ? { blendMode } : {}),
			});
		const normal = await pixelAt([layer()], 50, 50);
		const blended = await pixelAt([layer(mode)], 50, 50);
		expect(blended).not.toEqual(normal);
	});
});
