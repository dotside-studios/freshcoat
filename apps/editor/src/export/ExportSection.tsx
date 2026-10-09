import { validate } from "@freshcoat-js/coatfile";
import { Button } from "@freshcoat-js/ui/button";
import { IconButton } from "@freshcoat-js/ui/icon-button";
import { cn } from "@freshcoat-js/ui/lib/cn";
import { SegmentedControl, SegmentedItem } from "@freshcoat-js/ui/segmented";
import { Tab, TabList, TabPanel, Tabs } from "@freshcoat-js/ui/tabs";
import {
	assetRef,
	type DataRecord,
	type DatasetAsset,
	type ExportItem,
	type ExportPreset,
	parseAssetRef,
	planExport,
	resolveValues,
	sheetSummary,
	unfilledRequired,
	variantFor,
	variantsFor,
} from "@freshcoat-js/workspace";
import {
	boundDatasetOf,
	itemSize,
	pagesPerSheet,
	planSheets,
	sheetOf,
	withRecordIds,
} from "@freshcoat-js/workspace/export";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useController } from "~/app/context";
import { BINDING, EMPTY, plural } from "~/app/copy";
import { formatNumber } from "~/app/format";
import { VariantSwatch } from "~/app/VariantSwatch";
import { selectedInView } from "~/data/gallery-model";
import { useDocumentFonts } from "~/render/use-document-fonts";
import { useEditor } from "~/state/hooks";
import type { ExportView } from "~/state/store";
import { workspaceOf } from "~/state/workspace";
import AddIcon from "~icons/mingcute/add-line";
import CloseIcon from "~icons/mingcute/close-line";
import PresetsIcon from "~icons/mingcute/layout-left-line";
import PrevIcon from "~icons/mingcute/left-line";
import NextIcon from "~icons/mingcute/right-line";
import SettingsIcon from "~icons/mingcute/settings-3-line";
import { ExportItemPreview, type PreviewItem } from "./ExportPreview";
import { ExportSettings, type SettingsTab } from "./ExportSettings";
import { useExportJobs } from "./export-jobs";
import {
	labelColumn,
	photoSizedTemplate,
	recordLabel,
	recordOutcome,
	type StatusFilter,
	selectedIds,
} from "./export-ui";
import { Filmstrip } from "./Filmstrip";
import {
	type FilmstripEntry,
	type FilmstripScope,
	filmstripEntries,
	previewVariant,
	variantToken,
	withVariantEntries,
} from "./filmstrip-model";
import { GlyphNotice } from "./GlyphNotice";
import { useGlyphPreflight } from "./glyph-client";
import { JobBar } from "./JobBar";
import { PresetList } from "./PresetList";
import { newPreset } from "./preset";
import {
	effectiveMode,
	PREVIEW_MODE_LABEL,
	type PreviewMode,
	previewModes,
	sourceField,
} from "./preview-mode";
import { RecordsList } from "./RecordsList";
import { SheetPreview } from "./SheetPreview";

/** A place the preview steps to: a record, and under All variants one of
 *  its variants by token (`variantToken`). */
type Stop = { recordId: string; token?: string };

const stopKey = (stop: Stop) =>
	stop.token === undefined ? stop.recordId : `${stop.recordId}:${stop.token}`;

/** The variant id a token names: undefined for Default. */
const variantOfToken = (token: string) =>
	token === variantToken(undefined) ? undefined : token;

/** Below this the presets and settings are sheets over a full-width preview. */
const SHEETS_BELOW = 1100;
const RAIL_KEY = "freshcoat.export.presetsRail";
const NONE: string[] = [];

function useNarrow(): boolean {
	const [narrow, setNarrow] = useState(
		() => typeof window !== "undefined" && window.innerWidth < SHEETS_BELOW,
	);
	useEffect(() => {
		if (typeof window === "undefined" || !window.matchMedia) return;
		const mq = window.matchMedia(`(max-width: ${SHEETS_BELOW - 1}px)`);
		const on = () => setNarrow(mq.matches);
		on();
		mq.addEventListener("change", on);
		return () => mq.removeEventListener("change", on);
	}, []);
	return narrow;
}

