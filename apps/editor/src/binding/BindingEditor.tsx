import { isEmptyVariant, type Template } from "@freshcoat-js/coatfile";
import { TextField } from "@freshcoat-js/ui/field";
import { cn } from "@freshcoat-js/ui/lib/cn";
import { NumberField } from "@freshcoat-js/ui/number-field";
import { Select, SelectItem } from "@freshcoat-js/ui/select";
import type {
	Binding,
	Dataset,
	FieldSource,
	VariantSource,
} from "@freshcoat-js/workspace";
import { useMemo } from "react";
import { useController } from "~/app/context";
import { EMPTY, VARIANT_EXPORT } from "~/app/copy";
import { useEditor } from "~/state/hooks";
import WarningIcon from "~icons/mingcute/warning-line";
import {
	imageFields,
	readsDataset,
	rebindDataset,
	SOURCE_KINDS,
	type SourceKind,
	sourceOfKind,
	sourceProblem,
	type TemplateField,
	templateFields,
	unboundBinding,
	type VariantKind,
	variantSourceOfKind,
	withFieldSource,
	withVariantSource,
} from "./binding";

const NONE = "__none__";

export type BindingEditorProps = {
	template: Template;
	binding: Binding | undefined;
	datasets: readonly Dataset[];
	onChange: (binding: Binding | undefined) => void;
	className?: string;
};

/** Which dataset a template reads from, where each of its fields gets its
 *  value, and which variants it exports. With no dataset only the variant
 *  choice remains, held by a binding with no dataset id. Controlled: every
 *  change is a whole new binding. */
export function BindingEditor({
	template,
	binding,
	datasets,
	onChange,
	className,
}: BindingEditorProps) {
	const bound = readsDataset(binding) ? binding : undefined;
	const dataset = bound
		? datasets.find((d) => d.id === bound.datasetId)
		: undefined;
	const fields = useMemo(() => templateFields(template), [template]);
	const missing = bound !== undefined && dataset === undefined;

	return (
		<div
			className={cn("flex flex-col gap-2", className)}
			data-testid="binding-editor"
		>
			<Select
				label="Dataset"
				value={dataset ? dataset.id : NONE}
				onChange={(key) => {
					const next = datasets.find((d) => d.id === key);
					onChange(rebindDataset(template, next, binding));
				}}
			>
				<SelectItem id={NONE} textValue="None">
					None (use defaults)
				</SelectItem>
				{datasets.map((d) => (
					<SelectItem key={d.id} id={d.id} textValue={d.name}>
						{d.name}
					</SelectItem>
				))}
			</Select>
			{missing ? (
				<p className="text-fc-sm text-fc-warning">
					Dataset not found. Choose another.
				</p>
			) : null}
			{bound ? (
				<>
					<div className="flex flex-col divide-y divide-fc-border rounded-[3px] border border-fc-border">
						{fields.length === 0 ? (
							<p className="px-2 py-2 text-fc-faint text-fc-sm">
								{EMPTY.fields}
							</p>
						) : (
							fields.map((field) => (
								<FieldRow
									key={field.key}
									field={field}
									source={bound.fields[field.key]}
									dataset={dataset}
									onChange={(source) =>
										onChange(withFieldSource(bound, field.key, source))
									}
								/>
							))
						)}
					</div>
					<VariantRow
						template={template}
						source={bound.variant}
						dataset={dataset}
						onChange={(source) => onChange(withVariantSource(bound, source))}
					/>
				</>
			) : (
				<>
					<p className="text-fc-faint text-fc-sm">{VARIANT_EXPORT.unbound}</p>
					{(template.variants?.length ?? 0) > 0 ? (
						<VariantRow
							template={template}
							source={binding?.variant}
							dataset={undefined}
							onChange={(source) => onChange(unboundBinding(source))}
						/>
					) : null}
				</>
			)}
		</div>
	);
}

