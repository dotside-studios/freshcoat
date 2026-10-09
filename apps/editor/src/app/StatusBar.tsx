import { IconButton } from "@freshcoat-js/ui/icon-button";
import { Menu, MenuItem, MenuSeparator } from "@freshcoat-js/ui/menu";
import { Popover } from "@freshcoat-js/ui/popover";
import { Tooltip, TooltipTrigger } from "@freshcoat-js/ui/tooltip";
import { useState } from "react";
import { MenuTrigger, Button as RACButton } from "react-aria-components";
import { SideMenu, VariantMenu } from "~/canvas/SideVariantMenus";
import { getElement } from "~/doc/path";
import { activeVariantId } from "~/doc/variant-edit";
import { useEditor, useThrottledEditor } from "~/state/hooks";
import { type EditorState, working } from "~/state/store";
import { activeSlot } from "~/state/workspace";
import PrevIcon from "~icons/mingcute/left-line";
import NextIcon from "~icons/mingcute/right-line";
import ChevronUpIcon from "~icons/mingcute/up-line";
import { useController } from "./context";
import { plural, VARIANT_UI } from "./copy";
import { formatNumber } from "./format";
import { IssuesPopover } from "./IssuesPopover";
import { useRenderStats } from "./render-stats";

export function StatusBar() {
	const controller = useController();
	const template = useEditor((s) => s.doc?.history.present ?? null);
	const side = useEditor((s) => s.side);
	const selection = useEditor((s) => s.selection);
	const render = useThrottledEditor(selectRender, 250);
	const zoom = useEditor((s) => s.view.zoom);
	const hasSelection = selection.some((k) => !k.endsWith("/bg"));
	const showStats = useRenderStats();
	const frame = template?.template_data[side];
	const size = useEditor(working);
	const hasVariants = useEditor(
		(s) => (s.doc?.history.present.variants?.length ?? 0) > 0,
	);
	const variant = useEditor((s) => {
		const t = s.doc?.history.present;
		const id = t ? activeVariantId(t, s.variantId) : undefined;
		return id ? t?.variants?.find((v) => v.id === id)?.label : undefined;
	});

	let summary = "";
	if (template && selection.length === 1) {
		const key = selection[0] as string;
		const el = getElement(template, key);
		summary = key.endsWith("/bg")
			? "background"
			: el && "type" in el
				? `${el.type.replace("_", " ")} · ${el.id}`
				: "";
	} else if (selection.length > 1) summary = plural(selection.length, "layer");

	const t = render.timings;
	const stats = render.stats;

	return (
		<footer className="flex h-6 shrink-0 items-center gap-4 border-fc-border border-t bg-fc-app px-3 text-fc-muted text-fc-sm tabular-nums pointer-coarse:h-8">
			{frame && template ? (
				<span className="flex min-w-0 items-center gap-1">
					<SideMenu
						placement="top start"
						className="data-hovered:text-fc-text"
					/>
					{hasVariants ? (
						<>
							<span>·</span>
							<VariantMenu
								placement="top start"
								className={
									variant
										? "text-fc-accent-hover data-hovered:text-fc-accent"
										: "data-hovered:text-fc-text"
								}
							>
								<span data-testid={variant ? "status-variant" : undefined}>
									{variant ?? VARIANT_UI.default}
								</span>
							</VariantMenu>
						</>
					) : null}
					<span className="shrink-0">
						· {size?.width} × {size?.height}
					</span>
				</span>
			) : null}
			{summary ? <span className="truncate">{summary}</span> : null}
			<IssuesPopover />
			<span className="flex-1" />
			<RecordStep />
			{render.status === "error" ? (
				<span className="truncate text-fc-danger" title={render.error}>
					Couldn't render: {render.error}
				</span>
			) : t && showStats ? (
				<TooltipTrigger delay={300}>
					<RACButton
						data-testid="render-readout"
						className="outline-none data-hovered:text-fc-text"
					>
						{stats && stats.completed > 1 ? "render" : "first paint"}{" "}
						{t.total.toFixed(1)} ms
						{stats && stats.completed > 1
							? ` · p95 ${stats.p95.toFixed(1)} ms · ${stats.perSecond} r/s`
							: ""}
					</RACButton>
					<Tooltip>
						<div className="grid grid-cols-[auto_auto] gap-x-3 tabular-nums">
							<span>compile</span>
							<span className="text-right">{t.compile.toFixed(2)} ms</span>
							<span>layout</span>
							<span className="text-right">{t.layout.toFixed(2)} ms</span>
							<span>lower</span>
							<span className="text-right">{t.lower.toFixed(2)} ms</span>
							<span>paint</span>
							<span className="text-right">{t.paint.toFixed(2)} ms</span>
						</div>
					</Tooltip>
				</TooltipTrigger>
			) : null}
			<span className="flex items-center">
				<ZoomField zoom={zoom} />
				<MenuTrigger>
					<RACButton
						aria-label="Zoom"
						data-testid="zoom-menu"
						className="grid size-5 place-items-center rounded-[3px] outline-none data-focus-visible:outline-solid data-focus-visible:outline-1 data-focus-visible:outline-fc-accent data-hovered:text-fc-text pointer-coarse:size-7"
					>
						<ChevronUpIcon className="size-3" />
					</RACButton>
					<Popover placement="top end">
						<Menu
							disabledKeys={hasSelection ? [] : ["selection"]}
							onAction={(id) => {
								if (id === "fit") controller.fitView();
								else if (id === "selection") controller.zoomToSelection();
								else controller.zoomTo(Number(id));
							}}
						>
							<MenuItem id="fit" shortcut="Shift+1">
								Zoom to fit
							</MenuItem>
							<MenuItem id="selection" shortcut="Shift+2">
								Zoom to selection
							</MenuItem>
							<MenuSeparator />
							{[0.5, 1, 2, 4].map((z) => (
								<MenuItem
									key={z}
									id={String(z)}
									shortcut={z === 1 ? "Mod+0" : undefined}
								>
									{`${z * 100}%`}
								</MenuItem>
							))}
						</Menu>
					</Popover>
				</MenuTrigger>
			</span>
		</footer>
	);
}

