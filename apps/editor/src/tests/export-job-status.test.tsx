import { toast } from "@freshcoat-js/ui/toast";
import type { Dataset, ExportPreset } from "@freshcoat-js/workspace";
import type { JobFile, JobResult } from "@freshcoat-js/workspace/export";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
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

vi.mock("@freshcoat-js/ui/toast", () => ({ toast: vi.fn() }));

afterEach(() => {
	cleanup();
	vi.mocked(toast).mockClear();
});

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
	let finish:
		| ((r: JobResult | null, state?: ExportRunnerSnapshot["state"]) => void)
		| null = null;
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
				finish = (r, state = "error") => {
					set(
						r
							? { state: r.cancelled ? "cancelled" : "done", result: r }
							: state === "error"
								? { state, error: "boom" }
								: { state },
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
	return {
		runner,
		started,
		finish: (r: JobResult | null, state?: ExportRunnerSnapshot["state"]) =>
			finish?.(r, state),
	};
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

describe("finished job toast", () => {
	const items = [
		{ key: "r1:front", recordId: "r1", side: "front", fileName: "a", ok: true },
		{
			key: "r2:front",
			recordId: "r2",
			side: "front",
			fileName: "b",
			ok: false,
		},
		{ key: "r3:front", recordId: "r3", side: "front", fileName: "c", ok: true },
	];

	test("outside Export, reports the result and retries the failures", async () => {
		const { preset, jobs, fake } = setup();
		const run = jobs.run(preset);
		await waitFor(() => expect(fake.started).toHaveLength(1));
		await act(async () => {
			fake.finish({ items, cancelled: false, ms: 1 });
			await run;
		});
		expect(toast).toHaveBeenCalledTimes(1);
		const [message, options] = vi.mocked(toast).mock.calls[0] ?? [];
		expect(message).toBe("All: 2 files exported, 1 failed");
		expect(options?.tone).toBe("warning");
		expect(options?.action?.label).toBe("Retry failed");
		act(() => options?.action?.onAction());
		await waitFor(() => expect(fake.started).toHaveLength(2));
		expect(fake.started[1]).toMatchObject({
			records: "selected",
			selected: ["r2"],
		});
		expect(jobs.getSnapshot().job?.presetName).toBe("All (retry)");
	});

	test("reports a job that failed to run", async () => {
		const { preset, jobs, fake } = setup();
		const run = jobs.run(preset);
		await waitFor(() => expect(fake.started).toHaveLength(1));
		await act(async () => {
			fake.finish(null);
			await run;
		});
		expect(vi.mocked(toast).mock.calls[0]).toEqual([
			"Couldn't export All: boom",
			{ tone: "danger" },
		]);
	});

	test("stays quiet for a job canceled before it ran", async () => {
		const { preset, jobs, fake } = setup();
		const run = jobs.run(preset);
		await waitFor(() => expect(fake.started).toHaveLength(1));
		await act(async () => {
			fake.finish(null, "cancelled");
			await run;
		});
		expect(toast).not.toHaveBeenCalled();
	});

	test("stays quiet in Export", async () => {
		const { controller, preset, jobs, fake } = setup();
		controller.dispatch({ type: "setSection", section: "export" });
		const run = jobs.run(preset);
		await waitFor(() => expect(fake.started).toHaveLength(1));
		await act(async () => {
			fake.finish({ items, cancelled: false, ms: 1 });
			await run;
		});
		expect(toast).not.toHaveBeenCalled();
	});
});
