import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ControllerProvider } from "../app/context";
import { EditorController } from "../app/controller";
import { getElement } from "../doc/path";
import { LeftPanel } from "../panels/LeftPanel";
import { fastUser } from "./aria";
import { doc } from "./doc-fixture";

let controller: EditorController;

function row(key: string): HTMLElement {
	return screen.getByTestId(`layer-row-${key}`);
}

function setup() {
	controller = new EditorController();
	controller.dispatch({ type: "open", template: doc(), fileName: "doc.coat" });
	const user = fastUser();
	render(
		<ControllerProvider controller={controller}>
			<LeftPanel />
		</ControllerProvider>,
	);
	return user;
}

beforeEach(() => {
	Element.prototype.scrollIntoView ??= () => {};
	// jsdom has no CSS.escape, which react-aria uses to find rows by key.
	const g = globalThis as { CSS?: { escape?: (s: string) => string } };
	g.CSS ??= {};
	g.CSS.escape ??= (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
});
afterEach(cleanup);

describe("Layers tree", () => {
	it("lists the side topmost first with the background last", () => {
		setup();
		const tree = screen.getByRole("treegrid", { name: "Layers" });
		const names = within(tree)
			.getAllByRole("row")
			.map((r) => r.getAttribute("data-layer-key"));
		expect(names).toEqual([
			"0/6",
			"0/5",
			"0/4",
			"0/3",
			"0/2",
			"0/1",
			"0/0",
			"0/bg",
		]);
		expect(within(row("0/4")).getByText("{}")).toBeTruthy();
		expect(within(row("0/0")).queryByText("{}")).toBeNull();
	});

	it("clicking a row selects it in the store, modifiers extend", async () => {
		const user = setup();
		await user.click(within(row("0/0")).getByText("a"));
		expect(controller.state.selection).toEqual(["0/0"]);
		await user.keyboard("{Shift>}");
		await user.click(within(row("0/4")).getByText("title"));
		await user.keyboard("{/Shift}");
		expect(new Set(controller.state.selection)).toEqual(
			new Set(["0/0", "0/1", "0/2", "0/3", "0/4"]),
		);
		await user.keyboard("{Control>}");
		await user.click(within(row("0/2")).getByText("m"));
		await user.keyboard("{/Control}");
		expect(controller.state.selection).not.toContain("0/2");
		expect(controller.state.selection).toContain("0/0");
	});

	it("follows a selection made elsewhere, expanding its ancestors", () => {
		setup();
		expect(screen.queryByTestId("layer-row-0/1/2/0")).toBeNull();
		act(() => controller.select(["0/1/2/0"]));
		const deep = row("0/1/2/0");
		expect(deep.getAttribute("aria-selected")).toBe("true");
		expect(row("0/1").getAttribute("aria-expanded")).toBe("true");
		expect(row("0/1/2").getAttribute("aria-expanded")).toBe("true");
		expect(row("0/0").getAttribute("aria-selected")).toBe("false");
	});

	it("shows a mask's source as a marked child", () => {
		setup();
		act(() => controller.select(["0/2/0"]));
		expect(within(row("0/2/-1")).getByText("mask ·")).toBeTruthy();
		expect(within(row("0/2/-1")).getByText("ms")).toBeTruthy();
	});

	it("hover goes both ways", async () => {
		const user = setup();
		await user.hover(row("0/5"));
		expect(controller.state.hover).toBe("0/5");
		await user.unhover(row("0/5"));
		expect(controller.state.hover).toBeNull();
		act(() => controller.dispatch({ type: "hover", key: "0/4" }));
		expect(row("0/4").hasAttribute("data-canvas-hover")).toBe(true);
		act(() => controller.dispatch({ type: "hover", key: null }));
		expect(row("0/4").hasAttribute("data-canvas-hover")).toBe(false);
	});

	it("eye and lock toggle the editor-only sets, not the document", async () => {
		const user = setup();
		const before = controller.template;
		await user.click(within(row("0/5")).getByRole("button", { name: "Hide" }));
		expect(controller.state.hidden.has("0/5")).toBe(true);
		expect(
			within(row("0/5")).getByRole("button", { name: "Show" }),
		).toBeTruthy();
		await user.click(within(row("0/5")).getByRole("button", { name: "Lock" }));
		expect(controller.state.locked.has("0/5")).toBe(true);
		expect(controller.template).toBe(before);
		expect(controller.state.doc?.history.past.length).toBe(0);
	});

	it("renames inline: Enter commits, a refusal keeps the field open", async () => {
		const user = setup();
		await user.dblClick(within(row("0/0")).getByText("a"));
		const input = await screen.findByRole("textbox", { name: "Rename a" });
		await act(() => new Promise((r) => requestAnimationFrame(r)));
		await user.clear(input);
		await user.type(input, "title{Enter}");
		expect(getElement(controller.template as never, "0/0")?.id).toBe("a");
		expect(screen.getByRole("textbox", { name: "Rename a" })).toBeTruthy();
		await user.clear(input);
		await user.type(input, "hero{Enter}");
		expect(getElement(controller.template as never, "0/0")?.id).toBe("hero");
		expect(screen.queryByRole("textbox")).toBeNull();
		expect(within(row("0/0")).getByText("hero")).toBeTruthy();
	});

	it("Escape cancels a rename", async () => {
		const user = setup();
		await user.dblClick(within(row("0/5")).getByText("rot"));
		const input = await screen.findByRole("textbox", { name: "Rename rot" });
		await act(() => new Promise((r) => requestAnimationFrame(r)));
		await user.type(input, "zzz{Escape}");
		expect(screen.queryByRole("textbox")).toBeNull();
		expect(getElement(controller.template as never, "0/5")?.id).toBe("rot");
		expect(controller.state.doc?.history.past.length).toBe(0);
	});
});

describe("Layers filter", () => {
	it("narrows the tree to matching layers, expanding their ancestors", async () => {
		const user = setup();
		await user.type(
			screen.getByRole("searchbox", { name: "Filter layers" }),
			"deep",
		);
		const tree = screen.getByRole("treegrid", { name: "Layers" });
		expect(
			within(tree)
				.getAllByRole("row")
				.map((r) => r.getAttribute("data-layer-key")),
		).toEqual(["0/1", "0/1/2", "0/1/2/0"]);
		await user.keyboard("{Escape}");
		expect(within(tree).getAllByRole("row")).toHaveLength(8);
	});

	it("says when nothing matches", async () => {
		const user = setup();
		await user.type(
			screen.getByRole("searchbox", { name: "Filter layers" }),
			"zzz",
		);
		expect(screen.getByText("No matching layers")).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "Clear filter" }));
		expect(screen.queryByText("No matching layers")).toBeNull();
	});
});

