import { IconButton } from "@freshcoat-js/ui/icon-button";
import { Menu, MenuItem } from "@freshcoat-js/ui/menu";
import { Popover } from "@freshcoat-js/ui/popover";
import { Tooltip, TooltipTrigger } from "@freshcoat-js/ui/tooltip";
import { MenuTrigger, Button as RACButton } from "react-aria-components";
import { getElement } from "~/doc/path";
import { activeVariantId } from "~/doc/variant-edit";
import { useEditor, useThrottledEditor } from "~/state/hooks";
import { type EditorState, working } from "~/state/store";
import { activeSlot } from "~/state/workspace";
import PrevIcon from "~icons/mingcute/left-line";
import NextIcon from "~icons/mingcute/right-line";
import { useController } from "./context";
import { plural } from "./copy";
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
	const showStats = useRenderStats();
	const frame = template?.template_data[side];
	const size = useEditor(working);
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
				<span>
					{frame.name}
					{variant ? (
						<>
							{" · "}
							<span
								data-testid="status-variant"
								className="text-fc-accent-hover"
							>
								{variant}
							</span>
						</>
					) : null}{" "}
					· {size?.width} × {size?.height}
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
			<MenuTrigger>
				<RACButton
					aria-label="Zoom"
					data-testid="zoom-menu"
					className="w-12 rounded-[3px] text-right outline-none data-focus-visible:outline-solid data-focus-visible:outline-1 data-focus-visible:outline-fc-accent data-hovered:text-fc-text"
				>
					{Math.round(zoom * 100)}%
				</RACButton>
				<Popover placement="top end">
					<Menu
						onAction={(id) => {
							if (id === "fit") controller.fitView();
							else controller.zoomTo(Number(id));
						}}
					>
						<MenuItem id="fit" shortcut="Shift+1">
							Zoom to fit
						</MenuItem>
						{[0.5, 1, 2, 4].map((z) => (
							<MenuItem
								key={z}
								id={String(z)}
								shortcut={z === 1 ? "Shift+0" : undefined}
							>
								{`${z * 100}%`}
							</MenuItem>
						))}
					</Menu>
				</Popover>
			</MenuTrigger>
		</footer>
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
