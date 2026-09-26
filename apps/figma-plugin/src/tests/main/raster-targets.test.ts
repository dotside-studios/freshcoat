import { describe, expect, it } from "vitest";
import type { FigmaContainerNode } from "~/lib/figma/types";
import { collectRasterTargets } from "~/main/raster-targets";

const base = {
	visible: true,
	opacity: 1,
	blendMode: "NORMAL" as const,
	absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
};

const frame: FigmaContainerNode = {
	...base,
	id: "1:0",
	name: "front",
	type: "FRAME",
	clipsContent: false,
	fills: [],
	children: [
		{
			...base,
			id: "1:1",
			name: "static",
			type: "RECTANGLE",
			fills: [{ type: "IMAGE", scaleMode: "FILL", imageRef: "H" }],
		},
		{
			...base,
			id: "1:2",
			name: "{{avatar}}",
			type: "RECTANGLE",
			fills: [{ type: "IMAGE", scaleMode: "FILL", imageRef: "H2" }],
		},
		{
			...base,
			id: "1:3",
			name: "blurred",
			type: "RECTANGLE",
			effects: [{ type: "BACKGROUND_BLUR", visible: true, radius: 4 }],
			fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
		},
	],
};

describe("collectRasterTargets", () => {
	it("includes static image fills and flatten nodes, excludes dynamic {{token}} images", () => {
		const ids = collectRasterTargets(frame);
		expect(ids).toContain("1:1"); // static image
		expect(ids).toContain("1:3"); // flatten (unsupported effect)
		expect(ids).not.toContain("1:2"); // dynamic field
	});
});