function FieldRow({
	field,
	source,
	dataset,
	onChange,
}: {
	field: TemplateField;
	source: FieldSource | undefined;
	dataset: Dataset | undefined;
	onChange: (source: FieldSource | undefined) => void;
}) {
	const kind: SourceKind = source?.kind ?? "default";
	const problem = sourceProblem(source, dataset);
	const unmatched = field.required && (source === undefined || !!problem);
	const warning = unmatched
		? problem
			? `Required: ${problem.toLowerCase()}`
			: "Required, no source"
		: problem;
	return (
		<div
			className="flex flex-col gap-1 px-2 py-1.5"
			data-testid={`binding-field-${field.key}`}
			data-unmatched={unmatched || undefined}
		>
			<div className="flex min-w-0 items-center gap-1 text-fc-sm">
				<span className="min-w-0 truncate text-fc-text">{field.title}</span>
				{field.required ? (
					<span aria-hidden className="text-fc-muted">
						*
					</span>
				) : null}
				<span className="min-w-0 truncate font-fc-mono text-fc-faint">
					{field.key}
				</span>
				{warning ? (
					<span
						role="img"
						aria-label={warning}
						title={warning}
						className="ml-auto flex shrink-0 text-fc-warning"
					>
						<WarningIcon className="size-3.5" />
					</span>
				) : null}
			</div>
			<div className="flex min-w-0 items-center gap-1">
				<Select
					aria-label={`Source for ${field.key}`}
					className="w-24 shrink-0"
					value={kind}
					onChange={(key) =>
						onChange(
							sourceOfKind(key as SourceKind, field.key, dataset, source),
						)
					}
				>
					{SOURCE_KINDS.map((k) => (
						<SelectItem key={k.id} id={k.id} textValue={k.label}>
							{k.label}
						</SelectItem>
					))}
				</Select>
				<div className="min-w-0 flex-1">
					<SourceInput
						field={field}
						source={source}
						dataset={dataset}
						onChange={onChange}
					/>
				</div>
			</div>
			{source?.kind === "serial" ? (
				<SerialInputs
					source={source}
					fieldKey={field.key}
					onChange={onChange}
				/>
			) : null}
		</div>
	);
}

function SourceInput({
	field,
	source,
	dataset,
	onChange,
}: {
	field: TemplateField;
	source: FieldSource | undefined;
	dataset: Dataset | undefined;
	onChange: (source: FieldSource | undefined) => void;
}) {
	if (source === undefined)
		return (
			<span
				className="block truncate px-1.5 text-fc-faint text-fc-sm"
				title={field.defaultValue}
			>
				{field.defaultValue === "" ? "Empty" : field.defaultValue}
			</span>
		);
	if (source.kind === "column")
		return (
			<ColumnSelect
				label={`Column for ${field.key}`}
				dataset={dataset}
				value={source.column}
				onChange={(column) => onChange({ kind: "column", column })}
			/>
		);
	if (source.kind === "constant")
		return (
			<TextField
				aria-label={`Fixed value for ${field.key}`}
				value={source.value}
				placeholder="Value"
				onChange={(value) => onChange({ kind: "constant", value })}
			/>
		);
	return (
		<span className="block truncate px-1.5 font-fc-mono text-fc-muted text-fc-sm">
			{serialExample(source)}
		</span>
	);
}

function serialExample(
	source: Extract<FieldSource, { kind: "serial" }>,
): string {
	const n = source.start;
	return `${source.prefix ?? ""}${n < 0 ? "-" : ""}${String(Math.abs(n)).padStart(source.pad, "0")}${source.suffix ?? ""}, …`;
}

