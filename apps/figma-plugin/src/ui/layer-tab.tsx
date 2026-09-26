import {
	Bold,
	Button,
	Checkbox,
	Code,
	Dropdown,
	type DropdownOption,
	IconButton,
	IconCheck16,
	IconClose16,
	IconPlus16,
	IconVisible16,
	SegmentedControl,
	Text,
	Textbox,
} from "@create-figma-plugin/ui";
import { type Symbology, symbologyLabel } from "@freshcoat/coatfile";
import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import {
	type BindProperty,
	extractTokens,
	type FieldFormat,
	type FieldMeta,
	formatsForProperty,
	type MarkerKind,
	markerName,
	NAME_MARKED_PROPERTIES,
	parseMarker,
	parseVisibilityMarker,
} from "~/lib/figma/binding";
import {
	BARCODE_SYMBOLOGIES,
	DEFAULT_SYMBOLOGY,
	parseBarcodeLayerName,
} from "~/lib/figma/transpiler/barcode-name";
import { titleCase } from "~/lib/figma/transpiler/fields";
import type { SelectionDetail } from "~/shared/protocol";
import {
	byPropertyOrder,
	formatLabel,
	propertyLabel,
} from "~/ui/binding-labels";
import {
	Badge,
	EmptyState,
	Hint,
	IconSlot,
	InlineConfirm,
	ListButton,
	PropertyIcon,
} from "~/ui/components";
import { listOf } from "~/ui/copy";
import {
	Field,
	FieldGroup,
	Fill,
	Indented,
	Panel,
	Row,
	Section,
	SectionTitle,
	Stack,
	Truncate,
} from "~/ui/layout";
import { useMainMessage } from "~/ui/messages";
import { postToMain } from "~/ui/post";
import { useAnnounce } from "~/ui/status";

export function slugifyId(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
}

function substituteToken(template: string, from: string, to: string): string {
	return template.replace(
		new RegExp(`\\{\\{\\s*${from}\\s*\\}\\}`, "g"),
		`{{${to}}}`,
	);
}

const SOURCE_OPTIONS = [
	{ value: "user", children: "User" },
	{ value: "system", children: "System" },
	{ value: "order", children: "Order" },
];

const EDITABLE: Array<keyof FieldMeta> = [
	"id",
	"title",
	"format",
	"source",
	"required",
];

function isDirty(
	detail: SelectionDetail,
	drafts: Record<string, FieldMeta>,
): boolean {
	return detail.fields.some((f) => {
		const draft = drafts[f.id];
		return draft && EDITABLE.some((k) => draft[k] !== f.meta[k]);
	});
}

/** What the last action sent, so the next selection-detail (main's echo of
 *  the write) can be answered with the right confirmation. */
type Pending =
	| { kind: "apply"; nodeId: string }
	| { kind: "bind"; nodeId: string; label: string }
	| { kind: "remove"; nodeId: string; label: string }
	| { kind: "unbind"; nodeId: string }
	| { kind: "visibility"; nodeId: string };

const APPLIED_MS = 1500;

const SYMBOLOGY_OPTIONS: DropdownOption[] = BARCODE_SYMBOLOGIES.map((s) => ({
	value: s,
	text: symbologyLabel(s),
}));

/** The symbology a `barcode:{{id}}` layer names, when its value is one whole
 *  field: the only shape the picker rewrites without losing anything. */
function barcodeSymbology(name: string): Symbology | null {
	const parsed = parseBarcodeLayerName(name);
	if (!parsed || parsed.mode !== "token") return null;
	return parsed.symbology ?? DEFAULT_SYMBOLOGY;
}

// The `;key=value` options after a marker's value, kept when the symbology is
// rewritten.
function markerOptions(name: string): string {
	const end = name.lastIndexOf("}}");
	const semi = name.indexOf(";", end === -1 ? 0 : end);
	return semi === -1 ? "" : name.slice(semi);
}

