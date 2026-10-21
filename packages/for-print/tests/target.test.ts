import { describe, expect, test } from "bun:test";
import {
	createGroup,
	createImage,
	createText,
	type Node,
} from "@freshcoat-js/engine";
import { analyzePixels, buildRecommendation } from "../src/analyze";
import {
	analyzeScene,
	planForPrint,
	planScene,
	printAdjust,
	printFinish,
} from "../src/plan";
import { YMCKO_FINISH, YMCKO_PRESET } from "../src/presets";
import {
	DEFAULT_PRINT_TARGET,
	type PrintTarget,
	printTarget,
	YMCKO_DYE_SUB,
} from "../src/target";
import type { PixelData, PrintOptimizeOptions } from "../src/types";

const imageNode = (src = "a.png"): Node =>
	createImage({
		pos: { x: 0, y: 0 },
		size: { width: 10, height: 10 },
		src,
		fit: "cover",
	});
const textNode = (): Node =>
	createText({
		pos: { x: 0, y: 0 },
		size: { width: 10, height: 10 },
		text: "hi",
		font: {
			family: "X",
			weight: 400,
			style: "normal",
			size: 12,
			lineHeight: 1.2,
		},
	});
const tree = () => createGroup([imageNode("p.png"), textNode()]);
const gray = (): PixelData => ({
	data: new Uint8ClampedArray(4 * 16).fill(128),
	width: 4,
	height: 4,
});

const FIXED: PrintOptimizeOptions = {
	saturation: 1.1,
	contrast: 1.05,
	sharpness: 0,
	gamma: 0.95,
	darkness: 0,
};
const ANALYZED: PrintOptimizeOptions = { ...FIXED, saturation: 1.4 };
const LASER: PrintTarget = {
	id: "test-laser",
	name: "Test laser",
	preset: FIXED,
	recommend: () => ({ recommendation: ANALYZED, notes: ["laser"] }),
	finish: { whiteClamp: 250 },
};

const adjustOf = (scene: Node) =>
	scene.kind === "group" ? scene.children[0]?.adjust : undefined;

describe("YMCKO_DYE_SUB", () => {
	test("is the default and the source of the YMCKO aliases", () => {
		expect(DEFAULT_PRINT_TARGET).toBe(YMCKO_DYE_SUB);
		expect(YMCKO_PRESET).toBe(YMCKO_DYE_SUB.preset);
		expect(YMCKO_FINISH).toBe(YMCKO_DYE_SUB.finish);
	});

	test("printTarget finds it by id, and absent reads as it", () => {
		expect(printTarget("ymcko-dye-sub")).toBe(YMCKO_DYE_SUB);
		expect(printTarget(undefined)).toBe(YMCKO_DYE_SUB);
		expect(printTarget("nope")).toBeUndefined();
	});
});

describe("a custom target", () => {
	test("drives the recommendation", () => {
		expect(buildRecommendation({} as never, LASER).recommendation).toBe(
			ANALYZED,
		);
		expect(analyzePixels(gray(), LASER).notes).toContain("laser");
	});

	test("planForPrint without a sampler: its preset and its finish", async () => {
		const plan = await planForPrint(tree(), { target: LASER });
		expect(adjustOf(plan.scene)).toEqual(printAdjust(FIXED));
		expect(plan.scene).toEqual(planScene(tree(), {}, LASER));
		expect(plan.finish).toBe(LASER.finish);
	});

	test("planForPrint with a sampler: its recommendation", async () => {
		const plan = await planForPrint(tree(), {
			target: LASER,
			sample: async () => gray(),
		});
		expect(adjustOf(plan.scene)).toEqual(printAdjust(ANALYZED));
	});

	test("its balance curve goes on its finish", () => {
		const finish = printFinish({ r: 1.1, g: 1, b: 1 }, LASER);
		expect(finish.whiteClamp).toBe(250);
		expect(finish.curve).toBeDefined();
		expect(printFinish(undefined, LASER)).toBe(LASER.finish);
	});

	test("its policy sets intent defaults, and the caller's policy wins", async () => {
		const withText: PrintTarget = { ...LASER, policy: { text: FIXED } };
		const planned = planScene(tree(), {}, withText);
		expect(planned.kind === "group" && planned.children[1]?.adjust).toEqual(
			printAdjust(FIXED),
		);
		const off = planScene(tree(), { text: null }, withText);
		expect(off.kind === "group" && off.children[1]?.adjust).toBeUndefined();
		const fixed = await analyzeScene(async () => gray(), tree(), {
			target: { ...LASER, policy: { photo: null } },
		});
		expect(adjustOf(fixed)).toBeUndefined();
	});

	test("does not share cached analyses with another target", async () => {
		const cache = new Map();
		await analyzeScene(async () => gray(), tree(), { cache });
		const scene = await analyzeScene(async () => gray(), tree(), {
			cache,
			target: LASER,
		});
		expect(adjustOf(scene)).toEqual(printAdjust(ANALYZED));
		expect(cache.size).toBe(2);
	});
});
