import type {
	Dataset,
	ExportItem,
	ExportPreset,
	SheetLayout,
} from "@freshcoat/workspace";
import { DEFAULT_SHEET_LAYOUT, SheetLayoutError } from "@freshcoat/workspace";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from "vitest";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { ExportSection } from "~/export/ExportSection";
import { exportJobsFor } from "~/export/export-jobs";
import { previewModes } from "~/export/preview-mode";
import {
	pagesPerSheet,
	planSheets,
	SHEETS_DONT_FIT,
	SHEETS_NEED_TEMPLATE_SIZE,
	sheetLayout,
	sheetOf,
	shortSheetError,
	withSideIndex,
} from "~/export/sheets";
import type { ExportRunner } from "~/export/use-export-runner";
import { doc } from "./doc-fixture";

const item = (recordId: string, recordIndex: number, side: string) =>
	({
		key: `${recordId}:${side}`,
		recordId,
		recordIndex,
		side,
		fileName: "",
		values: {},
	}) satisfies ExportItem;

const pdf = (layout?: ExportPreset["layout"]): ExportPreset => ({
	id: "p_1",
	name: "Sheets",
	templateId: "t",
	records: "all",
	sides: "all",
	format: "pdf",
	scale: 1,
	dpi: 300,
	fileName: "{{index}}",
	markExported: false,
	...(layout ? { layout } : {}),
});

const sheet = (patch: Partial<SheetLayout> = {}): SheetLayout => ({
	...DEFAULT_SHEET_LAYOUT,
	...patch,
});

// 1000 × 600 at 300 dpi: 84.7 × 50.8 mm, 2 × 5 on A4 portrait.
const CARD = { width: 1000, height: 600 };

describe("sheet helpers", () => {
	test("side indexes count within each record's run", () => {
		const plan = [
			item("a", 0, "front"),
			item("a", 0, "back"),
			item("b", 1, "back"),
			item("c", 2, "front"),
		];
		expect(withSideIndex(plan).map((i) => i.sideIndex)).toEqual([0, 1, 0, 0]);
	});

	test("only a PDF on sheets has a sheet layout", () => {
		expect(sheetLayout(pdf())).toBeNull();
		expect(sheetLayout(pdf({ kind: "single" }))).toBeNull();
		expect(sheetLayout({ ...pdf(sheet()), format: "png-zip" })).toBeNull();
		expect(sheetLayout(pdf(sheet()))).toEqual(sheet());
	});

	test("plans the export's items on sheets", () => {
		const plan = Array.from({ length: 21 }, (_, i) => [
			item(`r${i}`, i, "front"),
			item(`r${i}`, i, "back"),
		]).flat();
		const single = planSheets(plan, CARD, pdf(sheet()));
		expect(single?.imposition?.perSheet).toBe(10);
		expect(single?.imposition?.sheets).toBe(5);
		expect(single?.imposition && pagesPerSheet(single.imposition)).toBe(1);

		const duplex = planSheets(plan, CARD, pdf(sheet({ duplex: "long-edge" })));
		const imposition = duplex?.imposition;
		if (!imposition) throw new Error("no imposition");
		expect(imposition.sheets).toBe(3);
		expect(imposition.pages).toHaveLength(6);
		expect(pagesPerSheet(imposition)).toBe(2);
		expect(sheetOf(imposition, "r0")).toBe(0);
		expect(sheetOf(imposition, "r10")).toBe(1);
		expect(sheetOf(imposition, "r20")).toBe(2);
		expect(sheetOf(imposition, "nobody")).toBe(-1);
	});

	test("says why a layout can't be imposed", () => {
		const plan = [item("a", 0, "front")];
		expect(planSheets(plan, CARD, pdf())).toBeNull();
		const tight = planSheets(plan, CARD, pdf(sheet({ marginMm: 100 })));
		expect(tight?.error).toMatch(/too wide/);
		expect(tight?.shortError).toBe(SHEETS_DONT_FIT);
		const photo = planSheets(plan, CARD, {
			...pdf(sheet()),
			size: { kind: "image", field: "photo" },
		});
		expect(photo?.error).toBe(SHEETS_NEED_TEMPLATE_SIZE);
		expect(photo?.shortError).toBe(SHEETS_NEED_TEMPLATE_SIZE);
	});

	test("a layout error has a short form for the job bar", () => {
		expect(shortSheetError(new SheetLayoutError("x".repeat(80), "width"))).toBe(
			SHEETS_DONT_FIT,
		);
		expect(
			shortSheetError(new SheetLayoutError("The gap can't be negative")),
		).toBe("The gap can't be negative");
		expect(
			shortSheetError(
				new SheetLayoutError(
					"Double-sided sheets hold two sides of a card, and this one has 3",
				),
			),
		).toBe("Can't lay out the sheets");
	});

	test("Sheet joins the preview modes when the preset uses sheets", () => {
		expect(previewModes(null, true)).toEqual(["output", "sheet"]);
		expect(previewModes("photo", true)).toEqual([
			"output",
			"source",
			"split",
			"sheet",
		]);
	});
});

