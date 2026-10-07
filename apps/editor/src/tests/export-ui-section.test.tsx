import type { Template } from "@freshcoat-js/coatfile";
import type { Dataset, ExportPreset, Workspace } from "@freshcoat-js/workspace";
import type { JobFile, JobResult } from "@freshcoat-js/workspace/export";
import {
	act,
	cleanup,
	render,
	screen,
	waitFor,
	within,
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
import { exportJobsFor } from "~/export/export-jobs";
import type {
	ExportRunner,
	ExportRunnerSnapshot,
} from "~/export/use-export-runner";
import { photoWatermark } from "~/samples/photo-watermark";
import { button, chooseOption, fastUser } from "./aria";
import { doc, PNG_BYTES, PNG_SHA } from "./doc-fixture";

const sizes: [string, number][] = [
	["clientWidth", 900],
	["clientHeight", 600],
	["offsetWidth", 900],
	["offsetHeight", 600],
];
const saved = new Map<string, PropertyDescriptor | undefined>();

beforeAll(() => {
	// jsdom has no CSS.escape, which react-aria uses to find rows by key.
	const g = globalThis as { CSS?: { escape?: (s: string) => string } };
	g.CSS ??= {};
	g.CSS.escape ??= (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
	// The virtualised records list lays out only what fits its box.
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
	// A desktop window: presets and settings are docked panels, not sheets.
	vi.stubGlobal("innerWidth", 1440);
	localStorage.clear();
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const people: Dataset = {
	id: "d_people",
	name: "People",
	columns: [
		{ key: "name", type: "text" },
		{ key: "title", type: "text" },
	],
	records: [
		{ id: "r1", status: "pending", values: { name: "Ada", title: "Dr" } },
		{
			id: "r2",
			status: "exported",
			values: { name: "Bo", title: "Mx" },
			exportedAt: "2026-09-25T10:00:00.000Z",
		},
		{
			id: "r3",
			status: "failed",
			values: { name: "Cy", title: "Ms" },
			error: "font missing",
		},
		{ id: "r4", status: "skipped", values: { name: "Di", title: "Mr" } },
	],
	assets: [],
};

/** The fixture with a Dark variant that recolours the front. */
function withDark(): Template {
	const t = doc();
	return {
		...t,
		variants: [
			{
				id: "dark",
				label: "Dark",
				swatch: "#111111",
				overrides: [
					{
						name: "front",
						elements: [{ id: "a", properties: { fill: "#000" } }],
					},
				],
			},
		],
	} as Template;
}

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
		start(workspace, preset) {
			started.push({ workspace, preset });
			set({
				state: "running",
				progress: { done: 1, failed: 1, total: 4, etaMs: 18_000 },
			});
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

function setup() {
	const controller = new EditorController();
	controller.dispatch({ type: "open", template: doc(), fileName: "doc.coat" });
	controller.dispatch({ type: "datasetEdit", datasets: [people] });
	const templateId = controller.state.workspace?.activeTemplateId as string;
	controller.dispatch({
		type: "setBinding",
		id: templateId,
		binding: {
			datasetId: people.id,
			fields: {
				name: { kind: "column", column: "name" },
				title: { kind: "column", column: "title" },
			},
		},
	});
	controller.dispatch({ type: "setSection", section: "export" });
	const fake = fakeRunner();
	const downloads: JobFile[] = [];
	// The session's jobs are made on first use, so these deps stick.
	exportJobsFor(controller, {
		runner: fake.runner,
		download: (f) => downloads.push(f),
	});
	render(
		<ControllerProvider controller={controller}>
			<ExportSection />
		</ControllerProvider>,
	);
	return {
		controller,
		templateId,
		fake,
		downloads,
		user: fastUser(),
		records: () =>
			controller.state.workspace?.datasets[0]?.records ?? people.records,
	};
}

// Generous: the virtualised tables lay out slowly under jsdom.
describe("export section", { timeout: 20_000 }, () => {
	test("starts empty and creates a preset with the defaults", async () => {
		const { controller, user, templateId } = setup();
		expect(screen.getByTestId("section-export")).toBeTruthy();
		expect(
			within(screen.getByTestId("export-presets")).getByText("No presets"),
		).toBeTruthy();
		await user.click(
			within(screen.getByTestId("export-presets")).getByRole("button", {
				name: "New preset",
			}),
		);
		const presets = controller.state.workspace?.presets ?? [];
		expect(presets).toHaveLength(1);
		expect(presets[0]).toMatchObject({
			name: "New preset",
			templateId,
			records: "all",
			sides: "all",
			format: "png-zip",
			scale: 1,
			dpi: 300,
			fileName: "{{template}}-{{index}}-{{side}}",
			markExported: true,
		});
		expect(controller.state.workspace?.activePresetId).toBe(presets[0]?.id);
		// 3 records (the skipped one is left out) × 2 sides.
		expect(button("Export 6 files")).toBeTruthy();
		expect(screen.getByTestId("export-file-example").textContent).toBe(
			"e.g. doc-1-front.png",
		);
		expect(screen.getByTestId("export-stepper-position").textContent).toBe(
			"1 / 3",
		);
	});

	/** Sets an All preset and opens the Records tab. */
	async function recordsTab() {
		const ctx = setup();
		act(() => {
			ctx.controller.dispatch({
				type: "setPreset",
				preset: {
					id: "p_1",
					name: "All",
					templateId: ctx.templateId,
					records: "all",
					sides: "all",
					format: "png-zip",
					scale: 1,
					dpi: 300,
					fileName: "{{name}}-{{side}}",
					markExported: true,
				},
			});
		});
		await ctx.user.click(screen.getByRole("tab", { name: "Records" }));
		const list = screen.getByTestId("export-records");
		await waitFor(() => expect(within(list).getByText("Ada")).toBeTruthy());
		return { ...ctx, list };
	}

	test("lists records with their status", async () => {
		const { list } = await recordsTab();
		expect(within(list).getByText("font missing")).toBeTruthy();
		expect(
			list.querySelectorAll("[data-status]").length,
		).toBeGreaterThanOrEqual(4);
	});

	test("changes records' status in bulk", async () => {
		const { user, records, list } = await recordsTab();
		const rowOf = (name: string) =>
			within(list).getByText(name).closest('[role="row"]') as HTMLElement;
		await user.click(within(rowOf("Ada")).getByRole("checkbox"));
		await user.click(within(rowOf("Cy")).getByRole("checkbox"));
		expect(screen.getByTestId("export-records-selection").textContent).toBe(
			"2 selected",
		);
		await user.click(within(list).getByRole("button", { name: /Set status/ }));
		await user.click(await screen.findByRole("menuitem", { name: "Skipped" }));
		expect(records().map((r) => r.status)).toEqual([
			"skipped",
			"exported",
			"skipped",
			"skipped",
		]);
		// The list's selection is what the button exports, until it is cleared.
		expect(button("Export 2 selected")).toBeTruthy();
		await user.click(button("Clear selection"));
		expect(button("Export 2 files")).toBeTruthy();
		expect(screen.getByTestId("export-file-example").textContent).toBe(
			"e.g. Bo-front.png",
		);
	});

	test("with records set to selected, the list selection is the preset's", async () => {
		const { controller, user } = setup();
		const templateId = controller.state.workspace?.activeTemplateId as string;
		act(() => {
			controller.dispatch({
				type: "setPreset",
				preset: {
					id: "p_1",
					name: "Picked",
					templateId,
					records: "selected",
					selected: [],
					sides: ["front"],
					format: "pdf",
					scale: 1,
					dpi: 300,
					fileName: "{{index}}",
					markExported: true,
				},
			});
		});
		expect(button("Export 0 files")).toHaveProperty("disabled", true);
		await user.click(screen.getByRole("tab", { name: "Records" }));
		const list = screen.getByTestId("export-records");
		await waitFor(() => expect(within(list).getByText("Bo")).toBeTruthy());
		const row = within(list)
			.getByText("Bo")
			.closest('[role="row"]') as HTMLElement;
		await user.click(within(row).getByRole("checkbox"));
		expect(controller.state.workspace?.presets[0]?.selected).toEqual(["r2"]);
		expect(button("Export 1 file")).toBeTruthy();
		expect(screen.getByTestId("export-page-size").textContent).toBe(
			"Page 3.33 × 2.00 in · 84.7 × 50.8 mm",
		);
	});

	test("an unbound template exports its defaults", async () => {
		const { controller } = setup();
		const templateId = controller.state.workspace?.activeTemplateId as string;
		act(() => {
			controller.dispatch({ type: "setBinding", id: templateId });
			controller.dispatch({
				type: "setPreset",
				preset: {
					id: "p_1",
					name: "Defaults",
					templateId,
					records: "all",
					sides: "all",
					format: "png-zip",
					scale: 2,
					dpi: 300,
					fileName: "{{template}}-{{side}}",
					markExported: true,
				},
			});
		});
		expect(screen.getByTestId("export-unbound").textContent).toBe(
			"Not bound to a dataset, exporting defaults",
		);
		expect(button("Export 2 files")).toBeTruthy();
		expect(screen.getByTestId("export-file-example").textContent).toBe(
			"e.g. doc-front@2x.png",
		);
	});

	/** Runs the All preset and finishes it with two files ok and one failed. */
	async function finishedJob() {
		const ctx = setup();
		const { controller, user, fake } = ctx;
		const templateId = controller.state.workspace?.activeTemplateId as string;
		act(() => {
			controller.dispatch({
				type: "setPreset",
				preset: {
					id: "p_1",
					name: "All",
					templateId,
					records: "all",
					sides: "all",
					format: "png-zip",
					scale: 1,
					dpi: 300,
					fileName: "{{name}}-{{side}}",
					markExported: true,
				},
			});
		});
		await user.click(button("Export 6 files"));
		expect(fake.started).toHaveLength(1);
		const bar = screen.getByTestId("export-job");
		expect(bar.dataset.state).toBe("running");
		expect(screen.getByTestId("export-progress").textContent).toBe("1 / 4");
		expect(bar.textContent).toContain("1failed");
		expect(screen.getByTestId("export-eta").textContent).toBe("~18 sleft");
		const file = {
			blob: new Blob([new Uint8Array([1])]),
			name: "all.zip",
			mediaType: "application/zip",
		};
		await act(async () => {
			fake.finish({
				file,
				cancelled: false,
				ms: 1500,
				items: [
					{
						key: "r1:front",
						recordId: "r1",
						side: "front",
						fileName: "a",
						ok: true,
					},
					{
						key: "r1:back",
						recordId: "r1",
						side: "back",
						fileName: "b",
						ok: true,
					},
					{
						key: "r2:front",
						recordId: "r2",
						side: "front",
						fileName: "c",
						ok: false,
						error: "no font",
					},
				],
			});
		});
		expect(bar.dataset.state).toBe("done");
		return { ...ctx, bar, file };
	}

	test("a finished job marks records and downloads once", async () => {
		const { downloads, records, file } = await finishedJob();
		expect(downloads).toEqual([file]);
		expect(records().map((r) => [r.status, r.error])).toEqual([
			["exported", undefined],
			["failed", "no font"],
			["failed", "font missing"],
			["skipped", undefined],
		]);
		expect(records()[0]?.exportedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
		expect(screen.getByTestId("export-summary").textContent).toBe(
			"All · 2 ok · 1 failed · 1.5 s",
		);
	});

	test("a finished job downloads its report and its file again", async () => {
		const { user, downloads } = await finishedJob();
		await user.click(button("Report"));
		expect(downloads.at(-1)?.name).toBe("export-report.csv");
		expect(await downloads.at(-1)?.blob.text()).toContain(
			"c,r2,front,failed,no font",
		);
		downloads.pop();
		await user.click(button("Download all.zip"));
		expect(downloads).toHaveLength(2);
	});

	test("a finished job retries its failures and keeps history", async () => {
		const { user, fake, downloads, bar } = await finishedJob();
		await user.click(button("Retry failed"));
		expect(fake.started[1]?.preset.records).toBe("failed");
		act(() => fake.runner.cancel());
		await waitFor(() => expect(bar.dataset.state).toBe("cancelled"));
		expect(downloads).toHaveLength(1);

		await user.click(button("Job history"));
		const entries = await screen.findAllByTestId("export-history-entry");
		expect(entries.map((e) => e.textContent)).toEqual([
			expect.stringContaining("All (retry)"),
			expect.stringContaining("All"),
		]);
	});

	test("the filmstrip steps through what the preset exports, and all on request", async () => {
		const { controller, user } = setup();
		const templateId = controller.state.workspace?.activeTemplateId as string;
		act(() => {
			controller.dispatch({
				type: "setPreset",
				preset: {
					id: "p_1",
					name: "All",
					templateId,
					records: "all",
					sides: "all",
					format: "png-zip",
					scale: 1,
					dpi: 300,
					fileName: "{{name}}-{{side}}",
					markExported: true,
				},
			});
		});
		const strip = screen.getByTestId("export-filmstrip");
		// the skipped record is not exported
		expect(
			within(strip)
				.getAllByRole("option")
				.map((o) => o.dataset.record),
		).toEqual(["r1", "r2", "r3"]);
		await user.click(within(strip).getAllByRole("option")[1] as HTMLElement);
		expect(controller.state.exportRecordId).toBe("r2");
		expect(screen.getByTestId("export-stepper-position").textContent).toBe(
			"2 / 3",
		);
		await user.keyboard("{ArrowRight}");
		expect(controller.state.exportRecordId).toBe("r3");
		expect(screen.getByTestId("export-record-error").textContent).toBe(
			"font missing",
		);

		await user.click(screen.getByRole("radio", { name: /^All/ }));
		expect(within(strip).getAllByRole("option")).toHaveLength(4);
		expect(screen.getByTestId("export-stepper-position").textContent).toBe(
			"3 / 4",
		);
		const skipped = within(strip).getAllByRole("option")[3] as HTMLElement;
		await user.click(skipped);
		expect(controller.state.exportRecordId).toBe("r4");
		expect(screen.getByText("not in this export")).toBeTruthy();
	});

	test("under All variants, each record has a cell and a preview per variant", async () => {
		const { controller, user, templateId } = setup();
		act(() => {
			controller.dispatch({
				type: "open",
				template: withDark(),
				fileName: "doc.coat",
			});
		});
		const id = controller.state.workspace?.activeTemplateId as string;
		act(() => {
			controller.dispatch({
				type: "setBinding",
				id,
				binding: {
					datasetId: people.id,
					fields: { name: { kind: "column", column: "name" } },
					variant: { kind: "all" },
				},
			});
			controller.dispatch({
				type: "setPreset",
				preset: {
					id: "p_1",
					name: "All",
					templateId: id,
					records: "all",
					sides: ["front"],
					format: "png-zip",
					scale: 1,
					dpi: 300,
					fileName: "{{name}}",
					markExported: true,
				},
			});
		});
		expect(id).not.toBe(templateId);
		const strip = screen.getByTestId("export-filmstrip");
		const cells = () =>
			within(strip)
				.getAllByRole("option")
				.map((o) => `${o.dataset.record}:${o.dataset.variant}`);
		expect(cells()).toEqual([
			"r1:default",
			"r1:dark",
			"r2:default",
			"r2:dark",
			"r3:default",
			"r3:dark",
		]);
		expect(button("Export 6 files")).toBeTruthy();
		expect(screen.getByTestId("export-file-example").textContent).toBe(
			"e.g. Ada-default.png",
		);
		const preview = screen.getByTestId("export-preview");
		expect(preview.dataset.renderKey).toMatch(/^r1:front:default\|/);
		expect(screen.getByTestId("export-preview-variant").textContent).toBe(
			"Default",
		);

		await user.click(within(strip).getAllByRole("option")[1] as HTMLElement);
		expect(controller.state.exportRecordId).toBe("r1");
		expect(screen.getByTestId("export-preview").dataset.renderKey).toMatch(
			/^r1:front:dark\|/,
		);
		expect(screen.getByTestId("export-preview-variant").textContent).toBe(
			"Dark",
		);
		expect(screen.getByTestId("export-stepper-position").textContent).toBe(
			"2 / 6",
		);
		await user.keyboard("{ArrowRight}");
		expect(controller.state.exportRecordId).toBe("r2");
		expect(screen.getByTestId("export-preview").dataset.renderKey).toMatch(
			/^r2:front:default\|/,
		);
		await user.click(button("Next record"));
		expect(screen.getByTestId("export-preview").dataset.renderKey).toMatch(
			/^r2:front:dark\|/,
		);
	});

	test("a template with no dataset chooses its variants in the Export section", async () => {
		const { controller, user } = setup();
		act(() => {
			controller.dispatch({
				type: "open",
				template: withDark(),
				fileName: "doc.coat",
			});
		});
		const id = controller.state.workspace?.activeTemplateId as string;
		act(() => {
			controller.dispatch({
				type: "setPreset",
				preset: {
					id: "p_1",
					name: "Defaults",
					templateId: id,
					records: "all",
					sides: ["front"],
					format: "png-zip",
					scale: 1,
					dpi: 300,
					fileName: "{{template}}",
					markExported: true,
				},
			});
		});
		expect(button("Export 1 file")).toBeTruthy();
		const settings = screen.getByTestId("export-settings");
		expect(within(settings).getByText(/\{\{variant\}\}/)).toBeTruthy();
		await chooseOption(
			user,
			within(settings).getByLabelText(/Variant source/, { selector: "button" }),
			"All variants",
		);
		expect(
			controller.state.workspace?.templates.find((t) => t.id === id)?.binding,
		).toEqual({ datasetId: "", fields: {}, variant: { kind: "all" } });
		expect(screen.getByTestId("export-unbound")).toBeTruthy();
		expect(button("Export 2 files")).toBeTruthy();
		expect(screen.getByTestId("export-stepper-position").textContent).toBe(
			"1 / 2",
		);
		await user.click(button("Next record"));
		expect(screen.getByTestId("export-preview").dataset.renderKey).toMatch(
			/^:front:dark\|/,
		);
		expect(screen.getByTestId("export-preview-variant").textContent).toBe(
			"Dark",
		);
	});

	test("after a job, Show failed narrows the filmstrip and records to failures", async () => {
		const { controller, user, fake } = setup();
		const templateId = controller.state.workspace?.activeTemplateId as string;
		act(() => {
			controller.dispatch({
				type: "setPreset",
				preset: {
					id: "p_1",
					name: "All",
					templateId,
					records: "all",
					sides: ["front"],
					format: "png-zip",
					scale: 1,
					dpi: 300,
					fileName: "{{name}}-{{side}}",
					markExported: false,
				},
			});
		});
		await user.click(button("Export 3 files"));
		const item = (recordId: string, ok: boolean) => ({
			key: `${recordId}:front`,
			recordId,
			side: "front",
			fileName: recordId,
			ok,
			...(ok ? {} : { error: "boom" }),
		});
		await act(async () => {
			fake.finish({
				cancelled: false,
				ms: 1000,
				items: [item("r1", false), item("r2", true), item("r3", true)],
			});
		});
		await user.click(button("Show failed"));
		const strip = screen.getByTestId("export-filmstrip");
		// r1 failed in the job; r3 was already failed
		expect(
			within(strip)
				.getAllByRole("option")
				.map((o) => o.dataset.record),
		).toEqual(["r1", "r3"]);
		expect(controller.state.exportRecordId).toBe("r1");
		expect(
			screen
				.getByRole("radio", { name: /^Failed/ })
				.getAttribute("aria-checked"),
		).toBe("true");
		await user.click(screen.getByRole("tab", { name: "Records" }));
		expect(
			screen
				.getByRole("radio", { name: /^Failed/ })
				.getAttribute("aria-checked"),
		).toBe("true");
	});

	test("Source and Split appear when the template binds an image field", async () => {
		const controller = new EditorController();
		controller.dispatch({
			type: "open",
			template: photoWatermark(),
			fileName: "photo.coat",
		});
		const blob = new Blob([PNG_BYTES as BlobPart], { type: "image/png" });
		controller.dispatch({
			type: "datasetEdit",
			datasets: [
				{
					id: "d_photos",
					name: "Photos",
					columns: [
						{ key: "photo", type: "image" },
						{ key: "file_name", type: "text" },
					],
					records: [
						{
							id: "p1",
							status: "pending",
							values: { photo: `ws:${PNG_SHA}`, file_name: "one.png" },
						},
					],
					assets: [
						{
							sha256: PNG_SHA,
							contentType: "image/png",
							name: "one.png",
							size: blob.size,
							width: 1,
							height: 1,
							blob,
						},
					],
				},
			],
		});
		const templateId = controller.state.workspace?.activeTemplateId as string;
		controller.dispatch({
			type: "setPreset",
			preset: {
				id: "p_1",
				name: "Marked",
				templateId,
				records: "all",
				sides: "all",
				format: "jpeg-zip",
				size: { kind: "image", field: "photo" },
				scale: 1,
				dpi: 300,
				fileName: "{{file_name}}",
				markExported: true,
			},
		});
		controller.dispatch({ type: "setSection", section: "export" });
		exportJobsFor(controller, { runner: fakeRunner().runner });
		const view = render(
			<ControllerProvider controller={controller}>
				<ExportSection />
			</ControllerProvider>,
		);
		// unbound: the output only
		expect(screen.queryByRole("radio", { name: "Split" })).toBeNull();
		act(() => {
			controller.dispatch({
				type: "setBinding",
				id: templateId,
				binding: {
					datasetId: "d_photos",
					fields: { photo: { kind: "column", column: "photo" } },
				},
			});
		});
		view.rerender(
			<ControllerProvider controller={controller}>
				<ExportSection />
			</ControllerProvider>,
		);
		const user = fastUser();
		expect(screen.getByRole("radio", { name: "Output" })).toBeTruthy();
		expect(screen.getByRole("radio", { name: "Source" })).toBeTruthy();
		await user.click(screen.getByRole("radio", { name: "Split" }));
		const preview = screen.getByTestId("export-preview");
		expect(preview.dataset.mode).toBe("split");
		const divider = screen.getByRole("slider", {
			name: "Split between source and output",
		});
		expect(divider.getAttribute("aria-valuenow")).toBe("50");
		divider.focus();
		await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
		expect(divider.getAttribute("aria-valuenow")).toBe("60");
		await user.click(screen.getByRole("radio", { name: "Source" }));
		expect(preview.dataset.mode).toBe("source");
		expect(screen.getByTestId("export-preview-size").textContent).toBe("1 × 1");
	});
});
