import type {
	Element,
	FrameElement,
	ImageProperties,
	MaskElement,
	Template,
} from "@freshcoat-js/coatfile";
import { validate } from "@freshcoat-js/coatfile";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { getElement } from "~/doc/path";
import { DesignPanel } from "~/panels/design/DesignPanel";
import { chooseOption, fastUser, spinbutton } from "./aria";
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

beforeAll(() => {
	// jsdom has no CSS.escape, which react-aria uses to find items by key.
	const g = globalThis as { CSS?: { escape?: (s: string) => string } };
	g.CSS ??= {};
	g.CSS.escape ??= (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
});
afterEach(cleanup);

describe("DesignPanel", () => {
	it("shows a text layer's position, content and type sections", () => {
		setup(["0/1/1"]);
		// t1 sits at 70,10 inside frame f at 200,100.
		expect(spinbutton("X")).toHaveProperty("value", "270");
		expect(screen.getByLabelText("Text content")).toHaveProperty(
			"value",
			"Hi {{ name }}",
		);
		expect(spinbutton("Font size")).toHaveProperty("value", "16");
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

	it("sets the text direction", async () => {
		const c = setup(["0/1/1"]);
		await chooseOption(
			fastUser(),
			screen.getByRole("button", { name: /Text direction/ }),
			"Right to left",
		);
		expect(
			(el(c, "0/1/1").properties as { direction?: string }).direction,
		).toBe("rtl");
		expect(validate(c.template).ok).toBe(true);
	});

	it("writes OpenType features from the features field", () => {
		const c = setup(["0/1/1"]);
		typeInto(screen.getByLabelText("OpenType features"), "tnum, -liga");
		const font = (el(c, "0/1/1").properties as { font: { features?: unknown } })
			.font;
		expect(font.features).toEqual({ tnum: 1, liga: 0 });
		expect(validate(c.template).ok).toBe(true);
	});

	it("writes paragraph spacing, and clears it at zero", () => {
		const c = setup(["0/1/1"]);
		const field = spinbutton("Paragraph spacing");
		typeInto(field, "12");
		const spacing = () =>
			(el(c, "0/1/1").properties as { paragraphSpacing?: number })
				.paragraphSpacing;
		expect(spacing()).toBe(12);
		typeInto(field, "0");
		expect(spacing()).toBeUndefined();
	});

	it("shows a rect's geometry, fill, stroke and corners, and writes X", () => {
		const c = setup(["0/0"]);
		const x = spinbutton("X");
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
		const y = spinbutton("Y");
		expect(y).toHaveProperty("value", "");
		expect(y.getAttribute("placeholder")).toBe("Mixed");
		typeInto(spinbutton("Opacity"), "50");
		expect(el(c, "0/0").opacity).toBe(0.5);
		expect(el(c, "0/5").opacity).toBe(0.5);
		expect(c.state.doc?.history.past).toHaveLength(1);
	});

	it("disables X and Y for auto-layout children", () => {
		setup(["0/3/0"]);
		expect(spinbutton("X").hasAttribute("disabled")).toBe(true);
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
		const w = spinbutton("Template width");
		const h = spinbutton("Template height");
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

	it("sets and clears a background blur as one shared field", () => {
		const c = setup(["0/0", "0/1"]);
		typeInto(spinbutton("Background blur"), "16");
		expect(el(c, "0/0").backdropBlur).toBe(16);
		expect(el(c, "0/1").backdropBlur).toBe(16);
		expect(validate(c.template).ok).toBe(true);
		typeInto(spinbutton("Background blur"), "0");
		expect("backdropBlur" in el(c, "0/0")).toBe(false);
	});

	it("positions an image's stroke outside", () => {
		const c = setup(["0/2/0"]);
		fireEvent.click(screen.getByRole("button", { name: "Add stroke" }));
		fireEvent.click(screen.getByRole("radio", { name: "Outside" }));
		expect(
			(el(c, "0/2/0").properties as { stroke?: { align?: string } }).stroke
				?.align,
		).toBe("outside");
		expect(validate(c.template).ok).toBe(true);
	});

	it("splits a frame's corners and writes one", () => {
		const c = setup(["0/1"]);
		fireEvent.click(
			screen.getByRole("button", { name: "Independent corners" }),
		);
		typeInto(spinbutton("TL radius"), "12");
		expect(
			(el(c, "0/1").properties as { cornerRadius?: unknown }).cornerRadius,
		).toEqual([12, 0, 0, 0]);
		expect(validate(c.template).ok).toBe(true);
	});

	it("keeps an image's corners uniform", () => {
		setup(["0/2/0"]);
		expect(
			screen.queryByRole("button", { name: "Independent corners" }),
		).toBeNull();
	});

	it("switches a frame to a grid and edits its tracks and gaps", () => {
		const c = setup(["0/3"]);
		fireEvent.click(screen.getByRole("radio", { name: "Grid" }));
		const layout = () =>
			(el(c, "0/3").properties as { layout?: unknown }).layout;
		expect(layout()).toEqual({
			type: "grid",
			columns: ["1fr", "1fr"],
			gap: 10,
			padding: { top: 10, right: 10, bottom: 10, left: 10 },
		});
		typeInto(spinbutton("Column count"), "3");
		expect(layout()).toMatchObject({ columns: ["1fr", "1fr", "1fr"] });
		const first = screen.getByRole("radiogroup", { name: "Column 1 size" });
		fireEvent.click(within(first).getByRole("radio", { name: "Fixed" }));
		typeInto(spinbutton("Column 1 size"), "80");
		typeInto(spinbutton("Column 2 share"), "2");
		const third = screen.getByRole("radiogroup", { name: "Column 3 size" });
		fireEvent.click(within(third).getByRole("radio", { name: "Hug" }));
		expect(layout()).toMatchObject({ columns: [80, "2fr", "auto"] });
		expect(screen.getByText("Added as children need them")).toBeTruthy();
		typeInto(spinbutton("Row count"), "2");
		expect(layout()).toMatchObject({ rows: ["auto", "auto"] });
		typeInto(spinbutton("Row count"), "0");
		expect(layout()).not.toHaveProperty("rows");
		typeInto(spinbutton("Row gap"), "4");
		expect(layout()).toMatchObject({ gap: [4, 10] });
		expect(validate(c.template).ok).toBe(true);
		fireEvent.click(screen.getByRole("radio", { name: "Flex" }));
		expect(layout()).toMatchObject({ direction: "row", gap: 10 });
	});

	it("places a grid child by column and row", () => {
		const t = doc();
		const row = t.template_data[0].elements[3] as FrameElement;
		row.properties.layout = { type: "grid", columns: ["1fr", "1fr"] };
		const c = setup(["0/3/0"], t);
		expect(screen.queryByRole("checkbox", { name: "Grow" })).toBeNull();
		typeInto(screen.getByLabelText("Grid column"), "1-2");
		typeInto(screen.getByLabelText("Grid row"), "2");
		expect(el(c, "0/3/0").layoutChild).toEqual({ column: [1, 2], row: 2 });
		typeInto(screen.getByLabelText("Grid row"), "0");
		expect(el(c, "0/3/0").layoutChild).toEqual({ column: [1, 2], row: 2 });
		typeInto(screen.getByLabelText("Grid column"), "");
		expect(el(c, "0/3/0").layoutChild).toEqual({ row: 2 });
		expect(validate(c.template).ok).toBe(true);
	});

	it("adds adjustments and writes each factor", () => {
		const c = setup(["0/0"]);
		fireEvent.click(screen.getByRole("button", { name: "Add adjustments" }));
		expect(el(c, "0/0").adjust).toEqual({});
		typeInto(spinbutton("Saturation"), "50");
		typeInto(spinbutton("Gamma"), "0.8");
		fireEvent.click(screen.getByRole("checkbox", { name: "Preserve hue" }));
		expect(el(c, "0/0").adjust).toEqual({
			saturation: 0.5,
			gamma: 0.8,
			preserveHue: true,
		});
		typeInto(spinbutton("Saturation"), "100");
		expect(el(c, "0/0").adjust).toEqual({ gamma: 0.8, preserveHue: true });
		expect(validate(c.template).ok).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: "Remove adjustments" }));
		expect(el(c, "0/0").adjust).toBeUndefined();
	});

	it("sets an image's focal point and crop", () => {
		const c = setup(["0/2/0"]);
		const props = () => el(c, "0/2/0").properties as ImageProperties;
		typeInto(spinbutton("Focus X"), "20");
		expect(props().focus).toEqual([0.2, 0.5]);
		fireEvent.click(screen.getByRole("checkbox", { name: "Crop image" }));
		expect(props().crop).toEqual({ x: 0, y: 0, width: 1, height: 1 });
		typeInto(spinbutton("Crop X"), "30");
		expect(props().crop).toEqual({ x: 0.3, y: 0, width: 0.7, height: 1 });
		typeInto(spinbutton("Crop width"), "90");
		expect(props().crop).toEqual({ x: 0.3, y: 0, width: 0.7, height: 1 });
		expect(validate(c.template).ok).toBe(true);

		cleanup();
		const t = doc();
		const mask = t.template_data[0].elements[2] as MaskElement;
		(mask.properties.children[0].properties as ImageProperties).focus =
			"{{name}}";
		setup(["0/2/0"], t);
		expect(
			screen.getByRole("button", { name: /Focus source/ }).textContent,
		).toContain("Name");
		expect(screen.queryByRole("spinbutton", { name: "Focus X" })).toBeNull();
		expect(validate(c.template).ok).toBe(true);
	});
});
