import type { Dataset, ExportPreset } from "@freshcoat-js/workspace";
import type { JobFile, JobResult } from "@freshcoat-js/workspace/export";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { exportJobsFor } from "~/export/export-jobs";
import { JobIndicator } from "~/export/JobIndicator";
import type {
	ExportRunner,
	ExportRunnerSnapshot,
} from "~/export/use-export-runner";
import { button, fastUser } from "./aria";
import { doc } from "./doc-fixture";

afterEach(cleanup);

const people: Dataset = {
	id: "d_people",
	name: "People",
	columns: [{ key: "name", type: "text" }],
	records: ["Ada", "Bo", "Cy"].map((name, i) => ({
		id: `r${i + 1}`,
		status: "pending" as const,
		values: { name },
	})),
	assets: [],
};

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
	let finish: ((r: JobResult | null) => void) | null = null;
	const started: ExportPreset[] = [];
	const runner: ExportRunner = {
		getSnapshot: () => snapshot,
		subscribe(l) {
			listeners.add(l);
			return () => listeners.delete(l);
		},
		start(_workspace, preset) {
			started.push(preset);
			set({
				state: "running",
				progress: { done: 1, failed: 0, total: 3, etaMs: 2000 },
			});
			return new Promise((resolve) => {
				finish = (r) => {
					set(
						r
							? { state: r.cancelled ? "cancelled" : "done", result: r }
							: { state: "error", error: "boom" },
					);
					resolve(r);
				};
			});
		},
		cancel() {
			finish?.({ items: [], cancelled: true, ms: 5 });
		},
		dispose() {},
	};
	return { runner, started, finish: (r: JobResult | null) => finish?.(r) };
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
			fields: { name: { kind: "column", column: "name" } },
		},
	});
	const preset: ExportPreset = {
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
	};
	controller.dispatch({ type: "setPreset", preset });
	const fake = fakeRunner();
	const downloads: JobFile[] = [];
	const jobs = exportJobsFor(controller, {
		runner: fake.runner,
		download: (f) => downloads.push(f),
	});
	return { controller, preset, fake, jobs, downloads, user: fastUser() };
}

describe("job indicator", () => {
	test("shows a running job outside Export and opens Export", async () => {
		const { controller, preset, jobs, fake, user } = setup();
		render(
			<ControllerProvider controller={controller}>
				<JobIndicator />
			</ControllerProvider>,
		);
		expect(screen.queryByTestId("job-indicator")).toBeNull();
		await act(async () => {
			void jobs.run(preset);
		});
		const indicator = await screen.findByTestId("job-indicator");
		expect(indicator.textContent).toContain("1 / 3");
		await user.click(button(/Exporting All/));
		expect(controller.state.section).toBe("export");
		expect(screen.queryByTestId("job-indicator")).toBeNull();
		act(() => fake.finish({ items: [], cancelled: false, ms: 1 }));
	});
});
