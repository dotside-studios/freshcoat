// A bitmap's `role`: lowered onto its command, checked by validateCommands, and,
// for a barcode, snapped to whole output pixels by the painter.
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test } from "vitest";
import { createHeadlessEnv } from "../src/headless";
import {
	approxEngine,
	type BitmapRole,
	type Command,
	compileScene,
	createBitmap,
	createFrame,
	decodePixels,
	validateCommands,
} from "../src/index";

// biome-ignore lint/suspicious/noExplicitAny: ck is the untyped WASM instance
let ck: any;
beforeAll(async () => {
	ck = await loadCanvasKit();
});

// Bar, space, bar, space: four modules, one pixel row, drawn at x = 10.4 across
// 17.3 px, so each module would be 4.325 px wide.
function bars(role?: BitmapRole): Command[] {
	const pixels = new Uint8Array(4 * 4);
	for (const i of [0, 2]) pixels[i * 4 + 3] = 255;
	return compileScene(
		createFrame({
			pos: { x: 0, y: 0 },
			size: { width: 40, height: 10 },
			children: [
				createBitmap({
					pos: { x: 10.4, y: 0 },
					size: { width: 17.3, height: 10 },
					pixels,
					pixelWidth: 4,
					pixelHeight: 1,
					...(role ? { role } : {}),
				}),
			],
		}),
		{ width: 40, height: 10, textEngine: approxEngine },
	);
}

function drawBitmap(commands: Command[]) {
	const find = (list: Command[]): Command | undefined => {
		for (const c of list) {
			if (c.op === "drawBitmap") return c;
			if (c.op === "drawGroup") {
				const hit = find(c.children);
				if (hit) return hit;
			}
		}
		return undefined;
	};
	return find(commands);
}

// Alpha across the middle row, as runs of [alpha, length].
async function row(commands: Command[]): Promise<number[][]> {
	const result = await createHeadlessEnv().paint(commands, ck);
	if (!("bytes" in result)) throw new Error("expected encoded output");
	const d = decodePixels(ck, result.bytes as Uint8Array);
	if (!d) throw new Error("decode failed");
	const runs: number[][] = [];
	for (let x = 0; x < d.width; x++) {
		const a = d.data[(5 * d.width + x) * 4 + 3];
		const last = runs.at(-1);
		if (last && last[0] === a) last[1]++;
		else runs.push([a, 1]);
	}
	return runs;
}

describe("bitmap role", () => {
	test("lowers onto the draw command, and only when set", () => {
		expect(drawBitmap(bars("barcode"))).toMatchObject({ role: "barcode" });
		expect(drawBitmap(bars())).not.toHaveProperty("role");
	});

	test("validateCommands refuses a role it does not know", () => {
		const commands = bars("barcode");
		const bitmap = drawBitmap(commands) as { role?: string };
		expect(validateCommands(commands)).toEqual([]);
		bitmap.role = "qr";
		expect(validateCommands(commands).map((i) => i.code)).toContain(
			"bad_bitmap_role",
		);
	});

	test("a barcode's modules land on whole, equal pixels", async () => {
		// 4.325 px floors to 4: the 16 px code centres in the 17.3 px box.
		expect(await row(bars("barcode"))).toEqual([
			[0, 11],
			[255, 4],
			[0, 4],
			[255, 4],
			[0, 17],
		]);
	});

	test("any other bitmap is drawn as placed", async () => {
		const runs = await row(bars());
		const widths = runs.filter(([a]) => a === 255).map(([, n]) => n);
		// Nearest-neighbour sampling of 4.325 px modules: not all the same width.
		expect(new Set(widths).size).toBeGreaterThan(1);
	});
});
