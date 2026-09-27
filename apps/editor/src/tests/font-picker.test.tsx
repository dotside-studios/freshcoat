import type { Template, TextElement } from "@freshcoat-js/coatfile";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
	vi,
} from "vitest";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { getElement } from "~/doc/path";
import { FontPickerPanel } from "~/fonts/FontPicker";
import { DesignPanel } from "~/panels/design/DesignPanel";
import { doc, geometryOf } from "./doc-fixture";

const saved = new Map<string, PropertyDescriptor | undefined>();
beforeAll(() => {
	// jsdom lays nothing out; the list needs a size to mount rows.
	for (const [prop, size] of [
		["offsetWidth", 300],
		["offsetHeight", 320],
	] as const) {
		saved.set(
			prop,
			Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop),
		);
		Object.defineProperty(HTMLElement.prototype, prop, {
			configurable: true,
			get: () => size,
		});
	}
	// Previews have nowhere to load from here, so every row uses the UI font.
	vi.stubGlobal("fetch", async () => {
		throw new Error("offline");
	});
});
afterAll(() => {
	for (const [prop, d] of saved)
		if (d) Object.defineProperty(HTMLElement.prototype, prop, d);
	vi.unstubAllGlobals();
});
afterEach(cleanup);

async function panel(templateFamilies: string[] = [], value = "Inter") {
	const onPick = vi.fn();
	const onClose = vi.fn();
	render(
		<FontPickerPanel
			value={value}
			templateFamilies={templateFamilies}
			onPick={onPick}
			onClose={onClose}
		/>,
	);
	const search = screen.getByRole("combobox", { name: "Search fonts" });
	const list = screen.getByRole("listbox", { name: "Fonts" });
	await within(list).findAllByRole("option");
	const names = () =>
		within(list)
			.getAllByRole("option")
			.map((o) => o.getAttribute("aria-label"));
	return { onPick, onClose, search, list, names, user: userEvent.setup() };
}

describe("<FontPickerPanel>", () => {
	test("lists the template's families first, then the catalogue by popularity", async () => {
		const { list, names } = await panel(["Inter", "My Brand Sans"]);
		expect(within(list).getByText("In this template")).toBeTruthy();
		expect(names().slice(0, 2)).toEqual(["Inter", "My Brand Sans"]);
		// the rest start with the most popular family and do not repeat Inter
		expect(names()[2]).toMatch(/^Roboto/);
		expect(names().filter((n) => n?.startsWith("Inter"))).toHaveLength(1);
		// the current family is selected
		expect(
			within(list)
				.getByRole("option", { selected: true })
				.getAttribute("aria-label"),
		).toBe("Inter");
	});

	test("mounts only the rows in view", async () => {
		const { names } = await panel();
		expect(names().length).toBeLessThan(30);
		expect(screen.getByText(/^1,9\d\d fonts$/)).toBeTruthy();
	});

	test("search is fuzzy on the name", async () => {
		const { search, names, user } = await panel();
		await user.type(search, "playfair disp");
		await waitFor(() => expect(names()[0]).toBe("Playfair Display"));
		await user.clear(search);
		await user.type(search, "plyfrdsp");
		await waitFor(() => expect(names()).toContain("Playfair Display"));
	});

	test("category chips and the sort narrow and order the list", async () => {
		const { names, user } = await panel();
		await user.click(screen.getByRole("button", { name: "Mono" }));
		await waitFor(() => expect(names()).toContain("Roboto Mono"));
		expect(names()).not.toContain("Roboto");
		expect(
			screen.getByRole("button", { name: "Mono" }).getAttribute("aria-pressed"),
		).toBe("true");
		await user.click(screen.getByRole("radio", { name: "Name" }));
		await waitFor(() => {
			const shown = names();
			expect(shown).toEqual(
				[...shown].sort((a, b) => (a ?? "").localeCompare(b ?? "")),
			);
		});
	});

	test("arrows move the active option, Enter picks it, Esc closes", async () => {
		const { search, list, onPick, onClose, user } = await panel([], "");
		await user.type(search, "lobster");
		await waitFor(() =>
			expect(within(list).getAllByRole("option")[0]?.textContent).toBe(
				"Lobster",
			),
		);
		const active = () =>
			document.getElementById(
				search.getAttribute("aria-activedescendant") ?? "",
			)?.textContent;
		expect(active()).toBe("Lobster");
		expect(list.getAttribute("aria-activedescendant")).toBe(
			search.getAttribute("aria-activedescendant"),
		);
		await user.keyboard("{ArrowDown}");
		expect(active()).toBe("Lobster Two");
		await user.keyboard("{ArrowUp}{ArrowUp}");
		expect(active()).toBe("Lobster");
		await user.keyboard("{ArrowDown}{Enter}");
		expect(onPick).toHaveBeenCalledWith({
			family: "Lobster Two",
			row: expect.objectContaining({ f: "Lobster Two" }),
		});
		await user.keyboard("{Escape}");
		expect(onClose).toHaveBeenCalled();
	});

	test("a name nothing matches is offered for lookup, first", async () => {
		const { search, names, onPick, user } = await panel();
		await user.type(search, "Qwxzv Grotesk");
		await waitFor(() =>
			expect(names()[0]).toBe("Look up “Qwxzv Grotesk” on Google Fonts"),
		);
		await user.keyboard("{Enter}");
		expect(onPick).toHaveBeenCalledWith({ family: "Qwxzv Grotesk" });
	});
});

