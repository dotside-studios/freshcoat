import { validate } from "@freshcoat-js/coatfile";
import { describe, expect, it } from "vitest";
import { parseSliceMarker } from "~/lib/figma/transpiler/slice";
import {
	type Box,
	codes,
	ellipse,
	frameNode,
	group,
	line,
	node,
	rect,
	red,
	run,
	slice,
} from "./slice-helpers";

describe("parseSliceMarker", () => {
	it("reads a trailing marker and strips it from the name", () => {
		expect(parseSliceMarker("Left panel #cut")).toEqual({
			name: "Left panel",
			edge: "through",
		});
		expect(parseSliceMarker("Fold #SCORE")).toEqual({
			name: "Fold",
			edge: "score",
		});
		expect(parseSliceMarker("a#kiss")).toEqual({ name: "a", edge: "kiss" });
		expect(parseSliceMarker("Tear #perforate")).toEqual({
			name: "Tear",
			edge: "perforate",
		});
		expect(parseSliceMarker("Panel #slice")).toEqual({
			name: "Panel",
			edge: "none",
		});
	});

	it("leaves a name with no trailing marker alone", () => {
		expect(parseSliceMarker("Rectangle 1")).toBeNull();
		expect(parseSliceMarker("#cut panel")).toBeNull();
		expect(parseSliceMarker("Panel #cutter")).toBeNull();
	});

	it("keeps an empty name when the marker is the whole layer name", () => {
		expect(parseSliceMarker("#cut")).toEqual({ name: "", edge: "through" });
	});
});

