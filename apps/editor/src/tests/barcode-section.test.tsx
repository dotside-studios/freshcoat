import type { BarcodeElement, Template } from "@freshcoat-js/coatfile";
import { setBarcodeEncoder, validate } from "@freshcoat-js/coatfile";
import { bwipBarcodeEncoder } from "@freshcoat-js/coatfile/barcode";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { IssuesList } from "~/app/IssuesPopover";
import { createElement } from "~/doc/factories";
import { insertElements, unwrap } from "~/doc/ops";
import { getElement } from "~/doc/path";
import { barcodeMessages } from "~/panels/design/BarcodeSection";
import { DesignPanel } from "~/panels/design/DesignPanel";
import { chooseOption } from "./aria";
import { doc, geometryOf } from "./doc-fixture";

// The fixture's side 0 holds seven layers, so a barcode appended lands at 0/7.
const KEY = "0/7";

function withBarcode(
	props: Partial<BarcodeElement["properties"]> = {},
	count = 1,
): Template {
	let t = doc();
	for (let i = 0; i < count; i++) {
		const el = createElement(
			"barcode",
			{ x: 100, y: 100, width: 360, height: 120 },
			t,
			0,
		) as BarcodeElement;
		el.properties = { ...el.properties, ...props };
		const at = t.template_data[0]?.elements.length ?? 0;
		t = unwrap(insertElements(t, { side: 0 }, at, [el])).template;
	}
	return t;
}

