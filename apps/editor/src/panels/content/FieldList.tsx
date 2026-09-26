import type { FieldDefinition, Template } from "@freshcoat/coatfile";
import { Button } from "@freshcoat/ui/button";
import { Checkbox, Switch } from "@freshcoat/ui/checkbox";
import { ColorInput } from "@freshcoat/ui/color";
import { TextArea, TextField } from "@freshcoat/ui/field";
import { IconButton } from "@freshcoat/ui/icon-button";
import { cn } from "@freshcoat/ui/lib/cn";
import { NumberField } from "@freshcoat/ui/number-field";
import { PanelSection } from "@freshcoat/ui/panel";
import { Select, SelectItem } from "@freshcoat/ui/select";
import { type ReactNode, useMemo, useState } from "react";
import { Button as RACButton } from "react-aria-components";
import { useController } from "~/app/context";
import { CONTENT } from "~/app/copy";
import {
	addField,
	fieldReferences,
	refuse,
	removeField,
	renameField,
	updateField,
} from "~/doc/ops";
import {
	type FieldEntry,
	humanize,
	isSystemField,
	listFields,
	referencedFields,
	sampleValues,
} from "~/doc/values";
import { useEditor } from "~/state/hooks";
import AddIcon from "~icons/mingcute/add-line";
import DeleteIcon from "~icons/mingcute/delete-2-line";
import ResetIcon from "~icons/mingcute/refresh-2-line";
import ChevronIcon from "~icons/mingcute/right-line";
import {
	FIELD_FORMATS,
	FIELD_SOURCES,
	fieldKeyError,
	setRequired,
	withPatch,
} from "./field-def";
import { Badge, DraftTextField, RefusalNotice, Subheading } from "./shared";

/** Every field in one list: its key, type and sample value on one line, and
 *  its definition when expanded. Fields a pipeline fills come last. */
export function FieldList({ template }: { template: Template }) {
	const controller = useController();
	const values = useEditor((s) => s.values);
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
	const [adding, setAdding] = useState(false);
	const [blocked, setBlocked] = useState<{ id: string; reason: string } | null>(
		null,
	);
	const fields = useMemo(() => listFields(template), [template]);
	const used = useMemo(() => referencedFields(template), [template]);
	const own = fields.filter((f) => !isSystemField(f.id, f.field));
	const system = fields.filter((f) => isSystemField(f.id, f.field));

	const toggle = (id: string, open?: boolean) =>
		setExpanded((prev) => {
			const next = new Set(prev);
			if (open ?? !next.has(id)) next.add(id);
			else next.delete(id);
			return next;
		});

	const create = (key: string): boolean => {
		const result = controller.edit(
			(t) => addField(t, key, { type: "string", title: humanize(key) }),
			{ scope: "base" },
		);
		if (!result?.ok) return false;
		controller.dispatch({
			type: "setValue",
			field: key,
			value: sampleValues(result.template)[key] ?? "",
		});
		setAdding(false);
		toggle(key, true);
		return true;
	};

	const rename = (from: string, to: string): boolean => {
		const result = controller.edit((t) => renameField(t, from, to), {
			scope: "base",
		});
		if (!result?.ok) return false;
		const value = controller.state.values[from];
		if (value !== undefined)
			controller.dispatch({ type: "setValue", field: to, value });
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.delete(from)) next.add(to);
			return next;
		});
		if (blocked?.id === from) setBlocked({ ...blocked, id: to });
		return true;
	};

	const remove = (id: string) => {
		const result = controller.edit((t) => removeField(t, id), {
			quiet: true,
			scope: "base",
		});
		if (!result) return;
		if (result.ok) {
			if (blocked?.id === id) setBlocked(null);
			toggle(id, false);
		} else setBlocked({ id, reason: result.reason });
	};

	const row = ({ id, field }: FieldEntry) => {
		const required = template.fields.required?.includes(id) ?? false;
		const references = blocked?.id === id ? fieldReferences(template, id) : [];
		return (
			<FieldRow
				key={id}
				id={id}
				field={field}
				required={required}
				unused={!used.has(id)}
				value={values[id] ?? ""}
				onValue={(value) =>
					controller.dispatch({ type: "setValue", field: id, value })
				}
				expanded={expanded.has(id)}
				onToggle={() => toggle(id)}
				onDelete={() => remove(id)}
				notice={
					blocked?.id === id && references.length > 0 ? (
						<RefusalNotice
							template={template}
							message={`${blocked.reason}. Remove them first:`}
							references={references}
							onDismiss={() => setBlocked(null)}
						/>
					) : null
				}
			>
				<FieldEditor
					id={id}
					field={field}
					required={required}
					taken={(k) => k !== id && k in template.fields.properties}
					onRename={(to) => rename(id, to)}
				/>
			</FieldRow>
		);
	};

	return (
		// At the inspector's narrowest, "Reset to samples" keeps only its icon so
		// the section's title still reads.
		<div className="@container">
			<PanelSection
				title={CONTENT.fields}
				actions={
					<>
						<Button
							size="sm"
							variant="ghost"
							isDisabled={fields.length === 0}
							onPress={() => controller.dispatch({ type: "resetValues" })}
						>
							<ResetIcon />
							<span className="@max-[15rem]:sr-only">
								{CONTENT.resetSamples}
							</span>
						</Button>
						<IconButton
							aria-label={CONTENT.addField}
							tooltip={CONTENT.addField}
							className="size-5 pointer-coarse:size-8"
							onPress={() => setAdding(true)}
						>
							<AddIcon />
						</IconButton>
					</>
				}
			>
				<div className="@container">
					<div className={ROWS}>
						{own.length === 0 && !adding ? <EmptyFields /> : null}
						{own.map(row)}
						{adding ? (
							<div className="col-span-full">
								<NewFieldKey
									taken={(k) => k in template.fields.properties}
									onCreate={create}
									onCancel={() => setAdding(false)}
								/>
							</div>
						) : null}
						{system.length > 0 ? (
							<>
								<div className="col-span-full">
									<Subheading>{CONTENT.system}</Subheading>
								</div>
								{system.map(row)}
							</>
						) : null}
					</div>
				</div>
			</PanelSection>
		</div>
	);
}

