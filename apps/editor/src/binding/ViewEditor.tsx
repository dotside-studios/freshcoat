import { Button } from "@freshcoat-js/ui/button";
import { Checkbox } from "@freshcoat-js/ui/checkbox";
import { TextField } from "@freshcoat-js/ui/field";
import { IconButton } from "@freshcoat-js/ui/icon-button";
import { Select, SelectItem } from "@freshcoat-js/ui/select";
import type {
	Column,
	Dataset,
	DatasetView,
	FilterOp,
	ViewFilter,
	ViewJoin,
	ViewResult,
} from "@freshcoat-js/workspace";
import { emptyView, slug } from "@freshcoat-js/workspace";
import { plural } from "~/app/copy";
import AddIcon from "~icons/mingcute/add-line";
import CloseIcon from "~icons/mingcute/close-line";
import WarningIcon from "~icons/mingcute/warning-line";

const NO_JOIN = "__none__";

type Choice = { id: string; label: string; op: FilterOp; not?: boolean };

const TEXT_CHOICES: Choice[] = [
	{ id: "equals", label: "is", op: "equals" },
	{ id: "not-equals", label: "is not", op: "equals", not: true },
	{ id: "contains", label: "contains", op: "contains" },
	{ id: "not-contains", label: "does not contain", op: "contains", not: true },
	{ id: "empty", label: "is empty", op: "empty" },
	{ id: "not-empty", label: "is not empty", op: "empty", not: true },
];

const COMPARE_CHOICES: Choice[] = [
	{ id: "lt", label: "<", op: "lt" },
	{ id: "lte", label: "≤", op: "lte" },
	{ id: "gt", label: ">", op: "gt" },
	{ id: "gte", label: "≥", op: "gte" },
];

function compares(column: Column | undefined): boolean {
	return (
		column?.type === "number" ||
		column?.type === "integer" ||
		column?.type === "date"
	);
}

function choicesFor(column: Column | undefined): Choice[] {
	return compares(column)
		? [...TEXT_CHOICES, ...COMPARE_CHOICES]
		: TEXT_CHOICES;
}

function choiceId(filter: ViewFilter): string {
	return `${filter.not ? "not-" : ""}${filter.op}`;
}

function placeholderFor(column: Column | undefined): string {
	switch (column?.type) {
		case "number":
		case "integer":
			return "Number";
		case "date":
			return "YYYY-MM-DD";
		case "boolean":
			return "Yes or no";
		default:
			return "Text";
	}
}

/** A join of `other` on the first column both datasets share a key with,
 *  else on their first columns. */
export function defaultJoin(base: Dataset, other: Dataset): ViewJoin {
	const shared = base.columns.find((c) =>
		other.columns.some((o) => o.key === c.key),
	);
	return {
		datasetId: other.id,
		on: shared?.key ?? base.columns[0]?.key ?? "",
		key: shared?.key ?? other.columns[0]?.key ?? "",
		prefix: `${slug(other.name)}_`,
	};
}

/** The filters and join of a binding's view: which records it reads and
 *  which columns they have. Controlled: every change is a whole new view. */
export function ViewEditor({
	base,
	view,
	result,
	datasets,
	onChange,
}: {
	base: Dataset;
	view: DatasetView | undefined;
	/** the view applied, for its columns and counts */
	result: ViewResult;
	datasets: readonly Dataset[];
	onChange: (view: DatasetView) => void;
}) {
	const current = view ?? emptyView();
	const join = current.join;
	const others = datasets.filter((d) => d.id !== base.id);
	const other = join
		? datasets.find((d) => d.id === join.datasetId)
		: undefined;
	const columns = result.dataset.columns;
	const setJoin = (next: ViewJoin | undefined) => {
		const { join: _j, ...rest } = current;
		onChange(next ? { ...rest, join: next } : rest);
	};
	const setFilter = (at: number, filter: ViewFilter | undefined) => {
		const filters = current.filters.flatMap((f, i) =>
			i !== at ? [f] : filter ? [filter] : [],
		);
		onChange({ ...current, filters });
	};
	const addFilter = () => {
		const column = columns[0]?.key ?? "";
		onChange({
			...current,
			filters: [...current.filters, { column, op: "equals", value: "" }],
		});
	};

	return (
		<div
			className="flex flex-col gap-1.5 rounded-[3px] border border-fc-border px-2 py-1.5"
			data-testid="view-editor"
		>
			<div className="flex min-w-0 items-center gap-1 text-fc-sm">
				<span className="text-fc-text">Records</span>
				<span
					className="ml-auto truncate text-fc-muted tabular-nums"
					data-testid="view-count"
				>
					{`${result.dataset.records.length} of ${plural(base.records.length, "record")}`}
				</span>
			</div>
			<Select
				label="Join"
				labelPosition="side"
				value={join ? join.datasetId : NO_JOIN}
				onChange={(key) => {
					if (key === NO_JOIN) return setJoin(undefined);
					const next = datasets.find((d) => d.id === key);
					if (next && next.id !== join?.datasetId)
						setJoin(defaultJoin(base, next));
				}}
			>
				<SelectItem id={NO_JOIN} textValue="None">
					None
				</SelectItem>
				{others.map((d) => (
					<SelectItem key={d.id} id={d.id} textValue={d.name}>
						{d.name}
					</SelectItem>
				))}
			</Select>
			{join ? (
				<div className="flex flex-col gap-1" data-testid="view-join">
					<div className="flex min-w-0 items-center gap-1">
						<KeySelect
							label="Join on"
							columns={base.columns}
							value={join.on}
							onChange={(on) => setJoin({ ...join, on })}
						/>
						<span className="text-fc-muted text-fc-sm">=</span>
						<KeySelect
							label={`Key in ${other?.name ?? "joined dataset"}`}
							columns={other?.columns ?? []}
							value={join.key}
							onChange={(key) => setJoin({ ...join, key })}
						/>
					</div>
					<TextField
						label="Prefix"
						labelPosition="side"
						value={join.prefix}
						placeholder="None"
						onChange={(prefix) => setJoin({ ...join, prefix })}
					/>
					<Checkbox
						isSelected={join.inner === true}
						onChange={(inner) => {
							const { inner: _i, ...rest } = join;
							setJoin(inner ? { ...rest, inner } : rest);
						}}
					>
						Only records with a match
					</Checkbox>
				</div>
			) : null}
			{current.filters.map((filter, at) => (
				<FilterRow
					// biome-ignore lint/suspicious/noArrayIndexKey: filters have no id, and a row is its position
					key={at}
					filter={filter}
					columns={columns}
					onChange={(next) => setFilter(at, next)}
				/>
			))}
			<Button
				size="sm"
				variant="ghost"
				className="self-start"
				onPress={addFilter}
				isDisabled={columns.length === 0}
			>
				<AddIcon />
				Add filter
			</Button>
			<ViewNotes result={result} />
		</div>
	);
}