describe("slice markers on layer names", () => {
	const box: Box = { x: 40, y: 30, width: 200, height: 100 };

	it("#cut on a rect keeps its paint and adds a through-cut piece", async () => {
		const r = await run([rect("r:1", "Sticker #cut", box)]);
		expect(r.elements).toHaveLength(1);
		expect(r.elements[0].id).toBe("Sticker");
		expect(r.elements[0].properties.fill).toBeDefined();
		expect(r.elements[0].properties.slice).toEqual({
			name: "Sticker",
			edge: "through",
		});
		expect(validate(r.template).ok).toBe(true);
	});

	it("#slice is a plain piece with no edge", async () => {
		const r = await run([rect("r:1", "Panel #slice", box)]);
		expect(r.elements[0].properties.slice).toEqual({ name: "Panel" });
	});

	it.each([
		["#kiss", "kiss"],
		["#score", "score"],
		["#perforate", "perforate"],
	])("%s sets the edge", async (marker, edge) => {
		const r = await run([ellipse("e:1", `Die ${marker}`, box)]);
		expect(r.elements[0].type).toBe("vector");
		expect(r.elements[0].properties.slice).toEqual({ name: "Die", edge });
		expect(validate(r.template).ok).toBe(true);
	});

	it("an open line becomes a cut line, never a piece", async () => {
		const r = await run([
			line("l:1", "Fold #score", { x: 0, y: 300, width: 400, height: 0 }),
		]);
		expect(r.elements[0].type).toBe("vector");
		expect(r.elements[0].properties.slice).toEqual({
			name: "Fold",
			edge: "score",
			output: "none",
		});
		expect(codes(r)).not.toContain("slice_open_path_piece");
		expect(validate(r.template).ok).toBe(true);
	});

	it("gives a flat line a box thick enough to be a slice, leaving the line where it was", async () => {
		const r = await run([
			line("l:1", "Fold #score", { x: 0, y: 300, width: 400, height: 0 }),
		]);
		expect(r.elements[0].pos).toEqual({ x: 0, y: 300 });
		expect(r.elements[0].size).toEqual({ width: 400, height: 1 });
	});

	it("keeps a rotated flat line on its endpoints when its box grows", async () => {
		const r = await run([
			node(
				"LINE",
				"l:1",
				"Fold #score",
				{ x: 260, y: 110, width: 0, height: 100 },
				{
					width: 100,
					height: 0,
					fills: [],
					strokes: red,
					strokeWeight: 2,
					fillGeometry: [{ path: "M 0 0 L 100 0" }],
					absoluteTransform: [
						[0, -1, 260],
						[1, 0, 110],
					],
				},
			),
		]);
		const el = r.elements[0];
		expect(el.rotation).toBe(90);
		const rad = ((el.rotation ?? 0) * Math.PI) / 180;
		const cx = el.pos.x + el.size.width / 2;
		const cy = el.pos.y + el.size.height / 2;
		const world = (x: number) => {
			const dx = x - el.size.width / 2;
			const dy = -el.size.height / 2;
			return {
				x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
				y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
			};
		};
		expect(world(0).x).toBeCloseTo(260, 4);
		expect(world(0).y).toBeCloseTo(110, 4);
		expect(world(100).x).toBeCloseTo(260, 4);
		expect(world(100).y).toBeCloseTo(210, 4);
		expect(validate(r.template).ok).toBe(true);
	});

	it("warns when #slice sits on an open path, which has no piece or edge", async () => {
		const r = await run([
			line("l:1", "Fold #slice", { x: 0, y: 300, width: 400, height: 0 }),
		]);
		expect(r.elements[0].properties.slice).toEqual({
			name: "Fold",
			output: "none",
		});
		expect(codes(r)).toContain("slice_open_path_piece");
	});

	it("warns and ignores a marker that is not a direct child of the frame", async () => {
		const r = await run([
			frameNode("n:1", "Box", { x: 0, y: 0, width: 400, height: 300 }, [
				rect("r:1", "Inner #cut", box),
			]),
			group("g:1", "Grp", { x: 0, y: 0, width: 400, height: 300 }, [
				rect("r:2", "InGroup #cut", box),
			]),
		]);
		expect(JSON.stringify(r.elements)).not.toContain('"slice"');
		const warns = r.warnings.filter(
			(w) => w.code === "slice_marker_not_top_level",
		);
		expect(warns.map((w) => w.nodeId)).toEqual(["r:1", "r:2"]);
		expect(warns[0].message).toMatch(/directly in the frame/);
		expect(validate(r.template).ok).toBe(true);
	});

	it("warns for a marker on a layer that is not a plain shape", async () => {
		const r = await run([
			node(
				"TEXT",
				"t:1",
				"Title #cut",
				{ x: 0, y: 0, width: 100, height: 20 },
				{
					characters: "Hi",
					fills: red,
					style: {
						fontFamily: "Inter",
						fontSize: 12,
						fontWeight: 400,
						textAlignHorizontal: "LEFT",
						textAlignVertical: "TOP",
					},
				},
			),
			frameNode(
				"n:1",
				"Frame #cut",
				{ x: 0, y: 0, width: 100, height: 100 },
				[],
			),
		]);
		expect(JSON.stringify(r.elements)).not.toContain('"slice"');
		expect(
			r.warnings
				.filter((w) => w.code === "slice_marker_not_shape")
				.map((w) => w.nodeId),
		).toEqual(["t:1", "n:1"]);
	});

	it("is not a slice name when the marker is the whole layer name", async () => {
		const r = await run([rect("9:2", "#cut", box)]);
		expect(r.elements[0].properties.slice).toEqual({
			name: "9_2",
			edge: "through",
		});
	});

	it("dedupes a marker's name against a slice node's", async () => {
		const r = await run([
			slice("s:1", "Left", { x: 0, y: 0, width: 100, height: 100 }),
			rect("r:1", "Left #cut", box),
		]);
		expect(
			r.elements.map((e) => e.properties.slice?.name).filter(Boolean),
		).toEqual(["Left", "Left-2"]);
		expect(codes(r)).toContain("slice_name_renamed");
		expect(validate(r.template).ok).toBe(true);
	});
});
