import {
	isEmptyValue,
	parseBooleanText,
	parseDateText,
	parseNumberText,
} from "./columns";
import { isValidKey } from "./ids";
import type {
	Binding,
	CellValue,
	Column,
	DataRecord,
	Dataset,
	DatasetAsset,
	DatasetView,
	FilterOp,
	ViewFilter,
	ViewJoin,
} from "./types";

export const FILTER_OPS: readonly FilterOp[] = [
	"equals",
	"contains",
	"empty",
	"lt",
	"lte",
	"gt",
	"gte",
];

const COMPARISONS: readonly FilterOp[] = ["lt", "lte", "gt", "gte"];

export type ViewResult = {
	/** the bound dataset's id, with the joined columns and the records the
	 *  view keeps; no records while `problems` is not empty */
	dataset: Dataset;
	/** why the view cannot be applied: a missing dataset or column, or a
	 *  value its column cannot compare */
	problems: string[];
	/** records whose join cell is empty or matches no key */
	unmatched: string[];
	/** key texts more than one joined record holds; the first one is used */
	duplicateKeys: string[];
	/** joined columns left out because the bound dataset has their key */
	clashes: string[];
};

export function emptyView(): DatasetView {
	return { filters: [] };
}

/** Whether a view changes nothing, so the dataset reads as it is. */
export function isEmptyView(view: DatasetView | undefined): boolean {
	return view === undefined || (view.filters.length === 0 && !view.join);
}

/** A join cell as text; empty cells match nothing. */
export function keyText(value: CellValue | undefined): string {
	return isEmptyValue(value) ? "" : String(value).trim();
}

function joinedColumns(
	base: Dataset,
	other: Dataset,
	join: ViewJoin,
): { columns: Column[]; clashes: string[] } {
	const taken = new Set(base.columns.map((c) => c.key));
	const columns: Column[] = [];
	const clashes: string[] = [];
	for (const column of other.columns) {
		if (column.key === join.key) continue;
		const key = `${join.prefix}${column.key}`;
		if (taken.has(key)) {
			clashes.push(key);
			continue;
		}
		taken.add(key);
		const { required: _r, ...rest } = column;
		columns.push({ ...rest, key });
	}
	return { columns, clashes };
}

function joinProblems(
	base: Dataset,
	other: Dataset | undefined,
	join: ViewJoin,
): string[] {
	const problems: string[] = [];
	if (!other) problems.push("The joined dataset is not in the workspace");
	if (!base.columns.some((c) => c.key === join.on))
		problems.push(`No column "${join.on}" to join on`);
	if (other && !other.columns.some((c) => c.key === join.key))
		problems.push(`${other.name} has no column "${join.key}"`);
	if (join.prefix !== "" && !isValidKey(`${join.prefix}x`))
		problems.push(`"${join.prefix}" cannot start a column key`);
	return problems;
}

function mergedAssets(a: DatasetAsset[], b: DatasetAsset[]): DatasetAsset[] {
	if (b.length === 0) return a;
	const seen = new Set(a.map((asset) => asset.sha256));
	return [...a, ...b.filter((asset) => !seen.has(asset.sha256))];
}

type Test = (cell: CellValue | undefined) => boolean;

function compare(
	op: FilterOp,
	a: number | string,
	b: number | string,
): boolean {
	switch (op) {
		case "lt":
			return a < b;
		case "lte":
			return a <= b;
		case "gt":
			return a > b;
		default:
			return a >= b;
	}
}

function numberOf(cell: CellValue | undefined): number | null {
	if (typeof cell === "number") return cell;
	return typeof cell === "string" ? parseNumberText(cell) : null;
}

function dateOf(cell: CellValue | undefined): string | null {
	return typeof cell === "string" ? parseDateText(cell) : null;
}

function cellText(cell: CellValue | undefined): string {
	return isEmptyValue(cell) ? "" : String(cell).trim().toLowerCase();
}

/** The test a filter makes of a cell, or why it cannot make one. A
 *  `contains` filter with no value keeps every record, negated or not. */
