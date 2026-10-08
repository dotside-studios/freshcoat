import { Button } from "@freshcoat-js/ui/button";
import { Checkbox } from "@freshcoat-js/ui/checkbox";
import { Dialog, Modal } from "@freshcoat-js/ui/dialog";
import { inputBase } from "@freshcoat-js/ui/field";
import { cn } from "@freshcoat-js/ui/lib/cn";
import { fieldLabel } from "@freshcoat-js/ui/lib/styles";
import { SegmentedControl, SegmentedItem } from "@freshcoat-js/ui/segmented";
import { Select, SelectItem } from "@freshcoat-js/ui/select";
import {
	type ApplyMappingResult,
	applyMapping,
	COLUMN_TYPES,
	type ColumnMapping,
	type ColumnType,
	type Dataset,
	type DateOrder,
	detectHeaderRow,
	guessMapping,
	headersOf,
	type ImportPlan,
	isValidKey,
	previewMapping,
} from "@freshcoat-js/workspace";
import {
	type DragEvent,
	type ReactNode,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Button as RACButton } from "react-aria-components";
import { useController } from "~/app/context";
import { KEY_RULE, plural } from "~/app/copy";
import { formatNumber } from "~/app/format";
import { useEditor } from "~/state/hooks";
import FileIcon from "~icons/mingcute/file-import-line";
import { pickFiles, TABLE_ACCEPT } from "./actions";
import { emptyDataset, replaceDataset, TYPE_LABELS, uniqueName } from "./model";
import { importTable, tableImporter } from "./table-import";
import { dataRowCount, type OpenedTable } from "./table-store";

export type ImportTarget = ({ datasetId: string } | { newDataset: true }) & {
	/** A file already chosen, by a drop: the wizard starts by reading it. */
	file?: File;
};

type Loaded = { name: string; table: OpenedTable };

const NO_ROWS: string[][] = [];

const SLASH_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;

/** `dmy` when some date can only be read day first, else `mdy`. */
export function guessDateOrder(
	rows: readonly (readonly string[])[],
): DateOrder {
	for (const row of rows.slice(0, 500)) {
		for (const cell of row) {
			const m = SLASH_DATE.exec(cell.trim());
			if (!m) continue;
			if (Number(m[1]) > 12) return "dmy";
			if (Number(m[2]) > 12) return "mdy";
		}
	}
	return "mdy";
}

function dataRowsOf(rows: readonly string[][], headerRow: number) {
	return rows
		.slice(Math.max(headerRow + 1, 0))
		.filter((r) => r.some((c) => c.trim() !== ""));
}

