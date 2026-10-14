// A group's `snap`: lowered onto its command, checked by validateCommands, and
// drawn so each module of its grid covers whole output pixels.
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test } from "vitest";
import { drawableBounds, makeBin } from "../src/canvaskit";
import { createHeadlessEnv } from "./helpers/headless";
import {
	approxEngine,
	type Command,
	compileScene,
	createFrame,
	createGroup,
	createPath,
	decodePixels,
	type SnapGrid,
	validateCommands,
} from "../src/index";

// biome-ignore lint/suspicious/noExplicitAny: ck is the untyped WASM instance
let ck: any;
beforeAll(async () => {
	ck = await loadCanvasKit();
});

// Bar, space, bar, space in a 4-module grid placed at x = 10.4 across 17.3 px,
// so each module would be 4.325 px wide.
function bars(snap?: SnapGrid): Command[] {
	return compileScene(
		createFrame({
			pos: { x: 0, y: 0 },
			size: { width: 40, height: 10 },
			children: [
				createGroup(
					[
						createPath({
							pos: { x: 0, y: 0 },
							size: { width: 17.3, height: 10 },
							d: "M0 0H1V1H0ZM2 0H3V1H2Z",
							viewBox: { x: 0, y: 0, width: 4, height: 1 },
							fills: [{ kind: "solid", color: "#000000" }],
						}),
					],
					{
						pos: { x: 10.4, y: 0 },
						size: { width: 17.3, height: 10 },
						...(snap ? { snap } : {}),
					},
				),
			],
		}),
		{ width: 40, height: 10, textEngine: approxEngine },
	);
}

function snapped(commands: Command[]) {
	const find = (list: Command[]): Command | undefined => {
		for (const c of list) {
			if (c.op === "drawGroup") {
				if (c.snap) return c;
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

describe("group snap", () => {
	test("lowers onto the draw command, and only when set", () => {
		expect(snapped(bars({ columns: 4, rows: 1 }))).toMatchObject({
			snap: { columns: 4, rows: 1 },
		});
		expect(snapped(bars())).toBeUndefined();
	});

	test("validateCommands refuses a grid without whole modules", () => {
		const commands = bars({ columns: 4, rows: 1 });
		expect(validateCommands(commands)).toEqual([]);
		(snapped(commands) as { snap: SnapGrid }).snap.columns = 2.5;
		expect(validateCommands(commands).map((i) => i.code)).toContain(
			"bad_snap",
		);
	});

	test("its modules land on whole, equal pixels", async () => {
		// 4.325 px floors to 4: the 16 px grid centres in the 17.3 px box.
		expect(await row(bars({ columns: 4, rows: 1 }))).toEqual([
			[0, 11],
			[255, 4],
			[0, 4],
			[255, 4],
			[0, 17],
		]);
	});

	test("an unsnapped group is drawn as placed", async () => {
		const runs = await row(bars());
		expect(runs.some(([a]) => a !== 0 && a !== 255)).toBe(true);
	});

	test("bounds follow the snapped grid", () => {
		const group = snapped(bars({ columns: 4, rows: 1 })) as Command & {
			op: "drawGroup";
		};
		const bin = makeBin();
		const provider = ck.TypefaceFontProvider.Make();
		const b = drawableBounds(ck, provider, bin, group, 1);
		provider.delete();
		bin.free();
		// The bars painted at 11 to 15 and 19 to 23, not where the box put them.
		expect(b?.[0]).toBe(11);
		expect(b?.[2]).toBe(23);
	});
});
