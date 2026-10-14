import type { Element, LayerSpot, Template } from "@freshcoat-js/coatfile";
import { validate } from "@freshcoat-js/coatfile";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { getElement } from "~/doc/path";
import { DesignPanel } from "~/panels/design/DesignPanel";
import { fastUser } from "./aria";
import { doc, geometryOf } from "./doc-fixture";

const RECT = "0/0";

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

const spot = (c: EditorController, key = RECT) =>
	(
		(getElement(c.template as Template, key) as Element).properties as {
			spot?: LayerSpot;
		}
	).spot;

beforeAll(() => {
	const g = globalThis as { CSS?: { escape?: (s: string) => string } };
	g.CSS ??= {};
	g.CSS.escape ??= (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
});
afterEach(cleanup);

describe("spot colour section", () => {
	it("marks a fill as an overprinting spot and edits it", async () => {
		const c = setup(doc());
		const user = fastUser();
		expect(screen.queryByRole("textbox", { name: "Fill spot name" })).toBeNull();
		await user.click(screen.getByRole("checkbox", { name: "Fill as spot" }));
		expect(spot(c)).toEqual({ fill: { spot: "White", overprint: true } });
		expect(validate(c.template).ok).toBe(true);

		const name = screen.getByRole("textbox", { name: "Fill spot name" });
		await user.clear(name);
		await user.type(name, "Gold Foil{Enter}");
		const tint = screen.getByRole("spinbutton", { name: "Fill spot tint" });
		await user.clear(tint);
		await user.type(tint, "40{Enter}");
		const alt = screen.getByRole("textbox", { name: "Fill spot alternate" });
		await user.type(alt, "#d4af37{Enter}");
		await user.click(screen.getByRole("checkbox", { name: "Overprint" }));
		expect(spot(c)).toEqual({
			fill: { spot: "Gold Foil", tint: 0.4, alt: "#d4af37" },
		});
		expect(validate(c.template).ok).toBe(true);
	});

	it("refuses a reserved name or an alternate that is not a colour", async () => {
		const c = setup(doc());
		const user = fastUser();
		await user.click(screen.getByRole("checkbox", { name: "Stroke as spot" }));
		const name = screen.getByRole("textbox", { name: "Stroke spot name" });
		await user.clear(name);
		await user.type(name, "All{Enter}");
		await user.type(
			screen.getByRole("textbox", { name: "Stroke spot alternate" }),
			"shiny{Enter}",
		);
		expect(spot(c)).toEqual({ stroke: { spot: "White", overprint: true } });
	});

	it("drops the spot when neither paint uses one", async () => {
		const c = setup(doc());
		const user = fastUser();
		const fill = screen.getByRole("checkbox", { name: "Fill as spot" });
		await user.click(fill);
		await user.click(fill);
		expect(spot(c)).toBeUndefined();
	});

	it("is only offered for rects and vectors", () => {
		setup(doc(), "0/1");
		expect(screen.queryByRole("checkbox", { name: "Fill as spot" })).toBeNull();
	});
});
