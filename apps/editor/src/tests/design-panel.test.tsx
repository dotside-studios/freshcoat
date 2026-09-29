import type { Element, Template } from "@freshcoat-js/coatfile";
import { validate } from "@freshcoat-js/coatfile";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { getElement } from "~/doc/path";
import { DesignPanel } from "~/panels/design/DesignPanel";
import { doc, geometryOf } from "./doc-fixture";

function setup(selection: string[], t: Template = doc()) {
	const c = new EditorController();
	c.open(t, "doc.coat");
	c.dispatch({
		type: "rendered",
		geometry: geometryOf(t),
		timings: { compile: 0, layout: 0, lower: 0, paint: 0, total: 0 },
		stats: {} as never,
		warnings: [],
	});
	c.select(selection);
	render(
		<ControllerProvider controller={c}>
			<DesignPanel />
		</ControllerProvider>,
	);
	return c;
}

const el = (c: EditorController, key: string) =>
	getElement(c.template as Template, key) as Element;

function typeInto(input: HTMLElement, value: string) {
	fireEvent.focus(input);
	fireEvent.change(input, { target: { value } });
	fireEvent.keyDown(input, { key: "Enter" });
}

afterEach(cleanup);

describe("DesignPanel", () => {
	it("shows a text layer's position, content and type sections", () => {
		setup(["0/1/1"]);
		// t1 sits at 70,10 inside frame f at 200,100.
		expect(screen.getByRole("spinbutton", { name: "X" })).toHaveProperty(
			"value",
			"270",
		);
		expect(screen.getByLabelText("Text content")).toHaveProperty(
			"value",
			"Hi {{ name }}",
		);
		expect(
			screen.getByRole("spinbutton", { name: "Font size" }),
		).toHaveProperty("value", "16");
		expect(screen.queryByText("Stroke")).toBeNull();
		expect(screen.getByText("Text")).toBeTruthy();
		expect(screen.getByText("Fill")).toBeTruthy();
	});

	it("edits text content as one undo step per burst", () => {
		const c = setup(["0/1/1"]);
		const area = screen.getByLabelText("Text content");
		fireEvent.change(area, { target: { value: "Hello" } });
		fireEvent.change(area, { target: { value: "Hello there" } });
		expect((el(c, "0/1/1").properties as { value: string }).value).toBe(
			"Hello there",
		);
		expect(c.state.doc?.history.past).toHaveLength(1);
	});

	it("focuses the content field on the canvas's double-click event", () => {
		setup(["0/1/1"]);
		act(() => {
			window.dispatchEvent(new CustomEvent("freshcoat:focus-text"));
		});
		expect(document.activeElement).toBe(screen.getByLabelText("Text content"));
	});

	it("justifies text and then offers the last line's alignment", () => {
		const c = setup(["0/1/1"]);
		expect(screen.queryByLabelText("Last line alignment")).toBeNull();
		fireEvent.click(screen.getByRole("radio", { name: "Justify" }));
		expect((el(c, "0/1/1").properties as { align?: string }).align).toBe(
			"justify",
		);
		expect(screen.getByLabelText("Last line alignment")).toBeTruthy();
		expect(validate(c.template).ok).toBe(true);
	});

	it("shows a rect's geometry, fill, stroke and corners, and writes X", () => {
		const c = setup(["0/0"]);
		const x = screen.getByRole("spinbutton", { name: "X" });
		expect(x).toHaveProperty("value", "10");
		expect(screen.getByText("Stroke")).toBeTruthy();
		expect(screen.getByText("Corners")).toBeTruthy();
		expect(screen.queryByText("Text")).toBeNull();
		typeInto(x, "123");
		expect(el(c, "0/0").pos).toEqual({ x: 123, y: 20 });
		expect(validate(c.template).ok).toBe(true);
	});

	it("shows Mixed for differing values and writes every layer", () => {
		const c = setup(["0/0", "0/5"]);
		const y = screen.getByRole("spinbutton", { name: "Y" });
		expect(y).toHaveProperty("value", "");
		expect(y.getAttribute("placeholder")).toBe("Mixed");
		typeInto(screen.getByRole("spinbutton", { name: "Opacity" }), "50");
		expect(el(c, "0/0").opacity).toBe(0.5);
		expect(el(c, "0/5").opacity).toBe(0.5);
		expect(c.state.doc?.history.past).toHaveLength(1);
	});

	it("disables X and Y for auto-layout children", () => {
		setup(["0/3/0"]);
		expect(
			screen.getByRole("spinbutton", { name: "X" }).hasAttribute("disabled"),
		).toBe(true);
		expect(screen.getByText("Resizing")).toBeTruthy();
	});

	it("shows the side and its background with nothing selected", () => {
		setup([]);
		expect(screen.getByTestId("side-size")).toBeTruthy();
		expect(screen.getByText("Every side shares this size")).toBeTruthy();
		expect(screen.getByText("Background")).toBeTruthy();
	});

	it("edits the template size with nothing selected, as an undo step", () => {
		const c = setup([]);
		const w = screen.getByRole("spinbutton", { name: "Template width" });
		const h = screen.getByRole("spinbutton", { name: "Template height" });
		expect([w, h].map((f) => (f as HTMLInputElement).value)).toEqual([
			"1000",
			"600",
		]);
		typeInto(w, "800");
		const t = c.base as Template;
		expect([t.width, t.height]).toEqual([800, 600]);
		// Without constraints: layers stay where they are.
		expect(el(c, "0/0").pos).toEqual(getElement(doc(), "0/0")?.pos);
		expect(c.state.doc?.history.past).toHaveLength(1);
		typeInto(h, "500");
		expect([c.base?.width, c.base?.height]).toEqual([800, 500]);
		c.undo();
		expect([c.base?.width, c.base?.height]).toEqual([1000, 600]);
	});

	it("adds a stroke and a shadow that validate", () => {
		const c = setup(["0/0"]);
		fireEvent.click(screen.getByRole("button", { name: "Add stroke" }));
		fireEvent.click(screen.getByRole("button", { name: "Add shadow" }));
		const e = el(c, "0/0");
		expect((e.properties as { stroke?: unknown }).stroke).toEqual({
			color: "#000000",
			width: 1,
		});
		expect(e.shadow).toMatchObject({ dx: 0, dy: 4 });
		expect(validate(c.template).ok).toBe(true);
	});
});
