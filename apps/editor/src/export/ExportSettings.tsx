import {
	hasInsets,
	type Template,
	templateBleed,
} from "@freshcoat-js/coatfile";
import { parsePrintProfile } from "@freshcoat-js/for-print";
import { Button } from "@freshcoat-js/ui/button";
import { Checkbox, Switch } from "@freshcoat-js/ui/checkbox";
import { TextField } from "@freshcoat-js/ui/field";
import { IconButton } from "@freshcoat-js/ui/icon-button";
import { ChevronRightIcon } from "@freshcoat-js/ui/icons";
import { NumberField } from "@freshcoat-js/ui/number-field";
import { PanelSection } from "@freshcoat-js/ui/panel";
import { SegmentedControl, SegmentedItem } from "@freshcoat-js/ui/segmented";
import { Select, SelectItem } from "@freshcoat-js/ui/select";
import { Slider } from "@freshcoat-js/ui/slider";
import { Tooltip, TooltipTrigger } from "@freshcoat-js/ui/tooltip";
import type {
	ExportDestination,
	ExportItem,
	ExportPreset,
	SheetLayout,
} from "@freshcoat-js/workspace";
import {
	DEFAULT_FILE_NAME_PATTERN,
	DEFAULT_QUALITY,
	exportSize,
	imageFormat,
	pdfLayout,
	sheetSummary,
} from "@freshcoat-js/workspace";
import { Fragment, type ReactNode, useState } from "react";
import {
	Disclosure,
	DisclosurePanel,
	FileTrigger,
	Focusable,
	Button as RACButton,
} from "react-aria-components";
import { useController } from "~/app/context";
import { plural, VARIANT_EXPORT } from "~/app/copy";
import { TemplateBindingEditor } from "~/binding/BindingEditor";
import { useEditor } from "~/state/hooks";
import CloseIcon from "~icons/mingcute/close-line";
import {
	DESTINATION_LABEL,
	fileNameExample,
	formatPageSize,
	imageFieldKeys,
	RECORD_FILTERS,
} from "./export-ui";
import { profileLabel } from "./print";
import {
	BLEED_NEEDS_TEMPLATE_SIZE,
	PAPER_CHOICES,
	PAPER_LABEL,
	type PaperChoice,
	paperChoice,
	paperSizeMm,
	presetBleed,
	SHEETS_NEED_TEMPLATE_SIZE,
	type SheetPlan,
	sheetsFor,
} from "./sheets";
import { destinationSupport } from "./sinks";

const DESTINATIONS: ExportDestination[] = ["download", "zip-file", "folder"];
/** the coat engine's largest export side */
const MAX_EXPORT_EDGE = 8192;
/** what "Limit long edge" starts at: a size most screens and sites take */
const DEFAULT_LONG_EDGE = 2048;

const DESTINATION_HINT: Record<ExportDestination, string> = {
	download: "One zip, split into parts past 512 MB",
	"zip-file": "Saved to a zip file you choose, as it goes",
	folder: "Saved into a folder you choose, file by file",
};

function Row({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex min-w-0 items-center gap-2">
			<span className="w-16 shrink-0 truncate text-fc-muted text-fc-sm">
				{label}
			</span>
			<div className="min-w-0 flex-1">{children}</div>
		</div>
	);
}

/** A note under a row, lined up with the row's control. */
/** One page's design units: the template, with its bleed when the preset
 *  includes it. */
function pageSize(template: Template, preset: ExportPreset) {
	const b = presetBleed(template, preset);
	return {
		width: template.width + b.left + b.right,
		height: template.height + b.top + b.bottom,
	};
}

function Hint({
	children,
	tone = "faint",
	testId,
}: {
	children: ReactNode;
	tone?: "faint" | "muted" | "warning";
	testId?: string;
}) {
	return (
		<p
			className={
				tone === "warning"
					? "m-0 pl-18 text-fc-sm text-fc-warning"
					: tone === "muted"
						? "m-0 pl-18 text-fc-muted text-fc-sm tabular-nums"
						: "m-0 pl-18 text-fc-faint text-fc-sm"
			}
			data-testid={testId}
		>
			{children}
		</p>
	);
}

