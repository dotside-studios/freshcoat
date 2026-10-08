import type { RectElement, Template } from "@freshcoat-js/coatfile";
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

function withRect(stroke: RectElement["properties"]["stroke"]): Template {
	const t = doc();
	const el = createElement(
		"rect",
		{ x: 100, y: 100, width: 100, height: 100 },
		t,
		0,
	) as RectElement;
	el.properties = { ...el.properties, stroke };
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
	(getElement(c.template as Template, KEY) as RectElement).properties.stroke;
const field = (name: string) => screen.getByRole("spinbutton", { name });

beforeAll(() => {
	const g = globalThis as { CSS?: { escape?: (s: string) => string } };
	g.CSS ??= {};
	g.CSS.escape ??= (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
});
afterEach(cleanup);

describe("Stroke trim fields", () => {
	it("shows the trim as percentages, defaulting to the whole stroke", () => {
		setup(withRect({ color: "#000000", width: 2, trimEnd: 0.25 }));
		expect(field("Trim start")).toHaveProperty("value", "0%");
		expect(field("Trim end")).toHaveProperty("value", "25%");
		expect(field("Trim offset")).toHaveProperty("value", "0%");
	});

	it("writes fractions and clears a value set back to its default", async () => {
		const user = fastUser();
		const c = setup(withRect({ color: "#000000", width: 2 }));
		await user.clear(field("Trim end"));
		await user.type(field("Trim end"), "40{Enter}");
		expect(stroke(c)?.trimEnd).toBe(0.4);
		await user.clear(field("Trim offset"));
		await user.type(field("Trim offset"), "-25{Enter}");
		expect(stroke(c)?.trimOffset).toBe(-0.25);
		await user.clear(field("Trim end"));
		await user.type(field("Trim end"), "100{Enter}");
		expect(stroke(c)).not.toHaveProperty("trimEnd");
	});

	it("shows a bound trim's token", () => {
		setup(withRect({ color: "#000000", width: 2, trimEnd: "{{progress}}" }));
		expect(field("Trim end")).toHaveProperty("value", "");
		expect(field("Trim end").getAttribute("placeholder")).toBe("{{progress}}");
	});
});
