import { emptyDataset } from "@freshcoat-js/workspace/dataset";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { StatusBar } from "~/app/StatusBar";
import { tasksFor, withTask } from "~/app/status/tasks";
import { isStatusItemHidden, toggleStatusItem } from "~/app/status/visibility";
import { fastUser } from "./aria";
import { doc } from "./doc-fixture";

// jsdom has no CSS.escape, which react-aria uses to find a menu's items by key.
globalThis.CSS ??= {} as typeof CSS;
CSS.escape ??= (value: string) =>
	value.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);

afterEach(cleanup);

function mount() {
	const c = new EditorController();
	c.open(doc(), "doc.coat");
	render(
		<ControllerProvider controller={c}>
			<StatusBar />
		</ControllerProvider>,
	);
	return { c, user: fastUser() };
}

describe("status bar zoom", () => {
	it("takes a typed percentage", async () => {
		const { c, user } = mount();
		const field = screen.getByRole("textbox", { name: "Zoom percentage" });
		await user.click(field);
		await user.keyboard("{Control>}a{/Control}250{Enter}");
		expect(c.state.view.zoom).toBe(2.5);
		expect(field).toHaveProperty("value", "250%");
		await user.click(field);
		await user.keyboard("{Control>}a{/Control}x{Escape}");
		expect(c.state.view.zoom).toBe(2.5);
	});

	it("offers Zoom to selection, off while nothing is selected", async () => {
		const { user } = mount();
		await user.click(screen.getByRole("button", { name: "Zoom" }));
		const item = await screen.findByRole("menuitem", {
			name: /Zoom to selection/,
		});
		expect(item.getAttribute("aria-disabled")).toBe("true");
	});
});

describe("status bar sections", () => {
	it("shows the zoom in Edit only and the activity in every section", async () => {
		const { c } = mount();
		await act(async () => {
			void withTask(
				tasksFor(c),
				{ id: "a", title: "Reading photos" },
				() => new Promise<void>(() => {}),
			);
		});
		expect(screen.getByTestId("activity")).toBeTruthy();
		expect(screen.getByTestId("zoom-field")).toBeTruthy();
		for (const section of ["data", "export"] as const) {
			act(() => c.dispatch({ type: "setSection", section }));
			expect(screen.getByTestId("activity")).toBeTruthy();
			expect(screen.queryByTestId("zoom-field")).toBeNull();
		}
	});

	it("is the data status in the Data section, with items once there is a dataset", () => {
		const { c } = mount();
		expect(screen.queryByTestId("data-status")).toBeNull();
		act(() => c.dispatch({ type: "setSection", section: "data" }));
		expect(screen.getByTestId("data-status")).toBeTruthy();
		expect(screen.queryByTestId("data-status-records")).toBeNull();
		act(() =>
			c.dispatch({
				type: "datasetEdit",
				datasets: [{ ...emptyDataset("People"), id: "d1" }],
			}),
		);
		expect(screen.getByTestId("data-status-records").textContent).toBe(
			"0 records",
		);
	});
});

describe("status bar context menu", () => {
	afterEach(() => {
		for (const id of ["zoom", "render"])
			if (isStatusItemHidden(id) !== (id === "render")) toggleStatusItem(id);
	});

	it("lists the section's items with a check each, and hides one", async () => {
		const { user } = mount();
		fireEvent.contextMenu(screen.getByRole("contentinfo"));
		const zoom = await screen.findByRole("menuitemcheckbox", { name: "Zoom" });
		const render = screen.getByRole("menuitemcheckbox", {
			name: "Render stats",
		});
		expect(zoom.getAttribute("aria-checked")).toBe("true");
		expect(render.getAttribute("aria-checked")).toBe("false");
		expect(
			screen.queryByRole("menuitemcheckbox", { name: "Dataset name" }),
		).toBeNull();
		expect(
			screen.queryByRole("menuitemcheckbox", { name: "Render error" }),
		).toBeNull();
		await user.click(zoom);
		expect(screen.queryByTestId("zoom-field")).toBeNull();
		expect(
			screen
				.getByRole("menuitemcheckbox", { name: "Zoom" })
				.getAttribute("aria-checked"),
		).toBe("false");
		await user.click(screen.getByRole("menuitemcheckbox", { name: "Zoom" }));
		expect(screen.getByTestId("zoom-field")).toBeTruthy();
	});

	it("lists the Data items in the Data section", async () => {
		const { c } = mount();
		act(() => c.dispatch({ type: "setSection", section: "data" }));
		fireEvent.contextMenu(screen.getByTestId("data-status"));
		expect(
			await screen.findByRole("menuitemcheckbox", { name: "Record count" }),
		).toBeTruthy();
		expect(screen.queryByRole("menuitemcheckbox", { name: "Zoom" })).toBeNull();
	});
});
