import type { Template } from "@freshcoat-js/coatfile";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { updateElement } from "~/doc/ops";
import { DesignPanel } from "~/panels/design/DesignPanel";
import { button, fastUser } from "./aria";
import { doc, geometryOf } from "./doc-fixture";

const RECT = "0/0";
const TEXT = "0/1/1";

function setup(key: string, t: Template = doc()) {
	const c = new EditorController();
	c.open(t, "doc.coat");
	c.dispatch({
		type: "rendered",
		geometry: geometryOf(t),
		timings: { compile: 0, layout: 0, lower: 0, paint: 0, total: 0 },
		stats: {} as never,
		warnings: [],
	});
	c.select([key]);
	render(
		<ControllerProvider controller={c}>
			<DesignPanel />
		</ControllerProvider>,
	);
	return c;
}

beforeAll(() => {
	const g = globalThis as { CSS?: { escape?: (s: string) => string } };
	g.CSS ??= {};
	g.CSS.escape ??= (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
});
afterEach(cleanup);

describe("inspector popovers", () => {
	it("opens a gradient fill's stops in a popover", () => {
		const r = updateElement(doc(), RECT, {
			properties: {
				fill: {
					kind: "linear",
					angle: 90,
					stops: [
						{ offset: 0, color: "#000000" },
						{ offset: 1, color: "#ffffff" },
					],
				},
			},
		});
		setup(RECT, r.ok ? r.template : doc());
		expect(screen.queryByTestId("stop-bar")).toBeNull();
		expect(screen.getByTestId("gradient-swatch")).toBeTruthy();
		fireEvent.click(button("Edit fill 1"));
		expect(screen.getByRole("dialog", { name: "Gradient" })).toBeTruthy();
		expect(screen.getByTestId("stop-bar")).toBeTruthy();
	});

	it("opens an effect's settings in a popover", () => {
		setup(RECT);
		fireEvent.click(screen.getByRole("button", { name: "Add shadow" }));
		expect(screen.queryByLabelText("Shadow 1 x")).toBeNull();
		fireEvent.click(button("Shadow 1 settings"));
		const dialog = screen.getByRole("dialog", { name: "Shadow 1" });
		expect(dialog.contains(screen.getByLabelText("Shadow 1 x"))).toBe(true);
	});

	it("groups type settings in tabs", async () => {
		const user = fastUser();
		setup(TEXT);
		expect(screen.queryByLabelText("OpenType features")).toBeNull();
		fireEvent.click(button("Type settings"));
		const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
		expect(tabs).toEqual(["Basics", "Details", "Arc"]);
		expect(screen.getByLabelText("Case")).toBeTruthy();
		await user.click(screen.getByRole("tab", { name: "Details" }));
		expect(screen.getByLabelText("OpenType features")).toBeTruthy();
		await user.click(screen.getByRole("tab", { name: "Arc" }));
		expect(screen.getByLabelText("Text path")).toBeTruthy();
		expect(screen.queryByLabelText("OpenType features")).toBeNull();
	});
});