/** Whether the presets are folded to a rail: this viewer's choice, kept. */
function useRail(): [boolean, (on: boolean) => void] {
	const [rail, setRail] = useState(() => {
		try {
			return localStorage.getItem(RAIL_KEY) === "1";
		} catch {
			return false;
		}
	});
	const set = (on: boolean) => {
		setRail(on);
		try {
			if (on) localStorage.setItem(RAIL_KEY, "1");
			else localStorage.removeItem(RAIL_KEY);
		} catch {
			// Storage can be off; the choice then lasts the session.
		}
	};
	return [rail, set];
}

/** How long the file-name pattern must rest before the plan follows it. */
const FILE_NAME_SETTLE_MS = 150;

/** Whether the preset's file-name pattern has changed in the last moment,
 *  so the plan can wait for typing to pause. */
function useTypingFileName(preset: ExportPreset | undefined): boolean {
	const id = preset?.id;
	const fileName = preset?.fileName;
	const [settled, setSettled] = useState({ id, fileName });
	useEffect(() => {
		const timer = setTimeout(
			() =>
				setSettled((prev) =>
					prev.id === id && prev.fileName === fileName
						? prev
						: { id, fileName },
				),
			FILE_NAME_SETTLE_MS,
		);
		return () => clearTimeout(timer);
	}, [id, fileName]);
	return id === settled.id && fileName !== settled.fileName;
}

/** Whether planning just these records plans the same records as `plan`. */
function coversPlan(ids: readonly string[], plan: readonly ExportItem[]) {
	const wanted = new Set(ids);
	const planned = new Set(plan.map((item) => item.recordId));
	return (
		wanted.size === planned.size && [...wanted].every((id) => planned.has(id))
	);
}

