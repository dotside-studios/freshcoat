import type { Template, TextElement } from "@freshcoat-js/coatfile";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { createElement } from "~/doc/factories";
import { insertElements, unwrap } from "~/doc/ops";
import { getElement } from "~/doc/path";
import { DesignPanel } from "~/panels/design/DesignPanel";
import { fastUser } from "./aria";
import { doc, geometryOf } from "./doc-fixture";

const KEY = "0/7";

function withText(stroke?: TextElement["properties"]["stroke"]): Template {
	const t = doc();
	const el = createElement(
		"text",
		{ x: 100, y: 100, width: 200, height: 40 },
		t,
		0,
	) as TextElement;
	if (stroke) el.properties = { ...el.properties, stroke };
	const at = t.template_data[0]?.elements.length ?? 0;
	return unwrap(insertElements(t, { side: 0 }, at, [el])).template;
}

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

const stroke = (c: EditorController) =>
	(getElement(c.template as Template, KEY) as TextElement).properties.stroke;

beforeAll(() => {
	const g = globalThis as { CSS?: { escape?: (s: string) => string } };
	g.CSS ??= {};
	g.CSS.escape ??= (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
});
afterEach(cleanup);

describe("Text stroke section", () => {
	it("adds a stroke to a text layer", async () => {
		const user = fastUser();
		const c = setup(withText());
		await user.click(screen.getByRole("button", { name: "Add stroke" }));
		expect(stroke(c)).toEqual({ color: "#000000", width: 1 });
	});

	it("offers position and join but no dash, trim or cap", async () => {
		const user = fastUser();
		const c = setup(withText({ color: "#ff0000", width: 2 }));
		expect(screen.queryByRole("textbox", { name: "Stroke dash" })).toBeNull();
		expect(screen.queryByRole("spinbutton", { name: "Trim end" })).toBeNull();
		expect(screen.queryByRole("button", { name: /Stroke cap/ })).toBeNull();
		expect(screen.getByRole("button", { name: /Stroke join/ })).toBeTruthy();
		await user.click(screen.getByRole("radio", { name: "Outside" }));
		expect(stroke(c)).toEqual({ color: "#ff0000", width: 2, align: "outside" });
	});
});
