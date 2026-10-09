import { Button } from "@freshcoat-js/ui/button";
import { IconButton } from "@freshcoat-js/ui/icon-button";
import { cn } from "@freshcoat-js/ui/lib/cn";
import { Popover } from "@freshcoat-js/ui/popover";
import { ProgressBar } from "@freshcoat-js/ui/progress";
import { Tooltip, TooltipTrigger } from "@freshcoat-js/ui/tooltip";
import type { ExportPreset } from "@freshcoat-js/workspace";
import {
	printFallbacks,
	REPORT_FILE_NAME,
	reportCsv,
} from "@freshcoat-js/workspace/export";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { DialogTrigger, Dialog as RACDialog } from "react-aria-components";
import { plural } from "~/app/copy";
import { formatBytes, formatNumber } from "~/app/format";
import { useConfirm } from "~/data/ConfirmDialog";
import CheckIcon from "~icons/mingcute/check-circle-line";
import CloseIcon from "~icons/mingcute/close-line";
import DownloadIcon from "~icons/mingcute/download-2-line";
import ReportIcon from "~icons/mingcute/file-line";
import FailedIcon from "~icons/mingcute/filter-line";
import HistoryIcon from "~icons/mingcute/history-line";
import RetryIcon from "~icons/mingcute/refresh-2-line";
import ExportIconFill from "~icons/mingcute/upload-2-fill";
import ExportIcon from "~icons/mingcute/upload-2-line";
import WarningIcon from "~icons/mingcute/warning-line";
import type { ExportJobs, ExportJobsSnapshot } from "./export-jobs";
import {
	DESTINATION_LABEL,
	formatDuration,
	formatEta,
	formatRate,
	formatTime,
	retryPreset,
} from "./export-ui";

const HISTORY_STATE = { cancelled: "Canceled", error: "Failed" } as const;

/*
 * The bar is one line at every width, so it is a size container and gives up
 * detail as it narrows, least useful first: items per second below 72rem
 * (a 1024px tablet), the action labels (their icons stay, with the label as
 * a tooltip), then bytes written and the destination below 56rem (820px).
 */
const HIDE_BELOW_TABLET = "@max-[72rem]:hidden";
const HIDE_BELOW_NARROW = "@max-[56rem]:hidden";

/** A figure in the bar: the value, then what it counts. */
function Stat({
	value,
	label,
	tone,
	testId,
	className,
}: {
	value: ReactNode;
	label?: ReactNode;
	tone?: "danger";
	testId?: string;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"inline-flex shrink-0 items-baseline gap-1 whitespace-nowrap text-fc-sm tabular-nums",
				className,
			)}
			data-testid={testId}
		>
			<span
				className={cn(
					"font-medium",
					tone === "danger" ? "text-fc-danger-text" : "text-fc-text",
				)}
			>
				{value}
			</span>
			{label ? <span className="text-fc-muted">{label}</span> : null}
		</span>
	);
}

/** A labelled button that folds to its icon, with the label as a tooltip,
 *  when the bar is narrower than a desktop window. */
function BarAction({
	icon,
	label,
	onPress,
}: {
	icon: ReactNode;
	label: string;
	onPress: () => void;
}) {
	return (
		<TooltipTrigger>
			<Button aria-label={label} onPress={onPress}>
				{icon}
				<span className={HIDE_BELOW_TABLET}>{label}</span>
			</Button>
			<Tooltip>{label}</Tooltip>
		</TooltipTrigger>
	);
}

function Divider({ className }: { className?: string }) {
	return (
		<span
			aria-hidden
			className={cn("h-3.5 w-px shrink-0 bg-fc-border-strong", className)}
		/>
	);
}

/** Items per second over the running job, from its first progress event. */
function useRate(done: number | undefined, running: boolean): number | null {
	const first = useRef<{ at: number; done: number } | null>(null);
	const [rate, setRate] = useState<number | null>(null);
	useEffect(() => {
		if (!running) {
			first.current = null;
			setRate(null);
			return;
		}
		if (done === undefined) return;
		const now = performance.now();
		if (!first.current) {
			first.current = { at: now, done };
			return;
		}
		const seconds = (now - first.current.at) / 1000;
		if (seconds > 0.25) setRate((done - first.current.done) / seconds);
	}, [done, running]);
	return rate;
}

