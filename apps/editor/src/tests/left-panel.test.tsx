import type { Template } from "@freshcoat-js/coatfile";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { LeftPanel } from "~/panels/LeftPanel";
import { COLLAPSED_KEY } from "~/panels/layers/SectionHeader";
import { fastUser } from "./aria";
import { doc, geometryOf } from "./doc-fixture";

beforeEach(() => {
	Element.prototype.scrollIntoView ??= () => {};
	const g = globalThis as { CSS?: { escape?: (s: string) => string } };
	g.CSS ??= {};
	g.CSS.escape ??= (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
});
afterEach(() => {
	cleanup();
	localStorage.clear();
	vi.restoreAllMocks();
});

/** doc() with a second variant, Light, that changes nothing. */
function twoVariants(): Template {
	const t = doc();
	return {
		...t,
		variants: [
			...(t.variants ?? []),
			{ id: "light", label: "Light", overrides: [] },
		],
	};
}

function noVariants(): Template {
	const { variants: _, ...t } = doc();
	return t;
}

function open(t: Template = twoVariants()) {
	const c = new EditorController();
	c.open(t, "doc.coat");
	c.dispatch({
		type: "rendered",
		geometry: geometryOf(t),
		timings: { compile: 0, layout: 0, lower: 0, paint: 0, total: 0 },
		stats: {} as never,
		warnings: [],
	});
	return c;
}

function mount(c: EditorController = open()) {
	render(
		<ControllerProvider controller={c}>
			<LeftPanel />
		</ControllerProvider>,
	);
	return fastUser();
}

const base = (c: EditorController) => c.base as Template;
const past = (c: EditorController) => c.state.doc?.history.past.length ?? 0;
const option = (id: string) => screen.getByTestId(`variant-${id}`);
/** A section's collapse toggle, the button inside its heading. */
const header = (name: string) =>
	within(
		within(screen.getByRole("region", { name })).getByRole("heading", {
			level: 2,
		}),
	).getByRole("button", { name });

async function openMenu(id: string) {
	const row = option(id);
	act(() => row.focus());
	fireEvent.keyDown(row, { key: "F10", shiftKey: true });
	return screen.findByRole("menu");
}

describe("the left panel's sections", () => {
	it("stacks Templates, Sides, Variants and Layers; one with a single entry starts collapsed", () => {
		mount();
		const sections = screen.getAllByRole("region");
		expect(sections.map((s) => s.getAttribute("aria-label"))).toEqual([
			"Templates",
			"Sides",
			"Variants",
			"Layers",
		]);
		const shown = sections.map((s) => {
			const h = within(s).getByRole("heading", { level: 2 });
			const toggle = within(h).getByRole("button");
			const body = document.getElementById(
				toggle.getAttribute("aria-controls") ?? "",
			);
			expect(body?.hidden).toBe(
				toggle.getAttribute("aria-expanded") !== "true",
			);
			return toggle.getAttribute("aria-expanded");
		});
		expect(shown).toEqual(["false", "true", "true", "true"]);
	});

	it("a single-entry section keeps the person's choice, and opens when it gains a second entry", async () => {
		const c = open(noVariants());
		const user = mount(c);
		expect(header("Variants").getAttribute("aria-expanded")).toBe("false");
		await user.click(screen.getByRole("button", { name: "Add variant" }));
		expect(header("Variants").getAttribute("aria-expanded")).toBe("true");

		cleanup();
		const again = mount(open(noVariants()));
		expect(header("Variants").getAttribute("aria-expanded")).toBe("false");
		await again.click(header("Variants"));
		expect(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "")).toEqual({
			variants: false,
		});
		cleanup();
		mount(open(noVariants()));
		expect(header("Variants").getAttribute("aria-expanded")).toBe("true");
	});

	it("reads the older list of collapsed sections", () => {
		localStorage.setItem(COLLAPSED_KEY, JSON.stringify(["sides"]));
		mount();
		expect(header("Sides").getAttribute("aria-expanded")).toBe("false");
		expect(header("Templates").getAttribute("aria-expanded")).toBe("false");
		expect(header("Variants").getAttribute("aria-expanded")).toBe("true");
	});

	it("a header collapses its section, and remembers it", async () => {
		const user = mount();
		const toggle = header("Sides");
		const body = document.getElementById(
			toggle.getAttribute("aria-controls") ?? "",
		);
		await user.click(toggle);
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		expect(body?.hidden).toBe(true);
		expect(screen.queryByRole("listbox", { name: "Sides" })).toBeNull();
		expect(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "")).toEqual({
			sides: true,
		});

		cleanup();
		const again = mount();
		expect(header("Sides").getAttribute("aria-expanded")).toBe("false");
		expect(header("Variants").getAttribute("aria-expanded")).toBe("true");
		await again.click(header("Sides"));
		expect(header("Sides").getAttribute("aria-expanded")).toBe("true");
		expect(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "")).toEqual({
			sides: false,
		});
	});

	it("the header's actions work while the section is collapsed", async () => {
		const c = open();
		const user = mount(c);
		await user.click(header("Variants"));
		await user.click(screen.getByRole("button", { name: "Add variant" }));
		expect(base(c).variants).toHaveLength(3);
		await user.click(header("Sides"));
		await user.click(screen.getByRole("button", { name: "Add side" }));
		expect(base(c).template_data).toHaveLength(3);
	});

	it("collapsing Layers keeps it at the bottom; storage it can't read is ignored", async () => {
		localStorage.setItem(COLLAPSED_KEY, "{not json");
		const user = mount();
		for (const name of ["Sides", "Variants", "Layers"])
			expect(header(name).getAttribute("aria-expanded")).toBe("true");
		await user.click(header("Layers"));
		expect(screen.queryByRole("treegrid", { name: "Layers" })).toBeNull();
		expect(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "")).toEqual({
			layers: true,
		});
	});

	it("still toggles when storage throws", async () => {
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		const user = mount();
		expect(header("Templates").getAttribute("aria-expanded")).toBe("false");
		await user.click(header("Templates"));
		expect(header("Templates").getAttribute("aria-expanded")).toBe("true");
	});
});

