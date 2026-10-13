import {
	FORMAT_VERSION,
	minimumFormatVersion,
	resolveSlices,
	type Template,
	validate,
} from "@freshcoat-js/coatfile";
import { describe, expect, it } from "vitest";
import { classify } from "~/lib/figma/transpiler/classify";
import type { FigmaContainerNode } from "~/lib/figma/types";
import { collectRasterTargets } from "~/main/raster-targets";
import {
	codes,
	FRAME_BOX,
	frameNode,
	group,
	node,
	rect,
	run,
	slice,
} from "./slice-helpers";

describe("Figma slices", () => {
	it("imports a top-level SLICE as an unpainted rect with a slice modifier", async () => {
		const r = await run([
			slice("s:1", "Left", { x: 10, y: 20, width: 300, height: 200 }),
		]);
		expect(r.elements).toHaveLength(1);
		expect(r.elements[0]).toMatchObject({
			type: "rect",
			pos: { x: 10, y: 20 },
			size: { width: 300, height: 200 },
			properties: { slice: { name: "Left" } },
		});
		expect(r.elements[0].properties.fill).toBeUndefined();
		expect(r.elements[0].properties.stroke).toBeUndefined();
		expect(r.elements[0].rotation).toBeUndefined();
		expect(validate(r.template).ok).toBe(true);
	});

	it("hoists a SLICE out of nested frames and groups into frame coordinates", async () => {
		const inner = slice("s:1", "Deep", {
			x: 160,
			y: 90,
			width: 40,
			height: 30,
		});
		const r = await run([
			frameNode("n:1", "Outer", { x: 100, y: 50, width: 400, height: 300 }, [
				group("g:1", "Grp", { x: 150, y: 80, width: 100, height: 100 }, [
					inner,
				]),
			]),
		]);
		const slices = r.elements.filter((e) => e.properties.slice);
		expect(slices).toHaveLength(1);
		expect(slices[0].pos).toEqual({ x: 160, y: 90 });
		expect(slices[0].size).toEqual({ width: 40, height: 30 });
		const outer = r.elements.find((e) => e.type === "frame");
		expect(JSON.stringify(outer)).not.toContain('"slice"');
		expect(validate(r.template).ok).toBe(true);
	});

	it("keeps a rotated slice's rotation", async () => {
		const r = await run([
			slice(
				"s:1",
				"Tilt",
				{ x: 0, y: 0, width: 20, height: 100 },
				{
					width: 100,
					height: 20,
					absoluteTransform: [
						[0, -1, 260],
						[1, 0, 110],
					],
				},
			),
		]);
		expect(r.elements[0].rotation).toBe(90);
		expect(r.elements[0].size).toEqual({ width: 100, height: 20 });
		expect(r.elements[0].pos.x).toBeCloseTo(200, 4);
		expect(r.elements[0].pos.y).toBeCloseTo(150, 4);
	});

	it("puts slices at the bottom of the stack and leaves other layers in order", async () => {
		const withSlices = await run([
			rect("r:1", "A", { x: 0, y: 0, width: 50, height: 50 }),
			slice("s:1", "Left", { x: 0, y: 0, width: 500, height: 600 }),
			rect("r:2", "B", { x: 60, y: 0, width: 50, height: 50 }),
			slice("s:2", "Right", { x: 500, y: 0, width: 500, height: 600 }),
		]);
		const without = await run([
			rect("r:1", "A", { x: 0, y: 0, width: 50, height: 50 }),
			rect("r:2", "B", { x: 60, y: 0, width: 50, height: 50 }),
		]);
		expect(withSlices.elements.map((e) => e.id)).toEqual([
			"Left",
			"Right",
			"A",
			"B",
		]);
		expect(withSlices.elements.slice(2)).toEqual(without.elements);
	});

	it("ignores a hidden slice and one inside a hidden layer", async () => {
		const r = await run([
			slice(
				"s:1",
				"Off",
				{ x: 0, y: 0, width: 10, height: 10 },
				{
					visible: false,
				},
			),
			frameNode("n:1", "Hidden", { x: 0, y: 0, width: 100, height: 100 }, [
				slice("s:2", "In", { x: 0, y: 0, width: 10, height: 10 }),
			]),
		]);
		expect(r.elements.filter((e) => e.properties.slice)).toHaveLength(1);
		const hidden = await run([
			node(
				"FRAME",
				"n:2",
				"Hidden",
				{ x: 0, y: 0, width: 100, height: 100 },
				{
					visible: false,
					children: [slice("s:3", "In", { x: 0, y: 0, width: 10, height: 10 })],
				},
			),
		]);
		expect(hidden.elements.filter((e) => e.properties.slice)).toHaveLength(0);
	});

	it("does not touch the walk's counts, and skips SLICE for rasterizing", async () => {
		const s = slice("s:1", "Left", { x: 0, y: 0, width: 10, height: 10 });
		expect(classify(s)).toEqual({ kind: "skip" });
		const frame = frameNode("f:1", "Front", FRAME_BOX, [s]);
		expect(collectRasterTargets(frame as FigmaContainerNode)).toEqual([]);
		const r = await run([s]);
		expect(r.report.counts.skipped).toBe(0);
	});

	it("names duplicate slices Name-2, Name-3 and warns", async () => {
		const r = await run([
			slice("s:1", "Panel", { x: 0, y: 0, width: 100, height: 100 }),
			slice("s:2", "Panel", { x: 100, y: 0, width: 100, height: 100 }),
			slice("s:3", "Panel", { x: 200, y: 0, width: 100, height: 100 }),
		]);
		expect(r.elements.map((e) => e.properties.slice?.name)).toEqual([
			"Panel",
			"Panel-2",
			"Panel-3",
		]);
		expect(codes(r).filter((c) => c === "slice_name_renamed")).toHaveLength(2);
		const check = validate(r.template);
		expect(check.ok).toBe(true);
	});

	it("keeps a deduped name clear of a layer that already has it", async () => {
		const r = await run([
			slice("s:1", "Panel", { x: 0, y: 0, width: 100, height: 100 }),
			slice("s:2", "Panel", { x: 100, y: 0, width: 100, height: 100 }),
			slice("s:3", "Panel-2", { x: 200, y: 0, width: 100, height: 100 }),
		]);
		const names = r.elements.map((e) => e.properties.slice?.name);
		expect(new Set(names).size).toBe(3);
		expect(validate(r.template).ok).toBe(true);
	});

	it("falls back to the node id for an unnamed slice", async () => {
		const r = await run([
			slice("5:7", "", { x: 0, y: 0, width: 100, height: 100 }),
		]);
		expect(r.elements[0].properties.slice?.name).toBe("5_7");
		expect(validate(r.template).ok).toBe(true);
	});

	it("exports at a format version that covers slices", async () => {
		const r = await run([
			slice("s:1", "Left", { x: 0, y: 0, width: 100, height: 100 }),
		]);
		const t = r.template as Template;
		expect(minimumFormatVersion(t)).toBe("1.7");
		expect(t.format_version).toBe(FORMAT_VERSION);
		expect(t.format_version).toBe("1.7");
	});

	it("resolves to the slices the frame held", async () => {
		const r = await run([
			slice("s:1", "Left", { x: 0, y: 0, width: 500, height: 600 }),
			rect("r:1", "Bg", { x: 0, y: 0, width: 50, height: 50 }),
		]);
		const out = resolveSlices(r.template as Template, { frameName: "front" });
		expect(out.map((s) => s.name)).toEqual(["Left"]);
		expect(out[0].output).toBe("piece");
		expect(out[0].edge).toBe("none");
	});
});