/** The zoom as a percentage that takes a typed one. */
function ZoomField({ zoom }: { zoom: number }) {
	const controller = useController();
	const shown = `${Math.round(zoom * 100)}%`;
	const [draft, setDraft] = useState<string | null>(null);
	const commit = () => {
		const percent = Number.parseFloat(draft ?? "");
		if (Number.isFinite(percent) && percent > 0)
			controller.zoomTo(percent / 100);
		setDraft(null);
	};
	return (
		<input
			aria-label="Zoom percentage"
			data-testid="zoom-field"
			inputMode="decimal"
			className="w-11 rounded-[3px] bg-transparent text-right outline-none hover:text-fc-text focus:bg-fc-raised focus:text-fc-text focus:outline-solid focus:outline-1 focus:outline-fc-accent"
			value={draft ?? shown}
			onFocus={(e) => {
				setDraft(shown);
				e.currentTarget.select();
			}}
			onChange={(e) => setDraft(e.currentTarget.value)}
			onBlur={commit}
			onKeyDown={(e) => {
				if (e.key === "Enter") e.currentTarget.blur();
				else if (e.key === "Escape") {
					setDraft(null);
					e.currentTarget.blur();
				}
			}}
		/>
	);
}

/** "◀ 7/120 ▶": steps the Edit preview through the bound dataset. */
function RecordStep() {
	const controller = useController();
	const shown = useEditor((s) => {
		const id = activeSlot(s)?.binding?.datasetId;
		const records = s.workspace?.datasets.find((d) => d.id === id)?.records;
		if (!records?.length) return null;
		const at = s.previewRecordId
			? records.findIndex((r) => r.id === s.previewRecordId)
			: -1;
		return `${at}/${records.length}`;
	});
	if (!shown) return null;
	const [at, count] = shown.split("/").map(Number) as [number, number];
	const step = "size-5 pointer-coarse:size-7 [&_svg]:size-3.5";
	return (
		<span className="flex items-center" data-testid="status-record">
			<IconButton
				aria-label="Previous record"
				tooltip="Previous record"
				className={step}
				isDisabled={at === 0}
				onPress={() => controller.stepRecord(-1)}
			>
				<PrevIcon />
			</IconButton>
			<RACButton
				aria-label="Choose a record"
				className="rounded-[3px] px-1 outline-none data-focus-visible:outline-solid data-focus-visible:outline-1 data-focus-visible:outline-fc-accent data-hovered:text-fc-text"
				onPress={() => {
					controller.dispatch({ type: "setPanels", panels: { right: true } });
					controller.dispatch({ type: "setRightTab", tab: "content" });
				}}
			>
				{at < 0 ? "–" : formatNumber(at + 1)}/{formatNumber(count)}
			</RACButton>
			<IconButton
				aria-label="Next record"
				tooltip="Next record"
				className={step}
				isDisabled={at === count - 1}
				onPress={() => controller.stepRecord(1)}
			>
				<NextIcon />
			</IconButton>
		</span>
	);
}

function selectRender(s: EditorState) {
	return s.render;
}