function setup(t: Template, selection = [KEY]) {
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

const code = (c: EditorController, key = KEY) =>
	getElement(c.template as Template, key) as BarcodeElement;

beforeAll(() => {
	setBarcodeEncoder(bwipBarcodeEncoder);
	// jsdom has no CSS.escape, which react-aria uses to find items by key.
	const g = globalThis as { CSS?: { escape?: (s: string) => string } };
	g.CSS ??= {};
	g.CSS.escape ??= (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
});
afterAll(() => setBarcodeEncoder(null));
afterEach(cleanup);

describe("BarcodeSection", () => {
	it("sits at the end of the fixture's first side", () => {
		const t = withBarcode();
		expect(getElement(t, KEY)?.type).toBe("barcode");
		expect(validate(t).ok).toBe(true);
	});

	it("shows a Code 128's type, value and text controls, and no recovery", () => {
		setup(withBarcode());
		expect(screen.getByText("Barcode")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: /Barcode type/ }).textContent,
		).toContain("Code 128");
		expect(screen.getByLabelText("Barcode value")).toHaveProperty(
			"value",
			"FRESHCOAT",
		);
		expect(screen.getByText("Human-readable text")).toBeTruthy();
		expect(
			screen.getByRole("spinbutton", { name: "Quiet zone" }),
		).toHaveProperty("value", "10 modules");
		expect(
			screen.queryByRole("spinbutton", { name: "Error correction" }),
		).toBeNull();
		expect(screen.queryByTestId("barcode-message")).toBeNull();
	});

	it("writes the value as one undo step per burst", () => {
		const c = setup(withBarcode());
		const input = screen.getByLabelText("Barcode value");
		fireEvent.change(input, { target: { value: "A" } });
		fireEvent.change(input, { target: { value: "ABC-123" } });
		expect(code(c).properties.value).toBe("ABC-123");
		expect(c.state.doc?.history.past).toHaveLength(1);
	});

	it("inserts a field token at the caret", async () => {
		const user = userEvent.setup();
		const c = setup(withBarcode({ value: "ID " }));
		await user.click(screen.getByRole("button", { name: "Insert field" }));
		const menu = await screen.findByRole("menu");
		await user.click(within(menu).getByRole("menuitem", { name: /name/ }));
		expect(code(c).properties.value).toBe("ID {{name}}");
	});

	it("squares the box and drops old-symbology settings when switching to Data Matrix", async () => {
		const user = userEvent.setup();
		const c = setup(withBarcode({ quietZone: 4, showText: false }));
		await chooseOption(
			user,
			screen.getByRole("button", { name: /Barcode type/ }),
			"Data Matrix",
		);
		const el = code(c);
		expect(el.properties.symbology).toBe("datamatrix");
		expect(el.properties.quietZone).toBeUndefined();
		expect(el.size).toEqual({ width: 120, height: 120 });
		// Centred where the wide box was.
		expect(el.pos).toEqual({ x: 220, y: 100 });
		expect(screen.queryByText("Human-readable text")).toBeNull();
		expect(
			screen.getByRole("spinbutton", { name: "Quiet zone" }),
		).toHaveProperty("value", "1 module");
		expect(validate(c.template).ok).toBe(true);
	});

	it("turns a Data Matrix square back into a bar code's box, as one undo step", async () => {
		const user = userEvent.setup();
		const t = withBarcode({ symbology: "datamatrix" });
		const square = getElement(t, KEY) as BarcodeElement;
		square.pos = { x: 220, y: 100 };
		square.size = { width: 120, height: 120 };
		const c = setup(t);
		await chooseOption(
			user,
			screen.getByRole("button", { name: /Barcode type/ }),
			"Code 128",
		);
		const el = code(c);
		expect(el.properties.symbology).toBe("code128");
		// Width kept, a third of it high, centred where the square was.
		expect(el.size).toEqual({ width: 120, height: 40 });
		expect(el.pos).toEqual({ x: 220, y: 140 });
		expect(c.state.doc?.history.past).toHaveLength(1);
		act(() => c.undo());
		expect(code(c).properties.symbology).toBe("datamatrix");
		expect(code(c).size).toEqual({ width: 120, height: 120 });
		expect(code(c).pos).toEqual({ x: 220, y: 100 });
	});

	// Encoding PDF417 in jsdom takes over 3 s alone, and more on a busy
	// runner, so this one gets more than the default 5 s.
	it("keeps the box for PDF417 and offers its 0 to 8 levels", async () => {
		const user = userEvent.setup();
		const c = setup(withBarcode());
		await chooseOption(
			user,
			screen.getByRole("button", { name: /Barcode type/ }),
			"PDF417",
		);
		expect(code(c).size).toEqual({ width: 360, height: 120 });
		const ec = screen.getByRole("spinbutton", { name: "Error correction" });
		expect(ec.getAttribute("placeholder")).toBe("Auto");
		fireEvent.focus(ec);
		fireEvent.change(ec, { target: { value: "12" } });
		fireEvent.keyDown(ec, { key: "Enter" });
		expect(code(c).properties.errorCorrection).toBe(8);
	}, 20_000);

	it("offers ITF-14 bearer bars, and only for ITF-14", async () => {
		const user = userEvent.setup();
		const c = setup(
			withBarcode({ symbology: "itf14", value: "1234567890123" }),
		);
		const bearers = screen.getByRole("button", { name: /Bearer bars/ });
		expect(bearers.textContent).toContain("None");
		await chooseOption(user, bearers, "Frame");
		expect(code(c).properties.bearerBars).toBe("frame");
		await chooseOption(
			user,
			screen.getByRole("button", { name: /Bearer bars/ }),
			"None",
		);
		expect(code(c).properties.bearerBars).toBeUndefined();
		await chooseOption(
			user,
			screen.getByRole("button", { name: /Bearer bars/ }),
			"Top and bottom",
		);
		await chooseOption(
			user,
			screen.getByRole("button", { name: /Barcode type/ }),
			"Code 128",
		);
		expect(code(c).properties.bearerBars).toBeUndefined();
		expect(screen.queryByRole("button", { name: /Bearer bars/ })).toBeNull();
	});

	it("gives Aztec a percentage", () => {
		setup(withBarcode({ symbology: "aztec", errorCorrection: 33 }));
		expect(
			screen.getByRole("spinbutton", { name: "Error correction" }),
		).toHaveProperty("value", "33%");
	});

	it("adds and removes a background", async () => {
		const user = userEvent.setup();
		const c = setup(withBarcode());
		await user.click(screen.getByRole("button", { name: "Add background" }));
		expect(code(c).properties.background).toBe("#ffffff");
		await user.click(screen.getByRole("button", { name: "Remove background" }));
		expect(code(c).properties.background).toBeUndefined();
	});

	it("says inline why an EAN-13 value doesn't encode", () => {
		setup(withBarcode({ symbology: "ean13", value: "12345" }));
		const message = screen.getByTestId("barcode-message");
		expect(message.textContent).toMatch(/EAN-13/i);
		expect(message.className).toContain("text-fc-danger-text");
	});

	it("checks the value the preview record fills in", () => {
		const c = setup(withBarcode({ symbology: "ean13", value: "{{title}}" }));
		// The sample title is text, which EAN-13 can't carry.
		expect(screen.getByTestId("barcode-message")).toBeTruthy();
		// An unfilled field is a skeleton, not an error.
		act(() => c.dispatch({ type: "setValue", field: "title", value: "" }));
		expect(screen.queryByTestId("barcode-message")).toBeNull();
		act(() => c.dispatch({ type: "setValue", field: "title", value: "abc" }));
		expect(screen.getByTestId("barcode-message")).toBeTruthy();
		act(() =>
			c.dispatch({ type: "setValue", field: "title", value: "590123412345" }),
		);
		expect(screen.queryByTestId("barcode-message")).toBeNull();
	});

	it("shows Mixed for two codes of different types", () => {
		const t = withBarcode({}, 2);
		const second = getElement(t, "0/8") as BarcodeElement;
		second.properties = { ...second.properties, symbology: "aztec" };
		setup(t, [KEY, "0/8"]);
		expect(
			screen.getByRole("button", { name: /Barcode type/ }).textContent,
		).toContain("Mixed");
		// Aztec has no human-readable line, so the text rows go.
		expect(screen.queryByText("Human-readable text")).toBeNull();
	});
});

