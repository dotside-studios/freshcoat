import type { Element, Template } from "@freshcoat-js/coatfile";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { CONTENT } from "~/app/copy";
import { createElement } from "~/doc/factories";
import { insertElements, unwrap } from "~/doc/ops";
import { getElement } from "~/doc/path";
import { DesignPanel } from "~/panels/design/DesignPanel";
import { fastUser } from "./aria";
import { doc, geometryOf } from "./doc-fixture";

const KEY = "0/7";

function withLayer(type: "image" | "qr", props: Record<string, unknown>) {
	let t = doc();
	t.fields.properties.photo = { type: "string", format: "image" };
	t.fields.properties.site = { type: "string", format: "url" };
	const el = createElement(
		type,
		{ x: 100, y: 100, width: 120, height: 120 },
		t,
		0,
	) as Element;
	el.properties = { ...el.properties, ...props } as never;
	t = unwrap(insertElements(t, { side: 0 }, 7, [el])).template;
	return t;
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

const props = (c: EditorController) =>
	(getElement(c.template as Template, KEY) as Element).properties as Record<
		string,
		unknown
	>;

const button = (label: string) =>
	screen.getByLabelText(label, { selector: "button" });

beforeAll(() => {
	const g = globalThis as { CSS?: { escape?: (s: string) => string } };
	g.CSS ??= {};
	g.CSS.escape ??= (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
});
afterEach(cleanup);

describe("Insert field", () => {
	it("lists image and url fields first for an image and binds the source", async () => {
		const user = fastUser();
		const c = setup(withLayer("image", { src: "https://example.com/a.png" }));
		await user.click(button("Insert field"));
		const menu = await screen.findByRole("menu");
		const items = within(menu)
			.getAllByRole("menuitem")
			.map((i) => i.textContent);
		expect(items.slice(0, 2)).toEqual(["photo", "site"]);
		await user.click(within(menu).getByRole("menuitem", { name: "photo" }));
		expect(props(c).src).toBe("{{photo}}");
	});

	it("inserts a field into a QR value at the caret", async () => {
		const user = fastUser();
		const c = setup(withLayer("qr", { value: "https://x.io/" }));
		await user.click(button("Insert field"));
		const menu = await screen.findByRole("menu");
		await user.click(within(menu).getByRole("menuitem", { name: /name/ }));
		expect(props(c).value).toBe("https://x.io/{{name}}");
	});

	it("creates a field from the menu and inserts it", async () => {
		const user = fastUser();
		const c = setup(withLayer("image", { src: "https://example.com/a.png" }));
		await user.click(button("Insert field"));
		const menu = await screen.findByRole("menu");
		await user.click(
			within(menu).getByRole("menuitem", { name: CONTENT.newField }),
		);
		const key = await screen.findByRole("textbox", { name: CONTENT.newKey });
		await user.type(key, "logo{Enter}");
		const t = c.template as Template;
		expect(t.fields.properties.logo).toEqual({
			type: "string",
			title: "Logo",
			format: "image",
		});
		expect(props(c).src).toBe("{{logo}}");
		expect(c.state.values.logo).toBeTruthy();
	});

	it("offers New field even when the template has none", async () => {
		const user = fastUser();
		const t = withLayer("qr", { value: "" });
		t.fields = { type: "object", properties: {} };
		const c = setup(t);
		await user.click(button("Insert field"));
		const menu = await screen.findByRole("menu");
		await user.click(
			within(menu).getByRole("menuitem", { name: CONTENT.newField }),
		);
		await user.type(
			await screen.findByRole("textbox", { name: CONTENT.newKey }),
			"code{Enter}",
		);
		expect(props(c).value).toBe("{{code}}");
	});
});