describe("Sides list", () => {
	it("clicking a side switches to it and the tree follows", async () => {
		const user = setup();
		const sides = screen.getByRole("listbox", { name: "Sides" });
		await user.click(within(sides).getByText("back"));
		expect(controller.state.side).toBe(1);
		expect(screen.getByTestId("layer-row-1/0")).toBeTruthy();
		expect(screen.queryByTestId("layer-row-0/6")).toBeNull();
	});

	it("adds a side and shows it", async () => {
		const user = setup();
		await user.click(screen.getByRole("button", { name: "Add side" }));
		const t = controller.template;
		expect(t?.template_data.map((f) => f.name)).toEqual([
			"front",
			"back",
			"side-3",
		]);
		expect(controller.state.side).toBe(2);
	});

	it("renames a side by double-click", async () => {
		const user = setup();
		const sides = screen.getByRole("listbox", { name: "Sides" });
		await user.dblClick(within(sides).getByText("back"));
		const input = await screen.findByRole("textbox", {
			name: "Rename side back",
		});
		await act(() => new Promise((r) => requestAnimationFrame(r)));
		await user.clear(input);
		await user.type(input, "reverse{Enter}");
		expect(controller.template?.template_data[1]?.name).toBe("reverse");
		// Variant overrides follow the side's name.
		expect(
			controller.template?.variants?.[0]?.overrides.map((o) => o.name),
		).toEqual(["front", "reverse"]);
	});
});