export function filterTest(
	filter: ViewFilter,
	columns: readonly Column[],
): Test | string {
	const column = columns.find((c) => c.key === filter.column);
	if (!column) return `No column "${filter.column}" to filter on`;
	const value = (filter.value ?? "").trim();
	if (filter.op === "contains" && value === "") return () => true;
	const test = baseTest(filter.op, column, value);
	if (typeof test === "string") return test;
	return filter.not ? (cell) => !test(cell) : test;
}

function baseTest(op: FilterOp, column: Column, value: string): Test | string {
	if (op === "empty" || (op === "equals" && value === ""))
		return (cell) => isEmptyValue(cell);
	if (op === "contains") {
		const wanted = value.toLowerCase();
		return (cell) => !isEmptyValue(cell) && cellText(cell).includes(wanted);
	}
	const numeric = column.type === "number" || column.type === "integer";
	if (numeric) {
		const n = parseNumberText(value);
		if (n === null) return `"${value}" is not a number, for ${column.key}`;
		if (op === "equals") return (cell) => numberOf(cell) === n;
		return (cell) => {
			const m = numberOf(cell);
			return m !== null && compare(op, m, n);
		};
	}
	if (column.type === "date") {
		const d = parseDateText(value);
		if (d === null) return `"${value}" is not a date, for ${column.key}`;
		if (op === "equals") return (cell) => dateOf(cell) === d;
		return (cell) => {
			const e = dateOf(cell);
			return e !== null && compare(op, e, d);
		};
	}
	if (COMPARISONS.includes(op))
		return `${column.key} is ${column.type}; only numbers and dates compare`;
	if (column.type === "boolean") {
		const b = parseBooleanText(value);
		if (b === null) return `"${value}" is not yes or no, for ${column.key}`;
		return (cell) =>
			(typeof cell === "boolean"
				? cell
				: parseBooleanText(String(cell ?? ""))) === b;
	}
	const wanted = value.toLowerCase();
	return (cell) => cellText(cell) === wanted;
}

/** The dataset a view reads from `base`, with `datasets` holding the one it
 *  joins. Filters run after the join, so they can test joined columns. */
export function applyView(
	base: Dataset,
	view: DatasetView | undefined,
	datasets: readonly Dataset[],
): ViewResult {
	const result: ViewResult = {
		dataset: base,
		problems: [],
		unmatched: [],
		duplicateKeys: [],
		clashes: [],
	};
	if (!view || isEmptyView(view)) return result;
	let columns = base.columns;
	let assets = base.assets;
	let records = base.records;
	const join = view.join;
	if (join) {
		const other = datasets.find((d) => d.id === join.datasetId);
		result.problems.push(...joinProblems(base, other, join));
		if (other && result.problems.length === 0) {
			const added = joinedColumns(base, other, join);
			result.clashes = added.clashes;
			columns = [...base.columns, ...added.columns];
			assets = mergedAssets(base.assets, other.assets);
			const byKey = new Map<string, DataRecord>();
			const duplicates = new Set<string>();
			for (const record of other.records) {
				const key = keyText(record.values[join.key]);
				if (key === "") continue;
				if (byKey.has(key)) duplicates.add(key);
				else byKey.set(key, record);
			}
			result.duplicateKeys = [...duplicates];
			const joined: DataRecord[] = [];
			for (const record of base.records) {
				const match = byKey.get(keyText(record.values[join.on]));
				if (!match) {
					result.unmatched.push(record.id);
					if (!join.inner) joined.push(record);
					continue;
				}
				const values = { ...record.values };
				for (const column of added.columns) {
					const cell = match.values[column.key.slice(join.prefix.length)];
					if (cell !== undefined) values[column.key] = cell;
				}
				joined.push({ ...record, values });
			}
			records = joined;
		}
	}
	const tests: { column: string; test: Test }[] = [];
	for (const filter of view.filters) {
		const test = filterTest(filter, columns);
		if (typeof test === "string") result.problems.push(test);
		else tests.push({ column: filter.column, test });
	}
	const kept =
		result.problems.length > 0
			? []
			: records.filter((record) =>
					tests.every(({ column, test }) => test(record.values[column])),
				);
	result.dataset = { ...base, columns, assets, records: kept };
	return result;
}