export function ExportSection() {
	const controller = useController();
	const wsState = useEditor((s) => s.workspace);
	const present = useEditor((s) => s.doc?.history.present);
	const guides = useEditor((s) => s.doc?.history.guides);
	const workspace = useMemo(
		() =>
			wsState
				? workspaceOf(
						wsState,
						present && guides ? { present, guides } : undefined,
					)
				: null,
		[wsState, present, guides],
	);
	const jobs = useExportJobs();
	const narrow = useNarrow();
	const [rail, setRail] = useRail();
	const [overlay, setOverlay] = useState<"presets" | "settings" | null>(null);
	const {
		filter,
		scope,
		tab,
		settingsTab,
		selection: listSelection,
	} = useEditor((s) => s.exportView);
	const setView = (view: Partial<ExportView>) =>
		controller.dispatch({ type: "setExportView", view });
	const setFilter = (filter: StatusFilter) => setView({ filter });
	const setScope = (scope: FilmstripScope) => setView({ scope });
	const setTab = (tab: ExportView["tab"]) => setView({ tab });
	const setSettingsTab = (settingsTab: SettingsTab) => setView({ settingsTab });
	const setListSelection = (selection: string[]) => setView({ selection });
	const [chosenMode, setChosenMode] = useState<PreviewMode>("output");
	const [split, setSplit] = useState(0.5);
	const previewId = useEditor((s) => s.recordId);
	const setPreviewId = (id: string | null) =>
		controller.dispatch({ type: "setRecord", id });
	const [previewSide, setPreviewSide] = useState<string | null>(null);
	// The variant the preview shows under All variants, as a token; null
	// is the record's first.
	const [chosenToken, setChosenToken] = useState<string | null>(null);
	const [sheetIndex, setSheetIndex] = useState(0);
	const [sheetBack, setSheetBack] = useState(false);

	const presets = wsState?.presets ?? [];
	const preset =
		presets.find((p) => p.id === wsState?.activePresetId) ?? presets[0];
	const entry = workspace?.templates.find((t) => t.id === preset?.templateId);
	const template = entry?.template;
	const binding = entry?.binding;
	const everyVariant = binding?.variant?.kind === "all";
	const dataset =
		workspace && preset ? boundDatasetOf(workspace, preset) : undefined;
	const unbound = !!preset && !!template && !dataset;

	const typingFileName = useTypingFileName(preset);
	const lastPlan = useRef<ExportItem[]>([]);
	const plan = useMemo(() => {
		if (!typingFileName)
			lastPlan.current =
				workspace && preset ? planExport(workspace, preset) : [];
		return lastPlan.current;
	}, [workspace, preset, typingFileName]);
	const issues = useMemo(() => {
		if (!template) return 0;
		const result = validate(template);
		return result.ok ? 0 : result.errors.length;
	}, [template]);
	const selection = useMemo(() => {
		const ids =
			preset?.records === "selected" ? (preset.selected ?? []) : listSelection;
		if (!dataset) return [];
		const known = new Set(dataset.records.map((r) => r.id));
		return ids.filter((id) => known.has(id));
	}, [preset, listSelection, dataset]);
	const dataView = useEditor((s) =>
		dataset ? s.dataViews[dataset.id] : undefined,
	);
	const dataSelection = useMemo(
		() => (dataset ? selectedInView(dataset, dataView) : NONE),
		[dataset, dataView],
	);
	const onSelectionChange = (ids: string[]) => {
		if (preset?.records === "selected")
			controller.dispatch({
				type: "setPreset",
				preset: { ...preset, selected: ids },
			});
		else setListSelection(ids);
	};
	// Chosen records the export button runs over in place of the preset's
	// own. A saved selection is the preset's own, so it runs as usual.
	const chosen = preset?.records === "selected" ? NONE : selection;
	// Choosing every planned record plans the same items, so the plan serves.
	const lastRunPlan = useRef<ExportItem[]>([]);
	const runPlan = useMemo(() => {
		if (!typingFileName)
			lastRunPlan.current =
				chosen.length > 0 && workspace && preset && !coversPlan(chosen, plan)
					? planExport(workspace, withRecordIds(preset, chosen))
					: plan;
		return lastRunPlan.current;
	}, [chosen, workspace, preset, plan, typingFileName]);
	const runCount = runPlan.length;
	const { fonts } = useDocumentFonts(template ?? null);
	const glyphIssues = useGlyphPreflight(template, fonts, runPlan);
	// What the export button would put on sheets, when the preset uses them.
	const sheets = useMemo(
		() => (preset ? planSheets(runPlan, template, preset) : null),
		[runPlan, template, preset],
	);
	const imposition = sheets?.imposition;
	const blocked =
		issues > 0
			? `Template has ${plural(issues, "issue")}`
			: sheets?.error
				? sheets.shortError
				: runCount === 0
					? "Nothing to export"
					: null;
	const unfilled = useMemo(
		() =>
			template && workspace
				? unfilledRequired(template, binding, workspace.datasets).length
				: 0,
		[template, binding, workspace],
	);
	const onStripSelection = (ids: string[]) =>
		onSelectionChange(
			dataset ? selectedIds(new Set(ids), [], dataset.records) : ids,
		);

	// What the preview steps through: the planned records, in plan order,
	// and under All variants each record in each of its variants.
	const planned = useMemo(() => {
		const ids: string[] = [];
		const idSet = new Set<string>();
		const sides: string[] = [];
		const stops: Stop[] = [];
		const seen = new Set<string>();
		for (const item of plan) {
			if (!idSet.has(item.recordId)) {
				idSet.add(item.recordId);
				ids.push(item.recordId);
			}
			if (!sides.includes(item.side)) sides.push(item.side);
			const stop = everyVariant
				? { recordId: item.recordId, token: variantToken(item.variantId) }
				: { recordId: item.recordId };
			if (!seen.has(stopKey(stop))) {
				seen.add(stopKey(stop));
				stops.push(stop);
			}
		}
		return { ids, sides, stops, set: idSet };
	}, [plan, everyVariant]);
	const lastResult = jobs.snapshot.lastResult;
	const failedIds = useMemo(
		() => new Set(lastResult ? recordOutcome(lastResult).failed : []),
		[lastResult],
	);
	const entries = useMemo(() => {
		const records = filmstripEntries(dataset, planned.set, scope, failedIds);
		return everyVariant && template
			? withVariantEntries(records, template, (record) =>
					variantsFor(template, binding, dataset, record),
				)
			: records;
	}, [dataset, planned.set, scope, failedIds, everyVariant, template, binding]);
	const scopeCounts = useMemo(() => {
		let failed = 0;
		for (const r of dataset?.records ?? [])
			if (r.status === "failed" || failedIds.has(r.id)) failed++;
		return {
			export: dataset ? planned.ids.length : 0,
			all: dataset?.records.length ?? 0,
			failed,
		};
	}, [dataset, planned.ids.length, failedIds]);
	const stops: Stop[] = dataset
		? entries.map((e) =>
				e.variant
					? { recordId: e.record.id, token: e.variant.token }
					: { recordId: e.record.id },
			)
		: planned.stops;

	const sides =
		planned.sides.length > 0
			? planned.sides
			: (template?.template_data.map((f) => f.name) ?? []);
	const side =
		previewSide && sides.includes(previewSide) ? previewSide : sides[0];
	const previewRecord = previewId
		? dataset?.records.find((r) => r.id === previewId)
		: undefined;
	const currentId = previewRecord
		? previewRecord.id
		: previewId && planned.set.has(previewId)
			? previewId
			: (stops[0]?.recordId ?? planned.ids[0]);
	const offPlanRecord =
		currentId !== undefined && !planned.set.has(currentId)
			? dataset?.records.find((r) => r.id === currentId)
			: undefined;
	// Under All variants, the variants the current record exports, as
	// tokens, and the one previewed.
	const tokensHere = useMemo(() => {
		if (!everyVariant || !template || currentId === undefined) return [];
		const inPlan = planned.stops
			.filter((s) => s.recordId === currentId)
			.map((s) => s.token ?? variantToken(undefined));
		if (inPlan.length > 0) return inPlan;
		const record = dataset?.records.find((r) => r.id === currentId);
		return variantsFor(template, binding, dataset, record).map(variantToken);
	}, [everyVariant, template, currentId, planned.stops, dataset, binding]);
	const currentToken = everyVariant
		? chosenToken !== null && tokensHere.includes(chosenToken)
			? chosenToken
			: tokensHere[0]
		: undefined;
	const currentKey =
		currentId === undefined
			? undefined
			: stopKey({ recordId: currentId, token: currentToken });
	const currentVariant =
		currentToken === undefined
			? undefined
			: previewVariant(template, variantOfToken(currentToken));
	const position =
		currentKey === undefined
			? -1
			: stops.findIndex((s) => stopKey(s) === currentKey);

	const item = useMemo((): PreviewItem | null => {
		if (!template || side === undefined) return null;
		// Under All variants every variant of a record is its own item, so
		// its key names the variant, as the plan's do.
		const keyOf = (recordId: string) =>
			currentToken === undefined
				? `${recordId}:${side}`
				: `${recordId}:${side}:${currentToken}`;
		if (offPlanRecord && entry) {
			const values = resolveValues(
				template,
				entry.binding,
				dataset,
				offPlanRecord,
				0,
			);
			const variantId =
				currentToken === undefined
					? variantFor(template, entry.binding, dataset, offPlanRecord)
					: variantOfToken(currentToken);
			return {
				key: keyOf(offPlanRecord.id),
				side,
				values,
				...(variantId ? { variantId } : {}),
			};
		}
		const inVariant = (i: ExportItem) =>
			currentToken === undefined || variantToken(i.variantId) === currentToken;
		const found: ExportItem | undefined =
			plan.find(
				(i) => i.recordId === currentId && i.side === side && inVariant(i),
			) ??
			plan.find((i) => i.recordId === currentId && inVariant(i)) ??
			plan.find((i) => i.recordId === currentId);
		if (!found) return null;
		const variantId =
			currentToken === undefined
				? found.variantId
				: variantOfToken(currentToken);
		return {
			key: keyOf(found.recordId),
			side,
			values: found.values,
			...(variantId ? { variantId } : {}),
		};
	}, [
		template,
		side,
		offPlanRecord,
		entry,
		dataset,
		plan,
		currentId,
		currentToken,
	]);

	// A preset sized by a photo previews each record at that photo's aspect.
	const previewTemplate = useMemo(
		() =>
			template && preset
				? photoSizedTemplate(template, preset, item, dataset)
				: template,
		[template, preset, item, dataset],
	);

	const assetsByRef = useMemo(
		() =>
			new Map<string, DatasetAsset>(
				(dataset?.assets ?? []).map((a) => [assetRef(a.sha256), a]),
			),
		[dataset?.assets],
	);
	const outputSize = useMemo(() => {
		if (!template || !preset || !item || preset.format === "pdf") return null;
		const size = itemSize(template, preset, item as ExportItem, assetsByRef);
		return "error" in size ? null : { width: size.width, height: size.height };
	}, [template, preset, item, assetsByRef]);

	// Source and Split show the photo the template's image field reads.
	const srcField = sourceField(template, entry?.binding, preset);
	const modes = previewModes(srcField, !!imposition);
	const mode = effectiveMode(chosenMode, modes);
	const sheetMode = mode === "sheet" && !!imposition;
	const perSheet = imposition ? pagesPerSheet(imposition) : 1;
	const sheetCount = imposition?.sheets ?? 0;
	const sheet = Math.max(0, Math.min(sheetCount - 1, sheetIndex));
	const sheetPage = sheet * perSheet + (perSheet === 2 && sheetBack ? 1 : 0);
	const pickRecord = (id: string, picked?: FilmstripEntry) => {
		setPreviewId(id);
		// A record picked without a variant keeps the one previewed.
		const token = picked?.variant?.token ?? currentToken;
		if (picked?.variant) setChosenToken(picked.variant.token);
		if (sheetMode && imposition) {
			const at = sheetOf(imposition, id, token);
			if (at >= 0) setSheetIndex(at);
		}
	};
	const srcValue = srcField && item ? item.values[srcField] : undefined;
	const sourceRef =
		srcValue && parseAssetRef(srcValue) !== null ? srcValue : null;
	const thumbColumn = useMemo(() => {
		const bound = srcField ? entry?.binding?.fields[srcField] : undefined;
		if (bound?.kind === "column") return bound.column;
		return dataset?.columns.find((c) => c.type === "image")?.key;
	}, [srcField, entry?.binding, dataset?.columns]);
	const assetFor = (record: DataRecord) => {
		const value = thumbColumn ? record.values[thumbColumn] : undefined;
		return typeof value === "string" ? assetsByRef.get(value) : undefined;
	};

	const step = (by: number) => {
		const base = position < 0 ? 0 : position + by;
		const next = stops[Math.max(0, Math.min(stops.length - 1, base))];
		if (next === undefined) return;
		setPreviewId(next.recordId);
		if (next.token !== undefined) setChosenToken(next.token);
	};
	const showFailed = () => {
		setScope("failed");
		setFilter("failed");
		const first = dataset?.records.find(
			(r) => r.status === "failed" || failedIds.has(r.id),
		);
		if (first) setPreviewId(first.id);
	};

	if (!wsState) return <div className="flex-1" data-testid="section-export" />;

	const addPreset = () =>
		controller.dispatch({
			type: "setPreset",
			preset: newPreset(wsState.activeTemplateId, presets),
		});

	const presetsPanel = (
		<PresetList
			activeId={preset?.id ?? null}
			onPicked={() => narrow && setOverlay(null)}
			onClose={narrow ? () => setOverlay(null) : undefined}
			collapsed={!narrow && rail}
			onCollapsedChange={narrow ? undefined : setRail}
		/>
	);
	const settingsPanel = preset ? (
		<ExportSettings
			preset={preset}
			template={template}
			plan={plan}
			listSelection={listSelection}
			outputSize={outputSize}
			sheets={sheets}
			tab={settingsTab}
			onTabChange={setSettingsTab}
		/>
	) : null;
	const label = labelColumn(dataset);
	const currentRecord = dataset?.records.find((r) => r.id === currentId);
	const labelFor = (record: DataRecord) => recordLabel(record, label);
	const aspect = previewTemplate
		? previewTemplate.width / previewTemplate.height
		: 1.5;

	const toolbar = (
		<div className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-fc-border border-b bg-fc-panel px-2 py-1">
			{narrow ? (
				<IconButton
					aria-label="Presets"
					tooltip="Presets"
					onPress={() =>
						setOverlay((o) => (o === "presets" ? null : "presets"))
					}
				>
					<PresetsIcon />
				</IconButton>
			) : null}
			{preset ? (
				<>
					{sheetMode ? (
						<div
							className="flex items-center gap-0.5"
							data-testid="export-sheet-stepper"
						>
							<IconButton
								aria-label="Previous sheet"
								isDisabled={sheet <= 0}
								onPress={() => setSheetIndex(sheet - 1)}
							>
								<PrevIcon />
							</IconButton>
							<span
								className="min-w-20 text-center text-fc-muted text-fc-sm tabular-nums"
								data-testid="export-sheet-position"
							>
								{`Sheet ${sheetCount === 0 ? 0 : sheet + 1} of ${formatNumber(sheetCount)}`}
							</span>
							<IconButton
								aria-label="Next sheet"
								isDisabled={sheet >= sheetCount - 1}
								onPress={() => setSheetIndex(sheet + 1)}
							>
								<NextIcon />
							</IconButton>
						</div>
					) : (
						<div
							className="flex items-center gap-0.5"
							data-testid="export-stepper"
						>
							<IconButton
								aria-label="Previous record"
								isDisabled={position <= 0}
								onPress={() => step(-1)}
							>
								<PrevIcon />
							</IconButton>
							<span
								className="min-w-14 text-center text-fc-muted text-fc-sm tabular-nums"
								data-testid="export-stepper-position"
							>
								{stops.length === 0
									? "0 / 0"
									: `${position < 0 ? "–" : position + 1} / ${stops.length}`}
							</span>
							<IconButton
								aria-label="Next record"
								isDisabled={stops.length === 0 || position >= stops.length - 1}
								onPress={() => step(1)}
							>
								<NextIcon />
							</IconButton>
						</div>
					)}
					<div className="flex min-w-0 flex-1 items-baseline gap-2">
						<span className="min-w-0 truncate font-medium text-fc-base text-fc-text">
							{currentRecord && !sheetMode
								? labelFor(currentRecord)
								: preset.name}
						</span>
						{currentVariant && !sheetMode ? (
							<span
								className="flex shrink-0 items-center gap-1 text-fc-muted text-fc-sm"
								data-testid="export-preview-variant"
							>
								{currentVariant.id !== undefined ? (
									<VariantSwatch
										swatch={currentVariant.swatch}
										className="size-2.5 rounded-[2px]"
									/>
								) : null}
								{currentVariant.label}
							</span>
						) : null}
						{sheetMode && imposition ? (
							<span className="shrink-0 text-fc-faint text-fc-sm tabular-nums">
								{sheetSummary(imposition)}
							</span>
						) : null}
						{offPlanRecord ? (
							<span className="shrink-0 text-fc-sm text-fc-warning">
								not in this export
							</span>
						) : null}
						{currentRecord?.status === "failed" && currentRecord.error ? (
							<span
								className="min-w-0 truncate text-fc-danger-text text-fc-sm"
								title={currentRecord.error}
								data-testid="export-record-error"
							>
								{currentRecord.error}
							</span>
						) : null}
						{outputSize ? (
							<span
								className="shrink-0 text-fc-faint text-fc-sm tabular-nums"
								data-testid="export-preview-size"
							>
								{`${outputSize.width} × ${outputSize.height}`}
							</span>
						) : null}
					</div>
					{modes.length > 1 ? (
						<SegmentedControl
							aria-label="Preview"
							selectedKey={mode}
							onSelectionChange={(key) => setChosenMode(key as PreviewMode)}
						>
							{modes.map((m) => (
								<SegmentedItem
									key={m}
									id={m}
									className="min-w-0 px-2.5 pointer-coarse:min-w-0"
								>
									{PREVIEW_MODE_LABEL[m]}
								</SegmentedItem>
							))}
						</SegmentedControl>
					) : null}
					{sheetMode && perSheet === 2 ? (
						<SegmentedControl
							aria-label="Sheet side"
							selectedKey={sheetBack ? "back" : "front"}
							onSelectionChange={(key) => setSheetBack(key === "back")}
						>
							<SegmentedItem
								id="front"
								className="min-w-0 px-2.5 pointer-coarse:min-w-0"
							>
								Front
							</SegmentedItem>
							<SegmentedItem
								id="back"
								className="min-w-0 px-2.5 pointer-coarse:min-w-0"
							>
								Back
							</SegmentedItem>
						</SegmentedControl>
					) : null}
					{sides.length > 1 && !sheetMode ? (
						<SegmentedControl
							aria-label="Preview side"
							selectedKey={side ?? null}
							onSelectionChange={(key) => setPreviewSide(String(key))}
						>
							{sides.map((name) => (
								<SegmentedItem
									key={name}
									id={name}
									className="min-w-0 px-2.5 capitalize pointer-coarse:min-w-0"
								>
									{name}
								</SegmentedItem>
							))}
						</SegmentedControl>
					) : null}
				</>
			) : (
				<span className="flex-1 text-fc-muted">Export</span>
			)}
			{narrow && preset ? (
				<IconButton
					aria-label="Settings"
					tooltip="Settings"
					onPress={() =>
						setOverlay((o) => (o === "settings" ? null : "settings"))
					}
				>
					<SettingsIcon />
				</IconButton>
			) : null}
		</div>
	);

	const showBinding = () => {
		setSettingsTab("content");
		if (narrow) setOverlay("settings");
	};
	const bottom = preset ? (
		<Tabs
			selectedKey={tab}
			onSelectionChange={(key) => setTab(key as typeof tab)}
			className={cn(
				"shrink-0 border-fc-border border-t bg-fc-panel",
				tab === "records" ? "h-[42%] min-h-[220px]" : "h-[132px]",
			)}
			data-testid="export-bottom"
		>
			<div className="flex shrink-0 items-center gap-2 border-fc-border border-b pr-2">
				<TabList aria-label="Records view" className="border-b-0">
					<Tab id="filmstrip">Filmstrip</Tab>
					<Tab id="records">Records</Tab>
				</TabList>
				<div className="flex-1" />
				{chosen.length > 0 ? (
					<span
						className="flex shrink-0 items-center gap-0.5 text-fc-muted text-fc-sm tabular-nums"
						data-testid="export-selection"
					>
						{`${chosen.length} selected`}
						<IconButton
							aria-label="Clear selection"
							tooltip="Clear selection"
							onPress={() => setListSelection([])}
						>
							<CloseIcon />
						</IconButton>
					</span>
				) : null}
				{tab === "filmstrip" && dataset ? (
					<SegmentedControl
						aria-label="Filmstrip shows"
						selectedKey={scope}
						onSelectionChange={(key) => setScope(key as FilmstripScope)}
					>
						<ScopeItem
							id="export"
							label="In export"
							count={scopeCounts.export}
						/>
						<ScopeItem id="all" label="All" count={scopeCounts.all} />
						{scopeCounts.failed > 0 || scope === "failed" ? (
							<ScopeItem
								id="failed"
								label="Failed"
								count={scopeCounts.failed}
							/>
						) : null}
					</SegmentedControl>
				) : null}
			</div>
			<TabPanel id="filmstrip" className="flex overflow-hidden">
				{dataset ? (
					<Filmstrip
						entries={entries}
						currentId={currentKey ?? null}
						onPick={pickRecord}
						assetFor={assetFor}
						labelFor={labelFor}
						aspect={aspect}
						selection={selection}
						onSelectionChange={onStripSelection}
						emptyText={
							scope === "failed"
								? "No failed records"
								: scope === "export"
									? "No records match this preset"
									: EMPTY.records
						}
					/>
				) : (
					<UnboundHint onBind={showBinding} />
				)}
			</TabPanel>
			<TabPanel id="records" className="flex flex-col overflow-hidden">
				{dataset ? (
					<RecordsList
						dataset={dataset}
						filter={filter}
						onFilterChange={setFilter}
						selection={selection}
						onSelectionChange={onSelectionChange}
						previewId={currentId ?? null}
						onPreview={pickRecord}
						selectionIsPreset={preset.records === "selected"}
						dataSelection={dataSelection}
					/>
				) : (
					<UnboundHint onBind={showBinding} />
				)}
			</TabPanel>
		</Tabs>
	) : null;

	return (
		<div
			className="relative flex min-h-0 flex-1 flex-col"
			data-testid="section-export"
		>
			<div className="relative flex min-h-0 flex-1">
				{narrow ? (
					overlay ? (
						<Overlay
							side={overlay === "presets" ? "left" : "right"}
							title={overlay === "settings" ? "Settings" : null}
							onClose={() => setOverlay(null)}
							testId={`export-overlay-${overlay}`}
						>
							{overlay === "presets" ? presetsPanel : settingsPanel}
						</Overlay>
					) : null
				) : (
					<aside
						className={cn(
							"flex shrink-0 flex-col border-fc-border border-r bg-fc-panel",
							rail ? "w-11" : "w-52",
						)}
					>
						{presetsPanel}
					</aside>
				)}

				<main className="flex min-w-0 flex-1 flex-col bg-fc-pasteboard">
					{toolbar}
					{!preset ? (
						<div className="grid flex-1 place-items-center p-6">
							<div className="flex max-w-xs flex-col items-center gap-3 text-center">
								<p className="m-0 text-fc-muted">{EMPTY.presets}</p>
								<Button variant="primary" onPress={addPreset}>
									<AddIcon />
									New preset
								</Button>
							</div>
						</div>
					) : (
						<>
							<div className="relative flex min-h-[160px] flex-1 flex-col">
								{unbound ? (
									<Notice testId="export-unbound">
										Not bound to a dataset, exporting defaults
										<Button
											variant="ghost"
											size="sm"
											className="ml-1 text-fc-warning underline"
											onPress={showBinding}
										>
											Bind a dataset
										</Button>
									</Notice>
								) : null}
								{glyphIssues ? (
									<GlyphNotice
										issues={glyphIssues}
										labelFor={(id) => {
											const record = dataset?.records.find((r) => r.id === id);
											return record ? labelFor(record) : id;
										}}
										onPick={dataset ? (id) => pickRecord(id) : undefined}
										showSide={sides.length > 1}
									/>
								) : null}
								{sheetMode && template && imposition ? (
									<SheetPreview
										className="flex-1"
										template={template}
										imposition={imposition}
										page={sheetPage}
										assets={dataset?.assets}
										cropMarks={sheets?.layout.cropMarks ?? false}
										currentRecordId={currentId}
										currentVariant={currentToken}
									/>
								) : previewTemplate && item ? (
									<ExportItemPreview
										className="flex-1"
										template={previewTemplate}
										item={item}
										assets={dataset?.assets}
										mode={mode}
										sourceRef={sourceRef}
										split={split}
										onSplitChange={setSplit}
										printer={
											template
												? { template, preset, assets: assetsByRef }
												: undefined
										}
									/>
								) : (
									<div
										className="grid flex-1 place-items-center p-4 text-center text-fc-muted"
										data-testid="export-no-records"
									>
										<div>
											{template ? EMPTY.records : "Template not found"}
											{template && dataset ? (
												<span className="block text-fc-faint text-fc-sm">
													Nothing matches this preset
												</span>
											) : null}
										</div>
									</div>
								)}
							</div>
							{bottom}
						</>
					)}
				</main>

				{!narrow && settingsPanel ? (
					<aside className="flex w-72 shrink-0 flex-col border-fc-border border-l bg-fc-panel">
						{settingsPanel}
					</aside>
				) : null}
			</div>
			<JobBar
				jobs={jobs}
				snapshot={jobs.snapshot}
				preset={preset}
				count={runCount}
				blocked={blocked}
				blockedDetail={
					sheets?.error && blocked === sheets.shortError
						? sheets.error
						: undefined
				}
				warning={unfilled > 0 ? BINDING.unfilled(unfilled) : null}
				onShowFailed={dataset ? showFailed : undefined}
				recordIds={chosen}
			/>
		</div>
	);
}

