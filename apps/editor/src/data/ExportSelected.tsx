import { validate } from "@freshcoat-js/coatfile";
import { Button } from "@freshcoat-js/ui/button";
import { DialogTrigger, Popover } from "@freshcoat-js/ui/popover";
import { Select, SelectItem } from "@freshcoat-js/ui/select";
import { planExport } from "@freshcoat-js/workspace";
import { withRecordIds } from "@freshcoat-js/workspace/export";
import { useEffect, useMemo, useState } from "react";
import { Dialog as RACDialog } from "react-aria-components";
import { useController } from "~/app/context";
import { EMPTY, plural } from "~/app/copy";
import { formatNumber } from "~/app/format";
import { useExportJobs } from "~/export/export-jobs";
import {
	DESTINATION_LABEL,
	FORMAT_LABEL,
	presetsForDataset,
} from "~/export/export-ui";
import { JobBar } from "~/export/JobBar";
import { useEditor } from "~/state/hooks";
import { workspaceSnapshot } from "~/state/workspace";
import ExportIconFill from "~icons/mingcute/upload-2-fill";
import ExportIcon from "~icons/mingcute/upload-2-line";
import { ToolButton } from "./DataToolbar";
import { registerExportSelected } from "./export-selected";

/**
 * "Export selected" in the Data toolbar: a popover that picks a preset, the
 * active one by default, and runs it over the selected records. The job
 * shows in Data's job bar and the section stays Data. Mod+E opens it.
 */
export function ExportSelected({
	datasetId,
	ids,
}: {
	datasetId: string;
	/** the selected records, in dataset order */
	ids: readonly string[];
}) {
	const controller = useController();
	const jobs = useExportJobs();
	const templates = useEditor((s) => s.workspace?.templates);
	const presets = useEditor((s) => s.workspace?.presets);
	const activeId = useEditor((s) => s.workspace?.activePresetId ?? null);
	const [open, setOpen] = useState(false);
	const [chosenId, setChosenId] = useState<string | null>(null);

	useEffect(() => registerExportSelected(() => setOpen(true)), []);

	const eligible = useMemo(
		() => presetsForDataset(templates ?? [], presets ?? [], datasetId),
		[templates, presets, datasetId],
	);
	const preset =
		eligible.find((p) => p.id === chosenId) ??
		eligible.find((p) => p.id === activeId) ??
		eligible[0];

	// Counted when the popover is open, against the workspace as it stands.
	const check = useMemo(() => {
		if (!open || !preset) return null;
		const workspace = workspaceSnapshot(controller.state);
		const entry = workspace?.templates.find((t) => t.id === preset.templateId);
		if (!workspace || !entry) return null;
		const result = validate(entry.template);
		const files = planExport(workspace, withRecordIds(preset, ids)).length;
		return { files, issues: result.ok ? 0 : result.errors.length };
	}, [open, preset, ids, controller]);

	const running = jobs.snapshot.runner.state === "running";
	const reason = running
		? "An export is running"
		: check && check.issues > 0
			? `Template has ${plural(check.issues, "issue")}`
			: check?.files === 0
				? "Nothing to export"
				: null;

	const run = () => {
		if (!preset) return;
		setOpen(false);
		void jobs.run(preset, undefined, { recordIds: ids });
	};

	return (
		<DialogTrigger isOpen={open} onOpenChange={setOpen}>
			<ToolButton
				icon={<ExportIcon />}
				label="Export selected"
				testId="export-selected"
				showLabel="wider"
			/>
			<Popover
				placement="bottom start"
				className="w-72 max-w-[calc(100vw-24px)]"
			>
				<RACDialog
					aria-label="Export selected"
					className="flex flex-col gap-2.5 p-3 outline-none"
					data-testid="export-selected-popover"
				>
					<h3 className="m-0 font-semibold text-fc-base text-fc-text">
						{`Export ${formatNumber(ids.length)} selected`}
					</h3>
					{preset ? (
						<>
							<Select
								label="Preset"
								labelPosition="side"
								value={preset.id}
								onChange={(key) => setChosenId(String(key))}
							>
								{eligible.map((p) => (
									<SelectItem key={p.id} id={p.id} textValue={p.name}>
										{p.name}
									</SelectItem>
								))}
							</Select>
							<p
								className="m-0 text-fc-muted text-fc-sm tabular-nums"
								data-testid="export-selected-summary"
							>
								{[
									check ? plural(check.files, "file") : null,
									FORMAT_LABEL[preset.format],
									preset.format === "pdf"
										? null
										: DESTINATION_LABEL[preset.destination ?? "download"],
								]
									.filter(Boolean)
									.join(" · ")}
							</p>
							{reason ? (
								<p className="m-0 text-fc-sm text-fc-warning">{reason}</p>
							) : null}
							<Button
								variant="primary"
								autoFocus
								isDisabled={!!reason}
								onPress={run}
								className="self-end"
							>
								<ExportIconFill />
								Export
							</Button>
						</>
					) : (
						<div className="flex flex-col gap-1">
							<p className="m-0 font-medium text-fc-text">{EMPTY.presets}</p>
							<p className="m-0 text-fc-muted text-fc-sm">
								Bind a template to this dataset in Export
							</p>
							<Button
								className="self-end"
								onPress={() =>
									controller.dispatch({ type: "setSection", section: "export" })
								}
							>
								Open Export
							</Button>
						</div>
					)}
				</RACDialog>
			</Popover>
		</DialogTrigger>
	);
}

/** Export's job bar at the foot of Data, once a job has run this session,
 *  until it is put away. It reports and does not start jobs. */
export function DataJobBar({ onShowFailed }: { onShowFailed: () => void }) {
	const jobs = useExportJobs();
	const presets = useEditor((s) => s.workspace?.presets);
	const [dismissed, setDismissed] = useState<number | null>(null);
	const job = jobs.snapshot.job;
	if (!job || job.id === dismissed) return null;
	return (
		<JobBar
			jobs={jobs}
			snapshot={jobs.snapshot}
			preset={presets?.find((p) => p.id === job.presetId)}
			count={0}
			blocked={null}
			hideRun
			onShowFailed={onShowFailed}
			onDismiss={() => setDismissed(job.id)}
		/>
	);
}
