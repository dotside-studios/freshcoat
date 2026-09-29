import { describe, expect, it } from "vitest";
import {
	layoutChildFromNode,
	layoutFromContainer,
} from "~/lib/figma/transpiler/frame";
import { textLayoutSizing } from "~/lib/figma/transpiler/text";
import type { FigmaContainerNode, FigmaNode } from "~/lib/figma/types";

const baseBox = { x: 0, y: 0, width: 100, height: 50 };

describe("layoutFromContainer", () => {
	it("maps a vertical auto-layout container to a column layout block", () => {
		const node = {
			id: "1:1",
			name: "stack",
			type: "FRAME",
			absoluteBoundingBox: baseBox,
			layoutMode: "VERTICAL",
			itemSpacing: 8,
			counterAxisSpacing: 4,
			paddingTop: 2,
			paddingRight: 3,
			paddingBottom: 2,
			paddingLeft: 3,
			primaryAxisAlignItems: "SPACE_BETWEEN",
			counterAxisAlignItems: "CENTER",
			layoutWrap: "WRAP",
			children: [],
		} as unknown as FigmaContainerNode;
		expect(layoutFromContainer(node, 1)).toEqual({
			direction: "column",
			gap: 8,
			crossGap: 4,
			padding: { top: 2, right: 3, bottom: 2, left: 3 },
			primaryAlign: "space-between",
			crossAlign: "center",
			wrap: true,
		});
	});

	it("returns undefined for a NONE / non-auto-layout container", () => {
		const node = { layoutMode: "NONE" } as unknown as FigmaContainerNode;
		expect(layoutFromContainer(node, 1)).toBeUndefined();
	});
});

describe("layoutChildFromNode", () => {
	it("maps sizing, grow, align, absolute, and min/max", () => {
		const node = {
			layoutSizingHorizontal: "FILL",
			layoutSizingVertical: "HUG",
			layoutGrow: 1,
			layoutAlign: "STRETCH",
			layoutPositioning: "ABSOLUTE",
			minWidth: 10,
			maxHeight: 80,
		} as unknown as FigmaNode;
		expect(layoutChildFromNode(node, 2)).toEqual({
			width: "fill",
			height: "hug",
			grow: 1,
			align: "stretch",
			absolute: true,
			min: { width: 20 },
			max: { height: 160 },
		});
	});

	it("returns undefined when the node carries no layout-child signal", () => {
		expect(layoutChildFromNode({} as FigmaNode, 1)).toBeUndefined();
	});
});

describe("textLayoutSizing", () => {
	it("WIDTH_AND_HEIGHT → hug width + hug height", () => {
		expect(textLayoutSizing("WIDTH_AND_HEIGHT")).toEqual({
			width: "hug",
			height: "hug",
		});
	});
	it("HEIGHT → fixed width + hug height", () => {
		expect(textLayoutSizing("HEIGHT")).toEqual({
			width: "fixed",
			height: "hug",
		});
	});
	it("NONE / TRUNCATE / undefined → fixed both", () => {
		expect(textLayoutSizing("NONE")).toEqual({
			width: "fixed",
			height: "fixed",
		});
		expect(textLayoutSizing(undefined)).toEqual({
			width: "fixed",
			height: "fixed",
		});
	});
});

describe("grid layout", () => {
	it("maps a GRID frame's tracks, gaps and padding", () => {
		const node = {
			layoutMode: "GRID",
			gridColumnSizes: [
				{ type: "FIXED", value: 120 },
				{ type: "FLEX", value: 1 },
				{ type: "HUG" },
			],
			gridRowSizes: [{ type: "FLEX" }, { type: "FIXED", value: 40 }],
			gridRowGap: 6,
			gridColumnGap: 10,
			paddingTop: 4,
		} as unknown as FigmaContainerNode;
		expect(layoutFromContainer(node, 2)).toEqual({
			type: "grid",
			columns: [240, "1fr", "auto"],
			rows: ["1fr", 80],
			gap: [12, 20],
			padding: { top: 8, right: 0, bottom: 0, left: 0 },
		});
	});

	it("writes equal gaps once and leaves zero gaps out", () => {
		const grid = (rowGap: number, columnGap: number) =>
			layoutFromContainer(
				{
					layoutMode: "GRID",
					gridColumnSizes: [{ type: "FLEX", value: 1 }],
					gridRowGap: rowGap,
					gridColumnGap: columnGap,
				} as unknown as FigmaContainerNode,
				1,
			);
		expect(grid(8, 8)).toMatchObject({ gap: 8 });
		expect(grid(0, 0)).not.toHaveProperty("gap");
	});

	it("places a grid child by its 1-based track or span", () => {
		const child = (extra: object) =>
			layoutChildFromNode({ ...extra } as unknown as FigmaNode, 1);
		expect(
			child({
				gridColumnAnchorIndex: 1,
				gridColumnSpan: 1,
				gridRowAnchorIndex: 0,
				gridRowSpan: 3,
			}),
		).toEqual({ column: 2, row: [1, 3] });
		expect(child({ gridColumnAnchorIndex: 0, gridColumnSpan: 2 })).toEqual({
			column: [1, 2],
		});
	});
});