function ScopeItem({
	id,
	label,
	count,
}: {
	id: FilmstripScope;
	label: string;
	count: number;
}) {
	return (
		<SegmentedItem
			id={id}
			className="min-w-0 px-2 pointer-coarse:min-w-0 pointer-coarse:px-2.5"
		>
			{label}
			<span className="ml-1 text-fc-faint tabular-nums">{count}</span>
		</SegmentedItem>
	);
}

function UnboundHint({ onBind }: { onBind: () => void }) {
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-fc-faint text-fc-sm">
			Bind a dataset to export one file per record
			<Button size="sm" onPress={onBind}>
				Bind a dataset
			</Button>
		</div>
	);
}

function Notice({ children, testId }: { children: ReactNode; testId: string }) {
	return (
		<p
			className="m-0 shrink-0 border-fc-border border-b bg-fc-warning/10 px-3 py-1 text-fc-sm text-fc-warning"
			data-testid={testId}
		>
			{children}
		</p>
	);
}

function Overlay({
	side,
	title,
	onClose,
	testId,
	children,
}: {
	side: "left" | "right";
	/** a title bar with a close button; the content brings its own without one */
	title: string | null;
	onClose: () => void;
	testId: string;
	children: ReactNode;
}) {
	return (
		<>
			<div
				aria-hidden="true"
				className="absolute inset-0 z-20 bg-fc-scrim"
				onPointerDown={onClose}
			/>
			<aside
				data-testid={testId}
				className={cn(
					"absolute inset-y-0 z-30 flex w-80 max-w-[88vw] flex-col bg-fc-panel shadow-(--shadow-fc-sheet)",
					side === "left"
						? "left-0 border-fc-border border-r"
						: "right-0 border-fc-border border-l",
				)}
				onKeyDown={(e) => {
					if (e.key === "Escape" && !e.defaultPrevented) onClose();
				}}
			>
				{title ? (
					<div className="flex h-8 shrink-0 items-center border-fc-border border-b pr-1 pl-2 pointer-coarse:h-10">
						<h2 className="m-0 flex-1 font-semibold text-[10px] text-fc-muted uppercase tracking-[0.06em]">
							{title}
						</h2>
						<IconButton aria-label="Close" onPress={onClose}>
							<CloseIcon />
						</IconButton>
					</div>
				) : null}
				{children}
			</aside>
		</>
	);
}
