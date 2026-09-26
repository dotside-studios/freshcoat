import type { Dataset } from "@freshcoat/workspace";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ControllerProvider } from "../app/context";
import { EditorController } from "../app/controller";
import { renameColumnEverywhere } from "../data/actions";
import { DataSection } from "../data/DataSection";
import { forgetViews } from "../data/gallery-model";
import { chooseOption } from "./aria";
import { doc } from "./doc-fixture";

let controller: EditorController;

function dataset(): Dataset {
	return {
		id: "d_people",
		name: "People",
		columns: [
			{ key: "name", type: "text", required: true },
			{ key: "age", type: "integer" },
		],
		records: [
			{ id: "r_1", values: { name: "Ada", age: 36 }, status: "pending" },
			{ id: "r_2", values: { name: "Grace", age: "old" }, status: "exported" },
			{ id: "r_3", values: { age: 41 }, status: "pending" },
		],
		assets: [],
	};
}

function setup(withData = true) {
	controller = new EditorController();
	controller.dispatch({ type: "open", template: doc(), fileName: "doc.coat" });
	if (withData)
		controller.dispatch({ type: "datasetEdit", datasets: [dataset()] });
	const user = userEvent.setup();
	render(
		<ControllerProvider controller={controller}>
			<DataSection />
		</ControllerProvider>,
	);
	return user;
}

const ws = () => {
	const w = controller.state.workspace;
	if (!w) throw new Error("no workspace");
	return w;
};

