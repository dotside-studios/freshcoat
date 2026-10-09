import { Button } from "@freshcoat-js/ui/button";
import { inputBase } from "@freshcoat-js/ui/field";
import { cn } from "@freshcoat-js/ui/lib/cn";
import { toast } from "@freshcoat-js/ui/toast";
import type { CellValue, Column, Dataset } from "@freshcoat-js/workspace";
import {
	assetMap,
	displayText,
	misfitCount,
	NUMERIC_TYPES,
	pastedValue,
	sharedValues,
	writeCells,
} from "@freshcoat-js/workspace/dataset";
import { type FormEvent, useMemo, useState } from "react";
import { useController } from "~/app/context";
import { plural } from "~/app/copy";
import { formatNumber } from "~/app/format";
import { editDataset } from "./actions";
import { inputModeFor } from "./cells";

/**
 * The Record tab while several records are selected: one form per column
 * that sets a value in every selected record, each as one undo step.
 */
export function BulkPanel({
	dataset,
	ids,
}: {
	dataset: Dataset;
	ids: readonly string[];
}) {
	const controller = useController();
	const shared = useMemo(() => sharedValues(dataset, ids), [dataset, ids]);
	const assets = useMemo(() => assetMap(dataset.assets), [dataset.assets]);

	const apply = (column: Column, value: CellValue) => {
		const writes = ids.map((id) => ({ id, key: column.key, value }));
		const next = editDataset(controller, dataset.id, (d) =>
			writeCells(d, writes),
		);
		const issues = next ? misfitCount(next, writes) : 0;
		if (issues)
			toast(`${plural(issues, "issue")} in ${column.key}`, {
				tone: "warning",
			});
	};

	return (
		<div
			className="flex min-h-0 flex-1 flex-col"
			data-testid="bulk-panel"
			data-count={ids.length}
		>
			<div className="flex h-8 shrink-0 items-center border-fc-border border-b px-2.5 pointer-coarse:h-10">
				<span className="min-w-0 flex-1 truncate font-medium tabular-nums">
					{`Set value for ${formatNumber(ids.length)} selected`}
				</span>
			</div>
			<div
				className="grid min-h-0 flex-1 auto-rows-min grid-cols-[minmax(72px,34%)_1fr] items-start gap-x-2 gap-y-1.5 overflow-auto p-2.5"
				data-testid="bulk-fields"
			>
				{dataset.columns.map((c) => {
					const value = shared.get(c.key);
					return (
						<BulkField
							key={c.key}
							column={c}
							shared={
								value === undefined ? undefined : displayText(c, value, assets)
							}
							onSet={(text) => {
								const v =
									c.type === "boolean"
										? text === "true"
										: pastedValue(dataset, c.key, text);
								if (v !== undefined) apply(c, v);
							}}
						/>
					);
				})}
			</div>
		</div>
	);
}

function BulkField({
	column,
	shared,
	onSet,
}: {
	column: Column;
	/** The value every selected record has, as text; undefined when mixed. */
	shared: string | undefined;
	onSet: (text: string) => void;
}) {
	const [draft, setDraft] = useState<string | null>(null);
	const id = `bulk-${column.key}`;
	const label = column.title ?? column.key;
	const submit = (e: FormEvent) => {
		e.preventDefault();
		onSet(draft ?? shared ?? "");
		setDraft(null);
	};
	return (
		<>
			<label
				htmlFor={id}
				className="flex h-fc-control min-w-0 items-center font-fc-mono text-[11px] text-fc-muted"
				title={column.title ? `${column.title} (${column.key})` : column.key}
			>
				<span className="truncate">{column.key}</span>
			</label>
			{column.type === "boolean" ? (
				<div className="flex gap-1" data-field={column.key}>
					{(["true", "false"] as const).map((v) => (
						<Button
							key={v}
							size="sm"
							variant={shared === v ? "primary" : "default"}
							aria-label={`Set ${label} to ${v === "true" ? "yes" : "no"}`}
							onPress={() => onSet(v)}
						>
							{v === "true" ? "Yes" : "No"}
						</Button>
					))}
				</div>
			) : (
				<form
					onSubmit={submit}
					className="flex min-w-0 gap-1"
					data-field={column.key}
				>
					<input
						id={id}
						type={column.type === "date" ? "date" : "text"}
						inputMode={inputModeFor(column)}
						autoComplete="off"
						value={draft ?? shared ?? ""}
						placeholder={shared === undefined ? "Mixed" : undefined}
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Escape") setDraft(null);
						}}
						className={cn(
							inputBase,
							"h-fc-control min-w-0 flex-1 hover:border-fc-border-strong focus:border-fc-accent",
							NUMERIC_TYPES.has(column.type) && "text-right tabular-nums",
						)}
					/>
					<Button
						type="submit"
						size="sm"
						aria-label={`Set ${label}`}
						isDisabled={draft === null}
					>
						Set
					</Button>
				</form>
			)}
		</>
	);
}
