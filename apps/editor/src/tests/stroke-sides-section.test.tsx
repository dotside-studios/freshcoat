import type { Element, Template } from "@freshcoat-js/coatfile";
import { validate } from "@freshcoat-js/coatfile";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { getElement } from "~/doc/path";
import { DesignPanel } from "~/panels/design/DesignPanel";
import { fastUser } from "./aria";
import { doc, geometryOf } from "./doc-fixture";

const RECT = "0/0";

function withStroke(stroke: unknown): Template {
	const t = doc();
	const rect = t.template_data[0]?.elements[0] as Element;
	(rect.properties as Record<string, unknown>).stroke = stroke;
	return t;
}

function setup(t: Template, key = RECT) {
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

const width = (c: EditorController, key = RECT) =>
	(
		(getElement(c.template as Template, key) as Element).properties as {
			stroke?: { width: unknown };
		}
	).stroke?.width;

beforeAll(() => {
	const g = globalThis as { CSS?: { escape?: (s: string) => string } };
	g.CSS ??= {};
	g.CSS.escape ??= (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
});
afterEach(cleanup);

describe("per-side stroke width", () => {
	it("starts unlinked for sides set apart in the file", () => {
		setup(withStroke({ color: "#000", width: { top: 1, bottom: 3 } }));
		expect(
			screen.queryByRole("spinbutton", { name: "Stroke width" }),
		).toBeNull();
		const sides = within(screen.getByTestId("stroke-sides"))
			.getAllByRole("spinbutton")
			.map((f) => (f as HTMLInputElement).value);
		expect(sides).toEqual(["1", "0", "3", "0"]);
	});

	it("sets one side unlinked, keeping the others, in one undo step", async () => {
		const c = setup(withStroke({ color: "#000", width: 2 }));
		const user = fastUser();
		await user.click(screen.getByRole("button", { name: "Link stroke sides" }));
		expect(width(c)).toBe(2);
		const bottom = screen.getByRole("spinbutton", {
			name: "Stroke width bottom",
		});
		await user.clear(bottom);
		await user.type(bottom, "6{Enter}");
		expect(width(c)).toEqual({ top: 2, right: 2, bottom: 6, left: 2 });
		expect(validate(c.template).ok).toBe(true);
		expect(c.state.doc?.history.past).toHaveLength(1);
		c.undo();
		expect(width(c)).toBe(2);
	});

	it("linking shows the sides mixed and leaves the file until a width is typed", async () => {
		const sides = { top: 1, right: 2, bottom: 3, left: 4 };
		const c = setup(withStroke({ color: "#000", width: sides }));
		const user = fastUser();
		await user.click(screen.getByRole("button", { name: "Link stroke sides" }));
		const field = screen.getByRole("spinbutton", { name: "Stroke width" });
		expect((field as HTMLInputElement).value).toBe("");
		expect(field.getAttribute("placeholder")).toBe("Mixed");
		expect(width(c)).toEqual(sides);
		expect(c.state.doc?.history.past).toHaveLength(0);
		await user.type(field, "5{Enter}");
		expect(width(c)).toBe(5);
	});

	it("offers no per-side width on a vector", () => {
		const t = doc();
		t.template_data[0]?.elements.push({
			id: "v",
			type: "vector",
			pos: { x: 0, y: 0 },
			size: { width: 10, height: 10 },
			properties: { d: "M0 0 L10 10", stroke: { color: "#000", width: 1 } },
		});
		setup(t, `0/${(t.template_data[0]?.elements.length ?? 1) - 1}`);
		expect(
			screen.getByRole("spinbutton", { name: "Stroke width" }),
		).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Link stroke sides" }),
		).toBeNull();
	});
});