beforeEach(() => {
	// A desktop window, where the inspector is docked beside the records.
	window.innerWidth = 1440;
	forgetViews();
	Element.prototype.scrollIntoView ??= () => {};
	// jsdom has no CSS.escape, which react-aria uses to find rows by key.
	const g = globalThis as { CSS?: { escape?: (s: string) => string } };
	g.CSS ??= {};
	g.CSS.escape ??= (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
});
afterEach(cleanup);

// Each interaction re-renders the whole section, and react-aria's grid then
// scans every cell for a tabbable child, calling getComputedStyle on each:
// about 200 ms a step under jsdom, so a five-step test takes over a second
// on an idle machine.
describe("Data section", { timeout: 15_000 }, () => {
	it("shows the datasets, the columns and a status line", async () => {
		const user = setup();
		expect(screen.getByTestId("section-data")).toBeTruthy();
		const list = screen.getByRole("listbox", { name: "Datasets" });
		expect(
			within(list).getByRole("option", { name: /People/ }).textContent,
		).toContain("3");
		expect(
			screen.getByRole("tab", { name: "Record", selected: true }),
		).toBeTruthy();
		await user.click(screen.getByRole("tab", { name: "Columns" }));
		const columns = screen.getByRole("listbox", { name: "Columns" });
		expect(
			within(columns)
				.getAllByRole("option")
				.map((o) => o.textContent),
		).toEqual(["name *Text", "ageInteger"]);
		const status = screen.getByTestId("data-status").textContent;
		expect(status).toContain("People");
		expect(status).toContain("3 records");
		expect(status).toContain("2 columns");
		// Grace's age is text; the third record has no name.
		expect(status).toContain("2 issues");
		expect(
			screen.getByRole("grid", { name: "Records of People" }),
		).toBeTruthy();
	});

	it("offers the ways to start when there are no datasets", async () => {
		const user = setup(false);
		expect(screen.getByTestId("data-empty")).toBeTruthy();
		await user.click(
			screen.getByRole("button", { name: "From template fields" }),
		);
		const [d] = ws().datasets;
		expect(d?.name).toBe("doc");
		expect(d?.columns.map((c) => [c.key, c.type, !!c.required])).toEqual([
			["name", "text", true],
			["title", "text", true],
			["show", "boolean", false],
		]);
		expect(ws().activeDatasetId).toBe(d?.id);
		expect(screen.queryByTestId("data-empty")).toBeNull();
		expect(screen.getByTestId("data-status").textContent).toContain(
			"0 records",
		);

		await user.click(screen.getByRole("button", { name: "Add" }));
		await user.click(screen.getByRole("menuitem", { name: "Record" }));
		expect(ws().datasets[0]?.records).toHaveLength(1);
		expect(ws().datasets[0]?.records[0]?.values).toEqual({ show: false });
	});

	it("searches, and follows the dataset through undo", async () => {
		const user = setup();
		await user.type(
			screen.getByRole("searchbox", { name: "Search records" }),
			"grace",
		);
		expect(screen.getByTestId("data-status-records").textContent).toBe(
			"1 of 3 records",
		);
		act(() => {
			controller.dispatch({ type: "datasetEdit", datasets: [] });
		});
		expect(screen.getByTestId("data-empty")).toBeTruthy();
		act(() => {
			controller.dispatch({ type: "datasetUndo" });
		});
		expect(screen.getByTestId("data-status").textContent).toContain(
			"3 records",
		);
	});

	it("edits the selected column's title and type", async () => {
		const user = setup();
		await user.click(screen.getByRole("tab", { name: "Columns" }));
		await user.click(
			within(screen.getByRole("listbox", { name: "Columns" })).getByRole(
				"option",
				{
					name: /age/,
				},
			),
		);
		const title = screen.getByTestId("column-title");
		await user.type(title, "Age{Enter}");
		expect(ws().datasets[0]?.columns[1]?.title).toBe("Age");
		// "old" does not convert back to a number, 36 and 41 do.
		act(() => {
			controller.dispatch({
				type: "datasetEdit",
				datasets: [
					{
						...(ws().datasets[0] as Dataset),
						columns: [
							{ key: "name", type: "text", required: true },
							{ key: "age", type: "text", title: "Age" },
						],
					},
				],
			});
		});
		// Scoped to the Columns panel: see chooseOption.
		const panel = within(screen.getByTestId("columns-panel"));
		await chooseOption(
			user,
			panel.getByRole("button", { name: /Type/ }),
			"Integer",
		);
		expect(panel.getByRole("alert").textContent).toContain(
			"1 value won't convert",
		);
		expect(ws().datasets[0]?.columns[1]?.type).toBe("text");
		await user.click(panel.getByRole("button", { name: "Change type" }));
		expect(ws().datasets[0]?.columns[1]?.type).toBe("integer");
	});
});

describe("renameColumnEverywhere", () => {
	it("renames the values and the bindings as one undo step", () => {
		controller = new EditorController();
		controller.dispatch({
			type: "open",
			template: doc(),
			fileName: "doc.coat",
		});
		controller.dispatch({ type: "datasetEdit", datasets: [dataset()] });
		const tid = ws().activeTemplateId;
		controller.dispatch({
			type: "setBinding",
			id: tid,
			binding: {
				datasetId: "d_people",
				fields: { name: { kind: "column", column: "name" } },
			},
		});
		expect(renameColumnEverywhere(controller, "d_people", "name", "1x")).toBe(
			false,
		);
		expect(
			renameColumnEverywhere(controller, "d_people", "name", "full_name"),
		).toBe(true);
		expect(ws().datasets[0]?.records[0]?.values).toEqual({
			full_name: "Ada",
			age: 36,
		});
		expect(ws().templates[0]?.binding?.fields.name).toEqual({
			kind: "column",
			column: "full_name",
		});
		controller.dispatch({ type: "datasetUndo" });
		expect(ws().datasets[0]?.records[0]?.values).toEqual({
			name: "Ada",
			age: 36,
		});
		expect(ws().templates[0]?.binding?.fields.name).toEqual({
			kind: "column",
			column: "name",
		});
		controller.dispatch({ type: "datasetRedo" });
		expect(ws().templates[0]?.binding?.fields.name).toEqual({
			kind: "column",
			column: "full_name",
		});
	});
});