function KeySelect({
	label,
	columns,
	value,
	onChange,
}: {
	label: string;
	columns: readonly Column[];
	value: string;
	onChange: (key: string) => void;
}) {
	const known = columns.some((c) => c.key === value);
	return (
		<Select
			aria-label={label}
			className="min-w-0 flex-1"
			value={known ? value : null}
			placeholder={value ? `${value} (missing)` : "Column"}
			onChange={(key) => {
				if (typeof key === "string") onChange(key);
			}}
		>
			{columns.map((c) => (
				<SelectItem key={c.key} id={c.key} textValue={c.key}>
					{c.key}
				</SelectItem>
			))}
		</Select>
	);
}

function FilterRow({
	filter,
	columns,
	onChange,
}: {
	filter: ViewFilter;
	columns: readonly Column[];
	onChange: (filter: ViewFilter | undefined) => void;
}) {
	const column = columns.find((c) => c.key === filter.column);
	const choices = choicesFor(column);
	const id = choiceId(filter);
	return (
		<div
			className="flex min-w-0 items-center gap-1"
			data-testid={`view-filter-${filter.column}`}
		>
			<KeySelect
				label="Filter column"
				columns={columns}
				value={filter.column}
				onChange={(key) => {
					const next = columns.find((c) => c.key === key);
					const keeps = choicesFor(next).some((c) => c.id === id);
					onChange(
						keeps
							? { ...filter, column: key }
							: { column: key, op: "equals", value: filter.value ?? "" },
					);
				}}
			/>
			<Select
				aria-label="Filter condition"
				className="w-24 shrink-0"
				value={choices.some((c) => c.id === id) ? id : null}
				placeholder={filter.op}
				onChange={(key) => {
					const choice = choices.find((c) => c.id === key);
					if (!choice) return;
					onChange({
						column: filter.column,
						op: choice.op,
						...(choice.op !== "empty" ? { value: filter.value ?? "" } : {}),
						...(choice.not ? { not: true } : {}),
					});
				}}
			>
				{choices.map((c) => (
					<SelectItem key={c.id} id={c.id} textValue={c.label}>
						{c.label}
					</SelectItem>
				))}
			</Select>
			{filter.op === "empty" ? (
				<span className="min-w-0 flex-1" />
			) : (
				<TextField
					aria-label="Filter value"
					className="min-w-0 flex-1"
					value={filter.value ?? ""}
					placeholder={placeholderFor(column)}
					onChange={(value) => onChange({ ...filter, value })}
				/>
			)}
			<IconButton
				aria-label="Remove filter"
				onPress={() => onChange(undefined)}
			>
				<CloseIcon />
			</IconButton>
		</div>
	);
}

function ViewNotes({ result }: { result: ViewResult }) {
	const notes = [
		...(result.unmatched.length > 0
			? [`${plural(result.unmatched.length, "record")} with no match`]
			: []),
		...(result.duplicateKeys.length > 0
			? [
					`More than one joined record for ${result.duplicateKeys.join(", ")}; the first is used`,
				]
			: []),
		...(result.clashes.length > 0
			? [`Left out, already a column: ${result.clashes.join(", ")}`]
			: []),
	];
	if (result.problems.length === 0 && notes.length === 0) return null;
	return (
		<div className="flex flex-col gap-0.5 text-fc-sm" data-testid="view-notes">
			{result.problems.map((problem) => (
				<p
					key={problem}
					className="m-0 flex items-center gap-1 text-fc-warning"
				>
					<WarningIcon className="size-3.5 shrink-0" />
					{problem}
				</p>
			))}
			{notes.map((note) => (
				<p key={note} className="m-0 text-fc-faint">
					{note}
				</p>
			))}
		</div>
	);
}