export function LayerTab(): JSX.Element {
	const announce = useAnnounce();
	const [detail, setDetail] = useState<SelectionDetail | null>(null);
	const [drafts, setDrafts] = useState<Record<string, FieldMeta>>({});
	const [applied, setApplied] = useState(false);
	// "all" for the whole binding, a property name for one of several.
	const [confirming, setConfirming] = useState<string | null>(null);
	const [visibilityOpen, setVisibilityOpen] = useState(false);
	const [symbology, setSymbology] = useState<Symbology | null>(null);
	const pendingRef = useRef<Pending | null>(null);
	const appliedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(
		() => () => {
			if (appliedTimer.current) clearTimeout(appliedTimer.current);
		},
		[],
	);

	useMainMessage((msg) => {
		if (msg.type !== "selection-detail") return;
		const next = msg.detail;
		const pending = pendingRef.current;
		if (pending && (next === null || next.nodeId === pending.nodeId)) {
			pendingRef.current = null;
			if (pending.kind === "apply") {
				setApplied(true);
				if (appliedTimer.current) clearTimeout(appliedTimer.current);
				appliedTimer.current = setTimeout(() => setApplied(false), APPLIED_MS);
				announce("Applied", "success", { quiet: true });
			} else if (pending.kind === "bind") {
				announce(`Bound as ${pending.label.toLowerCase()}`, "success");
			} else if (pending.kind === "remove") {
				announce(`Unbound ${pending.label.toLowerCase()}`, "success");
			} else if (pending.kind === "visibility") {
				announce("Condition set", "success");
			} else if (next && next.fields.length > 0) {
				// Plugin data is cleared, but a `text:{{id}}` name still binds it.
				announce("Still bound by its layer name", "info");
			} else {
				announce("Unbound", "success");
			}
		}
		if (next?.nodeId !== detail?.nodeId) {
			setConfirming(null);
			setVisibilityOpen(false);
			setApplied(false);
		}
		setDetail(next);
		setSymbology(next ? barcodeSymbology(next.name) : null);
		const drafted: Record<string, FieldMeta> = {};
		for (const f of next?.fields ?? []) drafted[f.id] = { ...f.meta };
		setDrafts(drafted);
	});

	if (!detail) {
		return (
			<EmptyState
				title="Select a layer"
				line={
					<>
						Or mark it by name, like <Code>{"text:{{name}}"}</Code>
					</>
				}
			/>
		);
	}

	const header = (
		<SectionTitle
			action={<Badge>{titleCase(detail.nodeType.toLowerCase())}</Badge>}
		>
			{detail.name}
		</SectionTitle>
	);

	const isBound = detail.fields.length > 0;
	const condition = parseVisibilityMarker(detail.name);
	// A kind marker in the name (`image:{{logo}}`) is what binds some layers,
	// so writing an `if:` name over it would unbind them.
	const canSetCondition = parseMarker(detail.name) === null;

	const visibility =
		condition || visibilityOpen ? (
			<Section title="Visibility">
				{visibilityOpen ? (
					<VisibilityForm
						initial={condition}
						onCancel={() => setVisibilityOpen(false)}
						onApply={(name) => {
							pendingRef.current = {
								kind: "visibility",
								nodeId: detail.nodeId,
							};
							setVisibilityOpen(false);
							postToMain({
								type: "set-binding",
								nodeId: detail.nodeId,
								bind: detail.bind,
								fields: detail.fields.map((f) => f.meta),
								renames: [],
								removedIds: [],
								setName: name,
							});
						}}
					/>
				) : condition ? (
					<Row>
						<IconSlot>
							<IconVisible16 />
						</IconSlot>
						<Fill>
							<span style={{ display: "block", lineHeight: "16px" }}>
								{describeCondition(condition)}
							</span>
						</Fill>
						<Button secondary onClick={() => setVisibilityOpen(true)}>
							Edit
						</Button>
					</Row>
				) : null}
			</Section>
		) : null;

	if (!isBound) {
		const bindAs = (property: BindProperty, format: FieldFormat) => {
			const id = slugifyId(detail.name) || "field";
			const label = propertyLabel(property);
			pendingRef.current = { kind: "bind", nodeId: detail.nodeId, label };
			postToMain({
				type: "set-binding",
				nodeId: detail.nodeId,
				bind: { [property]: `{{${id}}}` },
				fields: [
					{ id, format, title: titleCase(id), required: true, source: "user" },
				],
				renames: [],
				removedIds: [],
				// Image, QR and barcode layers are recognized by their name, so
				// binding one writes its marker.
				...(NAME_MARKED_PROPERTIES.has(property)
					? { setName: markerName(property as MarkerKind, id) }
					: {}),
			});
		};
		const capabilities = [...detail.capabilities].sort((a, b) =>
			byPropertyOrder(a.property, b.property),
		);
		return (
			<Panel>
				{header}
				{visibility}
				<FieldGroup label="Bind as">
					<ul style={{ listStyle: "none", margin: "-4px -8px 0", padding: 0 }}>
						{capabilities.map((c) => (
							<li key={c.property}>
								<ListButton
									icon={
										<PropertyIcon property={c.property} format={c.format} />
									}
									title={propertyLabel(c.property)}
									meta={`${formatLabel(c.format)} field`}
									onClick={() => bindAs(c.property, c.format)}
								/>
							</li>
						))}
						{canSetCondition && !condition && !visibilityOpen ? (
							<li>
								<ListButton
									icon={<IconVisible16 />}
									title="Show when…"
									meta="Only while a field is set"
									onClick={() => setVisibilityOpen(true)}
								/>
							</li>
						) : null}
					</ul>
				</FieldGroup>
			</Panel>
		);
	}

	// Which property drives each field id (constrains its type options).
	const propByField: Record<string, BindProperty> = {};
	for (const [property, template] of Object.entries(detail.bind)) {
		if (!template) continue;
		for (const id of extractTokens(template)) {
			propByField[id] = property as BindProperty;
		}
	}
	const bound = (Object.keys(detail.bind) as BindProperty[])
		.filter((p) => detail.bind[p])
		.sort(byPropertyOrder);
	const storedSymbology = barcodeSymbology(detail.name);
	const symbologyChanged =
		storedSymbology !== null &&
		symbology !== null &&
		symbology !== storedSymbology;
	const dirty = isDirty(detail, drafts) || symbologyChanged;

	const updateDraft = (id: string, patch: Partial<FieldMeta>): void => {
		setApplied(false);
		setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
	};

	const apply = (): void => {
		const renames: Array<{ from: string; to: string }> = [];
		const bind: Record<string, string> = { ...detail.bind } as Record<
			string,
			string
		>;
		const fields: FieldMeta[] = [];
		for (const f of detail.fields) {
			const draft = drafts[f.id];
			if (!draft) continue;
			const newId = slugifyId(draft.id) || f.id;
			if (newId !== f.id) {
				renames.push({ from: f.id, to: newId });
				for (const key of Object.keys(bind)) {
					bind[key] = substituteToken(bind[key], f.id, newId);
				}
			}
			fields.push({ ...draft, id: newId });
		}
		// A new symbology is written into the name, under the field's new key.
		const barcodeId = bind.barcode ? extractTokens(bind.barcode)[0] : null;
		const setName =
			symbologyChanged && symbology && barcodeId
				? markerName("barcode", barcodeId, { symbology }) +
					markerOptions(detail.name)
				: undefined;
		pendingRef.current = { kind: "apply", nodeId: detail.nodeId };
		postToMain({
			type: "set-binding",
			nodeId: detail.nodeId,
			bind,
			fields,
			renames,
			removedIds: renames.map((r) => r.from),
			...(setName ? { setName } : {}),
		});
	};

	const unbind = (): void => {
		setConfirming(null);
		pendingRef.current = { kind: "unbind", nodeId: detail.nodeId };
		postToMain({
			type: "clear-binding",
			nodeId: detail.nodeId,
			removedIds: detail.fields.map((f) => f.id),
		});
	};

	const removeProperty = (property: BindProperty): void => {
		setConfirming(null);
		const bind = { ...detail.bind } as Record<string, string>;
		delete bind[property];
		const keep = new Set(Object.values(bind).flatMap((t) => extractTokens(t)));
		pendingRef.current = {
			kind: "remove",
			nodeId: detail.nodeId,
			label: propertyLabel(property),
		};
		postToMain({
			type: "set-binding",
			nodeId: detail.nodeId,
			bind,
			fields: detail.fields.filter((f) => keep.has(f.id)).map((f) => f.meta),
			renames: [],
			removedIds: detail.fields.filter((f) => !keep.has(f.id)).map((f) => f.id),
		});
	};

	const addProperty = (property: BindProperty, format: FieldFormat): void => {
		const base = detail.fields[0]?.id ?? (slugifyId(detail.name) || "field");
		const id = `${base}_${property === "textColor" ? "color" : property}`;
		const label = propertyLabel(property);
		pendingRef.current = { kind: "bind", nodeId: detail.nodeId, label };
		postToMain({
			type: "set-binding",
			nodeId: detail.nodeId,
			bind: { ...detail.bind, [property]: `{{${id}}}` },
			fields: [
				...detail.fields.map((f) => f.meta),
				{ id, format, title: titleCase(id), required: true, source: "user" },
			],
			renames: [],
			removedIds: [],
		});
	};

	// More bindings on the same layer, limited to those that live in plugin
	// data: a name-marker kind would overwrite the marker already there.
	const addable = detail.capabilities
		.filter(
			(c) =>
				!bound.includes(c.property) && !NAME_MARKED_PROPERTIES.has(c.property),
		)
		.sort((a, b) => byPropertyOrder(a.property, b.property));

	const footer =
		confirming === "all" ? (
			<InlineConfirm
				question={`Unbind ${listOf(detail.fields.map((f) => f.id))}?`}
				confirmLabel="Unbind"
				onConfirm={unbind}
				onCancel={() => setConfirming(null)}
			/>
		) : (
			<Row>
				<Fill>
					{dirty ? (
						<Truncate text="Unapplied changes" muted />
					) : applied ? (
						<Row gap="extraSmall">
							<IconSlot>
								<span
									style={{
										display: "flex",
										color: "var(--figma-color-icon-success)",
									}}
								>
									<IconCheck16 />
								</span>
							</IconSlot>
							<Truncate text="Applied" />
						</Row>
					) : null}
				</Fill>
				<Button secondary onClick={() => setConfirming("all")}>
					Unbind
				</Button>
				<Button onClick={apply} disabled={!dirty}>
					Apply
				</Button>
			</Row>
		);

	return (
		<Panel footer={footer}>
			{header}
			<FieldGroup label="Bindings">
				<Stack gap="extraSmall">
					{bound.map((property) =>
						confirming === property ? (
							<InlineConfirm
								key={property}
								question={`Unbind ${propertyLabel(property).toLowerCase()}?`}
								confirmLabel="Unbind"
								onConfirm={() => removeProperty(property)}
								onCancel={() => setConfirming(null)}
							/>
						) : (
							<Row key={property}>
								<IconSlot>
									<PropertyIcon
										property={property}
										format={formatsForProperty(property)[0]}
										color={
											detail.fields.find((f) =>
												detail.bind[property]?.includes(`{{${f.id}}}`),
											)?.meta.default
										}
									/>
								</IconSlot>
								<Fill>
									<span
										title={`${propertyLabel(property)} ${detail.bind[property]}`}
										style={{
											display: "block",
											lineHeight: "16px",
											overflow: "hidden",
											textOverflow: "ellipsis",
											whiteSpace: "nowrap",
										}}
									>
										{propertyLabel(property)}{" "}
										<Code>{detail.bind[property]}</Code>
									</span>
								</Fill>
								{bound.length > 1 ? (
									<IconButton
										aria-label={`Unbind ${propertyLabel(property).toLowerCase()}`}
										title={`Unbind ${propertyLabel(property).toLowerCase()}`}
										onClick={() => setConfirming(property)}
									>
										<IconClose16 />
									</IconButton>
								) : null}
							</Row>
						),
					)}
				</Stack>
			</FieldGroup>
			{storedSymbology !== null && symbology !== null ? (
				<FieldGroup label="Symbology" inline>
					<Dropdown
						options={SYMBOLOGY_OPTIONS}
						value={symbology}
						onValueChange={(v) => {
							setApplied(false);
							setSymbology(v as Symbology);
						}}
					/>
				</FieldGroup>
			) : null}

			{detail.fields.map((f) => {
				const draft = drafts[f.id] ?? f.meta;
				const property = propByField[f.id] ?? "text";
				const formatOptions: DropdownOption[] = formatsForProperty(
					property,
				).map((fmt) => ({ value: fmt, text: formatLabel(fmt) }));
				return (
					<Section key={f.id} title={`Field ${f.id}`}>
						<Field label="Key" inline>
							<Textbox
								value={draft.id}
								onValueInput={(v) => updateDraft(f.id, { id: v })}
							/>
						</Field>
						<Field label="Label" inline>
							<Textbox
								value={draft.title}
								onValueInput={(v) => updateDraft(f.id, { title: v })}
							/>
						</Field>
						<FieldGroup label="Type" inline>
							<Dropdown
								options={formatOptions}
								value={draft.format}
								disabled={formatOptions.length < 2}
								onValueChange={(v) =>
									updateDraft(f.id, { format: v as FieldFormat })
								}
							/>
						</FieldGroup>
						<FieldGroup label="Source" inline>
							<SegmentedControl
								options={SOURCE_OPTIONS}
								value={draft.source}
								onValueChange={(v) =>
									updateDraft(f.id, { source: v as FieldMeta["source"] })
								}
							/>
						</FieldGroup>
						<Indented>
							<Checkbox
								value={draft.required ?? true}
								onValueChange={(v) => updateDraft(f.id, { required: v })}
							>
								<Text>Required</Text>
							</Checkbox>
						</Indented>
					</Section>
				);
			})}

			{addable.length > 0 ? (
				<FieldGroup label="Also bind">
					<div style={{ margin: "-4px -8px 0" }}>
						{addable.map((c) => (
							<ListButton
								key={c.property}
								icon={<IconPlus16 />}
								title={propertyLabel(c.property)}
								meta={`${formatLabel(c.format)} field`}
								onClick={() => addProperty(c.property, c.format)}
							/>
						))}
					</div>
				</FieldGroup>
			) : null}
			{visibility}
		</Panel>
	);
}

