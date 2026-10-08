import type { Element, Template } from "@freshcoat-js/coatfile";
import { describe, expect, it } from "vitest";
import { EditorController } from "~/app/controller";
import { unwrap, updateElement } from "~/doc/ops";
import { getElement } from "~/doc/path";
import { pasteStyle, readStyle } from "~/doc/style";
import { doc } from "./doc-fixture";

const styled = (): Template => {
	let t = doc();
	t = unwrap(
		updateElement(t, "0/0", {
			shadow: { color: "#000000", dx: 1, dy: 2, blur: 3 },
			blur: 4,
			properties: {
				fill: ["#ff0000", "#00ff00"],
				stroke: { color: "#0000ff", width: 2 },
				cornerRadius: [1, 2, 3, 4],
				cornerSmoothing: 0.6,
			},
		}),
	).template;
	return t;
};

const el = (t: Template, key: string) => getElement(t, key) as Element;

describe("pasteStyle", () => {
	it("copies fills, stroke, effects and corners between shapes", () => {
		const t = styled();
		const out = unwrap(
			pasteStyle(t, ["0/1", "0/5"], readStyle(el(t, "0/0"))),
		).template;
		const frame = el(out, "0/1");
		expect(frame.shadow).toEqual({ color: "#000000", dx: 1, dy: 2, blur: 3 });
		expect(frame.blur).toBe(4);
		expect(frame.type === "frame" && frame.properties).toMatchObject({
			fill: ["#ff0000", "#00ff00"],
			stroke: { color: "#0000ff", width: 2 },
			cornerRadius: [1, 2, 3, 4],
		});
		expect(frame.type === "frame" && frame.properties.children).toHaveLength(3);
		const rect = el(out, "0/5");
		expect(rect.type === "rect" && rect.properties.cornerSmoothing).toBe(0.6);
		expect(rect.pos).toEqual({ x: 700, y: 300 });
		expect(rect.rotation).toBe(30);
	});

	it("clears what the source lacks", () => {
		const t = styled();
		const out = unwrap(
			pasteStyle(t, ["0/0"], readStyle(el(t, "0/5"))),
		).template;
		const rect = el(out, "0/0");
		expect(rect.shadow).toBeUndefined();
		expect(rect.blur).toBeUndefined();
		expect(rect.type === "rect" && rect.properties).toEqual({});
	});

	it("gives text the topmost fill, and keeps its text style", () => {
		const t = styled();
		const out = unwrap(
			pasteStyle(t, ["0/1/1"], readStyle(el(t, "0/0"))),
		).template;
		const text = el(out, "0/1/1");
		expect(text.type === "text" && text.properties).toMatchObject({
			value: "Hi {{ name }}",
			color: "#00ff00",
			font: { family: "Inter", size: 16 },
		});
	});

	it("copies text style between text layers, keeping the content", () => {
		const t = unwrap(
			updateElement(doc(), "0/4", {
				properties: { align: "center", color: "#123456" },
			}),
		).template;
		const out = unwrap(
			pasteStyle(t, ["0/1/1"], readStyle(el(t, "0/4"))),
		).template;
		const text = el(out, "0/1/1");
		expect(text.type === "text" && text.properties).toEqual({
			value: "Hi {{ name }}",
			font: { family: "Inter", size: 24 },
			align: "center",
			color: "#123456",
		});
	});

	it("is one undo step from the controller", () => {
		const c = new EditorController();
		c.open(styled(), "doc.coat");
		c.select(["0/0"]);
		c.copyStyle();
		c.select(["0/1", "0/5"]);
		const before = c.template;
		c.pasteStyle();
		expect(el(c.template as Template, "0/5").blur).toBe(4);
		c.undo();
		expect(c.template).toEqual(before);
	});
});