function EmptyFields() {
	const [before, after] = CONTENT.empty.split("{{key}}");
	return (
		<p className="col-span-full m-0 text-fc-faint text-fc-sm">
			{before}
			<code className="font-fc-mono">{"{{key}}"}</code>
			{after}
		</p>
	);
}

function NewFieldKey({
	taken,
	onCreate,
	onCancel,
}: {
	taken: (key: string) => boolean;
	onCreate: (key: string) => boolean;
	onCancel: () => void;
}) {
	const [key, setKey] = useState("");
	const [touched, setTouched] = useState(false);
	const error = touched ? fieldKeyError(key, taken) : null;
	return (
		<TextField
			aria-label={CONTENT.newKey}
			placeholder="Key, e.g. first_name"
			autoFocus
			value={key}
			onChange={(v) => {
				setKey(v);
				setTouched(v !== "");
			}}
			isInvalid={!!error}
			errorMessage={error ?? undefined}
			inputClassName="font-fc-mono"
			onKeyDown={(e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					setTouched(true);
					if (!fieldKeyError(key, taken)) onCreate(key);
				} else if (e.key === "Escape") onCancel();
			}}
			onBlur={() => {
				if (key === "") onCancel();
			}}
		/>
	);
}

/** Values too long for the row's own line take a second one under it. */
const OWN_LINE = new Set<FieldDefinition["format"]>(["longText", "image"]);

/** The rows share their columns: the key column is as wide as the longest key
 *  (up to 60%), so short keys are never cut and the values line up after
 *  them. Each row is a subgrid of this. Below 14rem, at the inspector's
 *  narrowest, every value takes a second line so the keys stay legible. */
const ROWS =
	"grid grid-cols-[fit-content(60%)_minmax(0,1fr)_auto] items-center gap-x-1 gap-y-1 @max-[14rem]:grid-cols-[minmax(0,1fr)_auto]";

