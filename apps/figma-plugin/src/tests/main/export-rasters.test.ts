import { afterEach, describe, expect, it, vi } from "vitest";
import { RASTER_MAX_DIMENSION } from "~/lib/figma/transpiler/raster-scale";
import {
	exportRasters,
	exportThumbnails,
	mapLimit,
} from "~/main/export-rasters";

type ExportSettings = { constraint: { type: string; value: number } };
type FakeNode = {
	width?: number;
	height?: number;
	exportAsync?: (settings: ExportSettings) => Promise<Uint8Array>;
};

/** Install a minimal `figma` global backed by a node map. */
function stubFigma(nodes: Record<string, FakeNode | null>): void {
	(globalThis as { figma?: unknown }).figma = {
		getNodeByIdAsync: async (id: string) => nodes[id] ?? null,
	};
}

afterEach(() => {
	(globalThis as { figma?: unknown }).figma = undefined;
});

const ok = (byte: number, width = 100, height = 100): FakeNode => ({
	width,
	height,
	exportAsync: async () => new Uint8Array([byte]),
});
const throws = (): FakeNode => ({
	width: 10,
	height: 10,
	exportAsync: async () => {
		throw new Error("Cannot export node");
	},
});

const at = (scale: number, ...nodeIds: string[]) =>
	nodeIds.map((nodeId) => ({ nodeId, scale }));

describe("exportRasters", () => {
	it("exports every node it can", async () => {
		stubFigma({ a: ok(1), b: ok(2) });
		const out = await exportRasters(at(3, "a", "b"));
		expect(out).toEqual([
			{ nodeId: "a", bytes: [1] },
			{ nodeId: "b", bytes: [2] },
		]);
	});

	it("exports each node at the scale its own target asks for", async () => {
		const seen: number[] = [];
		const spy = (): FakeNode => ({
			width: 100,
			height: 100,
			exportAsync: async (settings) => {
				seen.push(settings.constraint.value);
				return new Uint8Array([1]);
			},
		});
		stubFigma({ a: spy(), b: spy() });
		await exportRasters([
			{ nodeId: "a", scale: 3 },
			{ nodeId: "b", scale: 6 },
		]);
		expect(seen).toEqual([3, 6]);
	});

	it("clamps the scale so a huge node stays under Figma's export ceiling", async () => {
		// Without the clamp exportAsync rejects outright and the author loses the
		// region entirely — a softer bitmap beats a missing one.
		let used = 0;
		stubFigma({
			big: {
				width: 2000,
				height: 1000,
				exportAsync: async (settings) => {
					used = settings.constraint.value;
					return new Uint8Array([1]);
				},
			},
		});
		await exportRasters([{ nodeId: "big", scale: 6 }]);
		expect(used).toBe(RASTER_MAX_DIMENSION / 2000);
		expect(used * 2000).toBeLessThanOrEqual(RASTER_MAX_DIMENSION);
	});

	it("skips a node that fails to export rather than failing the batch", async () => {
		// The bug this guards: one unexportable layer used to reject the whole
		// read, and main swallowed it, leaving the panel on "Reading your
		// frames…" forever.
		stubFigma({ a: ok(1), bad: throws(), c: ok(3) });
		const out = await exportRasters(at(3, "a", "bad", "c"));
		expect(out.map((r) => r.nodeId)).toEqual(["a", "c"]);
	});

	it("skips ids that no longer resolve to a node", async () => {
		stubFigma({ a: ok(1), gone: null });
		const out = await exportRasters(at(3, "a", "gone"));
		expect(out.map((r) => r.nodeId)).toEqual(["a"]);
	});

	it("skips a node with no exportAsync", async () => {
		stubFigma({ a: ok(1), plain: {} });
		const out = await exportRasters(at(3, "a", "plain"));
		expect(out.map((r) => r.nodeId)).toEqual(["a"]);
	});

	it("reports progress once per node, including the ones it skips", async () => {
		stubFigma({ a: ok(1), bad: throws(), c: ok(3) });
		const onProgress = vi.fn();
		await exportRasters(at(3, "a", "bad", "c"), onProgress);
		// Progress must advance past a failure — otherwise a design with a bad
		// layer looks stalled at the same number.
		expect(onProgress.mock.calls).toEqual([
			[1, 3],
			[1, 3],
			[2, 3],
		]);
	});

	it("returns an empty batch without calling progress", async () => {
		stubFigma({});
		const onProgress = vi.fn();
		expect(await exportRasters([], onProgress)).toEqual([]);
		expect(onProgress).not.toHaveBeenCalled();
	});
});

describe("exportRasters concurrency", () => {
	it("keeps target order when exports finish out of order", async () => {
		const slow = (byte: number, ms: number): FakeNode => ({
			width: 10,
			height: 10,
			exportAsync: () =>
				new Promise((r) => setTimeout(() => r(new Uint8Array([byte])), ms)),
		});
		stubFigma({ a: slow(1, 30), b: slow(2, 0), c: slow(3, 10) });
		const out = await exportRasters(at(3, "a", "b", "c"));
		expect(out.map((r) => r.nodeId)).toEqual(["a", "b", "c"]);
	});

	it("reports progress up to the total", async () => {
		stubFigma({ a: ok(1), b: ok(2), c: ok(3), d: ok(4) });
		const onProgress = vi.fn();
		await exportRasters(at(3, "a", "b", "c", "d"), onProgress);
		expect(onProgress).toHaveBeenCalledTimes(4);
		expect(onProgress).toHaveBeenLastCalledWith(4, 4);
	});
});

describe("exportThumbnails", () => {
	it("exports in input order and skips failures", async () => {
		stubFigma({ a: ok(1), bad: throws(), gone: null, c: ok(3) });
		const out = await exportThumbnails(["a", "bad", "gone", "c"], 128);
		expect(out).toEqual([
			{ nodeId: "a", bytes: [1] },
			{ nodeId: "c", bytes: [3] },
		]);
	});
});

describe("mapLimit", () => {
	it("never runs more than the limit at once and keeps order", async () => {
		let active = 0;
		let peak = 0;
		const out = await mapLimit([5, 1, 4, 2, 3, 0], 2, async (ms) => {
			active++;
			peak = Math.max(peak, active);
			await new Promise((r) => setTimeout(r, ms));
			active--;
			return ms * 10;
		});
		expect(peak).toBe(2);
		expect(out).toEqual([50, 10, 40, 20, 30, 0]);
	});

	it("handles an empty list", async () => {
		expect(await mapLimit([], 3, async (x) => x)).toEqual([]);
	});
});