/** A segmented choice the browser cannot make: disabled, and still hoverable
 *  and focusable so its tooltip can say why. */
function Unavailable({
	reason,
	children,
}: {
	reason: string;
	children: ReactNode;
}) {
	return (
		<TooltipTrigger delay={200}>
			<Focusable>
				<span
					// biome-ignore lint/a11y/noNoninteractiveTabindex: the tooltip is the reason, and it needs focus to be read
					tabIndex={0}
					className="inline-flex flex-1 rounded-[3px] outline-none focus-visible:outline-1 focus-visible:outline-fc-accent focus-visible:outline-solid"
				>
					{children}
				</span>
			</Focusable>
			<Tooltip>{reason}</Tooltip>
		</TooltipTrigger>
	);
}

const segmentedFull = "flex w-full";
const segmentedItemFull =
	"min-w-0 flex-1 px-1.5 pointer-coarse:min-w-0 pointer-coarse:px-2";

export function ExportSettings({
	preset,
	template,
	plan,
	listSelection,
	outputSize,
	sheets = null,
}: {
	preset: ExportPreset;
	template: Template | undefined;
	plan: readonly ExportItem[];
	/** the records list's selection, which seeds "selected" */
	listSelection: string[];
	/** the previewed record's output in pixels, when it is known */
	outputSize?: { width: number; height: number } | null;
	/** how the export lands on sheets, when it is laid out on them */
	sheets?: SheetPlan | null;
}) {
	const controller = useController();
	const templates = useEditor((s) => s.workspace?.templates);
	const set = (patch: Partial<ExportPreset>) =>
		controller.dispatch({ type: "setPreset", preset: { ...preset, ...patch } });
	const sideNames = template?.template_data.map((f) => f.name) ?? [];
	const chosen = preset.sides === "all" ? sideNames : preset.sides;
	const toggleSide = (name: string, on: boolean) => {
		const next = sideNames.filter((n) =>
			n === name ? on : chosen.includes(n),
		);
		set({ sides: next.length === sideNames.length ? "all" : next });
	};
	const example = fileNameExample(plan, preset, template);
	const size = exportSize(preset);
	const photoFields = imageFieldKeys(template);
	const destination = preset.destination ?? "download";
	const support = destinationSupport();
	const pdf = preset.format === "pdf";
	const lossy = imageFormat(preset) !== "png";
	const datasets = useEditor((s) => s.workspace?.datasets);
	const bindingOf = templates?.find((t) => t.id === preset.templateId)?.binding;
	const boundTo = bindingOf
		? datasets?.find((d) => d.id === bindingOf.datasetId)?.name
		: undefined;

	return (
		<div
			className="flex min-h-0 flex-1 flex-col overflow-auto"
			data-testid="export-settings"
		>
			<PanelSection title="Preset">
				<TextField
					label="Name"
					labelPosition="side"
					value={preset.name}
					onChange={(name) => set({ name })}
				/>
				<Select
					label="Template"
					labelPosition="side"
					value={preset.templateId}
					onChange={(key) => {
						if (typeof key === "string" && key !== preset.templateId)
							set({ templateId: key, sides: "all" });
					}}
				>
					{(templates ?? []).map((t) => (
						<SelectItem key={t.id} id={t.id} textValue={t.fileName}>
							{t.fileName}
						</SelectItem>
					))}
				</Select>
			</PanelSection>
			<PanelSection
				title={
					<>
						Binding
						{boundTo ? (
							<span className="ml-1.5 font-normal text-fc-faint normal-case tracking-normal">
								{boundTo}
							</span>
						) : null}
					</>
				}
				// Folded once bound: the settings below are what an export changes.
				defaultExpanded={!boundTo}
			>
				<TemplateBindingEditor templateId={preset.templateId} />
			</PanelSection>
			<PanelSection title="What">
				<Select
					label="Records"
					labelPosition="side"
					value={preset.records}
					onChange={(key) => {
						const records = key as ExportPreset["records"];
						if (records === preset.records) return;
						if (records === "selected")
							set({
								records,
								selected:
									preset.selected && preset.selected.length > 0
										? preset.selected
										: listSelection,
							});
						else set({ records });
					}}
				>
					{RECORD_FILTERS.map((f) => (
						<SelectItem key={f.id} id={f.id} textValue={f.label}>
							{f.label}
						</SelectItem>
					))}
				</Select>
				{preset.records === "selected" ? (
					<Hint>
						{`${plural(preset.selected?.length ?? 0, "record")} selected in the filmstrip or Records tab`}
					</Hint>
				) : null}
				<fieldset className="m-0 flex min-w-0 items-start gap-2 border-0 p-0">
					<legend className="float-left w-16 shrink-0 pt-1 text-fc-muted text-fc-sm">
						Sides
					</legend>
					<div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3">
						{sideNames.length > 1 ? (
							<Checkbox
								isSelected={preset.sides === "all"}
								isIndeterminate={
									preset.sides !== "all" && preset.sides.length > 0
								}
								onChange={(on) => set({ sides: on ? "all" : [] })}
							>
								All
							</Checkbox>
						) : null}
						{sideNames.map((name) => (
							<Checkbox
								key={name}
								isSelected={chosen.includes(name)}
								onChange={(on) => toggleSide(name, on)}
							>
								{name}
							</Checkbox>
						))}
					</div>
				</fieldset>
			</PanelSection>
			<PanelSection title="Size">
				<SegmentedControl
					aria-label="Size"
					className={segmentedFull}
					selectedKey={size.kind}
					onSelectionChange={(key) => {
						if (key === size.kind) return;
						if (key === "image" && photoFields[0])
							set({ size: { kind: "image", field: photoFields[0] } });
						else if (key === "template") set({ size: { kind: "template" } });
					}}
				>
					<SegmentedItem id="template" className={segmentedItemFull}>
						Template size
					</SegmentedItem>
					{photoFields.length === 0 ? (
						<Unavailable reason="No image field in the template">
							<SegmentedItem
								id="image"
								isDisabled
								className={segmentedItemFull}
							>
								Match image
							</SegmentedItem>
						</Unavailable>
					) : (
						<SegmentedItem id="image" className={segmentedItemFull}>
							Match image
						</SegmentedItem>
					)}
				</SegmentedControl>
				{size.kind === "image" ? (
					<>
						<Select
							label="Image"
							labelPosition="side"
							value={size.field}
							onChange={(key) => {
								if (typeof key === "string")
									set({ size: { ...size, field: key } });
							}}
						>
							{photoFields.map((key) => (
								<SelectItem key={key} id={key} textValue={key}>
									{key}
								</SelectItem>
							))}
						</Select>
						<div className="flex min-w-0 items-center gap-2">
							<Checkbox
								className="w-auto shrink-0"
								isSelected={size.maxEdge !== undefined}
								onChange={(on) => {
									const { maxEdge: _drop, ...rest } = size;
									set({
										size: on ? { ...rest, maxEdge: DEFAULT_LONG_EDGE } : rest,
									});
								}}
							>
								Limit long edge
							</Checkbox>
							<div className="min-w-0 flex-1">
								<NumberField
									aria-label="Limit long edge to"
									value={size.maxEdge ?? null}
									placeholder="Full size"
									isDisabled={size.maxEdge === undefined}
									min={16}
									max={MAX_EXPORT_EDGE}
									step={100}
									precision={0}
									unit="px"
									onChange={(edge) => set({ size: { ...size, maxEdge: edge } })}
								/>
							</div>
						</div>
					</>
				) : (
					<Row label="Scale">
						<NumberField
							aria-label="Scale"
							value={preset.scale}
							min={1}
							max={4}
							step={1}
							precision={2}
							unit="×"
							onChange={(scale) => set({ scale })}
						/>
					</Row>
				)}
				{template && hasInsets(templateBleed(template)) ? (
					<>
						<Checkbox
							isSelected={preset.bleed === true && size.kind === "template"}
							isDisabled={size.kind === "image"}
							onChange={(bleed) => set({ bleed })}
						>
							Include bleed
						</Checkbox>
						{size.kind === "image" ? (
							<Hint>{BLEED_NEEDS_TEMPLATE_SIZE}</Hint>
						) : null}
					</>
				) : null}
				{outputSize ? (
					<Hint tone="muted" testId="export-output-size">
						{size.kind === "image"
							? `This photo: ${outputSize.width} × ${outputSize.height} px`
							: `${outputSize.width} × ${outputSize.height} px`}
					</Hint>
				) : null}
			</PanelSection>
			<PanelSection title="Format">
				<SegmentedControl
					aria-label="Format"
					className={segmentedFull}
					selectedKey={preset.format}
					onSelectionChange={(key) =>
						set({ format: key as ExportPreset["format"] })
					}
				>
					<SegmentedItem id="png-zip" className={segmentedItemFull}>
						PNG
					</SegmentedItem>
					<SegmentedItem id="jpeg-zip" className={segmentedItemFull}>
						JPEG
					</SegmentedItem>
					<SegmentedItem id="webp-zip" className={segmentedItemFull}>
						WebP
					</SegmentedItem>
					<SegmentedItem id="pdf" className={segmentedItemFull}>
						PDF
					</SegmentedItem>
				</SegmentedControl>
				{pdf ? (
					<Row label="Pages">
						<SegmentedControl
							aria-label="PDF page image"
							className={segmentedFull}
							selectedKey={preset.pdfPageImage ?? "png"}
							onSelectionChange={(key) =>
								set({ pdfPageImage: key === "jpeg" ? "jpeg" : "png" })
							}
						>
							<SegmentedItem id="png" className={segmentedItemFull}>
								PNG
							</SegmentedItem>
							<SegmentedItem id="jpeg" className={segmentedItemFull}>
								JPEG
							</SegmentedItem>
						</SegmentedControl>
					</Row>
				) : null}
				{lossy ? (
					<Row label="Quality">
						<Slider
							aria-label="Quality"
							value={preset.quality ?? DEFAULT_QUALITY}
							minValue={1}
							maxValue={100}
							step={1}
							onChange={(quality) => set({ quality })}
						/>
					</Row>
				) : null}
				{pdf ? (
					<>
						<Row label="DPI">
							<NumberField
								aria-label="DPI"
								value={preset.dpi}
								min={36}
								max={2400}
								step={1}
								precision={0}
								onChange={(dpi) => set({ dpi })}
							/>
						</Row>
						{template ? (
							<Hint tone="muted" testId="export-page-size">
								{`${sheets ? "Card" : "Page"} ${formatPageSize(sheets ? template : pageSize(template, preset), preset.dpi)}`
									.split(" · ")
									.map((part, i) => (
										<Fragment key={part}>
											{i > 0 ? " · " : null}
											<span className="whitespace-nowrap">{part}</span>
										</Fragment>
									))}
							</Hint>
						) : null}
						<Hint>
							{sheets
								? "Card size is the template size at this DPI"
								: "Page size is the template size at this DPI"}
						</Hint>
					</>
				) : null}
			</PanelSection>
			{pdf ? (
				<LayoutGroup
					preset={preset}
					sheets={sheets}
					sided={sideNames.length > 1}
					onChange={(layout) => set({ layout })}
				/>
			) : null}
			<PrintGroup preset={preset} onChange={(print) => set({ print })} />
			<PanelSection title="Destination">
				{pdf ? (
					<p className="m-0 text-fc-faint text-fc-sm">
						A PDF is built in memory, then downloaded
					</p>
				) : (
					<>
						<SegmentedControl
							aria-label="Destination"
							className={segmentedFull}
							selectedKey={destination}
							onSelectionChange={(key) =>
								set({ destination: key as ExportDestination })
							}
						>
							{DESTINATIONS.map((d) => {
								const reason = support[d];
								const item = (
									<SegmentedItem
										key={d}
										id={d}
										isDisabled={!!reason}
										className={segmentedItemFull}
									>
										{DESTINATION_LABEL[d]}
									</SegmentedItem>
								);
								return reason ? (
									<Unavailable key={d} reason={reason}>
										{item}
									</Unavailable>
								) : (
									item
								);
							})}
						</SegmentedControl>
						{support[destination] ? (
							<Hint tone="warning">{support[destination]}</Hint>
						) : (
							<p className="m-0 text-fc-faint text-fc-sm">
								{DESTINATION_HINT[destination]}
							</p>
						)}
					</>
				)}
			</PanelSection>
			<PanelSection title="File names">
				<TextField
					aria-label="File name pattern"
					value={preset.fileName}
					placeholder={DEFAULT_FILE_NAME_PATTERN}
					onChange={(fileName) => set({ fileName })}
					inputClassName="font-fc-mono"
				/>
				<p
					className="m-0 truncate text-fc-muted text-fc-sm"
					data-testid="export-file-example"
					title={example}
				>
					<span className="text-fc-faint">e.g. </span>
					<span className="font-fc-mono">{example}</span>
				</p>
				<p className="m-0 text-fc-faint text-fc-sm">
					{VARIANT_EXPORT.fileNameTokens}
				</p>
				<Checkbox
					isSelected={preset.markExported}
					onChange={(markExported) => set({ markExported })}
				>
					Mark exported records
				</Checkbox>
			</PanelSection>
		</div>
	);
}

