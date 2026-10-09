import type { Template } from "@freshcoat-js/coatfile";
import { autoBinding } from "@freshcoat-js/workspace";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { getElement } from "~/doc/path";
import { ContentPanel } from "~/panels/ContentPanel";
import { setRequired, withPatch } from "~/panels/content/field-def";
import { RightPanel } from "~/panels/RightPanel";
import type { RightTab } from "~/state/store";
import { button, chooseOption, fastUser } from "./aria";
import { doc } from "./doc-fixture";

beforeAll(() => {
	Element.prototype.scrollIntoView ??= () => {};
	// jsdom has no CSS.escape, which react-aria's tab list uses to find tabs.
	const g = globalThis as { CSS?: { escape?: (s: string) => string } };
	g.CSS ??= {};
	g.CSS.escape ??= (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
});

afterEach(cleanup);

function setup(template: Template = doc(), panel = <ContentPanel />) {
	const controller = new EditorController();
	controller.dispatch({ type: "open", template, fileName: "doc.coat" });
	render(
		<ControllerProvider controller={controller}>{panel}</ControllerProvider>,
	);
	const t = () => controller.template as Template;
	const past = () => controller.state.doc?.history.past.length ?? 0;
	return { controller, t, past, user: fastUser() };
}

const textOf = (t: Template, key: string) => {
	const el = getElement(t, key);
	return el && el.type === "text" ? el.properties.value : undefined;
};

describe("the Content tab", () => {
	test("the inspector reads Design, Content, and old tab ids map over", async () => {
		const { controller, user } = setup(doc(), <RightPanel />);
		expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
			"Design",
			"Content",
		]);
		await user.click(screen.getByRole("tab", { name: "Content" }));
		expect(controller.state.rightTab).toBe("content");
		expect(screen.getByTestId("content-panel")).toBeTruthy();
		act(() =>
			controller.dispatch({
				type: "setRightTab",
				tab: "template" as RightTab,
			}),
		);
		expect(controller.state.rightTab).toBe("design");
		act(() =>
			controller.dispatch({
				type: "setRightTab",
				tab: "variables" as RightTab,
			}),
		);
		expect(controller.state.rightTab).toBe("content");
	});

	test("a row holds its key, type, required mark and value input", () => {
		setup();
		const row = screen.getByTestId("field-name");
		expect(within(row).getByText("name")).toBeTruthy();
		expect(within(row).getByText("Text")).toBeTruthy();
		expect(within(row).getByTitle("Required")).toBeTruthy();
		const value = within(row).getByTestId("value-name");
		expect(within(value).getByRole("textbox", { name: "Name" })).toHaveProperty(
			"value",
			"Ada",
		);
		expect(within(row).queryByRole("textbox", { name: "Key" })).toBeNull();
		expect(
			within(screen.getByTestId("field-show")).getByText("Yes / no"),
		).toBeTruthy();
	});

	test("expanding a row shows its definition under the value", async () => {
		const { user } = setup();
		const row = screen.getByTestId("field-name");
		const toggle = within(row).getByRole("button", { name: "name field" });
		await user.click(toggle);
		expect(toggle.getAttribute("aria-expanded")).toBe("true");
		expect(within(row).getByRole("textbox", { name: "Key" })).toHaveProperty(
			"value",
			"name",
		);
		expect(within(row).getByRole("textbox", { name: "Name" })).toBeTruthy();
		await user.click(toggle);
		expect(within(row).queryByRole("textbox", { name: "Key" })).toBeNull();
	});

	test("a long text or image value takes its own line", () => {
		const base = doc();
		base.fields.properties.bio = { type: "string", format: "longText" };
		base.fields.properties.photo = { type: "string", format: "image" };
		setup(base);
		// The row is a grid: the header line ends with the delete button, so a
		// value after it is on a line of its own, and one before it is inline.
		const inline = (id: string) => {
			const row = screen.getByTestId(`field-${id}`);
			const remove = within(row).getByRole("button", {
				name: `Delete field ${id}`,
			});
			const value = within(row).getByTestId(`value-${id}`);
			return Boolean(
				value.compareDocumentPosition(remove) &
					Node.DOCUMENT_POSITION_FOLLOWING,
			);
		};
		expect(inline("bio")).toBe(false);
		expect(inline("photo")).toBe(false);
		expect(inline("name")).toBe(true);
	});

	test("a new field's key is focused and its row opens expanded", async () => {
		const { user } = setup();
		await user.click(screen.getByRole("button", { name: "Add field" }));
		const key = screen.getByRole("textbox", { name: "New field key" });
		expect(document.activeElement).toBe(key);
		await user.type(key, "nickname{Enter}");
		const row = screen.getByTestId("field-nickname");
		expect(
			within(row)
				.getByRole("button", { name: "nickname field" })
				.getAttribute("aria-expanded"),
		).toBe("true");
		expect(within(row).getByRole("textbox", { name: "Key" })).toBeTruthy();
		expect(
			within(within(row).getByTestId("value-nickname")).getByRole("textbox"),
		).toHaveProperty("value", "Nickname");
	});

	test("with no fields it says how to add one", () => {
		const base = doc();
		base.fields = { type: "object", properties: {} };
		setup(base);
		expect(screen.getByText(/No fields yet\. Add one with \+/)).toBeTruthy();
		expect(screen.getByText("{{key}}")).toBeTruthy();
	});

	test("the record stepper heads the tab once the binding has records", () => {
		const { controller } = setup();
		expect(screen.queryByTestId("record-stepper")).toBeNull();
		const dataset = {
			id: "d_m",
			name: "Members",
			columns: [{ key: "name", type: "text" as const }],
			records: [
				{ id: "r_0", values: { name: "Grace" }, status: "pending" as const },
			],
			assets: [],
		};
		const id = controller.state.workspace?.activeTemplateId as string;
		act(() => {
			controller.dispatch({ type: "datasetEdit", datasets: [dataset] });
			controller.dispatch({
				type: "setBinding",
				id,
				binding: autoBinding(controller.template as Template, dataset),
			});
		});
		const stepper = screen.getByTestId("record-stepper");
		// "Try with" stays whole; only the dataset's name truncates, with the
		// full name in its tooltip.
		const heading = screen.getByRole("button", { name: "Try with Members" });
		expect(within(heading).getByText("Try with").className).toContain(
			"shrink-0",
		);
		const name = within(heading).getByText("Members");
		expect(name.className).toContain("truncate");
		expect(name.title).toBe("Members");
		expect(
			stepper.compareDocumentPosition(screen.getByTestId("field-name")) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});

	test("an unbound template offers the datasets and binds the one picked", async () => {
		const { controller, user } = setup();
		const dataset = {
			id: "d_m",
			name: "Members",
			columns: [{ key: "Name", type: "text" as const }],
			records: [
				{ id: "r_0", values: { Name: "Grace" }, status: "pending" as const },
			],
			assets: [],
		};
		act(() =>
			controller.dispatch({ type: "datasetEdit", datasets: [dataset] }),
		);
		expect(screen.queryByTestId("record-stepper")).toBeNull();
		await chooseOption(
			user,
			screen.getByLabelText("Dataset to try", { selector: "button" }),
			"Members",
		);
		const id = controller.state.workspace?.activeTemplateId;
		const slot = controller.state.workspace?.templates.find((t) => t.id === id);
		expect(slot?.binding).toMatchObject({
			datasetId: "d_m",
			fields: { name: { kind: "column", column: "Name" } },
		});
		expect(screen.getByTestId("record-stepper")).toBeTruthy();
		expect(screen.getByTestId("binding-unfilled").textContent).toBe(
			"1 required field unfilled",
		);
		const toggle = button("Binding");
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		await user.click(toggle);
		expect(toggle.getAttribute("aria-expanded")).toBe("true");
		expect(screen.getByTestId("binding-editor")).toBeTruthy();
	});
});