export function JobBar({
	jobs,
	snapshot,
	preset,
	count,
	blocked,
	blockedDetail,
	warning,
	onShowFailed,
	recordIds,
	hideRun,
	onDismiss,
}: {
	jobs: ExportJobs;
	snapshot: ExportJobsSnapshot;
	preset: ExportPreset | undefined;
	/** files the active preset plans */
	count: number;
	/** why the active preset cannot run, if it cannot */
	blocked: string | null;
	/** the whole of a `blocked` reason that is a short form, for its hover */
	blockedDetail?: string;
	/** what the export will miss though it can run */
	warning?: string | null;
	/** narrows the section to the records the last job failed */
	onShowFailed?: () => void;
	/** chosen records: the button exports only these, and says so */
	recordIds?: readonly string[];
	/** a bar that only reports jobs started elsewhere */
	hideRun?: boolean;
	/** puts the bar away until the next job */
	onDismiss?: () => void;
}) {
	const { runner, job, lastPreset, lastResult, unwritten, history } = snapshot;
	const running = runner.state === "running";
	const progress = runner.progress;
	const rate = useRate(progress?.done, running);
	const failedItems = lastResult?.items.filter((i) => !i.ok).length ?? 0;
	const okItems = lastResult ? lastResult.items.length - failedItems : 0;
	// A print fallback wrote a plain file: a warning, not a failure.
	const warnedItems = lastResult ? printFallbacks(lastResult.items) : 0;
	const reason =
		running || hideRun ? null : preset ? blocked : "Choose a preset";
	const chosen = recordIds && recordIds.length > 0 ? recordIds : undefined;
	const { confirm, element: confirmElement } = useConfirm();
	const confirmLargePdf = async (estimate: number) =>
		(await confirm({
			title: `Large PDF (about ${formatBytes(estimate)})`,
			message: "Zips are lighter on memory",
			confirmLabel: "Export PDF",
		})) === "confirm";
	const sink = lastResult?.sink;
	const shownPreset = running ? preset : lastPreset;
	const destination =
		shownPreset?.format === "pdf"
			? "PDF"
			: DESTINATION_LABEL[shownPreset?.destination ?? "download"];
	const written = sink?.bytes ?? lastResult?.file?.blob.size ?? 0;
	const downloadReport = () => {
		if (!lastResult) return;
		jobs.download({
			blob: new Blob([reportCsv(lastResult.items)], { type: "text/csv" }),
			name: REPORT_FILE_NAME,
			mediaType: "text/csv",
		});
	};

	return (
		<div
			className="@container flex min-h-11 shrink-0 items-center gap-3 border-fc-border border-t bg-fc-panel px-3 py-1.5"
			data-testid="export-job"
			data-state={runner.state}
		>
			{hideRun ? null : (
				<Button
					variant="primary"
					isDisabled={running || !preset || count === 0 || !!blocked}
					onPress={() => {
						if (preset)
							void jobs.run(preset, undefined, {
								confirmLargePdf,
								...(chosen ? { recordIds: chosen } : {}),
							});
					}}
				>
					<ExportIconFill />
					{!preset
						? "Export"
						: chosen
							? `Export ${formatNumber(chosen.length)} selected`
							: `Export ${plural(count, "file")}`}
				</Button>
			)}
			{reason && !running ? (
				<span
					className="inline-flex min-w-0 items-center gap-1 text-fc-sm text-fc-warning"
					title={(reason === blocked && blockedDetail) || reason}
					data-testid="export-blocked"
				>
					<WarningIcon className="size-3.5 shrink-0" />
					<span className="truncate">{reason}</span>
				</span>
			) : warning && !running && !hideRun ? (
				<span
					className="inline-flex min-w-0 items-center gap-1 text-fc-sm text-fc-warning"
					title={warning}
					data-testid="export-warning"
				>
					<WarningIcon className="size-3.5 shrink-0" />
					<span className="truncate">{warning}</span>
				</span>
			) : null}

			<div
				className="flex min-w-0 flex-1 items-center gap-3"
				aria-live="polite"
			>
				{running ? (
					<>
						<ProgressBar
							aria-label="Export progress"
							className="min-w-28 max-w-80 flex-1"
							value={progress?.assembling?.done ?? progress?.done ?? 0}
							maxValue={Math.max(
								1,
								progress?.assembling?.total ?? progress?.total ?? 1,
							)}
							isIndeterminate={!progress}
							tone={progress && progress.failed > 0 ? "danger" : "accent"}
						/>
						{progress ? (
							<>
								<Stat
									testId="export-progress"
									value={`${progress.done} / ${progress.total}`}
								/>
								{progress.failed > 0 ? (
									<Stat value={progress.failed} label="failed" tone="danger" />
								) : null}
								{progress.assembling ? (
									<Stat
										testId="export-assembling"
										value={`${progress.assembling.done} / ${progress.assembling.total}`}
										label="assembling PDF"
									/>
								) : null}
								<Divider />
								{rate !== null ? (
									<Stat
										testId="export-rate"
										value={formatRate(rate)}
										label="files/s"
										className={HIDE_BELOW_TABLET}
									/>
								) : null}
								{formatEta(progress.etaMs) ? (
									<Stat
										testId="export-eta"
										value={formatEta(progress.etaMs).replace(/ left$/, "")}
										label="left"
									/>
								) : null}
								{progress.bytes ? (
									<Stat
										testId="export-bytes"
										value={formatBytes(progress.bytes)}
										label="written"
										className={HIDE_BELOW_NARROW}
									/>
								) : null}
								<span
									className={cn(
										"inline-flex shrink-0 items-baseline gap-1 whitespace-nowrap text-fc-sm",
										HIDE_BELOW_NARROW,
									)}
								>
									<span className="text-fc-muted">to</span>
									<span className="font-medium text-fc-text">
										{destination}
									</span>
								</span>
							</>
						) : (
							<span
								className="text-fc-muted text-fc-sm"
								data-testid="export-progress"
							>
								{`Starting ${job?.presetName ?? ""}…`}
							</span>
						)}
						<Button onPress={() => jobs.cancel()}>Cancel</Button>
					</>
				) : runner.state === "done" && lastResult ? (
					<>
						<span
							className="inline-flex min-w-0 items-center gap-1.5 text-fc-sm tabular-nums"
							data-testid="export-summary"
						>
							{failedItems > 0 || warnedItems > 0 ? (
								<WarningIcon className="size-3.5 shrink-0 text-fc-warning" />
							) : (
								<CheckIcon className="size-3.5 shrink-0 text-fc-success" />
							)}
							{job?.presetName ? (
								<span
									className="min-w-0 truncate text-fc-muted"
									title={job.presetName}
								>
									{`${job.presetName} · `}
								</span>
							) : null}
							{job?.scope ? (
								<span className="shrink-0 whitespace-nowrap text-fc-muted">
									{`${job.scope} · `}
								</span>
							) : null}
							<span className="shrink-0 whitespace-pre text-fc-muted">
								{[
									`${okItems} ok`,
									warnedItems > 0 ? plural(warnedItems, "warning") : "",
									failedItems > 0 ? `${failedItems} failed` : "",
									formatDuration(lastResult.ms),
								]
									.filter(Boolean)
									.join(" · ")}
							</span>
						</span>
						<Divider className={HIDE_BELOW_NARROW} />
						{lastResult.ms > 0 && lastResult.items.length > 1 ? (
							<Stat
								value={formatRate(
									(lastResult.items.length / lastResult.ms) * 1000,
								)}
								label="files/s"
								className={HIDE_BELOW_TABLET}
							/>
						) : null}
						{written > 0 ? (
							<Stat
								value={formatBytes(written)}
								label="written"
								className={HIDE_BELOW_NARROW}
							/>
						) : null}
						{sink?.kind === "folder" ? (
							<Stat value={plural(sink.files, "file")} label="in the folder" />
						) : sink?.parts && sink.parts > 1 ? (
							<Stat value={sink.parts} label="parts" />
						) : null}
						<span className="ml-auto flex shrink-0 items-center gap-1.5">
							{failedItems > 0 && onShowFailed ? (
								<BarAction
									icon={<FailedIcon />}
									label="Show failed"
									onPress={onShowFailed}
								/>
							) : null}
							{failedItems > 0 && lastPreset ? (
								<BarAction
									icon={<RetryIcon />}
									label="Retry failed"
									onPress={() =>
										void jobs.run(
											retryPreset(lastPreset, lastResult),
											`${lastPreset.name} (retry)`,
										)
									}
								/>
							) : null}
							<BarAction
								icon={<ReportIcon />}
								label="Report"
								onPress={downloadReport}
							/>
						</span>
					</>
				) : runner.state === "cancelled" ? (
					<>
						<span
							className="min-w-0 truncate text-fc-muted text-fc-sm tabular-nums"
							data-testid="export-summary"
						>
							{`Canceled${progress ? ` after ${progress.done} of ${progress.total}` : ""}${
								sink?.kind === "folder"
									? ` · ${plural(sink.files, "file")} kept in the folder`
									: ""
							}`}
						</span>
						{lastPreset && lastResult && unwritten.length > 0 ? (
							<span className="ml-auto flex shrink-0 items-center gap-1.5">
								<BarAction
									icon={<ExportIcon />}
									label="Export the rest"
									onPress={() =>
										void jobs.run(lastPreset, `${lastPreset.name} (rest)`, {
											recordIds: unwritten,
										})
									}
								/>
							</span>
						) : null}
					</>
				) : runner.state === "error" ? (
					<>
						<span
							className="min-w-0 truncate text-fc-danger-text text-fc-sm"
							data-testid="export-summary"
							title={runner.error ?? undefined}
						>
							{`Couldn't export: ${runner.error ?? "unknown error"}`}
						</span>
						{lastPreset ? (
							<span className="ml-auto flex shrink-0 items-center gap-1.5">
								<BarAction
									icon={<RetryIcon />}
									label="Retry"
									onPress={() => void jobs.run(lastPreset, job?.presetName)}
								/>
							</span>
						) : null}
					</>
				) : null}
			</div>

			{!running && lastResult?.file ? (
				<Button
					aria-label={`Download ${lastResult.file.name}`}
					onPress={() => lastResult.file && jobs.download(lastResult.file)}
					className="min-w-0 max-w-64 shrink @max-[56rem]:max-w-40"
				>
					<DownloadIcon />
					<span className="min-w-0 truncate">{lastResult.file.name}</span>
				</Button>
			) : null}
			<DialogTrigger>
				<IconButton
					aria-label="Job history"
					tooltip="Job history"
					isDisabled={history.length === 0}
				>
					<HistoryIcon />
				</IconButton>
				<Popover placement="top end" className="w-80 max-w-[calc(100vw-24px)]">
					<RACDialog aria-label="Job history" className="p-1 outline-none">
						<ul className="m-0 flex list-none flex-col p-0">
							{history.map((entry) => (
								<li
									key={entry.id}
									className="flex items-center gap-2 rounded-[3px] px-2 py-1.5 hover:bg-fc-raised"
									data-testid="export-history-entry"
								>
									<div className="min-w-0 flex-1">
										<div className="truncate text-fc-base text-fc-text">
											{entry.presetName}
										</div>
										<div className="truncate text-fc-faint text-fc-sm tabular-nums">
											{[
												formatTime(entry.startedAt),
												entry.scope,
												entry.state === "done"
													? `${entry.ok} ok${entry.failed ? ` · ${entry.failed} failed` : ""}`
													: HISTORY_STATE[entry.state],
												formatDuration(entry.ms),
											]
												.filter(Boolean)
												.join(" · ")}
										</div>
									</div>
									{entry.file ? (
										<IconButton
											aria-label={`Download ${entry.file.name}`}
											tooltip={entry.file.name}
											onPress={() => entry.file && jobs.download(entry.file)}
										>
											<DownloadIcon />
										</IconButton>
									) : null}
								</li>
							))}
						</ul>
					</RACDialog>
				</Popover>
			</DialogTrigger>
			{onDismiss && !running ? (
				<IconButton aria-label="Close" tooltip="Close" onPress={onDismiss}>
					<CloseIcon />
				</IconButton>
			) : null}
			{confirmElement}
		</div>
	);
}
