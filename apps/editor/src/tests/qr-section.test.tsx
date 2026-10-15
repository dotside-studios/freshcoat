import type { QrCodeElement, Template } from "@freshcoat-js/coatfile";
import { validate } from "@freshcoat-js/coatfile";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { createElement } from "~/doc/factories";
import { insertElements, unwrap } from "~/doc/ops";
import { getElement } from "~/doc/path";
import { DesignPanel } from "~/panels/design/DesignPanel";
import { withGradientStop } from "~/panels/design/QrSection";
import { chooseOption, fastUser } from "./aria";
import { doc, geometryOf } from "./doc-fixture";

const KEY = "0/7";

function withQr(props: Partial<QrCodeElement["properties"]> = {}): Template {
	const t = doc();
	const el = createElement(
		"qr",
		{ x: 100, y: 100, width: 200, height: 200 },
		t,
		0,
	) as QrCodeElement;
	el.properties = { ...el.properties, ...props };
	const at = t.template_data[0]?.elements.length ?? 0;
	return unwrap(insertElements(t, { side: 0 }, at, [el])).template;
}

const button = (label: string) =>
	screen.getByLabelText(label, { selector: "button" });

function setup(t: Template) {
	const c = new EditorController();
	c.open(t, "doc.coat");
	c.dispatch({
		type: "rendered",
		geometry: geometryOf(t),
		timings: { compile: 0, layout: 0, lower: 0, paint: 0, total: 0 },
		stats: {} as never,
		warnings: [],
	});
	c.select([KEY]);
	render(
		<ControllerProvider controller={c}>
			<DesignPanel />
		</ControllerProvider>,
	);
	return c;
}

const qr = (c: EditorController) =>
	getElement(c.template as Template, KEY) as QrCodeElement;

const typeNumber = (label: string, value: string) => {
	const input = screen.getByRole("spinbutton", { name: label });
	fireEvent.focus(input);
	fireEvent.change(input, { target: { value } });
	fireEvent.keyDown(input, { key: "Enter" });
};

beforeAll(() => {
	const g = globalThis as { CSS?: { escape?: (s: string) => string } };
	g.CSS ??= {};
	g.CSS.escape ??= (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
});
afterEach(cleanup);

describe("QrSection", () => {
	it("sets module and eye shapes, and square clears them", async () => {
		const user = fastUser();
		const c = setup(withQr());
		await chooseOption(user, button("QR module shape"), "Dots");
		await chooseOption(user, button("QR eye frame"), "Circle");
		await chooseOption(user, button("QR eye center"), "Dot");
		expect(qr(c).properties).toMatchObject({
			moduleShape: "dot",
			finderOuter: "circle",
			finderInner: "dot",
		});
		await chooseOption(user, button("QR module shape"), "Square");
		expect(qr(c).properties.moduleShape).toBeUndefined();
		expect(validate(c.template as Template).ok).toBe(true);
	});

	it("sets the quiet zone in modules", () => {
		const c = setup(withQr());
		typeNumber("QR quiet zone", "4");
		expect(qr(c).properties.quietZone).toBe(4);
	});

	it("turns a gradient on from the foreground and off again", async () => {
		const user = fastUser();
		const c = setup(withQr({ foreground: "#112233" }));
		await user.click(screen.getByRole("checkbox", { name: "QR gradient" }));
		expect(qr(c).properties.gradient?.stops.map((s) => s.color)).toEqual([
			"#112233",
			"#1a237e",
		]);
		typeNumber("QR gradient angle", "45");
		expect(qr(c).properties.gradient?.angle).toBe(45);
		expect(validate(c.template as Template).ok).toBe(true);
		await user.click(screen.getByRole("checkbox", { name: "QR gradient" }));
		expect(qr(c).properties.gradient).toBeUndefined();
	});

	it("edits a logo's size and padding, and removes it", async () => {
		const user = fastUser();
		const c = setup(withQr({ logo: { src: "https://example.com/logo.png" } }));
		typeNumber("QR logo size", "25");
		typeNumber("QR logo padding", "2");
		expect(qr(c).properties.logo).toEqual({
			src: "https://example.com/logo.png",
			size: 0.25,
			padding: 2,
		});
		await user.click(button("Remove logo"));
		expect(qr(c).properties.logo).toBeUndefined();
	});

	it("names the logo's source", () => {
		setup(withQr({ logo: { src: "https://example.com/logo.png" } }));
		expect(screen.getByTestId("qr-logo-summary").textContent).toBe(
			"https://example.com/logo.png",
		);
	});

	it("caps the logo size field", () => {
		setup(withQr({ logo: { src: "https://example.com/logo.png" } }));
		typeNumber("QR logo size", "80");
		const input = screen.getByRole("spinbutton", { name: "QR logo size" });
		expect((input as HTMLInputElement).value).toContain("30");
	});
});

describe("withGradientStop", () => {
	it("starts a two-stop gradient from a colour", () => {
		expect(withGradientStop(undefined, 1, "#ff0000", "#000000")).toEqual({
			kind: "linear",
			angle: 0,
			stops: [
				{ offset: 0, color: "#000000" },
				{ offset: 1, color: "#ff0000" },
			],
		});
	});
});