describe("the Variants list", () => {
	it("lists Default, then each variant with what it changes", () => {
		const c = open();
		mount(c);
		const list = screen.getByRole("listbox", { name: "Variants" });
		const rows = within(list).getAllByRole("option");
		expect(rows.map((r) => r.textContent)).toEqual([
			"Default",
			"Dark4 layers",
			"LightNo changes",
		]);
	});

	it("selecting a row, or arrowing to it, sets the active variant", async () => {
		const c = open();
		const user = mount(c);
		await user.click(option("dark"));
		expect(c.state.variantId).toBe("dark");
		await user.keyboard("{ArrowDown}");
		expect(c.state.variantId).toBe("light");
		await user.keyboard("{ArrowUp}{ArrowUp}");
		expect(c.state.variantId).toBeUndefined();
	});

	it("Add variant appends one, selects it and renames it in place", async () => {
		const c = open();
		const user = mount(c);
		await user.click(screen.getByRole("button", { name: "Add variant" }));
		expect(base(c).variants?.map((v) => v.label)).toEqual([
			"Dark",
			"Light",
			"Variant 3",
		]);
		expect(c.state.variantId).toBe("variant-3");
		const input = await screen.findByRole("textbox", {
			name: "Rename Variant 3",
		});
		await act(() => new Promise((r) => requestAnimationFrame(r)));
		await waitFor(() => expect(document.activeElement).toBe(input));
		await user.keyboard("{Control>}a{/Control}Staff{Enter}");
		expect(base(c).variants?.[2]).toMatchObject({
			id: "variant-3",
			label: "Staff",
		});
	});

	it("renames from the menu; Escape cancels", async () => {
		const c = open();
		const user = mount(c);
		const menu = await openMenu("dark");
		await user.click(within(menu).getByRole("menuitem", { name: /Rename/ }));
		const input = await screen.findByRole("textbox", { name: "Rename Dark" });
		await waitFor(() => expect(document.activeElement).toBe(input));
		await user.keyboard("Night{Escape}");
		expect(base(c).variants?.[0]?.label).toBe("Dark");
		fireEvent.keyDown(option("dark"), { key: "F2" });
		const again = await screen.findByRole("textbox", { name: "Rename Dark" });
		await waitFor(() => expect(document.activeElement).toBe(again));
		await user.keyboard("{Control>}a{/Control}Night{Enter}");
		expect(base(c).variants?.[0]).toMatchObject({ id: "dark", label: "Night" });
	});

	it("the menu opens from the context-menu key and the pointer; Default has none", async () => {
		const c = open();
		mount(c);
		act(() => option("__default").focus());
		fireEvent.keyDown(option("__default"), { key: "ContextMenu" });
		expect(screen.queryByRole("menu")).toBeNull();
		fireEvent.contextMenu(option("light"));
		const menu = await screen.findByRole("menu");
		expect(
			within(menu)
				.getAllByRole("menuitem")
				.map((i) => i.textContent?.replace("F2", "")),
		).toEqual([
			"Rename",
			"Duplicate",
			"Swatch…",
			"Make portrait",
			"Make square",
			"Use Default's size",
			"Move up",
			"Move down",
			"Change id…",
			"Delete",
		]);
		expect(
			within(menu)
				.getByRole("menuitem", { name: "Move down" })
				.getAttribute("aria-disabled"),
		).toBe("true");
	});

	it("Duplicate copies the changes and selects the copy", async () => {
		const c = open();
		const user = mount(c);
		const menu = await openMenu("dark");
		await user.click(within(menu).getByRole("menuitem", { name: "Duplicate" }));
		const copy = base(c).variants?.[2];
		expect(copy).toMatchObject({ id: "dark-copy", label: "Dark copy" });
		expect(copy?.overrides).toEqual(base(c).variants?.[0]?.overrides);
		expect(c.state.variantId).toBe("dark-copy");
	});

	it("Move up and Move down reorder, each one undo step", async () => {
		const c = open();
		const user = mount(c);
		let menu = await openMenu("light");
		await user.click(within(menu).getByRole("menuitem", { name: "Move up" }));
		expect(base(c).variants?.map((v) => v.id)).toEqual(["light", "dark"]);
		menu = await openMenu("light");
		await user.click(within(menu).getByRole("menuitem", { name: "Move down" }));
		expect(base(c).variants?.map((v) => v.id)).toEqual(["dark", "light"]);
		expect(past(c)).toBe(2);
	});

	it("Swatch sets the suggested color, or none", async () => {
		const c = open();
		const user = mount(c);
		const menu = await openMenu("dark");
		await user.click(within(menu).getByRole("menuitem", { name: "Swatch…" }));
		const dialog = await screen.findByRole("dialog", { name: "Dark swatch" });
		await user.click(
			within(dialog).getByRole("button", { name: "Use suggested" }),
		);
		// Dark paints the front background black.
		expect(base(c).variants?.[0]?.swatch).toBe("#000000");
		await user.click(within(dialog).getByRole("button", { name: "None" }));
		expect(base(c).variants?.[0]?.swatch).toBeUndefined();
	});

	it("Change id warns, refuses a bad id and follows the active variant", async () => {
		const c = open();
		c.setVariant("dark");
		const user = mount(c);
		const menu = await openMenu("dark");
		await user.click(
			within(menu).getByRole("menuitem", { name: "Change id…" }),
		);
		const dialog = await screen.findByRole("dialog", {
			name: "Change variant id",
		});
		expect(within(dialog).getByTestId("change-id-warning").textContent).toBe(
			"Files, bindings and orders that saved the old id show the Default design instead.",
		);
		const field = within(dialog).getByRole("textbox", { name: "Id" });
		await user.clear(field);
		await user.type(field, "light{Enter}");
		expect(within(dialog).getByText(/already used/)).toBeTruthy();
		expect(base(c).variants?.[0]?.id).toBe("dark");
		await user.clear(field);
		await user.type(field, "night");
		await user.click(within(dialog).getByRole("button", { name: "Change id" }));
		expect(base(c).variants?.[0]?.id).toBe("night");
		expect(c.state.variantId).toBe("night");
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});

	it("Delete confirms with what is lost", async () => {
		const c = open();
		const user = mount(c);
		let menu = await openMenu("dark");
		await user.click(within(menu).getByRole("menuitem", { name: "Delete" }));
		let alert = await screen.findByRole("alertdialog");
		expect(alert.textContent).toContain("Delete Dark?");
		expect(alert.textContent).toContain("Its changes to 4 layers are removed.");
		await user.click(within(alert).getByRole("button", { name: "Cancel" }));
		expect(base(c).variants).toHaveLength(2);
		menu = await openMenu("dark");
		await user.click(within(menu).getByRole("menuitem", { name: "Delete" }));
		alert = await screen.findByRole("alertdialog");
		await user.click(within(alert).getByRole("button", { name: "Delete" }));
		expect(base(c).variants?.map((v) => v.id)).toEqual(["light"]);
	});
});

