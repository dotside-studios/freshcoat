import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test } from "vitest";
import { normalizeDash } from "../src/dash";
import { createGroup, createRect } from "../src/node";
import { renderSceneToPng } from "./helpers/headless";

const W = 100;
const H = 100;

let ck: unknown;
beforeAll(async () => {
	ck = await loadCanvasKit();
});

function render(dash: number[]) {
	const ground = createRect({
		pos: { x: 0, y: 0 },
		size: { width: W, height: H },
		fills: [{ kind: "solid", color: "#ffffff" }],
	});
	const rect = createRect({
		pos: { x: 20, y: 20 },
		size: { width: 60, height: 60 },
		stroke: { color: "#000000", width: 4, dash },
	});
	return renderSceneToPng(createGroup([ground, rect]), {
		width: W,
		height: H,
		ck,
	});
}

describe("normalizeDash", () => {
	test("repeats odd-length patterns", () => {
		expect(normalizeDash([4])).toEqual([4, 4]);
		expect(normalizeDash([5, 3, 2])).toEqual([5, 3, 2, 5, 3, 2]);
		expect(normalizeDash([6, 4])).toEqual([6, 4]);
	});

	test("drops empty, zero and invalid patterns", () => {
		expect(normalizeDash(undefined)).toBeUndefined();
		expect(normalizeDash([])).toBeUndefined();
		expect(normalizeDash([0, 0])).toBeUndefined();
		expect(normalizeDash([4, -1])).toBeUndefined();
		expect(normalizeDash([Number.NaN])).toBeUndefined();
	});
});

describe("stroke dash rendering", () => {
	test.each([[[4]], [[5, 3, 2]], [[0, 0]]])("paints %j", async (dash) => {
		const { bytes } = await render(dash);
		expect(bytes.length).toBeGreaterThan(0);
	});

	test("[4] renders like [4, 4]", async () => {
		const odd = await render([4]);
		const even = await render([4, 4]);
		expect(Buffer.from(odd.bytes).equals(Buffer.from(even.bytes))).toBe(true);
	});

	test("[0, 0] renders like a solid stroke", async () => {
		const zero = await render([0, 0]);
		const solid = await render([]);
		expect(Buffer.from(zero.bytes).equals(Buffer.from(solid.bytes))).toBe(
			true,
		);
	});
});
