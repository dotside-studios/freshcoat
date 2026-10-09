import { Button } from "@freshcoat-js/ui/button";
import { Checkbox } from "@freshcoat-js/ui/checkbox";
import { TextField } from "@freshcoat-js/ui/field";
import { DialogTrigger, Popover } from "@freshcoat-js/ui/popover";
import { Select, SelectItem } from "@freshcoat-js/ui/select";
import { toast } from "@freshcoat-js/ui/toast";
import type { DataRecord, Dataset } from "@freshcoat-js/workspace";
import {
	countMatches,
	type FindSpec,
	replaceAll,
} from "@freshcoat-js/workspace/dataset";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Dialog as RACDialog } from "react-aria-components";
import { useController } from "~/app/context";
import { plural } from "~/app/copy";
import FindIcon from "~icons/mingcute/list-search-line";
import { editDataset } from "./actions";
import { misfitCount } from "./clipboard";
import { ToolButton } from "./DataToolbar";
import { type FindField, registerFindReplace } from "./find-replace";

const ALL = "@all";

/**
 * "Find and replace" in the Data toolbar, over the records shown. Mod+F
 * opens it at Find, Mod+H at Replace. Replace all is one undo step.
 */
export function FindReplace({
	dataset,
	rows,
	filtered,
}: {
	dataset: Dataset;
	rows: readonly DataRecord[];
	/** Some records are hidden by the search or a filter. */
	filtered: boolean;
}) {
	const controller = useController();
	const [open, setOpen] = useState(false);
	const [find, setFind] = useState("");
	const [by, setBy] = useState("");
	const [column, setColumn] = useState(ALL);
	const [matchCase, setMatchCase] = useState(false);

	useEffect(
		() =>
			registerFindReplace((field: FindField) => {
				setOpen(true);
				requestAnimationFrame(() => {
					const el = document.getElementById(`find-replace-${field}`);
					if (el instanceof HTMLInputElement) {
						el.focus();
						el.select();
					}
				});
			}),
		[],
	);

	const key = dataset.columns.some((c) => c.key === column)
		? column
		: undefined;
	const spec: FindSpec = useMemo(
		() => ({ text: find, matchCase, ...(key ? { column: key } : {}) }),
		[find, matchCase, key],
	);
	const deferred = useDeferredValue(spec);
	const count = useMemo(
		() =>
			open ? countMatches(dataset, rows, deferred) : { matches: 0, records: 0 },
		[open, dataset, rows, deferred],
	);

	const replace = () => {
		let result: ReturnType<typeof replaceAll> | undefined;
		const next = editDataset(controller, dataset.id, (d) => {
			result = replaceAll(d, rows, spec, by);
			return result.dataset;
		});
		if (!result || !next) return;
		const issues = misfitCount(next, result.writes);
		toast(
			`Replaced ${plural(result.matches, "match", "matches")}${issues ? ` · ${plural(issues, "issue")}` : ""}`,
			{ tone: issues ? "warning" : "success" },
		);
	};

	return (
		<DialogTrigger isOpen={open} onOpenChange={setOpen}>
			<ToolButton
				icon={<FindIcon />}
				label="Find and replace"
				testId="find-replace"
				showLabel="never"
				shortcut="Mod+F"
			/>
			<Popover
				placement="bottom start"
				className="w-80 max-w-[calc(100vw-24px)]"
			>
				<RACDialog
					aria-label="Find and replace"
					className="flex flex-col gap-2 p-3 outline-none"
					data-testid="find-replace-popover"
				>
					<TextField
						id="find-replace-find"
						label="Find"
						labelPosition="side"
						value={find}
						onChange={setFind}
						autoFocus
						autoComplete="off"
					/>
					<TextField
						id="find-replace-replace"
						label="Replace"
						labelPosition="side"
						value={by}
						onChange={setBy}
						autoComplete="off"
						onKeyDown={(e) => {
							if (e.key === "Enter" && count.matches > 0) replace();
						}}
					/>
					<Select
						label="In"
						labelPosition="side"
						value={key ?? ALL}
						onChange={(k) => setColumn(String(k))}
					>
						<SelectItem id={ALL} textValue="All columns">
							All columns
						</SelectItem>
						{dataset.columns.map((c) => (
							<SelectItem key={c.key} id={c.key} textValue={c.key}>
								{c.key}
							</SelectItem>
						))}
					</Select>
					<Checkbox isSelected={matchCase} onChange={setMatchCase}>
						Match case
					</Checkbox>
					<div className="flex items-center gap-2">
						<span
							className="min-w-0 flex-1 truncate text-fc-muted text-fc-sm tabular-nums"
							data-testid="find-replace-count"
						>
							{find === ""
								? filtered
									? "In the records shown"
									: ""
								: count.matches === 0
									? "No matches"
									: `${plural(count.matches, "match", "matches")} in ${plural(count.records, "record")}`}
						</span>
						<Button
							variant="primary"
							size="sm"
							isDisabled={find === "" || count.matches === 0}
							onPress={replace}
						>
							Replace all
						</Button>
					</div>
				</RACDialog>
			</Popover>
		</DialogTrigger>
	);
}
