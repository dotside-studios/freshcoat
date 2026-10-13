import { type ToastOptions, toast } from "@freshcoat-js/ui/toast";
import { useSyncExternalStore } from "react";
import { useController } from "~/app/context";
import type { EditorController } from "~/app/controller";
import { createExternalStore } from "~/state/external-store";
import type { Section } from "~/state/workspace";

export type TaskOptions = {
	id: string;
	/** "Reading photos", "Exporting Badges" */
	title: string;
	/** the section with the task's detailed view, if any */
	section?: Section;
	cancellable?: boolean;
	/** What to toast when the task ends, if anything. It is shown only when
	 *  the task's `section` is not showing. A caller that toasts its own
	 *  result leaves this out. */
	onEnd?: (end: TaskEnd) => TaskToast | null | undefined;
};

export type TaskReport = { done: number; total: number; failed?: number };

export type TaskEnd = {
	status: "done" | "canceled" | "failed";
	/** the last report, if the task made one */
	report: TaskReport | null;
};

export type TaskToast = ToastOptions & { message: string };

export type TaskSnapshot = {
	id: string;
	title: string;
	section?: Section;
	cancellable: boolean;
	/** null until the task first reports */
	progress: { done: number; total: number; failed: number } | null;
};

type TaskRun = {
	report(r: TaskReport): void;
	signal: AbortSignal;
	end(status: TaskEnd["status"]): void;
};

export type Tasks = {
	getSnapshot(): readonly TaskSnapshot[];
	subscribe(listener: () => void): () => void;
	/** Aborts the signal of a cancellable task; the task decides how it ends. */
	cancel(id: string): void;
	/** Lower level than `withTask`, which is what features call. */
	start(options: TaskOptions): TaskRun;
};

/** The tasks of one editor session. */
export function createTasks(
	controller: Pick<EditorController, "state">,
): Tasks {
	const store = createExternalStore<readonly TaskSnapshot[]>([]);
	const aborters = new Map<string, AbortController>();

	return {
		getSnapshot: store.get,
		subscribe: store.subscribe,
		cancel(id) {
			if (store.get().find((t) => t.id === id)?.cancellable)
				aborters.get(id)?.abort();
		},
		start(options) {
			const { id } = options;
			const aborter = new AbortController();
			aborters.set(id, aborter);
			let last: TaskReport | null = null;
			const entry: TaskSnapshot = {
				id,
				title: options.title,
				...(options.section ? { section: options.section } : {}),
				cancellable: !!options.cancellable,
				progress: null,
			};
			store.set((tasks) => [...tasks.filter((t) => t.id !== id), entry]);
			return {
				signal: aborter.signal,
				report(r) {
					if (aborters.get(id) !== aborter) return;
					last = r;
					const progress = {
						done: r.done,
						total: r.total,
						failed: r.failed ?? 0,
					};
					store.set((tasks) =>
						tasks.map((t) => (t.id === id ? { ...t, progress } : t)),
					);
				},
				end(status) {
					// A task that took over the id keeps its entry.
					if (aborters.get(id) === aborter) {
						aborters.delete(id);
						store.set((tasks) => tasks.filter((t) => t.id !== id));
					}
					const shown = options.onEnd?.({ status, report: last });
					if (shown && controller.state.section !== options.section) {
						const { message, ...rest } = shown;
						toast(message, rest);
					}
				},
			};
		},
	};
}

/**
 * Runs long work as a task the shell shows, from any section. `run` reports
 * progress and watches the signal, which aborts when the task is canceled; a
 * canceled run still decides what it resolves with.
 */
export async function withTask<T>(
	tasks: Tasks,
	options: TaskOptions,
	run: (report: (r: TaskReport) => void, signal: AbortSignal) => Promise<T>,
): Promise<T> {
	const task = tasks.start(options);
	try {
		const result = await run(task.report, task.signal);
		task.end(task.signal.aborted ? "canceled" : "done");
		return result;
	} catch (e) {
		task.end(task.signal.aborted ? "canceled" : "failed");
		throw e;
	}
}

const sessions = new WeakMap<object, Tasks>();

/** The tasks beside a controller, made on first use. */
export function tasksFor(controller: Pick<EditorController, "state">): Tasks {
	let tasks = sessions.get(controller);
	if (!tasks) {
		tasks = createTasks(controller);
		sessions.set(controller, tasks);
	}
	return tasks;
}

/** Every running task, in the order they started. */
export function useTasks(): readonly TaskSnapshot[] {
	const tasks = tasksFor(useController());
	return useSyncExternalStore(
		tasks.subscribe,
		tasks.getSnapshot,
		tasks.getSnapshot,
	);
}