function SerialInputs({
	source,
	fieldKey,
	onChange,
}: {
	source: Extract<FieldSource, { kind: "serial" }>;
	fieldKey: string;
	onChange: (source: FieldSource) => void;
}) {
	const set = (patch: Partial<typeof source>) => {
		const next = { ...source, ...patch };
		if (!next.prefix) delete next.prefix;
		if (!next.suffix) delete next.suffix;
		onChange(next);
	};
	return (
		<div className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-1">
			<NumberField
				label="Start"
				aria-label={`Serial start for ${fieldKey}`}
				value={source.start}
				precision={0}
				onChange={(start) => set({ start })}
			/>
			<NumberField
				label="Step"
				aria-label={`Serial step for ${fieldKey}`}
				value={source.step}
				precision={0}
				onChange={(step) => set({ step })}
			/>
			<NumberField
				label="Pad"
				aria-label={`Serial padding for ${fieldKey}`}
				value={source.pad}
				min={0}
				max={20}
				precision={0}
				onChange={(pad) => set({ pad })}
			/>
			<TextField
				aria-label={`Serial prefix for ${fieldKey}`}
				placeholder="Prefix"
				className="col-span-1"
				value={source.prefix ?? ""}
				onChange={(prefix) => set({ prefix })}
			/>
			<TextField
				aria-label={`Serial suffix for ${fieldKey}`}
				placeholder="Suffix"
				className="col-span-2"
				value={source.suffix ?? ""}
				onChange={(suffix) => set({ suffix })}
			/>
		</div>
	);
}

function ColumnSelect({
	label,
	dataset,
	value,
	onChange,
}: {
	label: string;
	dataset: Dataset | undefined;
	value: string;
	onChange: (column: string) => void;
}) {
	const columns = dataset?.columns ?? [];
	const known = columns.some((c) => c.key === value);
	return (
		<Select
			aria-label={label}
			value={known ? value : null}
			placeholder={value ? `${value} (missing)` : "Choose a column"}
			onChange={(key) => {
				if (typeof key === "string") onChange(key);
			}}
		>
			{columns.map((c) => (
				<SelectItem key={c.key} id={c.key} textValue={c.key}>
					{c.title && c.title !== c.key ? `${c.key} · ${c.title}` : c.key}
				</SelectItem>
			))}
		</Select>
	);
}

const VARIANT_KINDS: VariantKind[] = [
	"none",
	"fixed",
	"column",
	"image",
	"all",
];

function VariantRow({
	template,
	source,
	dataset,
	onChange,
}: {
	template: Template;
	source: VariantSource | undefined;
	dataset: Dataset | undefined;
	onChange: (source: VariantSource | undefined) => void;
}) {
	const variants = template.variants ?? [];
	const kind: VariantKind = source?.kind ?? "none";
	const photos = imageFields(template);
	// Without a dataset there is no column or photo to read a variant from.
	const kinds = dataset
		? VARIANT_KINDS
		: VARIANT_KINDS.filter(
				(k) => (k !== "column" && k !== "image") || kind === k,
			);
	const exported = variants.filter((v) => !isEmptyVariant(v)).length;
	return (
		<div className="flex flex-col gap-1" data-testid="binding-variant">
			<span className="text-fc-muted text-fc-sm">Variant</span>
			<div className="flex min-w-0 items-center gap-1">
				<Select
					aria-label="Variant source"
					className="w-28 shrink-0"
					value={kind}
					onChange={(key) =>
						onChange(
							variantSourceOfKind(
								key as VariantKind,
								template,
								dataset,
								source,
							),
						)
					}
				>
					{kinds.map((k) => (
						<SelectItem
							key={k}
							id={k}
							textValue={VARIANT_EXPORT.kinds[k]}
							isDisabled={
								((k === "fixed" || k === "all" || k === "image") &&
									variants.length === 0) ||
								(k === "image" && photos.length === 0)
							}
						>
							{VARIANT_EXPORT.kinds[k]}
						</SelectItem>
					))}
				</Select>
				<div className="min-w-0 flex-1">
					{source?.kind === "fixed" ? (
						<Select
							aria-label="Fixed variant"
							value={source.id ?? NONE}
							onChange={(key) =>
								onChange({
									kind: "fixed",
									...(key !== NONE && typeof key === "string"
										? { id: key }
										: {}),
								})
							}
						>
							<SelectItem id={NONE} textValue={VARIANT_EXPORT.default}>
								{VARIANT_EXPORT.default}
							</SelectItem>
							{variants.map((v) => (
								<SelectItem key={v.id} id={v.id} textValue={v.label}>
									{v.label}
								</SelectItem>
							))}
						</Select>
					) : source?.kind === "image" ? (
						<Select
							aria-label="Variant photo"
							value={source.field || null}
							placeholder={VARIANT_EXPORT.noPhoto}
							onChange={(key) =>
								onChange({ kind: "image", field: String(key) })
							}
						>
							{photos.map((f) => (
								<SelectItem key={f.key} id={f.key} textValue={f.title}>
									{f.title}
								</SelectItem>
							))}
						</Select>
					) : source?.kind === "column" ? (
						<ColumnSelect
							label="Variant column"
							dataset={dataset}
							value={source.column}
							onChange={(column) => onChange({ ...source, column })}
						/>
					) : (
						<VariantHint
							text={
								variants.length === 0
									? VARIANT_EXPORT.noVariants
									: source?.kind === "all"
										? VARIANT_EXPORT.allHint(exported)
										: VARIANT_EXPORT.defaultHint
							}
						/>
					)}
				</div>
			</div>
			{source?.kind === "column" ? (
				<FallbackRow template={template} source={source} onChange={onChange} />
			) : null}
		</div>
	);
}

