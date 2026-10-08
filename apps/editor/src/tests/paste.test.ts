import type { Element, Template } from "@freshcoat-js/coatfile";
import { describe, expect, it } from "vitest";
import { EditorController } from "~/app/controller";
import { getElement } from "~/doc/path";
import { doc } from "./doc-fixture";

function open() {
	const c = new EditorController();
	c.open(doc(), "doc.coat");
	return c;
}

const el = (c: EditorController, key: string) =>
	getElement(c.template as Template, key) as Element;

async function copy(c: EditorController, key: string) {
	c.select([key]);
	await c.copy();
}

describe("paste", () => {
	it("pastes into the selected frame, centred when it would land outside", async () => {
		const c = open();
		await copy(c, "0/0");
		c.select(["0/1"]);
		await c.paste();
		expect(c.state.selection).toEqual(["0/1/3"]);
		expect(el(c, "0/1/3").pos).toEqual({ x: 100, y: 75 });
	});

	it("keeps the artboard position when pasting into a frame it overlaps", async () => {
		const c = open();
		await copy(c, "0/1/2/0");
		c.select(["0/1"]);
		await c.paste();
		expect(c.state.selection).toEqual(["0/1/3"]);
		expect(el(c, "0/1/3").pos).toEqual({ x: 105, y: 106 });
	});

	it("pastes a copied frame beside itself, not into itself", async () => {
		const c = open();
		await copy(c, "0/1");
		await c.paste();
		expect(c.state.selection).toEqual(["0/2"]);
		expect(el(c, "0/2").type).toBe("frame");
	});

	it("pastes in place at the copied artboard position, as one undo step", async () => {
		const c = open();
		await copy(c, "0/1/0");
		c.select([]);
		const before = (c.template as Template).template_data[0].elements.length;
		await c.paste({ inPlace: true });
		const key = `0/${before}`;
		expect(c.state.selection).toEqual([key]);
		expect(el(c, key).pos).toEqual({ x: 210, y: 110 });
		c.undo();
		expect((c.template as Template).template_data[0].elements).toHaveLength(
			before,
		);
	});
});
