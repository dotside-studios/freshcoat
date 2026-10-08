import type { Dataset } from "@freshcoat-js/workspace";
import * as ws from "@freshcoat-js/workspace";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ControllerProvider } from "../app/context";
import { EditorController } from "../app/controller";
import { ImportWizard } from "../data/ImportWizard";
import {
	inPageImporter,
	setTableImporter,
	type TableImporter,
} from "../data/table-import";
import { HEAD_ROWS } from "../data/table-store";
import { button, chooseOption, fastUser } from "./aria";
import { doc } from "./doc-fixture";

vi.mock("@freshcoat-js/workspace", async (original) => {
	const actual = await original<typeof import("@freshcoat-js/workspace")>();
	return { ...actual, applyMapping: vi.fn(actual.applyMapping) };
});

const RECORDS = 1500;

function people(): Dataset {
	return {
		id: "d_people",
		name: "People",
		columns: [
			{ key: "name", type: "text" },
			{ key: "joined", type: "date" },
		],
		records: [
			{ id: "r_1", values: { name: "Ada" }, status: "pending" },
			{ id: "r_2", values: { name: "Grace" }, status: "pending" },
		],
		assets: [],
	};
}

function csv(): File {
	const lines = ["name,joined"];
	for (let i = 0; i < RECORDS; i++) lines.push(`P${i},3/4/2025`);
	return new File([lines.join("\n")], "people.csv", { type: "text/csv" });
}

let controller: EditorController;
let apply: ReturnType<typeof vi.fn<TableImporter["apply"]>>;

