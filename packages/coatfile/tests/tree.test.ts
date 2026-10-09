import { describe, expect, test } from "vitest";
import { allElements, walkElements } from "../src/tree";
import type { Element } from "../src/types";

const rect = (id: string) =>
	({ id, type: "rect", properties: { fill: "#000000" } }) as Element;

const tree = [
	{
		id: "frame",
		type: "frame",
		properties: {
			children: [
				{
					id: "mask",
					type: "mask",
					properties: { mask: rect("shape"), children: [rect("photo")] },
				},
				rect("caption"),
			],
		},
	},
	rect("logo"),
] as Element[];

describe("walkElements", () => {
	test("visits each element before its contents, a mask's shape first", () => {
		expect(allElements(tree).map((el) => el.id)).toEqual([
			"frame",
			"mask",
			"shape",
			"photo",
			"caption",
			"logo",
		]);
	});

	test("a visit that returns false skips that element's contents", () => {
		const seen: string[] = [];
		walkElements(tree, (el) => {
			seen.push(el.id);
			return el.type !== "mask";
		});
		expect(seen).toEqual(["frame", "mask", "caption", "logo"]);
	});
});
