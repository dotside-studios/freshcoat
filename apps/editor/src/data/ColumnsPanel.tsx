import { compiledPattern } from "@freshcoat-js/coatfile";
import { templateStem } from "@freshcoat-js/coatfile/coat";
import { Button } from "@freshcoat-js/ui/button";
import { Checkbox } from "@freshcoat-js/ui/checkbox";
import { inputBase } from "@freshcoat-js/ui/field";
import { IconButton } from "@freshcoat-js/ui/icon-button";
import { cn } from "@freshcoat-js/ui/lib/cn";
import { fieldLabel } from "@freshcoat-js/ui/lib/styles";
import { Select, SelectItem } from "@freshcoat-js/ui/select";
import { treeRow } from "@freshcoat-js/ui/tree";
import {
	COLUMN_TYPES,
	type Column,
	type ColumnType,
	coerce,
	type Dataset,
} from "@freshcoat-js/workspace";
import { type ReactNode, useEffect, useId, useMemo, useState } from "react";
import { ListBox, ListBoxItem } from "react-aria-components";
import { useController } from "~/app/context";
import { EMPTY, KEY_RULE, plural } from "~/app/copy";
import { useEditor } from "~/state/hooks";
import AddIcon from "~icons/mingcute/add-line";
import DownIcon from "~icons/mingcute/arrow-down-line";
import UpIcon from "~icons/mingcute/arrow-up-line";
import DeleteIcon from "~icons/mingcute/delete-2-line";
import { editDataset, renameColumnEverywhere } from "./actions";
import type { Confirm } from "./ConfirmDialog";
import {
	addColumn,
	changeColumnType,
	columnValueCount,
	conversionFailures,
	deleteColumn,
	editText,
	keyProblem,
	moveColumn,
	NUMERIC_TYPES,
	newColumn,
	TEXTUAL_TYPES,
	TYPE_LABELS,
	updateColumn,
} from "./model";