const PHOTO_SHAPE = "\u0000photo";

/** What a variant column's empty cells, and cells that name no variant,
 *  render in. */
function FallbackRow({
	template,
	source,
	onChange,
}: {
	template: Template;
	source: Extract<VariantSource, { kind: "column" }>;
	onChange: (source: VariantSource) => void;
}) {
	const photos = imageFields(template);
	const fallback = source.fallback;
	const value =
		fallback?.kind === "image"
			? `${PHOTO_SHAPE}${fallback.field}`
			: (fallback?.id ?? NONE);
	const { fallback: _f, ...bare } = source;
	return (
		<div className="flex min-w-0 items-center gap-1">
			<span className="w-28 shrink-0 truncate pl-1.5 text-fc-faint text-fc-sm">
				{VARIANT_EXPORT.fallback}
			</span>
			<Select
				aria-label="Variant fallback"
				className="min-w-0 flex-1"
				value={value}
				onChange={(key) => {
					const k = String(key);
					onChange(
						k === NONE
							? bare
							: k.startsWith(PHOTO_SHAPE)
								? {
										...bare,
										fallback: {
											kind: "image",
											field: k.slice(PHOTO_SHAPE.length),
										},
									}
								: { ...bare, fallback: { kind: "fixed", id: k } },
					);
				}}
			>
				<SelectItem id={NONE} textValue={VARIANT_EXPORT.default}>
					{VARIANT_EXPORT.default}
				</SelectItem>
				{photos.map((f) => (
					<SelectItem
						key={f.key}
						id={`${PHOTO_SHAPE}${f.key}`}
						textValue={`${VARIANT_EXPORT.kinds.image}: ${f.title}`}
					>
						{photos.length > 1
							? `${VARIANT_EXPORT.kinds.image}: ${f.title}`
							: VARIANT_EXPORT.kinds.image}
					</SelectItem>
				))}
				{(template.variants ?? []).map((v) => (
					<SelectItem key={v.id} id={v.id} textValue={v.label}>
						{v.label}
					</SelectItem>
				))}
			</Select>
		</div>
	);
}

function VariantHint({ text }: { text: string }) {
	return (
		<span
			className="block truncate px-1.5 text-fc-faint text-fc-sm"
			title={text}
			data-testid="binding-variant-hint"
		>
			{text}
		</span>
	);
}

/** The binding editor for one of the workspace's templates, wired to the store. */
export function TemplateBindingEditor({
	templateId,
	className,
}: {
	templateId: string;
	className?: string;
}) {
	const controller = useController();
	const slot = useEditor((s) =>
		s.workspace?.templates.find((t) => t.id === templateId),
	);
	const isActive = useEditor(
		(s) => s.workspace?.activeTemplateId === templateId,
	);
	const live = useEditor((s) => s.doc?.history.present);
	const datasets = useEditor((s) => s.workspace?.datasets);
	if (!slot || !datasets) return null;
	const template =
		isActive && live
			? live
			: (slot.parked?.doc.history.present ?? slot.template);
	return (
		<BindingEditor
			className={className}
			template={template}
			binding={slot.binding}
			datasets={datasets}
			onChange={(binding) =>
				controller.dispatch({ type: "setBinding", id: templateId, binding })
			}
		/>
	);
}
