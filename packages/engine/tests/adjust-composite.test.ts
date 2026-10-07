// The adjust offscreen renders a layer's content; its blend and opacity
// composite the adjusted snapshot onto the real destination.
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { describe, expect, test } from "vitest";
import { decodePixels } from "../src/decode";
import { renderSceneToPng } from "./helpers/headless";
import { createFrame, createGroup, createRect } from "../src/node";
import type { Adjust, BlendMode } from "../src/types";

const IDENTITY = Uint8Array.from({ length: 256 }, (_, i) => i);
const LUT: Adjust = { lut: { r: IDENTITY, g: IDENTITY, b: IDENTITY } };
const SIZE = 32;

type Props = { blendMode?: BlendMode; opacity?: number; adjust?: Adjust };

function scene(top: Props, group?: Props) {
	const layers = [
		createRect({
			pos: { x: 0, y: 0 },
			size: { width: SIZE, height: SIZE },
			fills: [{ kind: "solid", color: "#0000ff" }],
		}),
		createRect({
			pos: { x: 4, y: 4 },
			size: { width: 24, height: 24 },
			fills: [{ kind: "solid", color: "#ff0000" }],
			...top,
		}),
	];
	return createFrame({
		pos: { x: 0, y: 0 },
		size: { width: SIZE, height: SIZE },
		background: createRect({
			pos: { x: 0, y: 0 },
			size: { width: SIZE, height: SIZE },
			fills: [{ kind: "solid", color: "#00ff00" }],
		}),
		children: group
			? [
					createGroup(layers, {
						pos: { x: 0, y: 0 },
						size: { width: SIZE, height: SIZE },
						...group,
					}),
				]
			: layers,
	});
}

async function pixels(top: Props, group?: Props): Promise<Uint8Array> {
	const ck = await loadCanvasKit();
	const out = await renderSceneToPng(scene(top, group), {
		width: SIZE,
		height: SIZE,
		ck,
	});
	expect(out.warnings).toEqual([]);
	const px = decodePixels(ck, out.bytes);
	if (!px) throw new Error("decode failed");
	return px.data;
}

function maxDiff(a: Uint8Array, b: Uint8Array): number {
	let max = 0;
	for (let i = 0; i < a.length; i++)
		max = Math.max(max, Math.abs(a[i] - b[i]));
	return max;
}

const center = (data: Uint8Array) => {
	const i = ((SIZE / 2) * SIZE + SIZE / 2) * 4;
	return Array.from(data.subarray(i, i + 4));
};

describe("adjust offscreen compositing", () => {
	test("identity LUT with multiply equals plain multiply", async () => {
		const plain = await pixels({ blendMode: "multiply" });
		const lut = await pixels({ blendMode: "multiply", adjust: LUT });
		expect(center(plain)).toEqual([0, 0, 0, 255]);
		expect(maxDiff(plain, lut)).toBe(0);
	});

	test("identity LUT on a half-opacity layer applies opacity once", async () => {
		const plain = await pixels({ opacity: 0.5 });
		const lut = await pixels({ opacity: 0.5, adjust: LUT });
		expect(maxDiff(plain, lut)).toBeLessThanOrEqual(1);
	});

	test("a tiny sharpen on a blended layer stays close to none", async () => {
		const plain = await pixels({ blendMode: "multiply", opacity: 0.7 });
		const sharp = await pixels({
			blendMode: "multiply",
			opacity: 0.7,
			adjust: { sharpen: 0.01 },
		});
		expect(maxDiff(plain, sharp)).toBeLessThanOrEqual(3);
	});

	test("linear-burn with a LUT matches linear-burn without", async () => {
		const plain = await pixels({ blendMode: "linear-burn" });
		const lut = await pixels({ blendMode: "linear-burn", adjust: LUT });
		expect(maxDiff(plain, lut)).toBeLessThanOrEqual(1);
	});

	test("children keep their blend inside an adjusted group", async () => {
		const plain = await pixels({ blendMode: "multiply" }, {});
		const lut = await pixels({ blendMode: "multiply" }, { adjust: LUT });
		expect(center(plain)).toEqual([0, 0, 0, 255]);
		expect(maxDiff(plain, lut)).toBe(0);
	});

	test("an adjusted group blends onto the frame below it", async () => {
		const plain = await pixels({}, { blendMode: "multiply", opacity: 0.6 });
		const lut = await pixels(
			{},
			{ blendMode: "multiply", opacity: 0.6, adjust: LUT },
		);
		expect(center(plain)).toEqual([0, 102, 0, 255]);
		expect(maxDiff(plain, lut)).toBeLessThanOrEqual(1);
	});
});