export function ImportWizard({
	target,
	onClose,
	onImported,
}: {
	target: ImportTarget;
	onClose: () => void;
	onImported: (datasetId: string, summary: string) => void;
}) {
	const controller = useController();
	const existing = useEditor((s) =>
		"datasetId" in target
			? s.workspace?.datasets.find((d) => d.id === target.datasetId)
			: undefined,
	);
	const [step, setStep] = useState<1 | 2 | 3>(1);
	const [file, setFile] = useState<Loaded | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [importing, setImporting] = useState(false);
	const [sheetIndex, setSheetIndex] = useState(0);
	const [headerRow, setHeaderRow] = useState(0);
	const [mode, setMode] = useState<"append" | "replace">("append");
	const [dateOrder, setDateOrder] = useState<DateOrder>("mdy");
	const [mapping, setMapping] = useState<ColumnMapping[]>([]);
	const [match, setMatch] = useState<{ source: number; column: string } | null>(
		null,
	);
	const [dragging, setDragging] = useState(false);
	const [reviewing, setReviewing] = useState(false);

	const base = useMemo<Dataset | undefined>(() => {
		if (existing) return existing;
		if ("newDataset" in target && file) {
			const names =
				controller.state.workspace?.datasets.map((d) => d.name) ?? [];
			return emptyDataset(
				uniqueName(file.name.replace(/\.[^.]+$/, "") || "Imported", names),
			);
		}
		return undefined;
	}, [existing, target, file, controller]);

	const sheet = file?.table.sheets[sheetIndex];
	const rows = sheet?.rows ?? NO_ROWS;
	const headers = useMemo(() => headersOf(rows, headerRow), [rows, headerRow]);
	const samples = useMemo(() => dataRowsOf(rows, headerRow), [rows, headerRow]);
	const recordCount = sheet ? dataRowCount(sheet, headerRow) : 0;
	const columns = base?.columns;

	// A new file, sheet or header row starts the mapping over.
	useEffect(() => {
		if (!columns) return;
		setMapping(guessMapping(headers, columns, samples.slice(0, 200)));
		setMatch(null);
		setReviewing(false);
	}, [headers, samples, columns]);

	const open = useRef<number | null>(null);
	const closed = useRef(false);
	useEffect(() => {
		closed.current = false;
		return () => {
			closed.current = true;
			if (open.current !== null) tableImporter().close(open.current);
			open.current = null;
		};
	}, []);

	const load = async (chosen: File) => {
		setLoading(true);
		setError(null);
		try {
			const table = await tableImporter().open(chosen, chosen.name);
			if (closed.current) {
				tableImporter().close(table.id);
				return;
			}
			if (open.current !== null) tableImporter().close(open.current);
			open.current = table.id;
			const first = table.sheets.findIndex((s) => s.rows.length > 0);
			const index = Math.max(first, 0);
			const sheetRows = table.sheets[index]?.rows ?? [];
			const detected = detectHeaderRow(sheetRows);
			setFile({ name: chosen.name, table });
			setSheetIndex(index);
			setHeaderRow(detected < 0 && sheetRows.length > 0 ? 0 : detected);
			setDateOrder(guessDateOrder(sheetRows));
		} catch (err) {
			const code = (err as { code?: string }).code;
			setError(
				code === "empty_file"
					? `${chosen.name} is empty`
					: code === "unsupported_format"
						? `${chosen.name} isn't a supported file type`
						: `Couldn't read ${chosen.name}: ${(err as Error).message ?? String(err)}`,
			);
		} finally {
			setLoading(false);
		}
	};

	const given = target.file;
	// biome-ignore lint/correctness/useExhaustiveDependencies: a dropped file is read once, when the wizard opens with it
	useEffect(() => {
		if (given) void load(given);
	}, [given]);

	const choose = async () => {
		const [chosen] = await pickFiles({ accept: TABLE_ACCEPT });
		if (chosen) await load(chosen);
	};

	const onDrop = (e: DragEvent) => {
		e.preventDefault();
		setDragging(false);
		const dropped = e.dataTransfer.files[0];
		if (dropped) void load(dropped);
	};

	const isNew = "newDataset" in target;
	const plan = useMemo<ImportPlan>(
		() => ({
			headerRow,
			mapping,
			mode: isNew ? "append" : mode,
			dateOrder,
			...(match && mode === "append" ? { match } : {}),
		}),
		[headerRow, mapping, isNew, mode, dateOrder, match],
	);

	const mappingProblems = useMemo(() => {
		const problems = new Map<number, string>();
		const taken = new Set(columns?.map((c) => c.key) ?? []);
		const seen = new Map<string, number>();
		mapping.forEach((m, i) => {
			if (m.kind === "new") {
				if (!isValidKey(m.key)) problems.set(i, KEY_RULE);
				else if (taken.has(m.key)) problems.set(i, "A column uses this key");
				else if (seen.has(m.key))
					problems.set(i, "Two new columns share this key");
				seen.set(m.key, i);
			} else if (m.kind === "column") {
				const other = [...mapping.entries()].find(
					([j, o]) => j < i && o.kind === "column" && o.column === m.column,
				);
				if (other) problems.set(i, `Also filled from column ${other[0] + 1}`);
			}
		});
		return problems;
	}, [mapping, columns]);
	const blocking = [...mappingProblems.values()].some(
		(p) => !p.startsWith("Also"),
	);
	const nothingMapped = mapping.every((m) => m.kind === "skip");
	const exact =
		headerRow >= 0 &&
		headers.length > 0 &&
		new Set(headers).size === headers.length &&
		headers.every((h) => columns?.some((c) => c.key === h));
	const skipMapping = exact && !reviewing && !blocking && !nothingMapped;

	// Totals over the held rows; Import maps the whole file in the worker.
	const result = useMemo(
		() => (step === 3 && base ? applyMapping(base, rows, plan) : null),
		[step, base, rows, plan],
	);
	const partial = samples.length < recordCount;
	const preview = useMemo(
		() =>
			step === 3 && base ? previewMapping(rows, plan, base.columns, 20) : [],
		[step, base, rows, plan],
	);

	const runImport = async (close: () => void) => {
		if (!file || !base) return;
		setImporting(true);
		setError(null);
		try {
			const result = await importTable(file.table.id, sheetIndex, base, plan);
			if (closed.current) return;
			commit(result);
			close();
		} catch (err) {
			setError(
				`Couldn't import ${file.name}: ${(err as Error).message ?? String(err)}`,
			);
		} finally {
			setImporting(false);
		}
	};

	const commit = (result: ApplyMappingResult) => {
		if (!base) return;
		const all = controller.state.workspace?.datasets ?? [];
		const isNew = !all.some((d) => d.id === base.id);
		controller.dispatch({
			type: "datasetEdit",
			datasets: isNew
				? [...all, result.dataset]
				: replaceDataset(all, result.dataset),
			activeId: result.dataset.id,
		});
		const rowsWithIssues = new Set(result.issues.map((i) => i.row)).size;
		onImported(
			result.dataset.id,
			`Imported ${plural(result.added, "record")}${result.updated ? `, updated ${formatNumber(result.updated)}` : ""} into ${result.dataset.name}${rowsWithIssues ? ` · ${formatNumber(rowsWithIssues)} with issues` : ""}`,
		);
	};

	const stepTitle = ["Choose a file", "Map columns", "Preview"][step - 1];

	return (
		<Modal
			isOpen
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
			width="max-w-3xl"
			isDismissable={false}
		>
			<Dialog
				data-testid="import-wizard"
				title={
					<span className="flex w-full items-center gap-2">
						<span>
							{"newDataset" in target
								? "Import as new dataset"
								: `Import into ${existing?.name ?? ""}`}
						</span>
						<span className="ml-auto font-normal text-fc-muted text-fc-sm">
							Step {step} of 3 · {stepTitle}
						</span>
					</span>
				}
				bodyClassName="max-h-[min(70vh,640px)] p-0"
				footer={({ close }) => (
					<>
						{file ? (
							<span className="mr-auto min-w-0 truncate text-fc-muted text-fc-sm">
								{file.name} · {plural(recordCount, "record")}
							</span>
						) : null}
						<Button variant="ghost" onPress={close}>
							Cancel
						</Button>
						{step > 1 ? (
							<Button
								onPress={() =>
									setStep((s) => (s === 3 && skipMapping ? 1 : s - 1) as 1 | 2)
								}
							>
								Back
							</Button>
						) : null}
						{step < 3 ? (
							<Button
								variant="primary"
								isDisabled={
									!file ||
									recordCount === 0 ||
									(step === 2 && (blocking || nothingMapped))
								}
								onPress={() =>
									setStep((s) => (s === 1 && skipMapping ? 3 : s + 1) as 2 | 3)
								}
							>
								Next
							</Button>
						) : (
							<Button
								variant="primary"
								isDisabled={!result || importing}
								onPress={() => void runImport(close)}
							>
								{importing ? "Importing…" : "Import"}
							</Button>
						)}
					</>
				)}
			>
				{step === 1 ? (
					<div className="flex flex-col gap-3 p-3">
						{/* biome-ignore lint/a11y/noStaticElementInteractions: a drop target; the button inside chooses from the keyboard */}
						<div
							data-testid="import-drop"
							onDragOver={(e) => {
								e.preventDefault();
								setDragging(true);
							}}
							onDragLeave={() => setDragging(false)}
							onDrop={onDrop}
							className={cn(
								"flex flex-col items-center gap-2 rounded-md border border-dashed px-4 py-6 text-center",
								dragging
									? "border-fc-accent bg-fc-accent-soft"
									: "border-fc-border-strong",
							)}
						>
							<FileIcon className="size-6 text-fc-muted" />
							<p className="text-fc-muted">
								{loading
									? "Reading…"
									: file
										? file.name
										: "Drop a CSV, TSV, Excel, ODS, Numbers or JSON file"}
							</p>
							<Button onPress={() => void choose()} isDisabled={loading}>
								{file ? "Choose another file…" : "Choose file…"}
							</Button>
							{error ? (
								<p role="alert" className="text-fc-danger">
									{error}
								</p>
							) : null}
						</div>
						{file ? (
							<>
								<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
									{file.table.sheets.length > 1 ? (
										<Select
											label="Sheet"
											selectedKey={String(sheetIndex)}
											onSelectionChange={(k) => {
												const i = Number(k);
												setSheetIndex(i);
												const r = file.table.sheets[i]?.rows ?? [];
												const h = detectHeaderRow(r);
												setHeaderRow(h < 0 && r.length ? 0 : h);
											}}
										>
											{file.table.sheets.map((s, i) => (
												<SelectItem key={s.name} id={String(i)}>
													{s.name}
												</SelectItem>
											))}
										</Select>
									) : null}
									<Select
										label="Header row"
										aria-label="Header row"
										selectedKey={String(headerRow)}
										onSelectionChange={(k) => setHeaderRow(Number(k))}
									>
										{[-1, ...rows.slice(0, 10).map((_, i) => i)].map((i) => (
											<SelectItem key={i} id={String(i)}>
												{i < 0 ? "No header row" : `Row ${i + 1}`}
											</SelectItem>
										))}
									</Select>
									{"datasetId" in target ? (
										<div className="flex flex-col">
											<span className={cn(fieldLabel, "mb-1")}>Records</span>
											<SegmentedControl
												aria-label="Append or replace"
												selectedKey={mode}
												onSelectionChange={(k) =>
													setMode(k as "append" | "replace")
												}
											>
												<SegmentedItem id="append">Append</SegmentedItem>
												<SegmentedItem id="replace">Replace</SegmentedItem>
											</SegmentedControl>
										</div>
									) : null}
									<Select
										label="Dates"
										aria-label="Date order"
										selectedKey={dateOrder}
										onSelectionChange={(k) => setDateOrder(k as DateOrder)}
									>
										<SelectItem id="mdy">Month first (3/31/2025)</SelectItem>
										<SelectItem id="dmy">Day first (31/3/2025)</SelectItem>
									</Select>
								</div>
								{mode === "replace" && existing?.records.length ? (
									<p className="text-fc-warning text-fc-sm">
										Replace removes {plural(existing.records.length, "record")}{" "}
										from {existing.name}
									</p>
								) : null}
								<RawPreview rows={rows} headerRow={headerRow} />
							</>
						) : null}
					</div>
				) : step === 2 && base ? (
					<MappingStep
						headers={headers}
						samples={samples}
						dataset={base}
						mapping={mapping}
						problems={mappingProblems}
						onMapping={setMapping}
						match={mode === "append" ? match : null}
						onMatch={
							"datasetId" in target && mode === "append" ? setMatch : null
						}
					/>
				) : step === 3 && result ? (
					<div className="flex flex-col gap-2 p-3">
						<p data-testid="import-totals" className="tabular-nums">
							{partial
								? `In the first ${formatNumber(samples.length)} records: `
								: null}
							<strong>{formatNumber(result.added)}</strong> to add ·{" "}
							<strong>{formatNumber(result.updated)}</strong> to update ·{" "}
							<strong
								className={result.issues.length ? "text-fc-danger" : undefined}
							>
								{formatNumber(new Set(result.issues.map((i) => i.row)).size)}
							</strong>{" "}
							with issues
							{skipMapping ? (
								<>
									{" · "}
									<LinkButton
										onPress={() => {
											setReviewing(true);
											setStep(2);
										}}
									>
										Review mapping
									</LinkButton>
								</>
							) : null}
						</p>
						<PreviewTable
							preview={preview}
							mapping={mapping}
							headers={headers}
						/>
						{recordCount > preview.length ? (
							<p className="text-fc-faint text-fc-sm">
								Showing {preview.length} of {formatNumber(recordCount)}
							</p>
						) : null}
						{error ? (
							<p role="alert" className="text-fc-danger">
								{error}
							</p>
						) : null}
					</div>
				) : null}
			</Dialog>
		</Modal>
	);
}