/**
 * Output through for-print: a switch, the printer's measured profile, and
 * the per-photo analysis under More.
 */
function PrintGroup({
	preset,
	onChange,
}: {
	preset: ExportPreset;
	onChange: (print: NonNullable<ExportPreset["print"]>) => void;
}) {
	const print = preset.print ?? { enabled: false };
	const [error, setError] = useState<string | null>(null);
	const profile = print.profile;
	const label = profile ? profileLabel(profile) : null;
	const importProfile = async (files: FileList | null) => {
		const file = files?.[0];
		if (!file) return;
		const parsed = parsePrintProfile(await file.text());
		if (parsed instanceof Error) {
			setError(`Couldn't import ${file.name}: ${parsed.message}`);
			return;
		}
		setError(null);
		onChange({ ...print, profile: parsed });
	};
	const removeProfile = () => {
		const { profile: _drop, ...rest } = print;
		setError(null);
		onChange(rest);
	};
	return (
		<PanelSection title="Print">
			<div data-testid="export-print" className="contents">
				<Switch
					isSelected={print.enabled}
					onChange={(enabled) => onChange({ ...print, enabled })}
				>
					Optimize for card printer
				</Switch>
				{print.enabled ? (
					<>
						<Row label="Profile">
							<div
								className="flex min-h-fc-control min-w-0 items-center gap-1"
								data-testid="export-print-profile"
							>
								{label ? (
									<>
										<span
											className="min-w-0 flex-1 truncate text-fc-base text-fc-text"
											title={label.name}
										>
											{label.name}
										</span>
										{label.date ? (
											<span className="shrink-0 text-fc-faint text-fc-sm tabular-nums">
												{label.date}
											</span>
										) : null}
										<IconButton
											aria-label="Remove profile"
											tooltip="Remove profile"
											onPress={removeProfile}
										>
											<CloseIcon />
										</IconButton>
									</>
								) : (
									<>
										<span className="min-w-0 flex-1 text-fc-muted text-fc-sm">
											None
										</span>
										<FileTrigger
											acceptedFileTypes={["application/json", ".json"]}
											onSelect={(files) => void importProfile(files)}
										>
											<Button>Import…</Button>
										</FileTrigger>
									</>
								)}
							</div>
						</Row>
						{error ? (
							<p
								role="alert"
								className="m-0 pl-18 text-fc-danger-text text-fc-sm"
								data-testid="export-print-profile-error"
							>
								{error}
							</p>
						) : null}
						<Disclosure className="group/more">
							<RACButton
								slot="trigger"
								className="flex h-fc-control cursor-default items-center gap-1 text-fc-muted text-fc-sm outline-none data-hovered:text-fc-text data-focus-visible:outline-1 data-focus-visible:outline-fc-accent data-focus-visible:outline-solid"
							>
								<ChevronRightIcon className="size-3 shrink-0 transition-transform duration-100 group-data-expanded/more:rotate-90" />
								More
							</RACButton>
							<DisclosurePanel>
								<Switch
									isSelected={print.analyze ?? true}
									onChange={(analyze) => onChange({ ...print, analyze })}
								>
									Analyze photos
								</Switch>
							</DisclosurePanel>
						</Disclosure>
					</>
				) : null}
			</div>
		</PanelSection>
	);
}

