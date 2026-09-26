import { describe, expect, it } from "vitest";
import type { FigmaRectangleNode, FigmaTextNode } from "~/lib/figma/types";

describe("figma node types", () => {
	it("accepts a TEXT node", () => {
		const n: FigmaTextNode = {
			id: "1:2",
			name: "Display name",
			type: "TEXT",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 24 },
			relativeTransform: [
				[1, 0, 0],
				[0, 1, 0],
			],
			characters: "Hello",
			style: {
				fontFamily: "Inter",
				fontSize: 16,
				fontWeight: 400,
				italic: false,
				letterSpacing: 0,
				lineHeightPx: 19,
				lineHeightPercentFontSize: 120,
				textAlignHorizontal: "LEFT",
				textAlignVertical: "TOP",
				textAutoResize: "NONE",
			},
			fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
		};
		expect(n.type).toBe("TEXT");
	});

	it("accepts a RECTANGLE with image fill", () => {
		const n: FigmaRectangleNode = {
			id: "1:3",
			name: "{{user_avatar}}",
			type: "RECTANGLE",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x: 10, y: 10, width: 80, height: 80 },
			relativeTransform: [
				[1, 0, 10],
				[0, 1, 10],
			],
			fills: [{ type: "IMAGE", scaleMode: "FILL", imageRef: "abc123" }],
			cornerRadius: 8,
		};
		expect(n.fills[0].type).toBe("IMAGE");
	});
});