type Cached = {
	view: DatasetView;
	datasets: readonly Dataset[];
	result: ViewResult;
};

const cache = new WeakMap<Dataset, Cached>();

/** `applyView` for a binding, or undefined when it reads no dataset of
 *  `datasets`. The result is kept while the dataset, the view and the
 *  dataset list stay the same objects, so a caller can compare by
 *  reference. */
export function bindingView(
	binding: Binding | undefined,
	datasets: readonly Dataset[],
): ViewResult | undefined {
	if (!binding) return undefined;
	const base = datasets.find((d) => d.id === binding.datasetId);
	if (!base) return undefined;
	const view = binding.view;
	if (!view || isEmptyView(view))
		return {
			dataset: base,
			problems: [],
			unmatched: [],
			duplicateKeys: [],
			clashes: [],
		};
	const hit = cache.get(base);
	if (hit && hit.view === view && sameJoined(hit, view, datasets))
		return hit.result;
	const result = applyView(base, view, datasets);
	cache.set(base, { view, datasets, result });
	return result;
}

function sameJoined(
	hit: Cached,
	view: DatasetView,
	datasets: readonly Dataset[],
): boolean {
	if (hit.datasets === datasets) return true;
	const id = view.join?.datasetId;
	if (id === undefined) return true;
	return (
		hit.datasets.find((d) => d.id === id) === datasets.find((d) => d.id === id)
	);
}

/** The dataset a binding reads, through its view. */
export function boundDataset(
	binding: Binding | undefined,
	datasets: readonly Dataset[],
): Dataset | undefined {
	return bindingView(binding, datasets)?.dataset;
}

/** The binding with its view replaced; an empty view is dropped. */
export function withView(
	binding: Binding,
	view: DatasetView | undefined,
): Binding {
	const { view: _v, ...rest } = binding;
	return view && !isEmptyView(view) ? { ...rest, view } : rest;
}

const WHERE = /^([A-Za-z_][A-Za-z0-9_]*)\s*(!=|!~|<=|>=|=|~|<|>)(.*)$/s;

/** A filter written as `<column><op><value>`: `=` equals, and with no value
 *  is empty; `~` contains; `<`, `<=`, `>`, `>=` compare; `!=` and `!~`
 *  negate, as does a leading `not `. Throws on anything else. */
export function parseFilter(text: string): ViewFilter {
	const negated = /^not\s+(?=[A-Za-z_])/.exec(text.trim());
	if (negated) {
		const { not, ...inner } = parseFilter(text.trim().slice(negated[0].length));
		return not ? inner : { ...inner, not: true };
	}
	const m = WHERE.exec(text.trim());
	if (!m)
		throw new Error(
			"Expected <column><op><value>, with = != ~ !~ < <= > or >= as the op.",
		);
	const [, column, sign, raw] = m as unknown as [
		string,
		string,
		string,
		string,
	];
	const value = raw.trim();
	const not = sign.startsWith("!");
	const op: FilterOp =
		sign === "~" || sign === "!~"
			? "contains"
			: sign === "<"
				? "lt"
				: sign === "<="
					? "lte"
					: sign === ">"
						? "gt"
						: sign === ">="
							? "gte"
							: value === ""
								? "empty"
								: "equals";
	return {
		column,
		op,
		...(op !== "empty" ? { value } : {}),
		...(not ? { not: true } : {}),
	};
}

const SIGNS: Record<FilterOp, string> = {
	equals: "=",
	contains: "~",
	empty: "=",
	lt: "<",
	lte: "<=",
	gt: ">",
	gte: ">=",
};

/** A filter as `parseFilter` reads it. A negated comparison has no sign of
 *  its own, so it reads as `not <column><op><value>`. */
export function formatFilter(filter: ViewFilter): string {
	const value = filter.op === "empty" ? "" : (filter.value ?? "");
	const sign = SIGNS[filter.op];
	if (!filter.not) return `${filter.column}${sign}${value}`;
	if (sign === "=" || sign === "~") return `${filter.column}!${sign}${value}`;
	return `not ${filter.column}${sign}${value}`;
}
