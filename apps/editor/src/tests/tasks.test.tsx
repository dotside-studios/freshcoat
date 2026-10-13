import { toast } from "@freshcoat-js/ui/toast";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ControllerProvider } from "~/app/context";
import { EditorController } from "~/app/controller";
import { Activity } from "~/app/status/Activity";
import { createTasks, tasksFor, withTask } from "~/app/status/tasks";
import { button, fastUser } from "./aria";
import { doc } from "./doc-fixture";

vi.mock("@freshcoat-js/ui/toast", async (importOriginal) => ({
	...(await importOriginal<object>()),
	toast: vi.fn(),
}));

afterEach(() => {
	cleanup();
	vi.mocked(toast).mockClear();
});

function openController() {
	const controller = new EditorController();
	controller.dispatch({ type: "open", template: doc(), fileName: "doc.coat" });
	return controller;
}

function gate<T = void>() {
	let resolve!: (v: T) => void;
	const promise = new Promise<T>((ok) => {
		resolve = ok;
	});
	return { promise, resolve };
}

describe("withTask", () => {
	test("lists a task while it runs and drops it after", async () => {
		const tasks = createTasks(new EditorController());
		const seen: number[] = [];
		tasks.subscribe(() => seen.push(tasks.getSnapshot().length));
		const hold = gate<string>();
		const run = withTask(tasks, { id: "a", title: "Work" }, (report) => {
			report({ done: 1, total: 4, failed: 1 });
			return hold.promise;
		});
		expect(tasks.getSnapshot()).toEqual([
			{
				id: "a",
				title: "Work",
				cancellable: false,
				progress: { done: 1, total: 4, failed: 1 },
			},
		]);
		hold.resolve("ok");
		expect(await run).toBe("ok");
		expect(tasks.getSnapshot()).toEqual([]);
		expect(seen).toEqual([1, 1, 0]);
	});

	test("a task has no progress until it reports", () => {
		const tasks = createTasks(new EditorController());
		void withTask(tasks, { id: "a", title: "Work" }, () => gate().promise);
		expect(tasks.getSnapshot()[0]?.progress).toBeNull();
	});

	test("cancel aborts the signal of a cancellable task only", async () => {
		const tasks = createTasks(new EditorController());
		const hold = gate();
		let signal!: AbortSignal;
		const run = withTask(
			tasks,
			{ id: "a", title: "Work", cancellable: true },
			(_, s) => {
				signal = s;
				return hold.promise;
			},
		);
		let fixed!: AbortSignal;
		void withTask(tasks, { id: "b", title: "Fixed" }, (_, s) => {
			fixed = s;
			return gate().promise;
		});
		tasks.cancel("b");
		expect(fixed.aborted).toBe(false);
		tasks.cancel("a");
		expect(signal.aborted).toBe(true);
		hold.resolve();
		await run;
		expect(tasks.getSnapshot().map((t) => t.id)).toEqual(["b"]);
	});

	test("a failed run drops the task and rethrows", async () => {
		const tasks = createTasks(new EditorController());
		await expect(
			withTask(tasks, { id: "a", title: "Work" }, async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		expect(tasks.getSnapshot()).toEqual([]);
	});

	test("tasksFor keeps one service per controller", () => {
		const a = new EditorController();
		expect(tasksFor(a)).toBe(tasksFor(a));
		expect(tasksFor(a)).not.toBe(tasksFor(new EditorController()));
	});
});

describe("end toast", () => {
	const options = {
		id: "a",
		title: "Work",
		section: "export" as const,
		onEnd: ({ status }: { status: string }) => ({
			message: `Work ${status}`,
			tone: "success" as const,
		}),
	};

	test("shows when the task's section is not showing", async () => {
		const controller = new EditorController();
		await withTask(tasksFor(controller), options, async () => {});
		expect(toast).toHaveBeenCalledTimes(1);
		expect(toast).toHaveBeenCalledWith("Work done", { tone: "success" });
	});

	test("stays quiet when its section is showing", async () => {
		const controller = openController();
		controller.dispatch({ type: "setSection", section: "export" });
		await withTask(tasksFor(controller), options, async () => {});
		expect(toast).not.toHaveBeenCalled();
	});

	test("stays quiet when the caller gives no toast", async () => {
		const controller = new EditorController();
		await withTask(
			tasksFor(controller),
			{ id: "a", title: "Work" },
			async () => {},
		);
		expect(toast).not.toHaveBeenCalled();
	});

	test("says a canceled run was canceled, with its last report", async () => {
		const controller = new EditorController();
		const onEnd = vi.fn(() => null);
		const tasks = tasksFor(controller);
		await withTask(
			tasks,
			{ id: "a", title: "Work", cancellable: true, onEnd },
			async (report) => {
				report({ done: 2, total: 5 });
				tasks.cancel("a");
			},
		);
		expect(onEnd).toHaveBeenCalledWith({
			status: "canceled",
			report: { done: 2, total: 5 },
		});
	});
});

describe("Activity", () => {
	function setup() {
		const controller = openController();
		const tasks = tasksFor(controller);
		render(
			<ControllerProvider controller={controller}>
				<Activity />
			</ControllerProvider>,
		);
		return { controller, tasks, user: fastUser() };
	}

	test("renders nothing without tasks", () => {
		setup();
		expect(screen.queryByTestId("activity")).toBeNull();
	});

	test("one task shows its title and count, several show a total", async () => {
		const { tasks } = setup();
		await act(async () => {
			void withTask(tasks, { id: "a", title: "First" }, async (report) => {
				report({ done: 1, total: 4 });
				await gate().promise;
			});
		});
		const bar = screen.getByTestId("activity");
		expect(bar.textContent).toContain("First");
		expect(bar.textContent).toContain("1 / 4");
		await act(async () => {
			void withTask(tasks, { id: "b", title: "Second" }, async (report) => {
				report({ done: 2, total: 6 });
				await gate().promise;
			});
		});
		expect(bar.textContent).toContain("2 tasks");
		expect(bar.textContent).toContain("3 / 10");
	});

	test("leaves out a task whose section is showing", async () => {
		const { controller, tasks } = setup();
		await act(async () => {
			void withTask(
				tasks,
				{ id: "a", title: "Export", section: "export" },
				() => gate().promise,
			);
		});
		expect(screen.getByTestId("activity")).toBeTruthy();
		act(() => controller.dispatch({ type: "setSection", section: "export" }));
		expect(screen.queryByTestId("activity")).toBeNull();
	});

	test("lists tasks with Cancel and Show where they apply", async () => {
		const { tasks, user } = setup();
		let aborted = false;
		await act(async () => {
			void withTask(
				tasks,
				{ id: "a", title: "Sectioned", section: "data", cancellable: true },
				(_, signal) =>
					new Promise<void>((resolve) =>
						signal.addEventListener("abort", () => {
							aborted = true;
							resolve();
						}),
					),
			);
			void withTask(tasks, { id: "b", title: "Plain" }, () => gate().promise);
		});
		await user.click(screen.getByTestId("activity"));
		expect(screen.getAllByTestId("activity-task")).toHaveLength(2);
		expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(1);
		expect(screen.getAllByRole("button", { name: "Show" })).toHaveLength(1);
		await user.click(button("Cancel"));
		expect(aborted).toBe(true);
	});

	test("Show opens the task's section", async () => {
		const { controller, tasks, user } = setup();
		await act(async () => {
			void withTask(
				tasks,
				{ id: "a", title: "Sectioned", section: "data" },
				() => gate().promise,
			);
		});
		await user.click(screen.getByTestId("activity"));
		await user.click(button("Show"));
		expect(controller.state.section).toBe("data");
	});
});
