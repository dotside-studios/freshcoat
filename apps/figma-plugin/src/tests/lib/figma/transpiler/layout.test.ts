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