function FieldRow({
	id,
	field,
	required,
	unused,
	value,
	onValue,
	expanded,
	onToggle,
	onDelete,
	notice,
	children,
}: {
	id: string;
	field: FieldDefinition;
	required: boolean;
	unused: boolean;
	value: string;
	onValue: (value: string) => void;
	expanded: boolean;
	onToggle: () => void;
	onDelete: () => void;
	notice: ReactNode;
	children: ReactNode;
}) {
	const format = FIELD_FORMATS.find((f) => f.id === (field.format ?? "text"));
	const type = format?.name ?? field.format;
	const title = field.title ?? humanize(id);
	const ownLine = OWN_LINE.has(field.format);
	const input = (
		<div
			data-testid={`value-${id}`}
			className={cn(
				"flex min-w-0 items-center",
				ownLine
					? "col-span-full pt-0.5 pr-6 pb-1 pl-5"
					: "@max-[14rem]:col-span-full @max-[14rem]:row-start-2 @max-[14rem]:pr-6 @max-[14rem]:pb-1 @max-[14rem]:pl-5",
			)}
		>
			<ValueInput
				field={field}
				title={title}
				value={value}
				onChange={onValue}
			/>
		</div>
	);
	return (
		<div
			data-testid={`field-${id}`}
			className={cn(
				"col-span-full grid grid-cols-subgrid items-center rounded-[3px]",
				expanded && "bg-fc-app/40 pb-2 ring-1 ring-fc-border",
			)}
		>
			<RACButton
				aria-expanded={expanded}
				aria-label={`${id} field`}
				onPress={onToggle}
				className={cn(
					"flex h-fc-control min-w-0 cursor-default items-center gap-1 rounded-[3px] pl-0.5 text-left outline-none data-hovered:bg-fc-hover data-focus-visible:outline-solid data-focus-visible:outline-1 data-focus-visible:outline-fc-accent pointer-coarse:h-8",
					ownLine && "col-span-2 @max-[14rem]:col-span-1",
				)}
			>
				<ChevronIcon
					className={cn(
						"size-3.5 shrink-0 text-fc-muted transition-transform duration-100",
						expanded && "rotate-90",
					)}
				/>
				<span
					className="min-w-0 truncate font-fc-mono text-fc-text text-[11px]"
					title={`${id} (${type})`}
				>
					{id}
				</span>
				{required ? (
					<span className="shrink-0 text-fc-danger" title="Required">
						*
					</span>
				) : null}
				{/* An unused field shows the badge in the type's place, so the row
				    needs no more room than the others; the type is in the
				    definition and the key's tooltip. */}
				{unused ? (
					<Badge tone="warning" className="ml-auto">
						{CONTENT.unused}
					</Badge>
				) : (
					<span className="ml-auto shrink-0 pl-0.5 text-[10px] text-fc-faint">
						{type}
					</span>
				)}
			</RACButton>
			{ownLine ? null : input}
			<IconButton
				aria-label={`Delete field ${id}`}
				tooltip="Delete field"
				className="mr-0.5 size-5 pointer-coarse:size-8"
				onPress={onDelete}
			>
				<DeleteIcon />
			</IconButton>
			{ownLine ? input : null}
			{notice ? <div className="col-span-full px-1 pt-1">{notice}</div> : null}
			{expanded ? (
				<fieldset
					aria-label={`${id} definition`}
					className="col-span-full m-0 flex min-w-0 flex-col gap-1.5 border-0 px-2 pt-1.5 pb-0"
				>
					{children}
				</fieldset>
			) : null}
		</div>
	);
}

/** The sample value's input, by the field's format. */
function ValueInput({
	field,
	title,
	value,
	onChange,
}: {
	field: FieldDefinition;
	title: string;
	value: string;
	onChange: (value: string) => void;
}) {
	switch (field.format) {
		case "boolean":
			return (
				<Switch
					aria-label={title}
					isSelected={value === "true"}
					onChange={(on) => onChange(on ? "true" : "false")}
				/>
			);
		case "color":
			return (
				<ColorInput
					aria-label={title}
					value={value}
					onChange={onChange}
					className="flex-1"
				/>
			);
		case "longText":
			return (
				<TextArea
					aria-label={title}
					value={value}
					onChange={onChange}
					rows={3}
					className="flex-1"
				/>
			);
		case "image":
		case "url":
			return (
				<TextField
					aria-label={title}
					value={value}
					onChange={onChange}
					placeholder={field.format === "image" ? "Image URL" : "https://"}
					className="flex-1"
					inputClassName="font-fc-mono text-[11px]"
				/>
			);
		default:
			return (
				<TextField
					aria-label={title}
					value={value}
					onChange={onChange}
					className="flex-1"
					isInvalid={
						field.maxLength !== undefined && value.length > field.maxLength
					}
				/>
			);
	}
}