// The whole inspector renders here, which is slow under a loaded machine.
describe("the Text section's family field", { timeout: 20_000 }, () => {
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
		c.select(["0/1/1"]);
		render(
			<ControllerProvider controller={c}>
				<DesignPanel />
			</ControllerProvider>,
		);
		return c;
	}

	test("picking a family adds it with the weights in use and sets it, in one undo step", async () => {
		const t = doc();
		const c = setup(t);
		const user = userEvent.setup();
		// t1 is bold, so the new family needs its bold too
		c.edit((d) => {
			const next = structuredClone(d);
			const el = getElement(next, "0/1/1") as TextElement;
			el.properties.font.weight = 700;
			return { ok: true, template: next, selection: ["0/1/1"] } as never;
		});
		const before = c.state.doc?.history.past.length ?? 0;
		await user.click(
			screen.getByRole("button", { name: "Font family: Inter" }),
		);
		const search = await screen.findByRole("combobox", {
			name: "Search fonts",
		});
		await user.click(search);
		await user.paste("Playfair Display");
		await screen.findByRole("option", { name: "Playfair Display" });
		await user.keyboard("{Enter}");

		const now = c.template as Template;
		expect(now.fonts?.find((f) => f.family === "Playfair Display")).toEqual({
			kind: "google",
			family: "Playfair Display",
			url: "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&display=swap",
		});
		expect(
			(getElement(now, "0/1/1") as TextElement).properties.font.family,
		).toBe("Playfair Display");
		expect(c.state.doc?.history.past.length).toBe(before + 1);
		expect(screen.queryByRole("combobox", { name: "Search fonts" })).toBeNull();

		c.undo();
		const undone = c.template as Template;
		expect(undone.fonts?.some((f) => f.family === "Playfair Display")).toBe(
			false,
		);
		expect(
			(getElement(undone, "0/1/1") as TextElement).properties.font.family,
		).toBe("Inter");
	});

	test("Esc closes the popover without an edit", async () => {
		const c = setup();
		const user = userEvent.setup();
		await user.click(
			screen.getByRole("button", { name: "Font family: Inter" }),
		);
		await user.click(await screen.findByRole("radio", { name: "Name" }));
		const fonts = (c.template as Template).fonts;
		fireEvent.keyDown(screen.getByRole("combobox", { name: "Search fonts" }), {
			key: "Escape",
		});
		await waitFor(() =>
			expect(
				screen.queryByRole("combobox", { name: "Search fonts" }),
			).toBeNull(),
		);
		expect((c.template as Template).fonts).toBe(fonts);
	});
});
