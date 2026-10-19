import type { Element, Template } from "@freshcoat-js/coatfile";
import { iccProfile } from "@freshcoat-js/test-utils";
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

/** The fixture with two slices on the front: `left` cut through and `right`
 *  kissed, the second added beside the fixture's layers. */
function withSlices(edges: [string, string] = ["through", "kiss"]): Template {
	const t = doc();
	const front = t.template_data[0];
	if (!front) throw new Error("fixture");
	const edge = (e: string) => (e === "none" ? {} : { edge: e });
	return {
		...t,
		template_data: [
			{
				...front,
				elements: [
					...front.elements.map((e) =>
						e.id === "a"
							? ({
									...e,
									properties: {
										...e.properties,
										slice: { name: "left", ...edge(edges[0]) },
									},
								} as Element)
							: e,
					),
					{
						id: "r",
						type: "rect",
						pos: { x: 500, y: 0 },
						size: { width: 100, height: 100 },
						properties: { slice: { name: "right", ...edge(edges[1]) } },
					} as Element,
				],
			},
			...t.template_data.slice(1),
		],
	};
}

function setup(template: Template = doc()) {
	const controller = new EditorController();
	controller.dispatch({ type: "open", template, fileName: "doc.coat" });
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
		await user.click(screen.getByRole("menuitem", { name: "Blank preset" }));
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
		await ctx.user.click(screen.getByRole("radio", { name: "Records" }));
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

	test("keeps its tabs and selection after another section shows", async () => {
		const { controller, user, list } = await recordsTab();
		const rowOf = (name: string) =>
			within(list).getByText(name).closest('[role="row"]') as HTMLElement;
		await user.click(within(rowOf("Ada")).getByRole("checkbox"));
		cleanup();
		act(() => controller.dispatch({ type: "setSection", section: "edit" }));
		act(() => controller.dispatch({ type: "setSection", section: "export" }));
		render(
			<ControllerProvider controller={controller}>
				<ExportSection />
			</ControllerProvider>,
		);
		expect(
			screen
				.getByRole("radio", { name: "Records" })
				.getAttribute("aria-checked"),
		).toBe("true");
		expect(button("Export 1 selected")).toBeTruthy();
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
		await user.click(screen.getByRole("radio", { name: "Records" }));
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

	test("the binding is the template's, shared by its presets", () => {
		const { controller, templateId } = setup();
		const preset = (id: string) => ({
			id,
			name: id,
			templateId,
			records: "all" as const,
			sides: "all" as const,
			format: "png-zip" as const,
			scale: 1,
			dpi: 300,
			fileName: "{{index}}",
			markExported: true,
		});
		act(() =>
			controller.dispatch({ type: "setPreset", preset: preset("p_1") }),
		);
		const header = () =>
			screen.getByRole("button", { name: /^Template binding/ }).textContent;
		expect(header()).not.toContain("used by");
		act(() =>
			controller.dispatch({ type: "setPreset", preset: preset("p_2") }),
		);
		expect(header()).toContain("People");
		expect(screen.getByTestId("binding-shared").textContent).toBe(
			"used by 2 presets",
		);
	});

	test("an unbound template exports its defaults", async () => {
		const { controller, user } = setup();
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
		const notice = screen.getByTestId("export-check-unbound");
		expect(notice.textContent).toContain(
			"Not bound to a dataset, exporting defaults",
		);
		expect(button("Export 2 files")).toBeTruthy();
		expect(screen.getByTestId("export-file-example").textContent).toBe(
			"e.g. doc-front@2x.png",
		);
		await user.click(
			within(notice).getByRole("button", { name: "Bind a dataset" }),
		);
		expect(screen.getByTestId("binding-editor")).toBeTruthy();
	});

	test("keeps the alpha channel of a PNG preset on request", async () => {
		const { controller, user, templateId } = setup();
		const preset = (format: ExportPreset["format"]): ExportPreset => ({
			id: "p_1",
			name: "Icons",
			templateId,
			records: "all",
			sides: "all",
			format,
			scale: 1,
			dpi: 300,
			fileName: "{{name}}-{{side}}",
			markExported: true,
		});
		act(() =>
			controller.dispatch({ type: "setPreset", preset: preset("png-zip") }),
		);
		const keep = screen.getByRole("checkbox", { name: "Keep alpha channel" });
		await user.click(keep);
		expect(controller.state.workspace?.presets[0]?.pngAlpha).toBe("keep");
		await user.click(keep);
		expect(controller.state.workspace?.presets[0]?.pngAlpha).toBe("auto");
		act(() =>
			controller.dispatch({ type: "setPreset", preset: preset("jpeg-zip") }),
		);
		expect(
			screen.queryByRole("checkbox", { name: "Keep alpha channel" }),
		).toBeNull();
	});

	test("draws a vector PDF's text with its fonts or as outlines", async () => {
		const { controller, user, templateId } = setup();
		const preset = (patch: Partial<ExportPreset>): ExportPreset => ({
			id: "p_1",
			name: "Print",
			templateId,
			records: "all",
			sides: "all",
			format: "pdf",
			scale: 1,
			dpi: 300,
			fileName: "{{name}}-{{side}}",
			markExported: true,
			...patch,
		});
		act(() => controller.dispatch({ type: "setPreset", preset: preset({}) }));
		expect(screen.queryByRole("radio", { name: "Outline" })).toBeNull();
		act(() =>
			controller.dispatch({
				type: "setPreset",
				preset: preset({ pdfPageImage: "vector" }),
			}),
		);
		await user.click(screen.getByRole("radio", { name: "Outline" }));
		expect(controller.state.workspace?.presets[0]?.pdfText).toBe("outline");
		await user.click(screen.getByRole("radio", { name: "Embed fonts" }));
		expect(controller.state.workspace?.presets[0]?.pdfText).toBe("embed");
	});

	describe("slices", () => {
		const preset = (
			templateId: string,
			patch: Partial<ExportPreset> = {},
		): ExportPreset => ({
			id: "p_1",
			name: "Pieces",
			templateId,
			records: "all",
			sides: "all",
			format: "png-zip",
			scale: 1,
			dpi: 300,
			fileName: "{{record}}-{{side}}",
			markExported: true,
			...patch,
		});
		const stored = (c: EditorController) => c.state.workspace?.presets[0];

		test("offers nothing about slices to a template without any", async () => {
			const { controller, user, templateId } = setup();
			act(() =>
				controller.dispatch({ type: "setPreset", preset: preset(templateId) }),
			);
			expect(
				screen.queryByRole("checkbox", { name: /slice pieces/ }),
			).toBeNull();
			expect(screen.queryByRole("button", { name: /Cut file/ })).toBeNull();
			await user.click(screen.getByRole("button", { name: "Insert field" }));
			expect(screen.queryByRole("menuitem", { name: "slice" })).toBeNull();
		});

		test("splits into pieces, which the plan, the count and the file names follow", async () => {
			const { controller, user, templateId } = setup(withSlices());
			act(() =>
				controller.dispatch({ type: "setPreset", preset: preset(templateId) }),
			);
			expect(button("Export 6 files")).toBeTruthy();
			const split = screen.getByRole("checkbox", {
				name: "Split into slice pieces",
			});
			expect(split).toHaveProperty("checked", false);
			await user.click(split);
			expect(stored(controller)?.split).toBe("pieces");
			// 3 records x (2 pieces on the front + the whole back).
			expect(button("Export 9 files")).toBeTruthy();
			await user.click(screen.getByRole("button", { name: "Insert field" }));
			expect(screen.getByRole("menuitem", { name: "slice" })).toBeTruthy();
			await user.keyboard("{Escape}");
			expect(screen.getByTestId("export-file-example").textContent).toBe(
				"e.g. r1-front-left.png",
			);
			await user.click(
				screen.getByRole("checkbox", { name: "Split into slice pieces" }),
			);
			expect(stored(controller)?.split).toBe("none");
		});

		test("lists the piece files of the previewed record and side", async () => {
			const { controller, templateId } = setup(withSlices());
			act(() =>
				controller.dispatch({ type: "setPreset", preset: preset(templateId) }),
			);
			expect(screen.queryByTestId("export-piece-files")).toBeNull();
			act(() =>
				controller.dispatch({
					type: "setPreset",
					preset: preset(templateId, { split: "pieces" }),
				}),
			);
			const files = screen.getByTestId("export-piece-files");
			expect(files.textContent).toBe("r1-front-left.pngr1-front-right.png");
		});

		test("picks a cut file for image zips when an edge cuts", async () => {
			const { controller, user, templateId } = setup(withSlices());
			act(() =>
				controller.dispatch({ type: "setPreset", preset: preset(templateId) }),
			);
			const select = screen.getByLabelText("Cut file");
			await chooseOption(user, select, "SVG");
			expect(stored(controller)?.cutFile).toBe("svg");
			await chooseOption(user, screen.getByLabelText("Cut file"), "DXF");
			expect(stored(controller)?.cutFile).toBe("dxf");
			await chooseOption(user, screen.getByLabelText("Cut file"), "None");
			expect(stored(controller)?.cutFile).toBe("none");
			expect(screen.queryByRole("checkbox", { name: "Cut lines" })).toBeNull();
		});

		test("hides the cut choices when no slice has an edge", async () => {
			const { controller, templateId } = setup(withSlices(["none", "none"]));
			act(() =>
				controller.dispatch({ type: "setPreset", preset: preset(templateId) }),
			);
			expect(
				screen.getByRole("checkbox", { name: "Split into slice pieces" }),
			).toBeTruthy();
			expect(screen.queryByLabelText("Cut file")).toBeNull();
			act(() =>
				controller.dispatch({
					type: "setPreset",
					preset: preset(templateId, { format: "pdf" }),
				}),
			);
			expect(screen.queryByRole("checkbox", { name: "Cut lines" })).toBeNull();
		});

		test("draws cut lines on a PDF", async () => {
			const { controller, user, templateId } = setup(withSlices());
			act(() =>
				controller.dispatch({
					type: "setPreset",
					preset: preset(templateId, { format: "pdf" }),
				}),
			);
			expect(screen.queryByLabelText("Cut file")).toBeNull();
			await user.click(screen.getByRole("checkbox", { name: "Cut lines" }));
			expect(stored(controller)?.cutLines).toBe(true);
			await user.click(screen.getByRole("checkbox", { name: "Cut lines" }));
			expect(stored(controller)?.cutLines).toBe(false);
		});

		test("names the spot colour of each edge kind the template cuts", async () => {
			const { controller, user, templateId } = setup(withSlices());
			act(() =>
				controller.dispatch({
					type: "setPreset",
					preset: preset(templateId, { format: "pdf" }),
				}),
			);
			expect(screen.queryByLabelText("Through spot")).toBeNull();
			await user.click(screen.getByRole("checkbox", { name: "Cut lines" }));
			const through = screen.getByLabelText("Through spot") as HTMLInputElement;
			expect(through.placeholder).toBe("CutContour");
			expect(
				(screen.getByLabelText("Kiss spot") as HTMLInputElement).placeholder,
			).toBe("KissCut");
			expect(screen.queryByLabelText("Score spot")).toBeNull();
			await user.type(through, "Thru");
			expect(stored(controller)?.cutSpots).toEqual({ through: "Thru" });
			await user.clear(screen.getByLabelText("Through spot"));
			expect(stored(controller)?.cutSpots).toEqual({});
		});

		test("says why pieces of vector pages can't run", async () => {
			const { controller, templateId } = setup(withSlices());
			act(() =>
				controller.dispatch({
					type: "setPreset",
					preset: preset(templateId, {
						format: "pdf",
						pdfPageImage: "vector",
						split: "pieces",
					}),
				}),
			);
			expect(screen.getByTestId("export-check-blocked").textContent).toContain(
				"Pieces need PNG or JPEG pages, not vector",
			);
		});
	});

	test("a PDF preset declares sRGB, a custom profile or nothing", async () => {
		const { controller, user, templateId } = setup();
		act(() =>
			controller.dispatch({
				type: "setPreset",
				preset: {
					id: "p_1",
					name: "Print shop",
					templateId,
					records: "all",
					sides: "all",
					format: "pdf",
					scale: 1,
					dpi: 300,
					fileName: "{{name}}-{{side}}",
					markExported: true,
				},
			}),
		);
		const group = screen.getByTestId("export-output-intent");
		const hint = () =>
			screen.getByTestId("export-output-intent-hint").textContent;
		expect(hint()).toBe("Declares sRGB, the space cards are drawn in");
		const input = group.querySelector("input[type=file]") as HTMLInputElement;

		await user.upload(
			input,
			new File([iccProfile({ space: "Lab " }) as BlobPart], "lab.icc"),
		);
		await waitFor(() =>
			expect(screen.getByTestId("export-output-intent-error").textContent).toBe(
				'Couldn\'t use lab.icc: its colour space "Lab" is not gray, RGB or CMYK',
			),
		);
		expect(
			controller.state.workspace?.presets[0]?.outputIntent,
		).toBeUndefined();

		const fogra = iccProfile({ description: "Coated FOGRA39" });
		await user.upload(input, new File([fogra as BlobPart], "fogra.icc"));
		await waitFor(() =>
			expect(hint()).toBe(
				"Cards stay sRGB; the printer converts them to this profile",
			),
		);
		const ws = controller.state.workspace;
		const sha = ws?.profiles?.[0]?.sha256;
		expect(ws?.profiles).toHaveLength(1);
		expect(ws?.profiles?.[0]).toMatchObject({
			name: "fogra.icc",
			description: "Coated FOGRA39",
			bytes: fogra,
		});
		expect(ws?.presets[0]?.outputIntent).toEqual({
			kind: "profile",
			sha256: sha,
		});
		expect(
			within(group).getByRole("button", { name: /Coated FOGRA39/ }),
		).toBeTruthy();

		await chooseOption(
			user,
			within(group).getByRole("button", { name: /Coated FOGRA39/ }),
			"None",
		);
		expect(controller.state.workspace?.presets[0]?.outputIntent).toEqual({
			kind: "none",
		});
		expect(hint()).toBe("No intent: each printer reads the colors its own way");
		// Picking the same file again keeps one copy.
		await user.upload(input, new File([fogra as BlobPart], "again.icc"));
		await waitFor(() =>
			expect(controller.state.workspace?.presets[0]?.outputIntent?.kind).toBe(
				"profile",
			),
		);
		expect(controller.state.workspace?.profiles).toHaveLength(1);
	});

	test("warns under the file name pattern about tokens that name nothing", async () => {
		const { controller, templateId } = setup();
		const preset = (fileName: string): ExportPreset => ({
			id: "p_1",
			name: "Names",
			templateId,
			records: "all",
			sides: "all",
			format: "png-zip",
			scale: 1,
			dpi: 300,
			fileName,
			markExported: true,
		});
		act(() =>
			controller.dispatch({
				type: "setPreset",
				preset: preset("{{name}}-{{side}}"),
			}),
		);
		expect(screen.queryByTestId("export-file-name-unknown")).toBeNull();
		act(() =>
			controller.dispatch({
				type: "setPreset",
				preset: preset("{{nam}}-{{side}}-{{team}}"),
			}),
		);
		expect(screen.getByTestId("export-file-name-unknown").textContent).toBe(
			"{{nam}}, {{team}} aren't fields or columns",
		);
		act(() =>
			controller.dispatch({
				type: "setPreset",
				preset: preset("{{nam}}"),
			}),
		);
		expect(screen.getByTestId("export-file-name-unknown").textContent).toBe(
			"{{nam}} isn't a field or column",
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
		expect(controller.state.recordId).toBe("r2");
		expect(screen.getByTestId("export-stepper-position").textContent).toBe(
			"2 / 3",
		);
		await user.keyboard("{ArrowRight}");
		expect(controller.state.recordId).toBe("r3");
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
		expect(controller.state.recordId).toBe("r4");
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
		expect(controller.state.recordId).toBe("r1");
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
		expect(controller.state.recordId).toBe("r2");
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
		await chooseOption(
			user,
			within(settings).getByLabelText(/Variant source/, { selector: "button" }),
			"All variants",
		);
		expect(
			controller.state.workspace?.templates.find((t) => t.id === id)?.binding,
		).toEqual({ datasetId: "", fields: {}, variant: { kind: "all" } });
		expect(screen.getByTestId("export-check-unbound")).toBeTruthy();
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
		expect(controller.state.recordId).toBe("r1");
		expect(
			screen
				.getByRole("radio", { name: /^Failed/ })
				.getAttribute("aria-checked"),
		).toBe("true");
		await user.click(screen.getByRole("radio", { name: "Records" }));
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

describe("export settings parity with the CLI", { timeout: 20_000 }, () => {
	const base = (templateId: string, patch: Partial<ExportPreset> = {}) =>
		({
			id: "p_1",
			name: "Print",
			templateId,
			records: "all",
			sides: ["front"],
			format: "pdf",
			scale: 1,
			dpi: 300,
			fileName: "{{name}}-{{side}}",
			markExported: false,
			...patch,
		}) satisfies ExportPreset;

	test("sets the min image DPI, 300 unless set, 0 for no check", async () => {
		const { controller, user, templateId } = setup();
		act(() =>
			controller.dispatch({
				type: "setPreset",
				preset: base(templateId, { format: "png-zip" }),
			}),
		);
		const field = screen.getByRole("spinbutton", { name: "Min image DPI" });
		expect((field as HTMLInputElement).value).toBe("300");
		await user.clear(field);
		await user.type(field, "150{Enter}");
		expect(controller.state.workspace?.presets[0]?.minImageDpi).toBe(150);
		await user.clear(field);
		await user.type(field, "0{Enter}");
		expect(controller.state.workspace?.presets[0]?.minImageDpi).toBe(0);
		expect(screen.getByTestId("export-min-dpi-hint").textContent).toBe(
			"No image resolution check",
		);
	});

	test("takes the whole 0 to 100 quality range", () => {
		const { controller, templateId } = setup();
		act(() =>
			controller.dispatch({
				type: "setPreset",
				preset: base(templateId, { format: "jpeg-zip" }),
			}),
		);
		const slider = screen.getByRole("slider", { name: "Quality" });
		expect(slider.getAttribute("min")).toBe("0");
		expect(slider.getAttribute("max")).toBe("100");
	});

	test("keeps custom paper portrait, swapping a short edge given as height", async () => {
		const { controller, user, templateId } = setup();
		act(() =>
			controller.dispatch({
				type: "setPreset",
				preset: base(templateId, {
					layout: {
						kind: "sheet",
						paper: { widthMm: 100, heightMm: 150 },
						orientation: "auto",
						marginMm: 5,
						gapMm: 0,
						cropMarks: true,
						duplex: "none",
					},
				}),
			}),
		);
		const height = screen.getByRole("spinbutton", { name: "Paper height" });
		await user.clear(height);
		await user.type(height, "60{Enter}");
		const layout = controller.state.workspace?.presets[0]?.layout;
		expect(layout?.kind === "sheet" && layout.paper).toEqual({
			widthMm: 60,
			heightMm: 100,
		});
	});

	test("names the output condition, defaulting to the profile's description", async () => {
		const { controller, user, templateId } = setup();
		act(() =>
			controller.dispatch({ type: "setPreset", preset: base(templateId) }),
		);
		const group = screen.getByTestId("export-output-intent");
		expect(
			within(group).queryByRole("textbox", {
				name: "Output condition identifier",
			}),
		).toBeNull();
		const input = group.querySelector("input[type=file]") as HTMLInputElement;
		const fogra = iccProfile({ description: "Coated FOGRA39" });
		await user.upload(input, new File([fogra as BlobPart], "fogra.icc"));
		const id = await within(group).findByRole("textbox", {
			name: "Output condition identifier",
		});
		expect(id.getAttribute("placeholder")).toBe("Coated FOGRA39");
		await user.type(id, "FOGRA39");
		const intent = () => controller.state.workspace?.presets[0]?.outputIntent;
		expect(intent()).toMatchObject({ kind: "profile", identifier: "FOGRA39" });
		await user.clear(id);
		expect(intent()).not.toHaveProperty("identifier");
	});

	test("says when a print target draws vector pages as PNG", () => {
		const { controller, templateId } = setup();
		act(() =>
			controller.dispatch({
				type: "setPreset",
				preset: base(templateId, { pdfPageImage: "vector" }),
			}),
		);
		expect(screen.queryByTestId("export-check-print_raster")).toBeNull();
		act(() =>
			controller.dispatch({
				type: "setPreset",
				preset: base(templateId, {
					pdfPageImage: "vector",
					print: { enabled: true },
				}),
			}),
		);
		expect(
			screen.getByTestId("export-check-print_raster").textContent,
		).toContain("Print target draws PDF pages as PNG, not vector");
	});

	test("says when spot inks print as plain color", () => {
		const t = doc();
		const front = t.template_data[0];
		if (!front) throw new Error("fixture");
		const spotted: Template = {
			...t,
			template_data: [
				{
					...front,
					elements: front.elements.map((e) =>
						e.id === "a"
							? ({
									...e,
									properties: {
										...e.properties,
										spot: { fill: { spot: "White" } },
									},
								} as Element)
							: e,
					),
				},
				...t.template_data.slice(1),
			],
		};
		const { controller, templateId } = setup(spotted);
		act(() =>
			controller.dispatch({ type: "setPreset", preset: base(templateId) }),
		);
		expect(
			screen.getByTestId("export-check-spot_raster").textContent,
		).toContain("Spot ink White prints as plain color");
		act(() =>
			controller.dispatch({
				type: "setPreset",
				preset: base(templateId, { pdfPageImage: "vector" }),
			}),
		);
		expect(screen.queryByTestId("export-check-spot_raster")).toBeNull();
	});

	test("after a job, Warnings groups render warnings by code and links each record", async () => {
		const { controller, user, fake, templateId } = setup();
		act(() =>
			controller.dispatch({
				type: "setPreset",
				preset: base(templateId, { format: "png-zip" }),
			}),
		);
		expect(screen.queryByTestId("export-check-warnings")).toBeNull();
		await user.click(button("Export 3 files"));
		const low = {
			code: "image_low_dpi",
			message: "Image prints at 120 DPI, under 300: photo",
		};
		const small = {
			code: "small_text",
			message: "Text is 4.2 pt at print size, below 6 pt: name",
		};
		const item = (
			recordId: string,
			warnings: { code: string; message: string }[],
		) => ({
			key: `${recordId}:front`,
			recordId,
			side: "front",
			fileName: recordId,
			ok: true,
			...(warnings.length > 0 ? { warnings } : {}),
		});
		await act(async () => {
			fake.finish({
				cancelled: false,
				ms: 1000,
				items: [item("r1", [low, small]), item("r2", [low]), item("r3", [])],
			});
		});
		const check = screen.getByTestId("export-check-warnings");
		expect(check.textContent).toContain(
			"Warnings in the last export: Low resolution image ×2, Small text ×1",
		);
		const list = screen.getByTestId("export-check-warnings-list");
		expect(
			within(list)
				.getAllByRole("button")
				.map((b) => b.textContent),
		).toEqual(["Ada", "Bo", "Ada"]);
		await user.click(within(list).getAllByRole("button")[1] as HTMLElement);
		expect(controller.state.recordId).toBe("r2");
	});
});
