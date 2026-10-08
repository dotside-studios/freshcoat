import type { Element, Template } from "@freshcoat-js/coatfile";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { createElement } from "~/doc/factories";
import { insertElements, unwrap } from "~/doc/ops";
import { getElement } from "~/doc/path";
import { DesignPanel } from "~/panels/design/DesignPanel";
import {
	completionAt,
	completionOptions,
} from "~/panels/design/field-completion";
import { fastUser } from "./aria";
import { doc, geometryOf } from "./doc-fixture";

const KEY = "0/7";

function setup() {
	let t = doc();
	const el = createElement(
		"text",
		{ x: 100, y: 100, width: 200, height: 40 },
		t,
		0,
	) as Element;
	el.properties = { ...el.properties, value: "" } as never;
	t = unwrap(insertElements(t, { side: 0 }, 7, [el])).template;
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
	const value = () =>
		(
			(getElement(c.template as Template, KEY) as Element).properties as {
				value?: string;
			}
		).value;
	return {
		c,
		value,
		area: screen.getByRole("textbox", { name: "Text content" }),
	};
}

afterEach(cleanup);

describe("completionAt", () => {
	it("finds an open {{ before the caret", () => {
		expect(completionAt("Hi {{na", 7)).toEqual({
			start: 3,
			end: 7,
			query: "na",
		});
		expect(completionAt("Hi {{ ", 6)).toEqual({ start: 3, end: 6, query: "" });
	});

	it("covers the rest of a token the caret is inside", () => {
		expect(completionAt("{{nam}} x", 3)).toEqual({
			start: 0,
			end: 7,
			query: "n",
		});
	});

	it("ignores closed tokens and plain text", () => {
		expect(completionAt("{{name}} ", 9)).toBeNull();
		expect(completionAt("name", 4)).toBeNull();
	});
});

describe("completionOptions", () => {
	it("puts key prefixes first and offers a new key", () => {
		const t = doc();
		t.fields.properties.surname = { type: "string" };
		const ids = completionOptions(t, "na").map((o) =>
			o.kind === "field" ? o.entry.id : `new:${o.id}`,
		);
		expect(ids).toEqual(["name", "surname", "new:na"]);
		expect(completionOptions(t, "name").some((o) => o.kind === "new")).toBe(
			false,
		);
	});
});

describe("{{ autocomplete in the inspector", () => {
	it("writes the chosen key with Enter", async () => {
		const user = fastUser();
		const { area, value } = setup();
		await user.click(area);
		await user.type(area, "Hi {{{{ti");
		const list = await screen.findByTestId("field-completion");
		expect(within(list).getAllByRole("option")[0]?.textContent).toBe("title");
		await user.keyboard("{Enter}");
		expect(value()).toBe("Hi {{title}}");
		expect(screen.queryByTestId("field-completion")).toBeNull();
	});

	it("creates a field from a new key", async () => {
		const user = fastUser();
		const { c, area, value } = setup();
		await user.click(area);
		await user.type(area, "{{{{city");
		const list = await screen.findByTestId("field-completion");
		await user.click(within(list).getByRole("option", { name: /city/ }));
		expect(value()).toBe("{{city}}");
		expect((c.template as Template).fields.properties.city).toEqual({
			type: "string",
			title: "City",
		});
	});

	it("closes on Escape", async () => {
		const user = fastUser();
		const { area, value } = setup();
		await user.click(area);
		await user.type(area, "{{{{na");
		await screen.findByTestId("field-completion");
		await user.keyboard("{Escape}");
		expect(screen.queryByTestId("field-completion")).toBeNull();
		expect(value()).toBe("{{na");
	});
});