describe("barcodeMessages", () => {
	it("dedupes, fills fields and skips empty values", () => {
		const t = withBarcode({ symbology: "ean13", value: "{{title}}" }, 2);
		const layers = [0, 1].map(
			(i) => getElement(t, `0/${7 + i}`) as BarcodeElement,
		);
		expect(barcodeMessages(t, {}, layers)).toEqual([]);
		expect(barcodeMessages(t, { title: "x" }, layers)).toHaveLength(1);
		expect(barcodeMessages(t, { title: "5901234123457" }, layers)).toEqual([]);
	});

	it("says nothing without an encoder", () => {
		const t = withBarcode({ symbology: "ean13", value: "x" });
		setBarcodeEncoder(null);
		try {
			expect(
				barcodeMessages(t, {}, [getElement(t, KEY) as BarcodeElement]),
			).toEqual([]);
		} finally {
			setBarcodeEncoder(bwipBarcodeEncoder);
		}
	});
});

describe("IssuesList", () => {
	it("lists a barcode the preview can't encode as a hint that selects it", async () => {
		const user = userEvent.setup();
		const t = withBarcode({ symbology: "ean13", value: "12" });
		const c = new EditorController();
		c.open(t, "doc.coat");
		c.dispatch({
			type: "rendered",
			geometry: geometryOf(t),
			timings: { compile: 0, layout: 0, lower: 0, paint: 0, total: 0 },
			stats: {} as never,
			warnings: [],
			barcodes: [
				{
					key: KEY,
					symbology: "ean13",
					value: "12",
					message: "EAN-13 must be 12 or 13 digits",
				},
			],
		});
		render(
			<ControllerProvider controller={c}>
				<IssuesList template={t} />
			</ControllerProvider>,
		);
		const list = screen.getByRole("region", { name: "Preview hints" });
		const row = within(list).getByTestId("barcode-hint");
		expect(row.textContent).toContain("EAN-13 must be 12 or 13 digits");
		await user.click(within(row).getByRole("button", { name: /Select/ }));
		expect(c.state.selection).toEqual([KEY]);
	});
});