describe("field usage", () => {
	test("an expanded field lists the layers using it, which select them", async () => {
		const { controller, user } = setup();
		await user.click(screen.getByRole("button", { name: "name field" }));
		const used = screen.getByTestId("used-by-name");
		const chip = within(used).getByTestId("reference-chip");
		expect(chip.textContent).toBe("front · t1");
		await user.click(chip);
		expect(controller.state.selection).toEqual(["0/1/1"]);
		expect(screen.queryByTestId("bound-name")).toBeNull();
	});

	test("a bound template shows what fills each field", async () => {
		const { controller, user } = setup();
		const dataset = {
			id: "d_m",
			name: "Members",
			columns: [{ key: "name", type: "text" as const }],
			records: [],
			assets: [],
		};
		const id = controller.state.workspace?.activeTemplateId as string;
		act(() => {
			controller.dispatch({ type: "datasetEdit", datasets: [dataset] });
			controller.dispatch({
				type: "setBinding",
				id,
				binding: autoBinding(controller.template as Template, dataset),
			});
		});
		await user.click(screen.getByRole("button", { name: "name field" }));
		await user.click(screen.getByRole("button", { name: "title field" }));
		expect(screen.getByTestId("bound-name").textContent).toBe("Bound toname");
		expect(screen.getByTestId("bound-title").textContent).toBe(
			"Bound toIts default",
		);
	});

	test("showing fields opens Content with them expanded", () => {
		const { controller } = setup(doc(), <RightPanel />);
		act(() =>
			controller.dispatch({ type: "showFields", fields: ["title", "show"] }),
		);
		expect(controller.state.rightTab).toBe("content");
		expect(controller.state.shownFields).toBeNull();
		for (const id of ["title", "show"])
			expect(
				screen
					.getByRole("button", { name: `${id} field` })
					.getAttribute("aria-expanded"),
			).toBe("true");
		expect(
			screen
				.getByRole("button", { name: "name field" })
				.getAttribute("aria-expanded"),
		).toBe("false");
	});
});