const ORIENTATIONS: { id: SheetLayout["orientation"]; label: string }[] = [
	{ id: "auto", label: "Auto" },
	{ id: "portrait", label: "Portrait" },
	{ id: "landscape", label: "Landscape" },
];

/** A millimetre field on a sheet layout. */
function MmField({
	label,
	value,
	onChange,
}: {
	label: string;
	value: number;
	onChange: (value: number) => void;
}) {
	return (
		<NumberField
			aria-label={label}
			value={value}
			min={0}
			max={1000}
			step={1}
			precision={1}
			unit="mm"
			onChange={onChange}
		/>
	);
}

/**
 * A PDF's layout: one image per page, or cards imposed on sheets of paper
 * with crop marks and, for double-sided printing, backs placed to line up.
 */
function LayoutGroup({
	preset,
	sheets,
	sided,
	onChange,
}: {
	preset: ExportPreset;
	sheets: SheetPlan | null;
	/** the template has a back */
	sided: boolean;
	onChange: (layout: NonNullable<ExportPreset["layout"]>) => void;
}) {
	const layout = pdfLayout(preset);
	const photoSized = exportSize(preset).kind === "image";
	const sheet = layout.kind === "sheet" ? layout : null;
	const patch = (next: Partial<SheetLayout>) => {
		if (sheet) onChange({ ...sheet, ...next });
	};
	const paper = sheet ? paperChoice(sheet) : "a4";
	const custom = sheet && typeof sheet.paper !== "string" ? sheet.paper : null;
	const offset = sheet?.backOffsetMm ?? { x: 0, y: 0 };
	return (
		<PanelSection title="Layout">
			<div data-testid="export-layout" className="contents">
				<SegmentedControl
					aria-label="Layout"
					className={segmentedFull}
					selectedKey={layout.kind}
					onSelectionChange={(key) => {
						if (key === layout.kind) return;
						onChange(key === "sheet" ? sheetsFor(preset) : { kind: "single" });
					}}
				>
					<SegmentedItem id="single" className={segmentedItemFull}>
						One per page
					</SegmentedItem>
					{photoSized && !sheet ? (
						<Unavailable reason={SHEETS_NEED_TEMPLATE_SIZE}>
							<SegmentedItem
								id="sheet"
								isDisabled
								className={segmentedItemFull}
							>
								Sheets
							</SegmentedItem>
						</Unavailable>
					) : (
						<SegmentedItem id="sheet" className={segmentedItemFull}>
							Sheets
						</SegmentedItem>
					)}
				</SegmentedControl>
				{sheet ? (
					<>
						<Select
							label="Paper"
							labelPosition="side"
							value={paper}
							onChange={(key) => {
								const next = key as PaperChoice;
								if (next === paper) return;
								patch({
									paper: next === "custom" ? { ...paperSizeMm(sheet) } : next,
								});
							}}
						>
							{PAPER_CHOICES.map((id) => (
								<SelectItem key={id} id={id} textValue={PAPER_LABEL[id]}>
									{PAPER_LABEL[id]}
								</SelectItem>
							))}
						</Select>
						{custom ? (
							<Row label="Size">
								<div className="flex min-w-0 gap-1">
									<NumberField
										label="W"
										aria-label="Paper width"
										value={custom.widthMm}
										min={10}
										max={2000}
										step={1}
										precision={1}
										unit="mm"
										onChange={(widthMm) =>
											patch({ paper: { ...custom, widthMm } })
										}
									/>
									<NumberField
										label="H"
										aria-label="Paper height"
										value={custom.heightMm}
										min={10}
										max={2000}
										step={1}
										precision={1}
										unit="mm"
										onChange={(heightMm) =>
											patch({ paper: { ...custom, heightMm } })
										}
									/>
								</div>
							</Row>
						) : null}
						<Row label="Orientation">
							<SegmentedControl
								aria-label="Orientation"
								className={segmentedFull}
								selectedKey={sheet.orientation}
								onSelectionChange={(key) =>
									patch({
										orientation: key as SheetLayout["orientation"],
									})
								}
							>
								{ORIENTATIONS.map((o) => (
									<SegmentedItem
										key={o.id}
										id={o.id}
										className={segmentedItemFull}
									>
										{o.label}
									</SegmentedItem>
								))}
							</SegmentedControl>
						</Row>
						<Row label="Margin">
							<MmField
								label="Margin"
								value={sheet.marginMm}
								onChange={(marginMm) => patch({ marginMm })}
							/>
						</Row>
						<Row label="Gap">
							<MmField
								label="Gap"
								value={sheet.gapMm}
								onChange={(gapMm) => patch({ gapMm })}
							/>
						</Row>
						{sheets?.imposition?.bleedMm &&
						sheets.imposition.gapMm > sheet.gapMm ? (
							<Hint testId="export-bleed-gap">
								{`Gap widened to ${Math.round(sheets.imposition.gapMm * 10) / 10} mm for bleed`}
							</Hint>
						) : null}
						<Checkbox
							isSelected={sheet.cropMarks}
							onChange={(cropMarks) => patch({ cropMarks })}
						>
							Crop marks
						</Checkbox>
						<Checkbox
							isSelected={sheet.duplex !== "none"}
							onChange={(on) => patch({ duplex: on ? "long-edge" : "none" })}
						>
							Double-sided
						</Checkbox>
						{sheet.duplex !== "none" ? (
							<>
								<Row label="Flip on">
									<SegmentedControl
										aria-label="Flip on"
										className={segmentedFull}
										selectedKey={sheet.duplex}
										onSelectionChange={(key) =>
											patch({ duplex: key as SheetLayout["duplex"] })
										}
									>
										<SegmentedItem id="long-edge" className={segmentedItemFull}>
											Long edge
										</SegmentedItem>
										<SegmentedItem
											id="short-edge"
											className={segmentedItemFull}
										>
											Short edge
										</SegmentedItem>
									</SegmentedControl>
								</Row>
								<Hint>Match the printer's flip setting</Hint>
								<Disclosure className="group/more">
									<RACButton
										slot="trigger"
										className="flex h-fc-control cursor-default items-center gap-1 text-fc-muted text-fc-sm outline-none data-hovered:text-fc-text data-focus-visible:outline-1 data-focus-visible:outline-fc-accent data-focus-visible:outline-solid"
									>
										<ChevronRightIcon className="size-3 shrink-0 transition-transform duration-100 group-data-expanded/more:rotate-90" />
										More
									</RACButton>
									<DisclosurePanel className="flex flex-col gap-2">
										<Row label="Offset">
											<div className="flex min-w-0 gap-1">
												<NumberField
													label="X"
													aria-label="Back offset X"
													value={offset.x}
													min={-50}
													max={50}
													step={0.5}
													precision={1}
													unit="mm"
													onChange={(x) =>
														patch({ backOffsetMm: { ...offset, x } })
													}
												/>
												<NumberField
													label="Y"
													aria-label="Back offset Y"
													value={offset.y}
													min={-50}
													max={50}
													step={0.5}
													precision={1}
													unit="mm"
													onChange={(y) =>
														patch({ backOffsetMm: { ...offset, y } })
													}
												/>
											</div>
										</Row>
										<Hint>Moves every back, for a printer that drifts</Hint>
										{sided ? null : (
											<Checkbox
												isSelected={sheet.blankBacks ?? false}
												onChange={(blankBacks) => patch({ blankBacks })}
											>
												Blank backs
											</Checkbox>
										)}
									</DisclosurePanel>
								</Disclosure>
							</>
						) : null}
						{sheets?.imposition ? (
							<p
								className="m-0 text-fc-muted text-fc-sm tabular-nums"
								data-testid="export-sheet-summary"
							>
								{sheetSummary(sheets.imposition)}
							</p>
						) : null}
						{sheets?.error ? (
							<p
								role="alert"
								className="m-0 text-fc-danger-text text-fc-sm"
								data-testid="export-sheet-error"
							>
								{sheets.error}
							</p>
						) : null}
					</>
				) : null}
			</div>
		</PanelSection>
	);
}