export function ColumnsPanel({
	dataset,
	selected,
	onSelect,
	confirm,
}: {
	dataset: Dataset;
	selected: string | null;
	onSelect: (key: string | null) => void;
	confirm: Confirm;
}) {
	const controller = useController();
	const column =
		dataset.columns.find((c) => c.key === selected) ?? dataset.columns[0];
	const selectedKeys = useMemo(
		() => new Set(column ? [column.key] : []),
		[column],
	);

	const add = () => {
		const at = column
			? dataset.columns.indexOf(column) + 1
			: dataset.columns.length;
		const c = newColumn(dataset);
		editDataset(controller, dataset.id, (d) => addColumn(d, c, at));
		onSelect(c.key);
	};

	const remove = async (c: Column) => {
		const values = columnValueCount(dataset, c.key);
		if (values > 0) {
			const answer = await confirm({
				title: "Delete column",
				message: `${c.key} has ${plural(values, "value")}. ${values === 1 ? "It" : "They"}'ll be deleted too.`,
				confirmLabel: "Delete",
				destructive: true,
			});
			if (answer !== "confirm") return;
		}
		const index = dataset.columns.indexOf(c);
		editDataset(controller, dataset.id, (d) => deleteColumn(d, c.key));
		const next =
			dataset.columns[index + 1] ?? dataset.columns[index - 1] ?? null;
		onSelect(next?.key ?? null);
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col" data-testid="columns-panel">
			<div className="flex h-7 shrink-0 items-center border-fc-border border-b pr-1 pl-2.5 pointer-coarse:h-9">
				<h2 className="min-w-0 flex-1 truncate font-semibold text-[10px] text-fc-muted uppercase tracking-[0.06em]">
					Columns
				</h2>
				<IconButton
					aria-label="Move column up"
					tooltip="Move up"
					isDisabled={!column || dataset.columns[0] === column}
					onPress={() =>
						column &&
						editDataset(controller, dataset.id, (d) =>
							moveColumn(d, column.key, -1),
						)
					}
					className="size-5 pointer-coarse:size-7 [&_svg]:size-3.5"
				>
					<UpIcon />
				</IconButton>
				<IconButton
					aria-label="Move column down"
					tooltip="Move down"
					isDisabled={!column || dataset.columns.at(-1) === column}
					onPress={() =>
						column &&
						editDataset(controller, dataset.id, (d) =>
							moveColumn(d, column.key, 1),
						)
					}
					className="size-5 pointer-coarse:size-7 [&_svg]:size-3.5"
				>
					<DownIcon />
				</IconButton>
				<IconButton
					aria-label="Delete column"
					tooltip="Delete column"
					isDisabled={!column}
					onPress={() => column && void remove(column)}
					className="size-5 pointer-coarse:size-7 [&_svg]:size-3.5"
				>
					<DeleteIcon />
				</IconButton>
				<IconButton
					aria-label="Add column"
					tooltip="Add column"
					onPress={add}
					className="size-5 pointer-coarse:size-7 [&_svg]:size-3.5"
				>
					<AddIcon />
				</IconButton>
			</div>
			<ListBox
				aria-label="Columns"
				data-testid="columns-list"
				items={dataset.columns}
				selectionMode="single"
				disallowEmptySelection
				selectedKeys={selectedKeys}
				onSelectionChange={(keys) => {
					const [k] = keys === "all" ? [] : [...keys];
					if (typeof k === "string") onSelect(k);
				}}
				renderEmptyState={() => (
					<p className="px-2.5 py-3 text-fc-faint text-fc-sm">
						{EMPTY.columns}
					</p>
				)}
				className="flex max-h-[38%] shrink-0 flex-col overflow-auto border-fc-border border-b py-1 outline-none"
			>
				{(c) => (
					<ListBoxItem
						id={c.key}
						textValue={c.key}
						className={cn(
							treeRow,
							"gap-2 pr-2 pl-2.5 data-focus-visible:outline-solid data-focus-visible:outline-1 data-focus-visible:outline-fc-accent",
						)}
					>
						<span className="min-w-0 flex-1 truncate font-fc-mono text-[11px]">
							{c.key}
							{c.required ? <span className="text-fc-danger"> *</span> : null}
						</span>
						<span className="shrink-0 text-fc-faint text-fc-sm">
							{TYPE_LABELS[c.type]}
						</span>
					</ListBoxItem>
				)}
			</ListBox>
			<div className="min-h-0 flex-1 overflow-auto">
				{column ? (
					<ColumnEditor
						key={`${dataset.id}:${column.key}`}
						dataset={dataset}
						column={column}
						onRenamed={onSelect}
					/>
				) : (
					<div className="flex flex-col items-start gap-2 p-3 text-fc-muted">
						<p>No column selected</p>
						<Button onPress={add}>
							<AddIcon />
							Add column
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}

function ColumnEditor({
	dataset,
	column,
	onRenamed,
}: {
	dataset: Dataset;
	column: Column;
	onRenamed: (key: string) => void;
}) {
	const controller = useController();
	const [pendingType, setPendingType] = useState<{
		type: ColumnType;
		failures: number;
	} | null>(null);
	const users = useEditor((s) => s.workspace?.templates);
	const bound = useMemo(() => {
		const out: string[] = [];
		for (const t of users ?? []) {
			if (t.binding?.datasetId !== dataset.id) continue;
			const fields = Object.entries(t.binding.fields)
				.filter(([, s]) => s.kind === "column" && s.column === column.key)
				.map(([f]) => f);
			if (
				t.binding.variant?.kind === "column" &&
				t.binding.variant.column === column.key
			)
				fields.push("variant");
			if (fields.length)
				out.push(`${templateStem(t.fileName)}: ${fields.join(", ")}`);
		}
		return out;
	}, [users, dataset.id, column.key]);

	const patch = (p: Partial<Omit<Column, "key" | "type">>, merge?: string) =>
		editDataset(
			controller,
			dataset.id,
			(d) => updateColumn(d, column.key, p),
			merge ? `column:${dataset.id}:${column.key}:${merge}` : undefined,
		);

	const applyType = (type: ColumnType) => {
		setPendingType(null);
		editDataset(
			controller,
			dataset.id,
			(d) => changeColumnType(d, column.key, type).dataset,
		);
	};

	return (
		<div className="flex flex-col gap-2.5 p-2.5">
			<CommitField
				label="Key"
				value={column.key}
				mono
				testId="column-key"
				validate={(v) => {
					const problem = keyProblem(dataset, column.key, v);
					return problem === "invalid"
						? KEY_RULE
						: problem === "taken"
							? "Another column uses this key"
							: null;
				}}
				onCommit={(v) => {
					if (renameColumnEverywhere(controller, dataset.id, column.key, v))
						onRenamed(v);
				}}
			/>
			{bound.length ? (
				<p className="-mt-1 text-fc-faint text-fc-sm">
					Bound in {bound.join("; ")}. Renaming updates it.
				</p>
			) : null}
			<CommitField
				label="Title"
				value={column.title ?? ""}
				testId="column-title"
				onCommit={(v) => patch({ title: v.trim() || undefined })}
			/>
			<CommitField
				label="Description"
				value={column.description ?? ""}
				multiline
				onCommit={(v) => patch({ description: v.trim() || undefined })}
			/>
			<div>
				<Select
					label="Type"
					aria-label="Type"
					data-testid="column-type"
					selectedKey={pendingType?.type ?? column.type}
					onSelectionChange={(key) => {
						const type = key as ColumnType;
						if (type === column.type) return setPendingType(null);
						const failures = conversionFailures(dataset, column.key, type);
						if (failures === 0) applyType(type);
						else setPendingType({ type, failures });
					}}
				>
					{COLUMN_TYPES.map((t) => (
						<SelectItem key={t} id={t}>
							{TYPE_LABELS[t]}
						</SelectItem>
					))}
				</Select>
				{pendingType ? (
					<div
						role="alert"
						className="mt-1.5 flex flex-col gap-2 rounded-[3px] border border-fc-warning/40 bg-fc-warning/10 p-2 text-fc-sm"
					>
						<p>
							{plural(pendingType.failures, "value")} won't convert to{" "}
							{TYPE_LABELS[pendingType.type].toLowerCase()}.{" "}
							{pendingType.failures === 1
								? "It keeps its text and is marked invalid."
								: "They keep their text and are marked invalid."}
						</p>
						<div className="flex justify-end gap-1.5">
							<Button
								size="sm"
								variant="ghost"
								onPress={() => setPendingType(null)}
							>
								Cancel
							</Button>
							<Button
								size="sm"
								variant="primary"
								onPress={() => applyType(pendingType.type)}
							>
								Change type
							</Button>
						</div>
					</div>
				) : null}
			</div>
			<Checkbox
				isSelected={!!column.required}
				onChange={(v) => patch({ required: v || undefined })}
			>
				Required
			</Checkbox>
			<DefaultField
				column={column}
				onChange={(value) => patch({ default: value })}
			/>
			<Constraints column={column} patch={patch} />
		</div>
	);
}

function DefaultField({
	column,
	onChange,
}: {
	column: Column;
	onChange: (value: Column["default"]) => void;
}) {
	if (column.type === "boolean") {
		const key =
			column.default === true
				? "yes"
				: column.default === false
					? "no"
					: "none";
		return (
			<Select
				label="Default"
				selectedKey={key}
				onSelectionChange={(k) =>
					onChange(k === "yes" ? true : k === "no" ? false : undefined)
				}
			>
				<SelectItem id="none">None</SelectItem>
				<SelectItem id="yes">Yes</SelectItem>
				<SelectItem id="no">No</SelectItem>
			</Select>
		);
	}
	return (
		<CommitField
			label="Default"
			value={editText(column, column.default ?? null)}
			placeholder="None"
			validate={(v) => {
				if (v.trim() === "") return null;
				const out = coerce(column, v);
				return out.ok ? null : (out.message ?? "Not valid");
			}}
			onCommit={(v) => {
				if (v.trim() === "") return onChange(undefined);
				onChange(coerce(column, v).value ?? undefined);
			}}
		/>
	);
}

function Constraints({
	column,
	patch,
}: {
	column: Column;
	patch: (p: Partial<Omit<Column, "key" | "type">>) => void;
}) {
	const numeric = NUMERIC_TYPES.has(column.type);
	const textual = TEXTUAL_TYPES.has(column.type);
	if (!numeric && !textual) return null;
	const num = (v: string) => {
		const t = v.trim();
		return t === "" ? undefined : Number(t);
	};
	const badNumber = (v: string) =>
		v.trim() !== "" && !Number.isFinite(Number(v.trim()))
			? "Not a number"
			: null;
	const badLength = (v: string) =>
		v.trim() !== "" && !/^\d+$/.test(v.trim())
			? "Must be a whole number"
			: null;
	return (
		<fieldset className="flex flex-col gap-2.5 border-fc-border border-t pt-2.5">
			<legend className="sr-only">Constraints</legend>
			<p className="font-semibold text-[10px] text-fc-muted uppercase tracking-[0.06em]">
				Constraints
			</p>
			{numeric ? (
				<div className="grid grid-cols-2 gap-2">
					<CommitField
						label="Minimum"
						value={column.minimum?.toString() ?? ""}
						validate={badNumber}
						onCommit={(v) => patch({ minimum: num(v) })}
					/>
					<CommitField
						label="Maximum"
						value={column.maximum?.toString() ?? ""}
						validate={badNumber}
						onCommit={(v) => patch({ maximum: num(v) })}
					/>
				</div>
			) : null}
			{column.type === "text" ? (
				<CommitField
					label="Allowed values"
					value={column.enum?.join(", ") ?? ""}
					placeholder="Any, or a, b, c"
					onCommit={(v) => {
						const list = v
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean);
						patch({ enum: list.length ? list : undefined });
					}}
				/>
			) : null}
			{textual ? (
				<>
					<div className="grid grid-cols-2 gap-2">
						<CommitField
							label="Min length"
							value={column.minLength?.toString() ?? ""}
							validate={badLength}
							onCommit={(v) => patch({ minLength: num(v) })}
						/>
						<CommitField
							label="Max length"
							value={column.maxLength?.toString() ?? ""}
							validate={badLength}
							onCommit={(v) => patch({ maxLength: num(v) })}
						/>
					</div>
					<CommitField
						label="Pattern"
						value={column.pattern ?? ""}
						mono
						placeholder="Regular expression"
						validate={(v) => {
							if (!v) return null;
							return compiledPattern(v) === null
								? "Not a valid regular expression"
								: null;
						}}
						onCommit={(v) => patch({ pattern: v || undefined })}
					/>
				</>
			) : null}
		</fieldset>
	);
}

/** A labelled field that commits on Enter or when it loses focus, and
 *  reverts on Escape or when `validate` refuses the text. */
function CommitField({
	label,
	value,
	onCommit,
	validate,
	placeholder,
	multiline,
	mono,
	testId,
}: {
	label: ReactNode;
	value: string;
	onCommit: (value: string) => void;
	validate?: (value: string) => string | null;
	placeholder?: string;
	multiline?: boolean;
	mono?: boolean;
	testId?: string;
}) {
	const id = useId();
	const [draft, setDraft] = useState(value);
	useEffect(() => setDraft(value), [value]);
	const error = draft !== value ? (validate?.(draft) ?? null) : null;

	const commit = () => {
		if (draft === value) return;
		if (validate?.(draft)) {
			setDraft(value);
			return;
		}
		onCommit(draft);
	};

	const props = {
		id,
		value: draft,
		placeholder,
		spellCheck: false,
		"aria-invalid": error ? true : undefined,
		"data-testid": testId,
		onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
		onBlur: commit,
		onKeyDown: (e: React.KeyboardEvent) => {
			e.stopPropagation();
			if (e.key === "Escape") {
				e.preventDefault();
				setDraft(value);
			} else if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				commit();
			}
		},
		className: cn(
			inputBase,
			multiline ? "block resize-y py-1 leading-normal" : "h-fc-control",
			mono && "font-fc-mono text-[11px]",
			error && "border-fc-danger data-hovered:border-fc-danger",
		),
	};

	return (
		<div className="flex min-w-0 flex-col">
			<label htmlFor={id} className={cn(fieldLabel, "mb-1")}>
				{label}
			</label>
			{multiline ? <textarea rows={2} {...props} /> : <input {...props} />}
			{error ? (
				<span className="mt-1 text-fc-danger text-fc-sm">{error}</span>
			) : null}
		</div>
	);
}
