import { Menu, MenuItem } from "@freshcoat/ui/menu";
import { Popover } from "@freshcoat/ui/popover";
import { Tooltip, TooltipTrigger } from "@freshcoat/ui/tooltip";
import { MenuTrigger, Button as RACButton } from "react-aria-components";
import { getElement } from "~/doc/path";
import { activeVariantId } from "~/doc/variant-edit";
import { useEditor, useThrottledEditor } from "~/state/hooks";
import type { EditorState } from "~/state/store";
import { useController } from "./context";
import { plural } from "./copy";
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
					· {template.width} × {template.height}
				</span>
			) : null}
			{summary ? <span className="truncate">{summary}</span> : null}
			<IssuesPopover />
			<span className="flex-1" />
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

function selectRender(s: EditorState) {
	return s.render;
}