const people: Dataset = {
	id: "d_people",
	name: "People",
	columns: [{ key: "name", type: "text" }],
	records: Array.from({ length: 21 }, (_, i) => ({
		id: `r${i + 1}`,
		status: "pending" as const,
		values: { name: `Person ${i + 1}` },
	})),
	assets: [],
};

function idleRunner(): ExportRunner {
	const snapshot = {
		state: "idle" as const,
		progress: null,
		result: null,
		error: null,
	};
	return {
		getSnapshot: () => snapshot,
		subscribe: () => () => {},
		start: () => new Promise(() => {}),
		cancel() {},
		dispose() {},
	};
}

beforeAll(() => {
	const g = globalThis as { CSS?: { escape?: (s: string) => string } };
	g.CSS ??= {};
	g.CSS.escape ??= (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
});

beforeEach(() => {
	vi.stubGlobal("fetch", async () => {
		throw new Error("offline");
	});
	vi.stubGlobal("innerWidth", 1440);
	localStorage.clear();
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function setup(preset: Partial<ExportPreset> = {}) {
	const controller = new EditorController();
	controller.dispatch({ type: "open", template: doc(), fileName: "doc.coat" });
	controller.dispatch({ type: "datasetEdit", datasets: [people] });
	const templateId = controller.state.workspace?.activeTemplateId as string;
	controller.dispatch({
		type: "setBinding",
		id: templateId,
		binding: {
			datasetId: people.id,
			fields: { name: { kind: "column", column: "name" } },
		},
	});
	controller.dispatch({
		type: "setPreset",
		preset: { ...pdf(), templateId, ...preset },
	});
	controller.dispatch({ type: "setSection", section: "export" });
	exportJobsFor(controller, { runner: idleRunner() });
	render(
		<ControllerProvider controller={controller}>
			<ExportSection />
		</ControllerProvider>,
	);
	const current = () => controller.state.workspace?.presets[0] as ExportPreset;
	const update = (patch: Partial<ExportPreset>) =>
		act(() => {
			controller.dispatch({
				type: "setPreset",
				preset: { ...current(), ...patch },
			});
		});
	return { controller, current, update, user: userEvent.setup() };
}

const layoutGroup = () => screen.getByTestId("export-layout");

describe("the Layout group", { timeout: 20_000 }, () => {
	test("is offered for a PDF, one per page by default", () => {
		setup();
		const group = within(layoutGroup());
		expect(
			group
				.getByRole("radio", { name: "One per page" })
				.getAttribute("aria-checked"),
		).toBe("true");
		expect(screen.queryByTestId("export-sheet-summary")).toBeNull();
		expect(screen.queryByRole("radio", { name: "Sheet" })).toBeNull();
	});

	test("Sheets takes the defaults and sums up the sheets", async () => {
		const { current, user } = setup();
		await user.click(
			within(layoutGroup()).getByRole("radio", { name: "Sheets" }),
		);
		expect(current().layout).toEqual(DEFAULT_SHEET_LAYOUT);
		// 21 records × 2 sides, 10 to an A4
		expect(screen.getByTestId("export-sheet-summary").textContent).toBe(
			"10 per sheet · 5 sheets",
		);
		expect(screen.getByTestId("export-page-size").textContent).toMatch(
			/^Card /,
		);
		expect(
			within(layoutGroup()).getByRole("checkbox", { name: "Crop marks" }),
		).toBeTruthy();
		await user.click(
			within(layoutGroup()).getByRole("checkbox", { name: "Crop marks" }),
		);
		expect(current().layout).toMatchObject({ cropMarks: false });
	});

	test("double-sided pairs sheets, with the offset under More", async () => {
		const { current, user } = setup({ layout: DEFAULT_SHEET_LAYOUT });
		expect(screen.queryByRole("button", { name: "More" })).toBeNull();
		await user.click(
			within(layoutGroup()).getByRole("checkbox", { name: "Double-sided" }),
		);
		expect(current().layout).toMatchObject({ duplex: "long-edge" });
		await user.click(
			within(layoutGroup()).getByRole("radio", { name: "Short edge" }),
		);
		expect(current().layout).toMatchObject({ duplex: "short-edge" });
		expect(screen.getByTestId("export-sheet-summary").textContent).toBe(
			"10 per sheet · 3 sheets",
		);
		expect(screen.getByText("Match the printer's flip setting")).toBeTruthy();
		await user.click(
			within(layoutGroup()).getByRole("button", { name: "More" }),
		);
		expect(
			screen.getByRole("spinbutton", { name: "Back offset X" }),
		).toBeTruthy();
		// a two-sided template has backs of its own
		expect(screen.queryByRole("checkbox", { name: "Blank backs" })).toBeNull();
	});

	test("a card that doesn't fit shows inline and blocks Export", () => {
		const { update } = setup({ layout: DEFAULT_SHEET_LAYOUT });
		expect(
			screen.getByRole("button", { name: "Export 42 files" }),
		).toHaveProperty("disabled", false);
		update({ layout: { ...DEFAULT_SHEET_LAYOUT, marginMm: 100 } });
		const error = screen.getByTestId("export-sheet-error");
		expect(error.getAttribute("role")).toBe("alert");
		expect(error.textContent).toMatch(/too wide/);
		expect(
			screen.getByRole("button", { name: "Export 42 files" }),
		).toHaveProperty("disabled", true);
		expect(screen.queryByTestId("export-sheet-summary")).toBeNull();
		// The job bar says it in a few words, with the whole of it on hover.
		const bar = screen.getByTestId("export-blocked");
		expect(bar.textContent).toBe(SHEETS_DONT_FIT);
		expect(bar.getAttribute("title")).toBe(error.textContent);
	});

	test("Sheets is unavailable for a size from each photo", () => {
		setup({ size: { kind: "image", field: "photo" } });
		const option = within(layoutGroup()).getByRole("radio", { name: "Sheets" });
		expect(option).toHaveProperty("disabled", true);
	});

	test("the Sheet preview steps through sheets, front and back", async () => {
		const { user, update } = setup({
			layout: { ...DEFAULT_SHEET_LAYOUT, duplex: "short-edge" },
		});
		await user.click(screen.getByRole("radio", { name: "Sheet" }));
		expect(screen.getByTestId("export-sheet-position").textContent).toBe(
			"Sheet 1 of 3",
		);
		const preview = screen.getByTestId("sheet-preview");
		expect(preview.dataset.side).toBe("front");
		expect(screen.getAllByTestId("sheet-slot").length).toBeGreaterThan(0);
		await user.click(screen.getByRole("button", { name: "Next sheet" }));
		await user.click(screen.getByRole("button", { name: "Next sheet" }));
		expect(screen.getByTestId("export-sheet-position").textContent).toBe(
			"Sheet 3 of 3",
		);
		expect(screen.getByRole("button", { name: "Next sheet" })).toHaveProperty(
			"disabled",
			true,
		);
		await user.click(
			within(screen.getByRole("radiogroup", { name: "Sheet side" })).getByRole(
				"radio",
				{ name: "Back" },
			),
		);
		expect(screen.getByTestId("sheet-preview").dataset.side).toBe("back");
		expect(screen.getByTestId("sheet-preview").dataset.page).toBe("5");

		// single-sided: one page to a sheet, no side control
		update({ layout: DEFAULT_SHEET_LAYOUT });
		expect(screen.queryByRole("radiogroup", { name: "Sheet side" })).toBeNull();
		expect(screen.getByTestId("sheet-preview").dataset.side).toBe("any");
	});
});
