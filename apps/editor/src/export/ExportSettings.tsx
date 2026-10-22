import {
	DEFAULT_MIN_IMAGE_DPI,
	hasInsets,
	type Template,
	templateBleed,
} from "@freshcoat-js/coatfile";
import {
	DEFAULT_PRINT_TARGET,
	PRINT_TARGETS,
	parsePrintProfile,
	printTarget,
} from "@freshcoat-js/for-print";
import { Button } from "@freshcoat-js/ui/button";
import { Checkbox, Switch } from "@freshcoat-js/ui/checkbox";
import { TextField } from "@freshcoat-js/ui/field";
import { IconButton } from "@freshcoat-js/ui/icon-button";
import { ChevronRightIcon } from "@freshcoat-js/ui/icons";
import { Menu, MenuItem, MenuSection } from "@freshcoat-js/ui/menu";
import { NumberField } from "@freshcoat-js/ui/number-field";
import { PanelSection } from "@freshcoat-js/ui/panel";
import { Popover } from "@freshcoat-js/ui/popover";
import { SegmentedControl, SegmentedItem } from "@freshcoat-js/ui/segmented";
import { Select, SelectItem } from "@freshcoat-js/ui/select";
import { Slider } from "@freshcoat-js/ui/slider";
import { Tooltip, TooltipTrigger } from "@freshcoat-js/ui/tooltip";
import type {
	CutKind,
	CutSpots,
	ExportCutFile,
	ExportDestination,
	ExportItem,
	ExportPreset,
	IccProfileAsset,
	PdfOutputIntent,
	PresetPrint,
	SheetLayout,
} from "@freshcoat-js/workspace";
import {
	boundDataset,
	DEFAULT_CUT_SPOTS,
	DEFAULT_FILE_NAME_PATTERN,
	DEFAULT_QUALITY,
	exportCutFile,
	exportSize,
	exportSplit,
	imageFields,
	imageFormat,
	MAX_BACK_OFFSET_MM,
	PRESET_SCALE,
	paperSize,
	pdfLayout,
	portraitPaper,
	readOutputProfile,
	sheetSummary,
	unknownFileNameTokens,
} from "@freshcoat-js/workspace";
import {
	BLEED_NEEDS_TEMPLATE_SIZE,
	presetBleed,
	printProfileMismatch,
	SHEETS_NEED_TEMPLATE_SIZE,
	type SheetPlan,
} from "@freshcoat-js/workspace/export";
import { Fragment, type ReactNode, useMemo, useRef, useState } from "react";
import {
	Disclosure,
	DisclosurePanel,
	FileTrigger,
	Focusable,
	MenuTrigger,
	Button as RACButton,
} from "react-aria-components";
import { useController } from "~/app/context";
import { plural, VARIANT_EXPORT } from "~/app/copy";
import { downloadBytes } from "~/app/download";
import { TemplateBindingEditor } from "~/binding/BindingEditor";
import { useEditor } from "~/state/hooks";
import CloseIcon from "~icons/mingcute/close-line";
import DownloadIcon from "~icons/mingcute/download-2-line";
import { CalibrateDialog } from "./CalibrateDialog";
import { ChecksList } from "./Checks";
import { printProfileFile } from "./calibrate";
import { type Check, type CheckTarget, checksSummary } from "./checks";
import type { ExportCollapsed, SettingsSectionId } from "./collapsed";
import {
	DESTINATION_LABEL,
	fileNameExample,
	fileNameTokenGroups,
	filesSummary,
	formatPageSize,
	formatSummary,
	printSummary,
	RECORD_FILTERS,
	settingsSummary,
	sizeSummary,
	sliceUse,
} from "./export-ui";
import { profileLabel } from "./print";
import {
	PAPER_CHOICES,
	PAPER_LABEL,
	type PaperChoice,
	paperChoice,
	sheetsFor,
	withCopies,
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

const CUT_FILES: [ExportCutFile, string][] = [
	["none", "None"],
	["svg", "SVG"],
	["dxf", "DXF"],
];

const CUT_SPOT_LABEL: Record<CutKind, string> = {
	through: "Through spot",
	kiss: "Kiss spot",
	score: "Score spot",
	perforate: "Perforate spot",
};

/** The spot colour each edge kind the template cuts is drawn in. A field
 *  left empty keeps the default name. */
function CutSpotFields({
	edges,
	spots,
	onChange,
}: {
	edges: readonly CutKind[];
	spots: CutSpots | undefined;
	onChange: (spots: CutSpots) => void;
}) {
	return (
		<>
			{edges.map((kind) => (
				<TextField
					key={kind}
					label={CUT_SPOT_LABEL[kind]}
					labelPosition="side"
					value={spots?.[kind] ?? ""}
					placeholder={DEFAULT_CUT_SPOTS[kind]}
					onChange={(name) => {
						const { [kind]: _, ...rest } = spots ?? {};
						onChange(name.trim() ? { ...rest, [kind]: name } : rest);
					}}
				/>
			))}
			<Hint>Separation names your cutter's RIP looks for</Hint>
		</>
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
	collapsed,
	checks,
	onCheckTarget,
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
	collapsed: ExportCollapsed;
	checks: readonly Check[];
	onCheckTarget: (target: CheckTarget) => void;
}) {
	const controller = useController();
	const templates = useEditor((s) => s.workspace?.templates);
	const set = (patch: Partial<ExportPreset>, profile?: IccProfileAsset) =>
		controller.dispatch({
			type: "setPreset",
			preset: { ...preset, ...patch },
			...(profile ? { profile } : {}),
		});
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
	const photoFields = template ? imageFields(template) : [];
	const destination = preset.destination ?? "download";
	const support = destinationSupport();
	const pdf = preset.format === "pdf";
	const lossy = imageFormat(preset) !== "png";
	const datasets = useEditor((s) => s.workspace?.datasets);
	const bindingOf = templates?.find((t) => t.id === preset.templateId)?.binding;
	const viewed = datasets ? boundDataset(bindingOf, datasets) : undefined;
	const boundTo = viewed?.name;
	const use = sliceUse(template);
	const unknownTokens = template
		? unknownFileNameTokens(preset.fileName, template, viewed)
		: [];
	const sharedBy =
		useEditor((s) => s.workspace?.presets)?.filter(
			(p) => p.templateId === preset.templateId,
		).length ?? 0;
	const fileNameBox = useRef<HTMLDivElement>(null);
	const tokenGroups = (
		template ? fileNameTokenGroups(template, viewed) : []
	).map((group) => ({
		...group,
		tokens: group.tokens.filter((t) => use.slices || t !== "slice"),
	}));
	const insertToken = (token: string) => {
		const input = fileNameBox.current?.querySelector("input");
		const value = preset.fileName;
		const start = input?.selectionStart ?? value.length;
		const end = input?.selectionEnd ?? start;
		const text = `{{${token}}}`;
		set({ fileName: value.slice(0, start) + text + value.slice(end) });
		requestAnimationFrame(() => {
			input?.focus();
			input?.setSelectionRange(start + text.length, start + text.length);
		});
	};
	const recordCount = useMemo(
		() => new Set(plan.map((item) => item.recordId)).size,
		[plan],
	);

	return (
		<div
			className="flex min-h-0 flex-1 flex-col overflow-y-auto"
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
				<p
					className="m-0 truncate text-fc-muted text-fc-sm"
					data-testid="export-settings-summary"
				>
					{settingsSummary(preset)}
				</p>
			</PanelSection>
			<SettingsSection
				id="records"
				title="Records"
				summary={boundTo ? plural(recordCount, "record") : "Not bound"}
				collapsed={collapsed}
			>
				<Disclosure
					className="group/more"
					isExpanded={!collapsed.has("binding", !!boundTo)}
					onExpandedChange={(open) => collapsed.set("binding", !open)}
				>
					<RACButton
						slot="trigger"
						className="flex h-fc-control w-full min-w-0 cursor-default items-center gap-1 text-fc-muted text-fc-sm outline-none data-hovered:text-fc-text data-focus-visible:outline-1 data-focus-visible:outline-fc-accent data-focus-visible:outline-solid"
					>
						<ChevronRightIcon className="size-3 shrink-0 transition-transform duration-100 group-data-expanded/more:rotate-90" />
						<span className="truncate">
							Template binding
							{sharedBy > 1 ? (
								<span
									className="ml-1.5 text-fc-faint"
									data-testid="binding-shared"
								>
									{`used by ${plural(sharedBy, "preset")}`}
								</span>
							) : null}
							{boundTo ? (
								<span className="ml-1.5 text-fc-faint">
									{sharedBy > 1 ? `· ${boundTo}` : boundTo}
								</span>
							) : null}
						</span>
					</RACButton>
					<DisclosurePanel>
						<TemplateBindingEditor templateId={preset.templateId} />
					</DisclosurePanel>
				</Disclosure>
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
						{`${plural(preset.selected?.length ?? 0, "record")} selected in the filmstrip or records list`}
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
			</SettingsSection>
			<SettingsSection
				id="format"
				title="Format"
				summary={formatSummary(preset)}
				collapsed={collapsed}
			>
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
				{preset.format === "png-zip" ? (
					<>
						<Checkbox
							isSelected={preset.pngAlpha === "keep"}
							onChange={(keep) => set({ pngAlpha: keep ? "keep" : "auto" })}
						>
							Keep alpha channel
						</Checkbox>
						<Hint>32-bit even when opaque</Hint>
					</>
				) : null}
				{pdf ? (
					<Row label="Pages">
						<SegmentedControl
							aria-label="PDF page image"
							className={segmentedFull}
							selectedKey={preset.pdfPageImage ?? "png"}
							onSelectionChange={(key) =>
								set({
									pdfPageImage:
										key === "jpeg" || key === "vector" ? key : "png",
								})
							}
						>
							<SegmentedItem id="png" className={segmentedItemFull}>
								PNG
							</SegmentedItem>
							<SegmentedItem id="jpeg" className={segmentedItemFull}>
								JPEG
							</SegmentedItem>
							<SegmentedItem id="vector" className={segmentedItemFull}>
								Vector
							</SegmentedItem>
						</SegmentedControl>
					</Row>
				) : null}
				{pdf && preset.pdfPageImage === "vector" ? (
					<>
						<Row label="Text">
							<SegmentedControl
								aria-label="PDF text"
								className={segmentedFull}
								selectedKey={preset.pdfText ?? "embed"}
								onSelectionChange={(key) =>
									set({ pdfText: key === "outline" ? "outline" : "embed" })
								}
							>
								<SegmentedItem id="embed" className={segmentedItemFull}>
									Embed fonts
								</SegmentedItem>
								<SegmentedItem id="outline" className={segmentedItemFull}>
									Outline
								</SegmentedItem>
							</SegmentedControl>
						</Row>
						{preset.pdfText === "outline" ? (
							<Hint>Glyphs as shapes, no fonts in the PDF</Hint>
						) : null}
					</>
				) : null}
				{lossy ? (
					<Row label="Quality">
						<Slider
							aria-label="Quality"
							value={preset.quality ?? DEFAULT_QUALITY}
							minValue={0}
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
				<Row label="Min DPI">
					<NumberField
						aria-label="Min image DPI"
						value={preset.minImageDpi ?? DEFAULT_MIN_IMAGE_DPI}
						min={0}
						step={1}
						precision={0}
						onChange={(minImageDpi) => set({ minImageDpi })}
					/>
				</Row>
				<Hint testId="export-min-dpi-hint">
					{(preset.minImageDpi ?? DEFAULT_MIN_IMAGE_DPI) > 0
						? `Warns for images under this at ${preset.dpi} DPI`
						: "No image resolution check"}
				</Hint>
			</SettingsSection>
			<SettingsSection
				id="size"
				title="Size"
				summary={sizeSummary(preset, outputSize)}
				collapsed={collapsed}
			>
				<SegmentedControl
					aria-label="Size"
					className={segmentedFull}
					selectedKey={size.kind}
					onSelectionChange={(key) => {
						if (key === size.kind) return;
						if (key === "image" && photoFields[0])
							set({
								size: { kind: "image", field: photoFields[0].key },
							});
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
							{photoFields.map(({ key }) => (
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
							min={PRESET_SCALE.min}
							max={PRESET_SCALE.max}
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
				{use.slices ? (
					<>
						<Checkbox
							isSelected={exportSplit(preset) === "pieces"}
							onChange={(on) => set({ split: on ? "pieces" : "none" })}
						>
							Split into slice pieces
						</Checkbox>
						{use.cuts && !pdf ? (
							<Select
								label="Cut file"
								labelPosition="side"
								value={exportCutFile(preset)}
								onChange={(key) => set({ cutFile: key as ExportCutFile })}
							>
								{CUT_FILES.map(([id, label]) => (
									<SelectItem key={id} id={id} textValue={label}>
										{label}
									</SelectItem>
								))}
							</Select>
						) : null}
						{use.cuts && pdf ? (
							<Checkbox
								isSelected={preset.cutLines === true}
								onChange={(cutLines) => set({ cutLines })}
							>
								Cut lines
							</Checkbox>
						) : null}
						{use.cuts && pdf && preset.cutLines === true ? (
							<CutSpotFields
								edges={use.edges}
								spots={preset.cutSpots}
								onChange={(cutSpots) => set({ cutSpots })}
							/>
						) : null}
					</>
				) : null}
			</SettingsSection>
			<SettingsSection
				id="print"
				title="Print"
				summary={printSummary(preset)}
				collapsed={collapsed}
			>
				{pdf ? (
					<LayoutGroup
						preset={preset}
						sheets={sheets}
						sided={sideNames.length > 1}
						onChange={(layout) => set({ layout })}
					/>
				) : null}
				{pdf ? (
					<OutputIntentGroup
						preset={preset}
						onChange={(outputIntent, profile) => set({ outputIntent }, profile)}
					/>
				) : null}
				<PrintGroup preset={preset} onChange={(print) => set({ print })} />
			</SettingsSection>
			<SettingsSection
				id="files"
				title="Files"
				summary={filesSummary(preset)}
				collapsed={collapsed}
			>
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
				<div ref={fileNameBox} className="flex min-w-0 items-center gap-1">
					<TextField
						aria-label="File name pattern"
						className="flex-1"
						value={preset.fileName}
						placeholder={DEFAULT_FILE_NAME_PATTERN}
						onChange={(fileName) => set({ fileName })}
						inputClassName="font-fc-mono"
					/>
					<MenuTrigger>
						<Button>Insert field</Button>
						<Popover placement="bottom end">
							<Menu
								aria-label="Insert field"
								onAction={(token) => insertToken(String(token))}
							>
								{tokenGroups.map((group) => (
									<MenuSection key={group.title} title={group.title}>
										{group.tokens.map((token) => (
											<MenuItem key={token} id={token}>
												{token}
											</MenuItem>
										))}
									</MenuSection>
								))}
							</Menu>
						</Popover>
					</MenuTrigger>
				</div>
				<p
					className="m-0 truncate text-fc-muted text-fc-sm"
					data-testid="export-file-example"
					title={example}
				>
					<span className="text-fc-faint">e.g. </span>
					<span className="font-fc-mono">{example}</span>
				</p>
				{unknownTokens.length > 0 ? (
					<p
						className="m-0 text-fc-sm text-fc-warning"
						data-testid="export-file-name-unknown"
					>
						{VARIANT_EXPORT.unknownTokens(unknownTokens)}
					</p>
				) : null}
				<Checkbox
					isSelected={preset.markExported}
					onChange={(markExported) => set({ markExported })}
				>
					Mark exported records
				</Checkbox>
			</SettingsSection>
			<SettingsSection
				id="checks"
				title="Checks"
				summary={checksSummary(checks)}
				collapsed={collapsed}
			>
				<ChecksList checks={checks} onTarget={onCheckTarget} />
			</SettingsSection>
		</div>
	);
}

function SettingsSection({
	id,
	title,
	summary,
	collapsed,
	children,
}: {
	id: SettingsSectionId;
	title: string;
	summary: string;
	collapsed: ExportCollapsed;
	children: ReactNode;
}) {
	return (
		<PanelSection
			data-section={id}
			title={
				<>
					{title}
					<span
						className="ml-1.5 font-normal text-fc-faint normal-case tracking-normal group-data-expanded/section:hidden"
						data-testid={`export-summary-${id}`}
					>
						{summary}
					</span>
				</>
			}
			isExpanded={!collapsed.has(id)}
			onExpandedChange={(open) => collapsed.set(id, !open)}
		>
			{children}
		</PanelSection>
	);
}

const NO_TARGET = "none";

function targetName(id: string): string {
	return printTarget(id)?.name ?? id;
}

/** The default target is left implicit, so a preset reads the same as before
 *  targets existed. */
function withTarget(print: PresetPrint, key: string): PresetPrint {
	const { target: _drop, ...rest } = print;
	if (key === NO_TARGET) return { ...print, enabled: false };
	if (key === DEFAULT_PRINT_TARGET.id) return { ...rest, enabled: true };
	return { ...rest, enabled: true, target: key };
}

/**
 * Output through for-print: the print target, the printer's measured
 * profile, and the per-photo analysis under More.
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
	const [measuring, setMeasuring] = useState(false);
	const profile = print.profile;
	const label = profile ? profileLabel(profile) : null;
	const mismatch = printProfileMismatch(print);
	const importProfile = async (files: FileList | null) => {
		const file = files?.[0];
		if (!file) return;
		const parsed = parsePrintProfile(await file.text());
		if (!parsed.ok) {
			setError(`Couldn't import ${file.name}: ${parsed.message}`);
			return;
		}
		setError(null);
		onChange({ ...print, profile: parsed.profile });
	};
	const removeProfile = () => {
		const { profile: _drop, ...rest } = print;
		setError(null);
		onChange(rest);
	};
	return (
		<div data-testid="export-print" className="contents">
			<Select
				label="Print target"
				labelPosition="side"
				value={
					print.enabled ? (print.target ?? DEFAULT_PRINT_TARGET.id) : NO_TARGET
				}
				triggerValue={
					print.enabled ? printTarget(print.target)?.shortName : undefined
				}
				onChange={(key) => onChange(withTarget(print, String(key)))}
			>
				<SelectItem id={NO_TARGET} textValue="None">
					None
				</SelectItem>
				{PRINT_TARGETS.map((t) => (
					<SelectItem key={t.id} id={t.id} textValue={t.name}>
						{t.name}
					</SelectItem>
				))}
			</Select>
			{print.enabled ? (
				<>
					<Row label="Profile">
						<div
							className="flex min-h-fc-control min-w-0 items-center gap-1"
							data-testid="export-print-profile"
						>
							{profile && label ? (
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
										aria-label="Export profile"
										tooltip="Export profile…"
										onPress={() => {
											const file = printProfileFile(profile);
											void downloadBytes(
												file.text,
												file.name,
												"application/json",
											);
										}}
									>
										<DownloadIcon />
									</IconButton>
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
									<Button onPress={() => setMeasuring(true)}>Measure…</Button>
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
					{mismatch ? (
						<Hint tone="warning" testId="export-print-profile-mismatch">
							Profile was measured on {targetName(mismatch.profileTarget)}, not{" "}
							{targetName(mismatch.presetTarget)}
						</Hint>
					) : null}
					<CalibrateDialog
						isOpen={measuring}
						onOpenChange={setMeasuring}
						target={print.target ?? DEFAULT_PRINT_TARGET.id}
						onSave={(measured) => {
							setError(null);
							onChange({ ...print, profile: measured });
						}}
					/>
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
	);
}

/**
 * What the PDF declares it was prepared for: sRGB, the space cards are drawn
 * in, or a profile of the press's condition, such as a print shop's CMYK one.
 * The cards stay sRGB either way; the printer converts them.
 */
function OutputIntentGroup({
	preset,
	onChange,
}: {
	preset: ExportPreset;
	onChange: (intent: PdfOutputIntent, profile?: IccProfileAsset) => void;
}) {
	const profiles = useEditor((s) => s.workspace?.profiles);
	const [error, setError] = useState<string | null>(null);
	const intent = preset.outputIntent ?? { kind: "srgb" };
	const profile =
		intent.kind === "profile"
			? profiles?.find((p) => p.sha256 === intent.sha256)
			: undefined;
	const profileName = profile
		? profile.description || profile.name
		: "Missing profile";
	const choose = async (files: FileList | null) => {
		const file = files?.[0];
		if (!file) return;
		const read = await readOutputProfile(
			new Uint8Array(await file.arrayBuffer()),
			file.name,
		);
		if (!read.ok) {
			setError(`Couldn't use ${file.name}: ${read.message}`);
			return;
		}
		setError(null);
		onChange({ kind: "profile", sha256: read.profile.sha256 }, read.profile);
	};
	return (
		<div data-testid="export-output-intent" className="contents">
			<Row label="Intent">
				<Select
					aria-label="Output intent"
					value={intent.kind}
					onChange={(key) => {
						setError(null);
						if (key === "srgb" || key === "none") onChange({ kind: key });
					}}
				>
					<SelectItem id="srgb" textValue="sRGB">
						sRGB
					</SelectItem>
					{intent.kind === "profile" ? (
						<SelectItem id="profile" textValue={profileName}>
							{profileName}
						</SelectItem>
					) : null}
					<SelectItem id="none" textValue="None">
						None
					</SelectItem>
				</Select>
			</Row>
			<div className="pl-18">
				<FileTrigger
					acceptedFileTypes={[".icc", ".icm", "application/vnd.iccprofile"]}
					onSelect={(files) => void choose(files)}
				>
					<Button>Custom profile…</Button>
				</FileTrigger>
			</div>
			{intent.kind === "profile" && profile ? (
				<Row label="Identifier">
					<TextField
						aria-label="Output condition identifier"
						value={intent.identifier ?? ""}
						placeholder={profile.identifier || profile.description}
						onChange={(identifier) => {
							const { identifier: _, ...rest } = intent;
							onChange(identifier.trim() ? { ...rest, identifier } : rest);
						}}
					/>
				</Row>
			) : null}
			{error ? (
				<p
					role="alert"
					className="m-0 pl-18 text-fc-danger-text text-fc-sm"
					data-testid="export-output-intent-error"
				>
					{error}
				</p>
			) : intent.kind === "profile" && !profile ? (
				<Hint tone="warning" testId="export-output-intent-hint">
					The profile is not in this workspace; choose it again
				</Hint>
			) : (
				<Hint testId="export-output-intent-hint">
					{intent.kind === "profile"
						? "Cards stay sRGB; the printer converts them to this profile"
						: intent.kind === "none"
							? "No intent: each printer reads the colors its own way"
							: "Declares sRGB, the space cards are drawn in"}
				</Hint>
			)}
		</div>
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
	const marksOn = !!sheet && (sheet.cropMarks || !!sheet.registrationMarks);
	return (
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
						<SegmentedItem id="sheet" isDisabled className={segmentedItemFull}>
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
								paper: next === "custom" ? paperSize(sheet) : next,
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
									min={0.1}
									step={1}
									precision={1}
									unit="mm"
									onChange={(widthMm) =>
										patch({ paper: portraitPaper({ ...custom, widthMm }) })
									}
								/>
								<NumberField
									label="H"
									aria-label="Paper height"
									value={custom.heightMm}
									min={0.1}
									step={1}
									precision={1}
									unit="mm"
									onChange={(heightMm) =>
										patch({ paper: portraitPaper({ ...custom, heightMm }) })
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
					<Row label="Copies">
						<div className="flex min-w-0 items-center gap-2">
							<NumberField
								aria-label="Copies"
								value={
									sheet.copies === "fill"
										? (sheets?.imposition?.copies ?? 1)
										: (sheet.copies ?? 1)
								}
								min={1}
								max={999}
								step={1}
								precision={0}
								isDisabled={sheet.copies === "fill"}
								onChange={(copies) =>
									onChange(withCopies(sheet, Math.max(1, Math.round(copies))))
								}
							/>
							<Checkbox
								isSelected={sheet.copies === "fill"}
								onChange={(fill) =>
									onChange(withCopies(sheet, fill ? "fill" : 1))
								}
							>
								Fill sheet
							</Checkbox>
						</div>
					</Row>
					<Switch
						isSelected={marksOn}
						onChange={(on) => patch({ cropMarks: on, registrationMarks: on })}
					>
						Printer marks
					</Switch>
					<Disclosure className="group/more">
						<RACButton
							slot="trigger"
							className="flex h-fc-control cursor-default items-center gap-1 text-fc-muted text-fc-sm outline-none data-hovered:text-fc-text data-focus-visible:outline-1 data-focus-visible:outline-fc-accent data-focus-visible:outline-solid"
						>
							<ChevronRightIcon className="size-3 shrink-0 transition-transform duration-100 group-data-expanded/more:rotate-90" />
							Marks
						</RACButton>
						<DisclosurePanel className="flex flex-col gap-2">
							<Checkbox
								isSelected={sheet.cropMarks}
								onChange={(cropMarks) => patch({ cropMarks })}
							>
								Crop marks
							</Checkbox>
							<Checkbox
								isSelected={sheet.registrationMarks ?? false}
								onChange={(registrationMarks) => patch({ registrationMarks })}
							>
								Registration marks
							</Checkbox>
							<Checkbox
								isSelected={sheet.colorBar ?? false}
								onChange={(colorBar) => patch({ colorBar })}
							>
								Color bar
							</Checkbox>
							<Checkbox
								isSelected={sheet.slug ?? false}
								onChange={(slug) => patch({ slug })}
							>
								Slug
							</Checkbox>
						</DisclosurePanel>
					</Disclosure>
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
									<SegmentedItem id="short-edge" className={segmentedItemFull}>
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
												min={-MAX_BACK_OFFSET_MM}
												max={MAX_BACK_OFFSET_MM}
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
												min={-MAX_BACK_OFFSET_MM}
												max={MAX_BACK_OFFSET_MM}
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
	);
}
