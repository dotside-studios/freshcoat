// A group paints its own background, so a hug-height container does not need a
// sibling rect sized to it — which is what forced a caller to resolve the layout
// once to learn the height and again to paint.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import CanvasKitInit from "canvaskit-wasm";
import { describe, expect, test } from "vitest";
import { approxEngine } from "../src/approx-layout";
import { compileScene } from "../src/compile-scene";
import { decodePixels } from "../src/decode";
import { renderSceneToPng } from "../src/headless";
import { createGroup, createRect, createText } from "../src/node";
import type { DrawGroupCommand, DrawRectCommand } from "../src/types";

const CK_BIN = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	"node_modules",
	"canvaskit-wasm",
	"bin",
);

const BOX = { pos: { x: 0, y: 0 }, size: { width: 40, height: 20 } };

function groupOf(commands: ReturnType<typeof compileScene>): DrawGroupCommand {
	return commands.find((c) => c.op === "drawGroup") as DrawGroupCommand;
}

describe("group fills", () => {
	test("lower to a rect drawn before the children, across the group's box", () => {
		const commands = compileScene(
			createGroup(
				[createRect({ ...BOX, fills: [{ kind: "solid", color: "#00ff00" }] })],
				{
					...BOX,
					fills: [{ kind: "solid", color: "#ff0000" }],
					cornerRadius: 8,
				},
			),
			{ width: 40, height: 20 },
		);

		const group = groupOf(commands);
		expect(group.children).toHaveLength(2);
		const bg = group.children[0] as DrawRectCommand;
		expect(bg.op).toBe("drawRect");
		expect(bg.fills).toEqual([{ kind: "solid", color: "#ff0000" }]);
		expect(bg.pos).toEqual(BOX.pos);
		expect(bg.size).toEqual(BOX.size);
		// Carried so a filled group can round its own corners.
		expect(bg.cornerRadius).toBe(8);
	});

	test("a group without fills is unchanged", () => {
		const commands = compileScene(createGroup([createRect(BOX)], BOX), {
			width: 40,
			height: 20,
		});
		expect(groupOf(commands).children).toHaveLength(1);
	});

	// The composite effects stay on the group, so the fill sits inside the layer
	// they apply to and a shadow is cast by the filled box rather than by the
	// children's outline.
	test("composite effects stay on the group, not the background", () => {
		const commands = compileScene(
			createGroup([createRect(BOX)], {
				...BOX,
				fills: [{ kind: "solid", color: "#ff0000" }],
				shadow: { color: "#000000", dx: 0, dy: 2, blur: 4 },
				opacity: 0.5,
			}),
			{ width: 40, height: 20 },
		);
		const group = groupOf(commands);
		expect(group.shadow).toBeTruthy();
		expect(group.opacity).toBe(0.5);
		const bg = group.children[0] as DrawRectCommand;
		expect(bg.shadow).toBeUndefined();
		expect(bg.opacity).toBeUndefined();
	});

	// The point of the feature: a hug-height column carries its own background,
	// with no second layout pass to learn how tall it ended up.
	test("a hug-height auto-layout group fills the height layout gave it", () => {
		const card = createGroup(
			[
				createText({
					text: "one line",
					font: {
						family: "F",
						weight: 400,
						style: "normal",
						size: 10,
						lineHeight: 12,
					},
					color: "#000000",
					layoutChild: { width: "fill", height: "hug" },
				}),
			],
			{
				size: { width: 100, height: 0 },
				layout: { type: "flex", direction: "column", padding: 5 },
				fills: [{ kind: "solid", color: "#ff0000" }],
				layoutChild: { width: 100, height: "hug" },
			},
		);
		const commands = compileScene(
			createGroup([card], {
				pos: { x: 0, y: 0 },
				size: { width: 100, height: 50 },
				layout: { type: "flex", direction: "column" },
			}),
			{ width: 100, height: 50, textEngine: approxEngine },
		);

		const outer = groupOf(commands);
		const inner = outer.children[0] as DrawGroupCommand;
		const bg = inner.children[0] as DrawRectCommand;
		expect(bg.op).toBe("drawRect");
		// Whatever height hugging produced, the background is that height — which
		// is the thing a caller previously had to run resolveLayout to learn.
		expect(inner.size.height).toBeGreaterThan(0);
		expect(bg.size).toEqual(inner.size);
		expect(bg.pos).toEqual(inner.pos);
	});

	test("paints the fill", async () => {
		const ck = await (CanvasKitInit as (o: unknown) => Promise<unknown>)({
			locateFile: (f: string) => join(CK_BIN, f),
		});
		const { bytes } = await renderSceneToPng(
			createGroup([], {
				...BOX,
				fills: [{ kind: "solid", color: "#ff0000" }],
			}),
			{ width: 40, height: 20, ck },
		);
		const pixels = decodePixels(ck, bytes);
		if (!pixels) throw new Error("decode failed");
		const at = (x: number, y: number) => {
			const i = (y * pixels.width + x) * 4;
			return [...pixels.data.subarray(i, i + 3)];
		};
		expect(at(20, 10)).toEqual([255, 0, 0]);
	});
});
