import type { Dataset, ExportPreset, Workspace } from "@freshcoat-js/workspace";
import { planExport } from "@freshcoat-js/workspace";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import {
	afterAll,
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
import { createExportJobs, exportJobsFor } from "~/export/export-jobs";
import {
	presetsForDataset,
	RECORD_FILTERS,
	retryPreset,
	selectedRunLabel,
} from "~/export/export-ui";
import { selectionAfterClick } from "~/export/filmstrip-model";
import { type JobResult, withRecordIds } from "~/export/job";
import type {
	ExportRunner,
	ExportRunnerSnapshot,
} from "~/export/use-export-runner";
import { membershipCard } from "~/samples/membership-card";
import { doc } from "./doc-fixture";

const members: Dataset = {
	id: "d_1",
	name: "Members",
	columns: [{ key: "display_name", type: "text" }],
	records: [
		{ id: "r1", status: "pending", values: { display_name: "Ada" } },
		{ id: "r2", status: "exported", values: { display_name: "Bo" } },
		{ id: "r3", status: "pending", values: { display_name: "Cy" } },
		{ id: "r4", status: "skipped", values: { display_name: "Di" } },
		{ id: "r5", status: "pending", values: { display_name: "Ed" } },
	],
	assets: [],
};

const workspace: Workspace = {
	formatVersion: "1.0",
	name: "Club",
	templates: [
		{
			id: "t_1",
			fileName: "Card.coat",
			template: membershipCard(),
			binding: {
				datasetId: "d_1",
				fields: {
					display_name: { kind: "column", column: "display_name" },
				},
			},
		},
	],
	datasets: [members],
	presets: [],
};

const pending: ExportPreset = {
	id: "p_1",
	name: "Pending fronts",
	templateId: "t_1",
	records: "pending",
	sides: ["front"],
	format: "png-zip",
	scale: 1,
	dpi: 300,
	fileName: "{{display_name}}-{{side}}",
	markExported: true,
};

describe("planning a run over record ids", () => {
	test("replaces the preset's filter with exactly those ids, in dataset order", () => {
		const plan = planExport(workspace, withRecordIds(pending, ["r5", "r2"]));
		expect(plan.map((i) => i.recordId)).toEqual(["r2", "r5"]);
		// The rest of the preset still applies: its sides and its naming.
		expect(plan.map((i) => i.fileName)).toEqual([
			"Bo-front.png",
			"Ed-front.png",
		]);
	});

	test("ignores ids the dataset does not hold and collapses duplicates", () => {
		const run = withRecordIds(pending, ["r3", "nope", "r1", "r3", "r1"]);
		expect(run.selected).toEqual(["r3", "nope", "r1"]);
		expect(planExport(workspace, run).map((i) => i.recordId)).toEqual([
			"r1",
			"r3",
		]);
	});

	test("exports a chosen record whatever its status", () => {
		const plan = planExport(workspace, withRecordIds(pending, ["r4", "r2"]));
		expect(plan.map((i) => i.recordId)).toEqual(["r2", "r4"]);
	});

	test("leaves the preset as it was", () => {
		const before = structuredClone(pending);
		const run = withRecordIds(pending, ["r1"]);
		expect(pending).toEqual(before);
		expect(run).toEqual({ ...pending, records: "selected", selected: ["r1"] });
	});

	test("the runs are named by their record count", () => {
		expect(selectedRunLabel(1)).toBe("1 selected record");
		expect(selectedRunLabel(3)).toBe("3 selected records");
	});

	test("a retry stays inside the chosen records", () => {
		const result: JobResult = {
			cancelled: false,
			ms: 1,
			items: [
				{ key: "r1", recordId: "r1", side: "front", fileName: "a", ok: true },
				{
					key: "r3",
					recordId: "r3",
					side: "front",
					fileName: "b",
					ok: false,
					error: "x",
				},
			],
		};
		expect(
			retryPreset(withRecordIds(pending, ["r1", "r3"]), result),
		).toMatchObject({ records: "selected", selected: ["r3"] });
	});

	test("the saved filter is called a saved selection", () => {
		expect(RECORD_FILTERS.find((f) => f.id === "selected")?.label).toBe(
			"Saved selection",
		);
	});

	test("the presets that can export a dataset are the ones bound to it", () => {
		const other = { ...pending, id: "p_2", templateId: "t_2" };
		expect(
			presetsForDataset(
				[{ id: "t_1", binding: { datasetId: "d_1" } }, { id: "t_2" }],
				[pending, other],
				"d_1",
			).map((p) => p.id),
		).toEqual(["p_1"]);
	});
});

describe("filmstrip selection", () => {
	const order = ["a", "b", "c", "d", "e"];

	test("a plain click only previews", () => {
		expect(
			selectionAfterClick(["a"], order, "a", "c", {
				range: false,
				toggle: false,
			}),
		).toBeNull();
	});

	test("Mod-click toggles one record", () => {
		const on = selectionAfterClick(["a"], order, "a", "c", {
			range: false,
			toggle: true,
		});
		expect(on).toEqual(["a", "c"]);
		expect(
			selectionAfterClick(on ?? [], order, "c", "a", {
				range: false,
				toggle: true,
			}),
		).toEqual(["c"]);
	});

	test("Shift-click selects the range from the anchor, either way", () => {
		expect(
			selectionAfterClick(["e"], order, "b", "d", {
				range: true,
				toggle: false,
			}),
		).toEqual(["b", "c", "d"]);
		expect(
			selectionAfterClick([], order, "d", "b", { range: true, toggle: false }),
		).toEqual(["b", "c", "d"]);
	});

	test("Mod-Shift-click adds the range, and no anchor is a range of one", () => {
		expect(
			selectionAfterClick(["e"], order, "a", "b", {
				range: true,
				toggle: true,
			}),
		).toEqual(["e", "a", "b"]);
		expect(
			selectionAfterClick([], order, null, "c", { range: true, toggle: false }),
		).toEqual(["c"]);
	});
});

/** A runner that finishes when told to, rendering nothing. */
function fakeRunner() {
	let snapshot: ExportRunnerSnapshot = {
		state: "idle",
		progress: null,
		result: null,
		error: null,
	};
	const listeners = new Set<() => void>();
	const set = (next: Partial<ExportRunnerSnapshot>) => {
		snapshot = { ...snapshot, ...next };
		for (const l of listeners) l();
	};
	let finish: ((r: JobResult) => void) | null = null;
	const started: { workspace: Workspace; preset: ExportPreset }[] = [];
	const runner: ExportRunner = {
		getSnapshot: () => snapshot,
		subscribe(l) {
			listeners.add(l);
			return () => listeners.delete(l);
		},
		start(ws, preset) {
			started.push({ workspace: ws, preset });
			set({ state: "running", progress: null });
			return new Promise((resolve) => {
				finish = (r) => {
					set({ state: r.cancelled ? "cancelled" : "done", result: r });
					resolve(r);
				};
			});
		},
		cancel() {
			finish?.({ items: [], cancelled: true, ms: 5 });
		},
		dispose() {},
	};
	return { runner, started, finish: (r: JobResult) => finish?.(r) };
}

const people: Dataset = {
	id: "d_people",
	name: "People",
	columns: [
		{ key: "name", type: "text" },
		{ key: "title", type: "text" },
	],
	records: [
		{ id: "r1", status: "pending", values: { name: "Ada", title: "Dr" } },
		{ id: "r2", status: "exported", values: { name: "Bo", title: "Mx" } },
		{ id: "r3", status: "pending", values: { name: "Cy", title: "Ms" } },
		{ id: "r4", status: "pending", values: { name: "Di", title: "Mr" } },
	],
	assets: [],
};

function controllerWithPeople() {
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
	const preset: ExportPreset = {
		id: "p_1",
		name: "Pending",
		templateId,
		records: "pending",
		sides: "all",
		format: "png-zip",
		scale: 1,
		dpi: 300,
		fileName: "{{name}}-{{side}}",
		markExported: true,
	};
	controller.dispatch({ type: "setPreset", preset });
	return { controller, preset };
}

const records = (controller: EditorController) =>
	controller.state.workspace?.datasets[0]?.records ?? [];

describe("running a preset over record ids", () => {
	test("runs exactly those records, names the run and leaves the preset", async () => {
		const { controller, preset } = controllerWithPeople();
		const fake = fakeRunner();
		const jobs = createExportJobs(controller, {
			runner: fake.runner,
			download: () => {},
		});
		const done = jobs.run(preset, undefined, {
			recordIds: ["r4", "r2", "gone", "r2"],
		});
		await vi.waitFor(() => expect(fake.started).toHaveLength(1));
		const ran = fake.started[0]?.preset;
		expect(ran).toMatchObject({
			records: "selected",
			selected: ["r4", "r2", "gone"],
		});
		expect(
			planExport(
				fake.started[0]?.workspace as Workspace,
				ran as ExportPreset,
			).map((i) => i.recordId),
		).toEqual(["r2", "r2", "r4", "r4"]);
		expect(jobs.getSnapshot().job?.scope).toBe("2 selected records");
		fake.finish({
			cancelled: false,
			ms: 10,
			items: ["r2", "r4"].map((id) => ({
				key: `${id}:front`,
				recordId: id,
				side: "front",
				fileName: id,
				ok: true,
			})),
		});
		await done;
		expect(controller.state.workspace?.presets).toEqual([preset]);
		expect(records(controller).map((r) => r.status)).toEqual([
			"pending",
			"exported",
			"pending",
			"exported",
		]);
		expect(jobs.getSnapshot().history[0]).toMatchObject({
			presetId: "p_1",
			presetName: "Pending",
			scope: "2 selected records",
		});
	});
});

const sizes: [string, number][] = [
	["clientWidth", 900],
	["clientHeight", 600],
	["offsetWidth", 900],
	["offsetHeight", 600],
];
const saved = new Map<string, PropertyDescriptor | undefined>();

describe("the filmstrip's selection in Export", { timeout: 20_000 }, () => {
	beforeAll(() => {
		const g = globalThis as { CSS?: { escape?: (s: string) => string } };
		g.CSS ??= {};
		g.CSS.escape ??= (s) =>
			String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
		for (const [prop, value] of sizes) {
			saved.set(
				prop,
				Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop),
			);
			Object.defineProperty(HTMLElement.prototype, prop, {
				configurable: true,
				get: () => value,
			});
		}
	});
	afterAll(() => {
		for (const [prop, descriptor] of saved)
			if (descriptor)
				Object.defineProperty(HTMLElement.prototype, prop, descriptor);
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

	function setup() {
		const { controller, preset } = controllerWithPeople();
		controller.dispatch({ type: "setSection", section: "export" });
		const fake = fakeRunner();
		exportJobsFor(controller, { runner: fake.runner, download: () => {} });
		render(
			<ControllerProvider controller={controller}>
				<ExportSection />
			</ControllerProvider>,
		);
		return { controller, preset, fake };
	}

	const cell = (id: string) =>
		document.querySelector(`[data-record="${id}"]`) as HTMLElement;
	const strip = () => screen.getByTestId("export-filmstrip");

	test("Mod-click and Shift-click select, and the button exports the selection", async () => {
		const { controller, preset, fake } = setup();
		// The preset's own filter: the three pending records, two sides each.
		expect(screen.getByRole("button", { name: "Export 6 files" })).toBeTruthy();
		fireEvent.click(screen.getByRole("radio", { name: /All/ }));
		fireEvent.click(cell("r1"));
		fireEvent.click(cell("r2"), { ctrlKey: true });
		expect(cell("r2").getAttribute("aria-checked")).toBe("true");
		expect(cell("r1").getAttribute("aria-checked")).toBe("false");
		// The plain click previewed; the Mod-click did not move the preview.
		expect(cell("r1").getAttribute("aria-selected")).toBe("true");
		expect(
			screen.getByRole("button", { name: "Export 1 selected" }),
		).toBeTruthy();
		fireEvent.click(cell("r4"), { shiftKey: true });
		expect(
			["r1", "r2", "r3", "r4"].map((id) =>
				cell(id).getAttribute("aria-checked"),
			),
		).toEqual(["false", "true", "true", "true"]);
		expect(screen.getByTestId("export-selection").textContent).toContain(
			"3 selected",
		);
		await act(async () => {
			fireEvent.click(
				screen.getByRole("button", { name: "Export 3 selected" }),
			);
		});
		await vi.waitFor(() => expect(fake.started).toHaveLength(1));
		expect(fake.started[0]?.preset).toMatchObject({
			id: "p_1",
			records: "selected",
			selected: ["r2", "r3", "r4"],
		});
		expect(controller.state.workspace?.presets).toEqual([preset]);
	});

	test("Mod+A selects every cell, Escape and Clear return to the preset's count", () => {
		setup();
		fireEvent.keyDown(strip(), { key: "a", code: "KeyA", ctrlKey: true });
		expect(
			screen.getByRole("button", { name: "Export 3 selected" }),
		).toBeTruthy();
		fireEvent.keyDown(strip(), { key: "Escape" });
		expect(screen.getByRole("button", { name: "Export 6 files" })).toBeTruthy();
		fireEvent.keyDown(strip(), { key: " " });
		expect(
			screen.getByRole("button", { name: "Export 1 selected" }),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
		expect(screen.getByRole("button", { name: "Export 6 files" })).toBeTruthy();
	});
});