function FieldEditor({
	id,
	field,
	required,
	taken,
	onRename,
}: {
	id: string;
	field: FieldDefinition;
	required: boolean;
	taken: (key: string) => boolean;
	onRename: (to: string) => boolean;
}) {
	const controller = useController();
	const patch = (p: Partial<FieldDefinition>, mergeKey?: string) =>
		controller.edit(
			(t) => {
				const def = t.fields.properties[id];
				if (!def) return refuse("unknown_field", `No field called "${id}"`);
				return updateField(t, id, withPatch(def, p));
			},
			{ mergeKey: mergeKey && `field:${id}:${mergeKey}`, scope: "base" },
		)?.ok ?? false;

	const setFormat = (format: string) => {
		const next = format === "text" ? undefined : format;
		const p: Partial<FieldDefinition> = {
			format: next as FieldDefinition["format"],
		};
		if (
			next === "boolean" &&
			field.default !== undefined &&
			field.default !== "true" &&
			field.default !== "false"
		)
			p.default = undefined;
		if (!patch(p)) return;
		const t = controller.template;
		if (t)
			controller.dispatch({
				type: "setValue",
				field: id,
				value: sampleValues(t)[id] ?? "",
			});
	};

	return (
		<>
			<DraftTextField
				label="Key"
				labelPosition="side"
				value={id}
				commitOn="blur"
				validate={(k) => (k === id ? null : fieldKeyError(k, taken))}
				onCommit={onRename}
				inputClassName="font-fc-mono"
			/>
			<DraftTextField
				label="Title"
				labelPosition="side"
				value={field.title ?? ""}
				placeholder={humanize(id)}
				onCommit={(v) => patch({ title: v || undefined }, "title")}
			/>
			<DraftTextField
				label="Description"
				labelPosition="side"
				multiline
				rows={2}
				value={field.description ?? ""}
				onCommit={(v) => patch({ description: v || undefined }, "description")}
			/>
			{field.format === "boolean" ? (
				<Select
					label="Default"
					labelPosition="side"
					selectedKey={field.default ?? "none"}
					onSelectionChange={(k) =>
						patch({ default: k === "none" ? undefined : String(k) })
					}
				>
					<SelectItem id="none">None</SelectItem>
					<SelectItem id="true">On</SelectItem>
					<SelectItem id="false">Off</SelectItem>
				</Select>
			) : (
				<DraftTextField
					label="Default"
					labelPosition="side"
					value={field.default ?? ""}
					placeholder="None"
					onCommit={(v) => patch({ default: v || undefined }, "default")}
				/>
			)}
			<Select
				label="Format"
				labelPosition="side"
				items={FIELD_FORMATS}
				selectedKey={field.format ?? "text"}
				onSelectionChange={(k) => setFormat(String(k))}
			>
				{(item) => <SelectItem id={item.id}>{item.name}</SelectItem>}
			</Select>
			<Select
				label="Source"
				labelPosition="side"
				items={FIELD_SOURCES}
				selectedKey={field["x-source"] ?? "unset"}
				onSelectionChange={(k) =>
					patch({
						"x-source":
							k === "unset"
								? undefined
								: (String(k) as FieldDefinition["x-source"]),
					})
				}
			>
				{(item) => <SelectItem id={item.id}>{item.name}</SelectItem>}
			</Select>
			<div className="flex items-center gap-2">
				<span className="w-16 shrink-0 truncate text-fc-muted text-fc-sm">
					Max length
				</span>
				<NumberField
					aria-label="Max length"
					className="min-w-0 flex-1"
					value={field.maxLength ?? null}
					placeholder="None"
					min={0}
					precision={0}
					onChange={(n) =>
						patch({ maxLength: n > 0 ? n : undefined }, "maxLength")
					}
				/>
			</div>
			<DraftTextField
				label="Pattern"
				labelPosition="side"
				value={field.pattern ?? ""}
				placeholder="Regular expression"
				inputClassName="font-fc-mono"
				validate={(v) => {
					try {
						new RegExp(v);
						return null;
					} catch {
						return "Not a valid regular expression";
					}
				}}
				onCommit={(v) => patch({ pattern: v || undefined }, "pattern")}
			/>
			<Checkbox
				className="pl-18"
				isSelected={required}
				onChange={(on) => {
					controller.edit((t) => setRequired(t, id, on), { scope: "base" });
				}}
			>
				Required
			</Checkbox>
		</>
	);
}