function LinkButton({
	onPress,
	children,
}: {
	onPress: () => void;
	children: ReactNode;
}) {
	return (
		<RACButton
			onPress={onPress}
			className="cursor-default rounded-[2px] text-fc-accent-hover underline decoration-fc-accent/50 underline-offset-2 outline-none data-hovered:text-fc-text data-focus-visible:outline-solid data-focus-visible:outline-1 data-focus-visible:outline-fc-accent"
		>
			{children}
		</RACButton>
	);
}

function RawPreview({
	rows,
	headerRow,
}: {
	rows: readonly string[][];
	headerRow: number;
}) {
	const shown = rows.slice(0, 8);
	const width = Math.min(
		8,
		shown.reduce((w, r) => Math.max(w, r.length), 0),
	);
	return (
		<div className="overflow-auto rounded-[3px] border border-fc-border">
			<table className="w-full border-collapse text-fc-sm">
				<tbody>
					{shown.map((row, r) => (
						<tr
							// biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
							key={r}
							className={cn(
								"border-fc-border border-b last:border-b-0",
								r === headerRow && "bg-fc-accent-soft font-medium text-fc-text",
								r < headerRow && "text-fc-faint",
							)}
						>
							<td className="w-8 px-1.5 py-0.5 text-right text-fc-faint tabular-nums">
								{r + 1}
							</td>
							{Array.from({ length: width }, (_, c) => (
								<td
									// biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
									key={c}
									className="max-w-40 truncate border-fc-border border-l px-1.5 py-0.5"
								>
									{row[c] ?? ""}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function targetKey(m: ColumnMapping): string {
	return m.kind === "column" ? `col:${m.column}` : m.kind;
}

function MappingStep({
	headers,
	samples,
	dataset,
	mapping,
	problems,
	onMapping,
	match,
	onMatch,
}: {
	headers: string[];
	samples: readonly string[][];
	dataset: Dataset;
	mapping: ColumnMapping[];
	problems: Map<number, string>;
	onMapping: (m: ColumnMapping[]) => void;
	match: { source: number; column: string } | null;
	onMatch: ((m: { source: number; column: string } | null) => void) | null;
}) {
	const set = (i: number, m: ColumnMapping) =>
		onMapping(mapping.map((old, j) => (j === i ? m : old)));
	const sampleOf = (i: number) =>
		samples
			.map((r) => r[i] ?? "")
			.filter((v) => v.trim() !== "")
			.slice(0, 3);

	return (
		<div className="flex flex-col">
			<table className="w-full border-collapse" data-testid="import-mapping">
				<thead className="sticky top-0 z-10 bg-fc-raised text-fc-muted text-fc-sm">
					<tr>
						<th className="px-3 py-1 text-left font-medium">Source column</th>
						<th className="hidden px-2 py-1 text-left font-medium sm:table-cell">
							Samples
						</th>
						<th className="w-[46%] px-3 py-1 text-left font-medium">Goes to</th>
					</tr>
				</thead>
				<tbody>
					{headers.map((header, i) => {
						const m = mapping[i] ?? { kind: "skip" };
						const newKey = m.kind === "new" ? m.key : "";
						const problem = problems.get(i);
						return (
							<tr
								// biome-ignore lint/suspicious/noArrayIndexKey: source columns are positional
								key={i}
								data-testid={`mapping-row-${i}`}
								className="border-fc-border border-b align-top"
							>
								<td className="px-3 py-1.5">
									<div className="truncate font-medium">
										{header || (
											<span className="text-fc-faint">Column {i + 1}</span>
										)}
									</div>
									<div className="truncate text-fc-faint text-fc-sm sm:hidden">
										{sampleOf(i).join(" · ")}
									</div>
								</td>
								<td className="hidden max-w-56 px-2 py-1.5 text-fc-muted text-fc-sm sm:table-cell">
									{sampleOf(i).map((s, k) => (
										// biome-ignore lint/suspicious/noArrayIndexKey: samples are positional
										<div key={k} className="truncate">
											{s}
										</div>
									))}
								</td>
								<td className="px-3 py-1.5">
									<Select
										aria-label={`Target for ${header || `column ${i + 1}`}`}
										selectedKey={targetKey(m)}
										onSelectionChange={(k) => {
											const key = String(k);
											if (key === "skip") set(i, { kind: "skip" });
											else if (key === "new")
												set(
													i,
													m.kind === "new"
														? m
														: {
																kind: "new",
																key: freshKey(header, i, dataset, mapping),
																type: "text",
															},
												);
											else set(i, { kind: "column", column: key.slice(4) });
										}}
									>
										{[
											...dataset.columns.map((c) => (
												<SelectItem key={c.key} id={`col:${c.key}`}>
													{c.title ? `${c.key} · ${c.title}` : c.key}
												</SelectItem>
											)),
											<SelectItem key="new" id="new">
												{m.kind === "new"
													? `New column: ${m.key} (${TYPE_LABELS[m.type].toLowerCase()})`
													: "New column"}
											</SelectItem>,
											<SelectItem key="skip" id="skip">
												Skip
											</SelectItem>,
										]}
									</Select>
									{m.kind === "new" ? (
										<div className="mt-1 flex gap-1">
											<input
												aria-label={`New column key for ${header || `column ${i + 1}`}`}
												value={newKey}
												spellCheck={false}
												onChange={(e) =>
													set(i, { ...m, key: e.target.value.trim() })
												}
												onKeyDown={(e) => e.stopPropagation()}
												className={cn(
													inputBase,
													"h-fc-control flex-1 font-fc-mono text-[11px]",
													problem && "border-fc-danger",
												)}
											/>
											<Select
												aria-label={`New column type for ${header || `column ${i + 1}`}`}
												className="w-28 shrink-0"
												selectedKey={m.type}
												onSelectionChange={(k) =>
													set(i, { ...m, type: k as ColumnType })
												}
											>
												{COLUMN_TYPES.map((t) => (
													<SelectItem key={t} id={t}>
														{TYPE_LABELS[t]}
													</SelectItem>
												))}
											</Select>
										</div>
									) : null}
									{problem ? (
										<p
											className={cn(
												"mt-1 text-fc-sm",
												problem.startsWith("Also")
													? "text-fc-warning"
													: "text-fc-danger",
											)}
										>
											{problem}
										</p>
									) : null}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
			{onMatch && dataset.columns.length > 0 && dataset.records.length > 0 ? (
				<div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
					<Checkbox
						isSelected={match !== null}
						onChange={(on) =>
							onMatch(
								on
									? {
											source: Math.max(
												mapping.findIndex((m) => m.kind === "column"),
												0,
											),
											column:
												mapping.find(
													(
														m,
													): m is Extract<ColumnMapping, { kind: "column" }> =>
														m.kind === "column",
												)?.column ??
												dataset.columns[0]?.key ??
												"",
										}
									: null,
							)
						}
					>
						Match existing records by
					</Checkbox>
					{match ? (
						<>
							<Select
								aria-label="Source column to match"
								className="w-40"
								selectedKey={String(match.source)}
								onSelectionChange={(k) =>
									onMatch({ ...match, source: Number(k) })
								}
							>
								{headers.map((h, i) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: source columns are positional
									<SelectItem key={i} id={String(i)}>
										{h || `Column ${i + 1}`}
									</SelectItem>
								))}
							</Select>
							<span className="text-fc-muted">equals</span>
							<Select
								aria-label="Dataset column to match"
								className="w-40"
								selectedKey={match.column}
								onSelectionChange={(k) =>
									onMatch({ ...match, column: String(k) })
								}
							>
								{dataset.columns.map((c) => (
									<SelectItem key={c.key} id={c.key}>
										{c.key}
									</SelectItem>
								))}
							</Select>
						</>
					) : null}
				</div>
			) : null}
		</div>
	);
}

function freshKey(
	header: string,
	index: number,
	dataset: Dataset,
	mapping: ColumnMapping[],
): string {
	const taken = new Set([
		...dataset.columns.map((c) => c.key),
		...mapping.flatMap((m, j) =>
			m.kind === "new" && j !== index ? [m.key] : [],
		),
	]);
	const guess = guessMapping([header || `column ${index + 1}`], [])[0];
	let key = guess?.kind === "new" ? guess.key : "column";
	for (let n = 2; taken.has(key); n++)
		key = `${guess?.kind === "new" ? guess.key : "column"}_${n}`;
	return key;
}

function PreviewTable({
	preview,
	mapping,
	headers,
}: {
	preview: ReturnType<typeof previewMapping>;
	mapping: ColumnMapping[];
	headers: string[];
}) {
	const keys = mapping.flatMap((m, i) =>
		m.kind === "skip"
			? []
			: [{ key: m.kind === "column" ? m.column : m.key, header: headers[i] }],
	);
	return (
		<div className="overflow-auto rounded-[3px] border border-fc-border">
			<table
				className="w-full border-collapse text-fc-sm"
				data-testid="import-preview"
			>
				<thead className="bg-fc-raised text-fc-muted">
					<tr>
						<th className="px-1.5 py-1 text-right font-medium">#</th>
						{keys.map((k, i) => (
							<th
								// biome-ignore lint/suspicious/noArrayIndexKey: targets are positional
								key={i}
								className="border-fc-border border-l px-1.5 py-1 text-left font-medium font-fc-mono"
								title={k.header}
							>
								{k.key}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{preview.map((row) => (
						<tr key={row.row} className="border-fc-border border-t">
							<td className="px-1.5 py-0.5 text-right text-fc-faint tabular-nums">
								{row.row + 1}
							</td>
							{row.cells.map((cell, i) => (
								<td
									// biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
									key={i}
									title={cell.message}
									data-bad={cell.ok ? undefined : ""}
									className={cn(
										"relative max-w-48 truncate border-fc-border border-l px-1.5 py-0.5",
										!cell.ok && "bg-fc-danger/15 text-fc-danger-text",
									)}
								>
									{cell.value === null
										? ""
										: typeof cell.value === "boolean"
											? cell.value
												? "true"
												: "false"
											: String(cell.value)}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
