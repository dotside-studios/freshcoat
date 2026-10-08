import type { Element, Template } from "@freshcoat-js/coatfile";
import { validate } from "@freshcoat-js/coatfile";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { getElement } from "~/doc/path";
import { DesignPanel } from "~/panels/design/DesignPanel";
import { button, chooseOption, fastUser, spinbutton } from "./aria";
import { doc, geometryOf } from "./doc-fixture";

const RECT = "0/0";

function setup(t: Template = doc()) {
	const c = new EditorController();
	c.open(t, "doc.coat");
	c.dispatch({
		type: "rendered",
		geometry: geometryOf(t),
		timings: { compile: 0, layout: 0, lower: 0, paint: 0, total: 0 },
		stats: {} as never,
		warnings: [],
	});
	c.select([RECT]);
	render(
		<ControllerProvider controller={c}>
			<DesignPanel />
		</ControllerProvider>,
	);
	return c;
}

const stroke = (c: EditorController) =>
	(
		(getElement(c.template as Template, RECT) as Element).properties as {
			stroke?: { color: unknown; width: number; dash?: number[] };
		}
	).stroke;

function typeInto(input: HTMLElement, value: string) {
	fireEvent.focus(input);
	fireEvent.change(input, { target: { value } });
	fireEvent.keyDown(input, { key: "Enter" });
}

beforeAll(() => {
	const g = globalThis as { CSS?: { escape?: (s: string) => string } };
	g.CSS ??= {};
	g.CSS.escape ??= (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
});
afterEach(cleanup);

describe("gradient stroke controls", () => {
	it("turns a stroke into a gradient and edits it like a fill", async () => {
		const user = fastUser();
		const c = setup();
		fireEvent.click(screen.getByRole("button", { name: "Add stroke" }));
		await chooseOption(user, button("Stroke kind"), "Linear");
		expect(stroke(c)).toEqual({
			color: {
				kind: "linear",
				angle: 90,
				stops: [
					{ offset: 0, color: "#000000" },
					{ offset: 1, color: "#00000000" },
				],
			},
			width: 1,
		});
		expect(screen.getByTestId("gradient-swatch").dataset.kind).toBe("linear");
		expect(screen.queryByLabelText("Stroke color")).toBeNull();

		typeInto(spinbutton("Gradient angle"), "45");
		fireEvent.click(button("Reverse stroke stops"));
		expect(stroke(c)?.color).toEqual({
			kind: "linear",
			angle: 45,
			stops: [
				{ offset: 0, color: "#00000000" },
				{ offset: 1, color: "#000000" },
			],
		});
		typeInto(spinbutton("Stroke width"), "4");
		expect(stroke(c)?.width).toBe(4);
		expect(validate(c.template).ok).toBe(true);
	});

	it("switches between gradient kinds and back to a solid colour", async () => {
		const user = fastUser();
		const c = setup();
		fireEvent.click(screen.getByRole("button", { name: "Add stroke" }));
		await chooseOption(user, button("Stroke kind"), "Radial");
		expect(stroke(c)?.color).toMatchObject({ kind: "radial", radius: 0.5 });
		await chooseOption(user, button("Stroke kind"), "Angular");
		expect(stroke(c)?.color).toMatchObject({
			kind: "angular",
			center: [0.5, 0.5],
		});
		expect(validate(c.template).ok).toBe(true);
		await chooseOption(user, button("Stroke kind"), "Solid");
		expect(stroke(c)?.color).toBe("#000000");
		expect(screen.getByLabelText("Stroke color")).toBeTruthy();
	});

	it("does not offer a pattern", async () => {
		const user = fastUser();
		setup();
		fireEvent.click(screen.getByRole("button", { name: "Add stroke" }));
		await user.click(button("Stroke kind"));
		const options = screen.getAllByRole("option").map((o) => o.textContent);
		expect(options).toEqual(["Solid", "Linear", "Radial", "Angular"]);
	});
});