beforeEach(() => {
	const inner = inPageImporter();
	apply = vi.fn<TableImporter["apply"]>(inner.apply);
	setTableImporter({ ...inner, apply });
	localStorage.clear();
	vi.mocked(ws.applyMapping).mockClear();
	Element.prototype.scrollIntoView ??= () => {};
	const g = globalThis as { CSS?: { escape?: (s: string) => string } };
	g.CSS ??= {};
	g.CSS.escape ??= (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
	controller = new EditorController();
	controller.dispatch({ type: "open", template: doc(), fileName: "doc.coat" });
	controller.dispatch({ type: "datasetEdit", datasets: [people()] });
});
afterEach(() => {
	cleanup();
	setTableImporter(null);
});

describe("Import wizard", { timeout: 30_000 }, () => {
	it("previews from the rows it holds and maps the whole file on Import", async () => {
		const user = fastUser();
		const onImported = vi.fn();
		render(
			<ControllerProvider controller={controller}>
				<ImportWizard
					target={{ datasetId: "d_people", file: csv() }}
					onClose={() => {}}
					onImported={onImported}
				/>
			</ControllerProvider>,
		);
		const wizard = await screen.findByTestId("import-wizard");
		await waitFor(() =>
			expect(wizard.textContent).toContain("people.csv · 1,500 records"),
		);

		const next = () => user.click(button("Next"));
		const back = () => user.click(button("Back"));
		await next();
		expect(screen.queryByTestId("import-mapping")).toBeNull();
		const totals = () => screen.getByTestId("import-totals").textContent;
		expect(totals()).toContain(`In the first ${HEAD_ROWS - 1} records:`);
		expect(totals()).toContain(`${HEAD_ROWS - 1} to add`);

		await back();
		await user.click(screen.getByRole("radio", { name: "Replace" }));
		await chooseOption(user, button(/Date order/), /Day first/);
		await next();
		await back();
		await user.click(screen.getByRole("radio", { name: "Append" }));
		await next();
		await user.click(button("Review mapping"));
		await user.click(screen.getByRole("checkbox", { name: /Match existing/ }));
		await next();

		expect(apply).not.toHaveBeenCalled();
		const previews = vi.mocked(ws.applyMapping).mock.calls;
		expect(previews.length).toBeGreaterThan(0);
		for (const [, rows] of previews) expect(rows.length).toBe(HEAD_ROWS);

		await user.click(button("Import"));
		await waitFor(() => expect(onImported).toHaveBeenCalled());
		expect(apply).toHaveBeenCalledTimes(1);
		const [, sheet, sent, plan] = apply.mock.calls[0] ?? [];
		expect(sheet).toBe(0);
		expect(plan?.match).toEqual({ source: 0, column: "name" });
		expect(sent?.records).toHaveLength(2);
		const imported = controller.state.workspace?.datasets[0];
		expect(imported?.records).toHaveLength(2 + RECORDS);
		expect(imported?.records[2]?.values).toEqual({
			name: "P0",
			joined: "2025-04-03",
		});
		expect(onImported.mock.calls[0]?.[1]).toBe(
			"Imported 1,500 records into People",
		);
	});

	it("leaves the existing records on the page when nothing is matched", async () => {
		const user = fastUser();
		render(
			<ControllerProvider controller={controller}>
				<ImportWizard
					target={{ datasetId: "d_people", file: csv() }}
					onClose={() => {}}
					onImported={() => {}}
				/>
			</ControllerProvider>,
		);
		await waitFor(() =>
			expect(screen.getByTestId("import-wizard").textContent).toContain(
				"1,500 records",
			),
		);
		const before = controller.state.workspace?.datasets[0]?.records;
		await user.click(button("Next"));
		await user.click(button("Import"));
		await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
		expect(apply.mock.calls[0]?.[2].records).toEqual([]);
		await waitFor(() =>
			expect(controller.state.workspace?.datasets[0]?.records).toHaveLength(
				2 + RECORDS,
			),
		);
		const after = controller.state.workspace?.datasets[0]?.records;
		expect(after?.[0]).toBe(before?.[0]);
	});

	it("reuses the last mapping for the next import into the dataset", async () => {
		const user = fastUser();
		const file = () =>
			new File(["Full name,joined\nZed,3/4/2025"], "more.csv", {
				type: "text/csv",
			});
		const run = async () => {
			const onImported = vi.fn();
			render(
				<ControllerProvider controller={controller}>
					<ImportWizard
						target={{ datasetId: "d_people", file: file() }}
						onClose={() => {}}
						onImported={onImported}
					/>
				</ControllerProvider>,
			);
			await waitFor(() =>
				expect(screen.getByTestId("import-wizard").textContent).toContain(
					"more.csv · 1 record",
				),
			);
			await user.click(button("Next"));
			return onImported;
		};

		await run();
		await chooseOption(user, button(/Target for Full name/), /^name$/);
		await user.click(button("Next"));
		await user.click(button("Import"));
		cleanup();

		const onImported = await run();
		expect(screen.queryByTestId("import-mapping")).toBeNull();
		await user.click(button("Import"));
		await waitFor(() => expect(onImported).toHaveBeenCalled());
		const records = controller.state.workspace?.datasets[0]?.records ?? [];
		expect(records.map((r) => r.values.name)).toEqual([
			"Ada",
			"Grace",
			"Zed",
			"Zed",
		]);
	});

	it("skips or adds every unmatched column at once", async () => {
		const user = fastUser();
		render(
			<ControllerProvider controller={controller}>
				<ImportWizard
					target={{
						datasetId: "d_people",
						file: new File(["name,Tier,Score\nZed,gold,4"], "tier.csv", {
							type: "text/csv",
						}),
					}}
					onClose={() => {}}
					onImported={() => {}}
				/>
			</ControllerProvider>,
		);
		await waitFor(() =>
			expect(screen.getByTestId("import-wizard").textContent).toContain(
				"tier.csv · 1 record",
			),
		);
		await user.click(button("Next"));
		await user.click(button("Skip all unmatched"));
		expect(screen.queryByLabelText(/New column key/)).toBeNull();
		await user.click(button("All as new columns"));
		await user.click(button("Next"));
		await user.click(button("Import"));
		await waitFor(() =>
			expect(controller.state.workspace?.datasets[0]?.columns).toHaveLength(4),
		);
		expect(controller.state.workspace?.datasets[0]?.columns.slice(2)).toEqual([
			{ key: "tier", type: "text", title: "Tier" },
			{ key: "score", type: "integer", title: "Score" },
		]);
	});

	it("shows the inferred type and keeps it for a new column", async () => {
		const user = fastUser();
		render(
			<ControllerProvider controller={controller}>
				<ImportWizard
					target={{
						datasetId: "d_people",
						file: new File(["name,Photo\nZed,zed.jpg\nYe,ye.png"], "p.csv", {
							type: "text/csv",
						}),
					}}
					onClose={() => {}}
					onImported={() => {}}
				/>
			</ControllerProvider>,
		);
		await waitFor(() =>
			expect(screen.getByTestId("import-wizard").textContent).toContain(
				"p.csv · 2 records",
			),
		);
		await user.click(button("Next"));
		expect(screen.getByTestId("inferred-1").textContent).toBe(
			"Image · inferred from 2 rows",
		);
		await chooseOption(user, button(/Target for Photo/), /^Skip$/);
		await chooseOption(user, button(/Target for Photo/), /^New column/);
		await user.click(button("Next"));
		await user.click(button("Import"));
		await waitFor(() =>
			expect(controller.state.workspace?.datasets[0]?.columns[2]).toEqual({
				key: "photo",
				type: "image",
				title: "Photo",
			}),
		);
	});

	it("counts issues per column and narrows the preview to them", async () => {
		const user = fastUser();
		render(
			<ControllerProvider controller={controller}>
				<ImportWizard
					target={{
						datasetId: "d_people",
						file: new File(
							["name,joined\nZed,3/4/2025\nYe,soon\nXi,later\nWu,5/6/2025"],
							"bad.csv",
							{ type: "text/csv" },
						),
					}}
					onClose={() => {}}
					onImported={() => {}}
				/>
			</ControllerProvider>,
		);
		await waitFor(() =>
			expect(screen.getByTestId("import-wizard").textContent).toContain(
				"bad.csv · 4 records",
			),
		);
		await user.click(button("Next"));
		expect(screen.getByTestId("column-issues-joined").textContent).toBe("2");
		const rows = () =>
			screen.getByTestId("import-preview").querySelectorAll("tbody tr");
		expect(rows()).toHaveLength(4);
		await user.click(
			screen.getByRole("checkbox", { name: "Only rows with issues" }),
		);
		expect(rows()).toHaveLength(2);
		expect(screen.queryByTestId("cell-issue")).toBeNull();
		const bad = screen
			.getByTestId("import-preview")
			.querySelector<HTMLElement>("[data-bad]");
		bad?.focus();
		expect((await screen.findByTestId("cell-issue")).textContent).toBe(
			"Not a date",
		);
	});
});