describe("preview values", () => {
	test("an edit updates the store values and not the history", async () => {
		const { controller, past, user } = setup();
		const input = screen.getByRole("textbox", { name: "Name" });
		expect(input).toHaveProperty("value", "Ada");
		await user.clear(input);
		await user.type(input, "Grace");
		expect(controller.state.values.name).toBe("Grace");
		expect(past()).toBe(0);
		expect(controller.dirty).toBe(false);
	});

	test("a boolean is a switch writing true/false", async () => {
		const { controller, user } = setup();
		const row = screen.getByTestId("value-show");
		await user.click(within(row).getByRole("switch"));
		expect(controller.state.values.show).toBe("false");
	});

	test("reset to samples restores the seeded values", async () => {
		const { controller, user } = setup();
		act(() =>
			controller.dispatch({ type: "setValue", field: "name", value: "X" }),
		);
		await user.click(screen.getByRole("button", { name: "Reset to samples" }));
		expect(controller.state.values.name).toBe("Ada");
	});

	test("unreferenced fields are flagged and system fields grouped", () => {
		const base = doc();
		base.fields.properties.spare = { type: "string" };
		base.fields.properties.order_no = { type: "string", "x-source": "system" };
		setup(base);
		const spare = screen.getByTestId("field-spare");
		expect(within(spare).getByText("unused")).toBeTruthy();
		// The badge takes the type's place; the type moves to the key's tooltip.
		expect(within(spare).queryByText("Text")).toBeNull();
		expect(within(spare).getByTitle("spare (Text)")).toBeTruthy();
		expect(
			within(screen.getByTestId("field-name")).queryByText("unused"),
		).toBeNull();
		const injected = screen.getByText("From the system");
		const order = screen.getByTestId("value-order_no");
		expect(
			injected.compareDocumentPosition(order) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});
});

describe("field definitions", () => {
	test("add a field with a unique, valid key", async () => {
		const { controller, t, user } = setup();
		await user.click(screen.getByRole("button", { name: "Add field" }));
		const key = screen.getByRole("textbox", { name: "New field key" });
		await user.type(key, "9bad");
		expect(screen.getByText(/not starting with a number/)).toBeTruthy();
		await user.clear(key);
		await user.type(key, "name{Enter}");
		expect(screen.getByText(/already a field/)).toBeTruthy();
		await user.clear(key);
		await user.type(key, "nickname{Enter}");
		expect(t().fields.properties.nickname).toEqual({
			type: "string",
			title: "Nickname",
		});
		expect(controller.state.values.nickname).toBe("Nickname");
		expect(screen.getByTestId("field-nickname")).toBeTruthy();
	});

	test("renaming a key rewrites the layer tokens and keeps the value", async () => {
		const { controller, t, user } = setup();
		await user.click(screen.getByRole("button", { name: "name field" }));
		const row = screen.getByTestId("field-name");
		const key = within(row).getByRole("textbox", { name: "Key" });
		await user.clear(key);
		await user.type(key, "full_name{Enter}");
		expect(t().fields.properties.full_name).toBeDefined();
		expect(t().fields.properties.name).toBeUndefined();
		expect(textOf(t(), "0/1/1")).toBe("Hi {{ full_name }}");
		expect(t().fields.required).toContain("full_name");
		expect(controller.state.values.full_name).toBe("Ada");
		expect(screen.getByTestId("field-full_name")).toBeTruthy();
	});

	test("an invalid key is not committed and reverts on blur", async () => {
		const { t, user } = setup();
		await user.click(screen.getByRole("button", { name: "title field" }));
		const key = within(screen.getByTestId("field-title")).getByRole("textbox", {
			name: "Key",
		});
		await user.clear(key);
		await user.type(key, "has space");
		expect(key.getAttribute("aria-invalid")).toBe("true");
		fireEvent.blur(key);
		expect(t().fields.properties.title).toBeDefined();
		expect(key).toHaveProperty("value", "title");
	});

	test("definition edits are one merged undo step per field", async () => {
		const { t, past, user } = setup();
		await user.click(screen.getByRole("button", { name: "title field" }));
		const row = within(screen.getByTestId("field-title")).getByRole("group", {
			name: "title definition",
		});
		await user.type(
			within(row).getByRole("textbox", { name: "Title" }),
			"Headline",
		);
		expect(t().fields.properties.title?.title).toBe("Headline");
		expect(past()).toBe(1);
		await user.click(within(row).getByRole("checkbox", { name: "Required" }));
		expect(t().fields.required).toEqual(["name"]);
	});

	test("the pattern input accepts patterns that only parse without the u flag", async () => {
		const { t, user } = setup();
		await user.click(screen.getByRole("button", { name: "title field" }));
		const pattern = within(screen.getByTestId("field-title")).getByRole(
			"textbox",
			{ name: "Pattern" },
		);
		for (const legacy of ["^\\d{3}\\-\\d{4}$", "^[\\w-.]+$", "^\\#\\d+$"]) {
			await user.clear(pattern);
			await user.click(pattern);
			await user.paste(legacy);
			expect(pattern.getAttribute("aria-invalid")).not.toBe("true");
			expect(screen.queryByText("Not a valid regular expression")).toBeNull();
			fireEvent.blur(pattern);
			expect(t().fields.properties.title?.pattern).toBe(legacy);
		}
		await user.clear(pattern);
		await user.click(pattern);
		await user.paste("^(a");
		expect(screen.getByText("Not a valid regular expression")).toBeTruthy();
	});

	test("delete is refused while referenced and lists the references", async () => {
		const { controller, t, user } = setup();
		await user.click(
			screen.getByRole("button", { name: "Delete field title" }),
		);
		expect(t().fields.properties.title).toBeDefined();
		const alert = screen.getByRole("alert");
		const chips = within(alert).getAllByTestId("reference-chip");
		expect(chips.map((c) => c.textContent)).toEqual(["front · title"]);
		await user.click(chips[0] as HTMLElement);
		expect(controller.state.selection).toEqual(["0/4"]);
	});

	test("a variant reference switches the variant preview", async () => {
		const base = doc();
		base.fields.properties.accent = { type: "string", format: "color" };
		const dark = base.variants?.[0];
		dark?.overrides[0]?.elements?.push({
			id: "rot",
			properties: { fill: "{{accent}}" },
		});
		const { controller, user } = setup(base);
		await user.click(
			screen.getByRole("button", { name: "Delete field accent" }),
		);
		const chips = within(screen.getByRole("alert")).getAllByTestId(
			"reference-chip",
		);
		expect(chips.map((c) => c.textContent)).toEqual(["Variant · Dark"]);
		await user.click(chips[0] as HTMLElement);
		expect(controller.state.variantId).toBe("dark");
	});

	test("an unreferenced field deletes", async () => {
		const base = doc();
		base.fields.properties.spare = { type: "string" };
		const { t, user } = setup(base);
		await user.click(
			screen.getByRole("button", { name: "Delete field spare" }),
		);
		expect(t().fields.properties.spare).toBeUndefined();
		expect(screen.queryByTestId("field-spare")).toBeNull();
	});
});

describe("field helpers", () => {
	test("withPatch removes keys set to undefined", () => {
		expect(
			withPatch(
				{ type: "string", title: "A", format: "url" },
				{
					title: undefined,
					maxLength: 4,
				},
			),
		).toEqual({ type: "string", format: "url", maxLength: 4 });
	});

	test("setRequired adds, removes and drops an empty list", () => {
		const t = doc();
		expect(setRequired(t, "show", true).fields.required).toEqual([
			"name",
			"title",
			"show",
		]);
		const none = setRequired(setRequired(t, "name", false), "title", false);
		expect("required" in none.fields).toBe(false);
		expect(setRequired(t, "name", true)).toBe(t);
	});
});
