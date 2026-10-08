import { ProgressBar } from "@freshcoat-js/ui/progress";
import { Tooltip, TooltipTrigger } from "@freshcoat-js/ui/tooltip";
import { Button as RACButton } from "react-aria-components";
import { useController } from "~/app/context";
import { formatNumber } from "~/app/format";
import { useEditor } from "~/state/hooks";
import { useExportJobs } from "./export-jobs";

/** The running export job, compact, for the menu bar outside Export.
 *  Pressing it opens Export. */
export function JobIndicator() {
	const controller = useController();
	const section = useEditor((s) => s.section);
	const { snapshot } = useExportJobs();
	const { runner, job } = snapshot;
	if (runner.state !== "running" || section === "export") return null;
	const progress = runner.progress;
	const label = job ? `Exporting ${job.presetName}` : "Exporting";
	return (
		<TooltipTrigger>
			<RACButton
				aria-label={`${label}, open Export`}
				data-testid="job-indicator"
				className="flex h-6 shrink-0 cursor-default items-center gap-2 rounded-[3px] px-1.5 text-fc-muted text-fc-sm outline-none data-focus-visible:outline-solid data-focus-visible:outline-1 data-focus-visible:outline-fc-accent data-hovered:bg-fc-hover"
				onPress={() =>
					controller.dispatch({ type: "setSection", section: "export" })
				}
			>
				<ProgressBar
					aria-label="Export progress"
					className="w-16"
					value={progress?.done ?? 0}
					maxValue={Math.max(1, progress?.total ?? 1)}
					isIndeterminate={!progress}
					tone={progress && progress.failed > 0 ? "danger" : "accent"}
				/>
				<span className="whitespace-nowrap tabular-nums">
					{progress
						? `${formatNumber(progress.done)} / ${formatNumber(progress.total)}`
						: "Starting…"}
				</span>
			</RACButton>
			<Tooltip>{label}</Tooltip>
		</TooltipTrigger>
	);
}
