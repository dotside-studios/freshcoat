import { emptyDataset } from "@freshcoat-js/workspace/dataset";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { StatusBar } from "~/app/StatusBar";
import { tasksFor, withTask } from "~/app/status/tasks";
import { fastUser } from "./aria";
import { doc } from "./doc-fixture";

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
