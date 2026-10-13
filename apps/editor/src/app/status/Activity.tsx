import { Button } from "@freshcoat-js/ui/button";
import { Dialog } from "@freshcoat-js/ui/dialog";
import { DialogTrigger, Popover } from "@freshcoat-js/ui/popover";
import { ProgressBar } from "@freshcoat-js/ui/progress";
import { useState } from "react";
import { Button as RACButton } from "react-aria-components";
import { useController } from "~/app/context";
import { plural } from "~/app/copy";
import { formatNumber } from "~/app/format";
import { useEditor } from "~/state/hooks";
import { STATUS_PRIORITY } from "./priority";
import { type TaskSnapshot, tasksFor, useTasks } from "./tasks";
import type { StatusItem } from "./types";

/** The rows tests and e2e find by an id, by task id. */
const ROW_TEST_IDS: Record<string, string> = {
	export: "job-indicator",
	"photo-import": "photo-import-progress",
};

type Progress = NonNullable<TaskSnapshot["progress"]>;

/** The progress of several tasks as one; null while none has reported. */
function combined(tasks: readonly TaskSnapshot[]): Progress | null {
	const reported = tasks.flatMap((t) => (t.progress ? [t.progress] : []));
	if (reported.length === 0) return null;
	return {
		done: reported.reduce((n, p) => n + p.done, 0),
		total: reported.reduce((n, p) => n + p.total, 0),
		failed: reported.reduce((n, p) => n + p.failed, 0),
	};
}

function progressText(progress: Progress | null): string {
	return progress
		? `${formatNumber(progress.done)} / ${formatNumber(progress.total)}`
		: "Starting…";
}

function Bar({
	label,
	progress,
	className,
}: {
	label: string;
	progress: Progress | null;
	className: string;
}) {
	return (
		<ProgressBar
			aria-label={label}
			className={className}
			value={progress?.done ?? 0}
			maxValue={Math.max(1, progress?.total ?? 1)}
			isIndeterminate={!progress}
			tone={progress && progress.failed > 0 ? "danger" : "accent"}
		/>
	);
}

/**
 * The running tasks, compact, for the status bar. A task whose section is
 * showing is left out, since that section shows it in full. Pressing it
 * lists the tasks, each with Cancel and Show where they apply.
 */
export function Activity() {
	const section = useEditor((s) => s.section);
	const [open, setOpen] = useState(false);
	const visible = useTasks().filter((t) => t.section !== section);
	const [first] = visible;
	if (!first) return null;
	const single = visible.length === 1 ? first : null;
	const progress = single ? single.progress : combined(visible);
	const title = single ? single.title : plural(visible.length, "task");
	return (
		<DialogTrigger isOpen={open} onOpenChange={setOpen}>
			<RACButton
				aria-label={`${title}, show activity`}
				data-testid="activity"
				className="flex h-6 shrink-0 cursor-default items-center gap-2 rounded-[3px] px-1.5 pointer-coarse:h-8 text-fc-muted text-fc-sm outline-none data-focus-visible:outline-solid data-focus-visible:outline-1 data-focus-visible:outline-fc-accent data-hovered:bg-fc-hover"
			>
				<span className="max-w-40 truncate @max-[48rem]:hidden">{title}</span>
				<Bar label={title} progress={progress} className="w-16" />
				<span className="whitespace-nowrap tabular-nums">
					{progressText(progress)}
				</span>
			</RACButton>
			<Popover
				placement="top end"
				className="flex w-72 max-w-[calc(100vw-1rem)] flex-col"
			>
				<Dialog data-testid="activity-popover" title="Activity">
					<ul className="m-0 flex list-none flex-col gap-2 p-0">
						{visible.map((task) => (
							<TaskRow
								key={task.id}
								task={task}
								onShow={() => setOpen(false)}
							/>
						))}
					</ul>
				</Dialog>
			</Popover>
		</DialogTrigger>
	);
}

function TaskRow({ task, onShow }: { task: TaskSnapshot; onShow: () => void }) {
	const controller = useController();
	const { section } = task;
	return (
		<li
			data-testid={ROW_TEST_IDS[task.id] ?? "activity-task"}
			className="flex flex-col gap-1.5 rounded-[3px] bg-fc-raised/60 p-1.5"
		>
			<div className="flex items-baseline gap-2 text-fc-sm">
				<span className="min-w-0 flex-1 truncate text-fc-text">
					{task.title}
				</span>
				<span className="shrink-0 text-fc-muted tabular-nums">
					{progressText(task.progress)}
				</span>
			</div>
			<Bar label={task.title} progress={task.progress} className="w-full" />
			{task.cancellable || section ? (
				<div className="flex gap-1.5">
					{section ? (
						<Button
							size="sm"
							onPress={() => {
								controller.dispatch({ type: "setSection", section });
								onShow();
							}}
						>
							Show
						</Button>
					) : null}
					{task.cancellable ? (
						<Button
							size="sm"
							onPress={() => tasksFor(controller).cancel(task.id)}
						>
							Cancel
						</Button>
					) : null}
				</div>
			) : null}
		</li>
	);
}

export const ACTIVITY_ITEM: StatusItem = {
	id: "activity",
	name: "Activity",
	sections: "all",
	align: "end",
	priority: STATUS_PRIORITY.activity,
	component: Activity,
};