describe("the Variants list with no variants", () => {
	it("shows Default and a button that adds one, as + does", async () => {
		const c = open(noVariants());
		const user = mount(c);
		await user.click(header("Variants"));
		const list = screen.getByRole("listbox", { name: "Variants" });
		expect(
			within(list)
				.getAllByRole("option")
				.map((r) => r.textContent),
		).toEqual(["Default"]);
		const hint = screen.getByRole("button", {
			name: "Add a variant, such as a colorway or a staff version",
		});
		await user.click(hint);
		expect(base(c).variants?.map((v) => v.label)).toEqual(["Variant 1"]);
		expect(c.state.variantId).toBe("variant-1");
		const input = await screen.findByRole("textbox", {
			name: "Rename Variant 1",
		});
		await waitFor(() => expect(document.activeElement).toBe(input));
		await user.keyboard("{Control>}a{/Control}Staff{Enter}");
		expect(base(c).variants?.[0]?.label).toBe("Staff");
		expect(
			screen.queryByRole("button", {
				name: "Add a variant, such as a colorway or a staff version",
			}),
		).toBeNull();
	});
});

describe("the Variants list works as Sides does", () => {
	it("F2 renames the focused row, and Default is not renamed", async () => {
		const c = open();
		const user = mount(c);
		act(() => option("__default").focus());
		fireEvent.keyDown(option("__default"), { key: "F2" });
		expect(screen.queryByRole("textbox")).toBeNull();
		act(() => option("light").focus());
		fireEvent.keyDown(option("light"), { key: "F2" });
		const input = await screen.findByRole("textbox", { name: "Rename Light" });
		await waitFor(() => expect(document.activeElement).toBe(input));
		await user.keyboard("{Control>}a{/Control}Day{Enter}");
		expect(base(c).variants?.[1]).toMatchObject({ id: "light", label: "Day" });
	});

	it("double-click renames", async () => {
		const c = open();
		const user = mount(c);
		await user.dblClick(within(option("dark")).getByText("Dark"));
		expect(
			await screen.findByRole("textbox", { name: "Rename Dark" }),
		).toBeTruthy();
		await user.dblClick(within(option("__default")).getByText("Default"));
		expect(
			screen.queryByRole("textbox", { name: "Rename Default" }),
		).toBeNull();
	});

	it("the menu is used from the keyboard alone", async () => {
		const c = open();
		const user = mount(c);
		const menu = await openMenu("dark");
		await waitFor(() =>
			expect(document.activeElement?.textContent).toMatch(/^Rename/),
		);
		expect(menu.getAttribute("aria-label")).toBe("Dark actions");
		await user.keyboard("{ArrowDown}{Enter}");
		expect(base(c).variants?.map((v) => v.id)).toEqual([
			"dark",
			"light",
			"dark-copy",
		]);
		expect(c.state.variantId).toBe("dark-copy");
		expect(past(c)).toBe(1);
	});
});