type Condition = NonNullable<ReturnType<typeof parseVisibilityMarker>>;

function describeCondition(c: Condition): JSX.Element {
	return (
		<>
			Shown when <Bold>{c.field}</Bold>{" "}
			{c.equals !== undefined
				? `is ${c.equals}`
				: c.not
					? "is not set"
					: "is set"}
		</>
	);
}

const CONDITION_OPTIONS: DropdownOption[] = [
	{ value: "set", text: "Is set" },
	{ value: "unset", text: "Is not set" },
	{ value: "equals", text: "Equals" },
];

/** The `if:` marker as a form. It writes the layer name, which is where the
 *  transpiler reads the condition from. */
function VisibilityForm(props: {
	initial: Condition | null;
	onApply: (layerName: string) => void;
	onCancel: () => void;
}): JSX.Element {
	const { initial } = props;
	const [field, setField] = useState(initial?.field ?? "");
	const [mode, setMode] = useState(
		initial?.equals !== undefined ? "equals" : initial?.not ? "unset" : "set",
	);
	const [value, setValue] = useState(initial?.equals ?? "");
	const id = slugifyId(field);
	const valid =
		id !== "" && /^[a-z_]/.test(id) && (mode !== "equals" || value !== "");
	const name = (): string => {
		if (mode === "unset") return `if:!{{${id}}}`;
		if (mode === "equals")
			return `if:{{${id}}}=${/^\S+$/.test(value) && !value.includes('"') ? value : `"${value.replace(/"/g, "")}"`}`;
		return `if:{{${id}}}`;
	};
	return (
		<Stack gap="small">
			<Field label="Field" inline>
				<Textbox
					value={field}
					onValueInput={setField}
					placeholder="show_badge"
				/>
			</Field>
			<FieldGroup label="Condition" inline>
				<Dropdown
					options={CONDITION_OPTIONS}
					value={mode}
					onValueChange={setMode}
				/>
			</FieldGroup>
			{mode === "equals" ? (
				<Field label="Value" inline>
					<Textbox value={value} onValueInput={setValue} placeholder="gold" />
				</Field>
			) : null}
			<Hint>
				Renames the layer to {valid ? <Code>{name()}</Code> : "an if: marker"}
			</Hint>
			<Row justify="end">
				<Button secondary onClick={props.onCancel}>
					Cancel
				</Button>
				<Button disabled={!valid} onClick={() => props.onApply(name())}>
					Apply
				</Button>
			</Row>
		</Stack>
	);
}
