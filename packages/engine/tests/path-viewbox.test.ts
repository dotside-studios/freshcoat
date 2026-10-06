// PathNode.viewBox — scale an authored path into the node's size box (SVG
// viewBox → viewport). Structural: the viewBox threads onto the drawPath command
// only when set. Behavioral: a 10-unit path with a 10×10 viewBox scaled into a
// 100×100 node fills the far corner; without the viewBox it stays at native size.
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { describe, expect, test } from "vitest";
import { createHeadlessEnv } from "../src/headless";
import {
	compileScene,
	createFrame,
	createPath,
	createRect,
} from "../src/index";

const solid = (color: string) => [{ kind: "solid" as const, color }];

// A 10×10 filled box path, sized into a 100×100 node, optionally with a viewBox.
function scene(viewBox?: { width: number; height: number }) {
	return createFrame({
		pos: { x: 0, y: 0 },
		size: { width: 100, height: 100 },
		background: createRect({
			pos: { x: 0, y: 0 },
			size: { width: 100, height: 100 },
			fills: solid("#ffffff"),
		}),
		children: [
			createPath({
				pos: { x: 0, y: 0 },
				size: { width: 100, height: 100 },
				d: "M0 0 H10 V10 H0 Z",
				fills: solid("#ff0000"),
				...(viewBox ? { viewBox } : {}),
			}),
		],
	});
}

describe("PathNode.viewBox structural lowering", () => {
	test("viewBox threads onto the drawPath command when set", () => {
		const draw = compileScene(scene({ width: 10, height: 10 }), {
			width: 100,
			height: 100,
		}).at(-1);
		if (draw?.op !== "drawGroup") throw new Error("expected drawGroup");
		const path = draw.children.find((c) => c.op === "drawPath");
		expect(path?.op).toBe("drawPath");
		if (path?.op !== "drawPath") throw new Error("unreachable");
		expect(path.viewBox).toEqual({ width: 10, height: 10 });
	});

	test("no viewBox key when unset", () => {
		const draw = compileScene(scene(), { width: 100, height: 100 }).at(-1);
		if (draw?.op !== "drawGroup") throw new Error("expected drawGroup");
		const path = draw.children.find((c) => c.op === "drawPath");
		if (path?.op !== "drawPath") throw new Error("expected drawPath");
		expect("viewBox" in path).toBe(false);
	});
});

describe("PathNode.viewBox scales the paint", () => {
	async function pixelAt(
		viewBox: { width: number; height: number } | undefined,
		x: number,
		y: number,
	) {
		const ck = (await loadCanvasKit()) as any;
		const env = createHeadlessEnv();
		const commands = compileScene(scene(viewBox), { width: 100, height: 100 });
		const result = (await env.paint(commands, ck)) as { bytes: Uint8Array };
		const img = ck.MakeImageFromEncoded(result.bytes);
		const px = img.readPixels(x, y, {
			width: 1,
			height: 1,
			colorType: ck.ColorType.RGBA_8888,
			alphaType: ck.AlphaType.Unpremul,
			colorSpace: ck.ColorSpace.SRGB,
		});
		const out = Array.from(px as Uint8Array);
		img.delete();
		return out;
	}

	test("a 10×10 viewBox fills the far corner of a 100×100 node", async () => {
		expect(await pixelAt({ width: 10, height: 10 }, 90, 90)).toEqual([
			255, 0, 0, 255,
		]);
	});

	test("without a viewBox the path stays at native size", async () => {
		expect(await pixelAt(undefined, 90, 90)).toEqual([255, 255, 255, 255]);
		expect(await pixelAt(undefined, 5, 5)).toEqual([255, 0, 0, 255]);
	});
});
