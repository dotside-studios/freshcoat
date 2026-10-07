// A group's isolation decides what its blended children mix with: Figma's Normal
// keeps them to the group's own content, pass-through lets them reach whatever
// lies under the group.
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test } from "vitest";
import { compileScene } from "../src/compile-scene";
import { decodePixels } from "../src/decode";
import { renderSceneToPng } from "./helpers/headless";
import { createGroup, createRect, type Node } from "../src/node";
import type { DrawGroupCommand } from "../src/types";
import { validateCommands } from "../src/validate-commands";

let ck: any;
beforeAll(async () => {
	ck = await loadCanvasKit();
});

const SIZE = { width: 40, height: 20 };
const solid = (color: string) => [{ kind: "solid" as const, color }];

// A multiply child half over the group's blue content and half over nothing the
// group drew, on an orange ground.
function scene(isolate: boolean | undefined): Node {
	return createGroup(
		[
			createRect({ pos: { x: 0, y: 0 }, size: SIZE, fills: solid("#ff8000") }),
			createGroup(
				[
					createRect({
						pos: { x: 0, y: 0 },
						size: { width: 20, height: 20 },
						fills: solid("#8080ff"),
					}),
					createRect({
						pos: { x: 10, y: 0 },
						size: { width: 20, height: 20 },
						fills: solid("#00ff00"),
						blendMode: "multiply",
					}),
				],
				{ pos: { x: 0, y: 0 }, size: SIZE, isolate },
			),
		],
		{ pos: { x: 0, y: 0 }, size: SIZE },
	);
}

async function render(node: Node) {
	const { bytes } = await renderSceneToPng(node, { ...SIZE, ck });
	const pixels = decodePixels(ck, bytes);
	if (!pixels) throw new Error("decode failed");
	return (x: number, y: number) => {
		const i = (y * pixels.width + x) * 4;
		return [...pixels.data.subarray(i, i + 3)];
	};
}

const near = (got: number[], want: number[]) =>
	got.every((v, i) => Math.abs(v - (want[i] as number)) <= 2);

describe("group isolation", () => {
	test("an isolated group's multiply child mixes only with the group", async () => {
		const at = await render(scene(true));
		expect(near(at(15, 10), [0, 128, 0])).toBe(true);
		expect(near(at(25, 10), [0, 255, 0])).toBe(true);
		expect(at(35, 10)).toEqual([255, 128, 0]);
	});

	test("without isolation the multiply child mixes with the ground", async () => {
		for (const isolate of [undefined, false]) {
			const at = await render(scene(isolate));
			expect(near(at(15, 10), [0, 128, 0])).toBe(true);
			expect(near(at(25, 10), [0, 128, 0])).toBe(true);
		}
	});

	test("lowers onto the drawGroup only when set", () => {
		const inner = (isolate?: boolean) => {
			const commands = compileScene(scene(isolate), SIZE);
			const outer = commands.find(
				(c) => c.op === "drawGroup",
			) as DrawGroupCommand;
			return outer.children[1] as DrawGroupCommand;
		};
		expect(inner(true).isolate).toBe(true);
		expect("isolate" in inner(false)).toBe(false);
		expect("isolate" in inner()).toBe(false);
		expect(validateCommands(compileScene(scene(true), SIZE))).toEqual([]);
	});

	test("validation flags a non-boolean isolate and one off a group", () => {
		const codes = (cmd: object) =>
			validateCommands([
				{ op: "createCanvas", width: 10, height: 10 },
				cmd as never,
			]).map((i) => i.code);
		const box = { pos: { x: 0, y: 0 }, size: { width: 10, height: 10 } };
		expect(codes({ op: "drawGroup", ...box, children: [], isolate: 1 })).toEqual(
			["bad_isolate"],
		);
		expect(codes({ op: "drawRect", ...box, isolate: true })).toEqual([
			"isolate_not_group",
		]);
	});
});
