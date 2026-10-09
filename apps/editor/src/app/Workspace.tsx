import { cn } from "@freshcoat-js/ui/lib/cn";
import { lazy, type ReactNode, Suspense, useEffect, useState } from "react";
import { VariantBar } from "~/canvas/VariantBar";
import { Viewport } from "~/canvas/Viewport";
import { LeftPanel } from "~/panels/LeftPanel";
import { RightPanel } from "~/panels/RightPanel";
import { useEditor } from "~/state/hooks";
import { AppMenuBar } from "./AppMenuBar";
import type { CommandContext } from "./commands";
import { useController } from "./context";
import { StatusBar } from "./StatusBar";
import { ToolStrip } from "./ToolStrip";

const loadData = () => import("~/data/DataSection");
const loadExport = () => import("~/export/ExportSection");
const DataSection = lazy(() =>
	loadData().then((m) => ({ default: m.DataSection })),
);
const ExportSection = lazy(() =>
	loadExport().then((m) => ({ default: m.ExportSection })),
);

// Docked panels leave a 1024px tablet about 500px of canvas, which is enough
// to work in; below this they cover the canvas instead.
const OVERLAY_BELOW = 960;
const CLOSED_BELOW = OVERLAY_BELOW;
const COMPACT_BELOW = 1200;

export function Workspace({ ctx }: { ctx: CommandContext }) {
	const controller = useController();
	const panels = useEditor((s) => s.panels);
	const narrow = useNarrow();

	// Start with the panels out of the way on a small screen.
	useEffect(() => {
		if (window.innerWidth < CLOSED_BELOW)
			controller.dispatch({
				type: "setPanels",
				panels: { left: false, right: false },
			});
	}, [controller]);

	useEffect(() => {
		const prefetch = () => {
			void loadData();
			void loadExport();
		};
		if (typeof requestIdleCallback === "function") {
			const id = requestIdleCallback(prefetch);
			return () => cancelIdleCallback(id);
		}
		const id = setTimeout(prefetch, 1);
		return () => clearTimeout(id);
	}, []);

	const section = useEditor((s) => s.section);

	return (
		<>
			<AppMenuBar ctx={ctx} />
			<Suspense fallback={<SectionLoading />}>
				{section === "data" ? <DataSection /> : null}
				{section === "export" ? <ExportSection /> : null}
			</Suspense>
			{/* Edit stays mounted while hidden so its render session stays warm. */}
			<div
				className={cn(
					"relative min-h-0 flex-1 flex-col",
					section === "edit" ? "flex" : "hidden",
				)}
				data-testid="section-edit"
			>
				<div className="relative flex min-h-0 flex-1">
					<ToolStrip ctx={ctx} />
					<SidePanel
						side="left"
						open={panels.left}
						overlay={narrow}
						defaultWidth={compact() ? 220 : 240}
						onClose={() =>
							controller.dispatch({
								type: "setPanels",
								panels: { left: false },
							})
						}
					>
						<LeftPanel onTemplateSetup={ctx.showTemplateSetup} />
					</SidePanel>
					<div className="relative min-w-0 flex-1">
						<Viewport />
						<VariantBar />
					</div>
					<SidePanel
						side="right"
						open={panels.right}
						overlay={narrow}
						defaultWidth={compact() ? 256 : 280}
						onClose={() =>
							controller.dispatch({
								type: "setPanels",
								panels: { right: false },
							})
						}
					>
						<RightPanel />
					</SidePanel>
				</div>
				<StatusBar />
			</div>
		</>
	);
}

function SectionLoading() {
	return (
		<div className="grid min-h-0 flex-1 place-items-center bg-fc-app text-fc-faint text-fc-sm">
			Loading…
		</div>
	);
}

function compact(): boolean {
	return typeof window !== "undefined" && window.innerWidth < COMPACT_BELOW;
}

function useNarrow(): boolean {
	const [narrow, setNarrow] = useState(
		() => typeof window !== "undefined" && window.innerWidth < OVERLAY_BELOW,
	);
	useEffect(() => {
		const mq = window.matchMedia(`(max-width: ${OVERLAY_BELOW - 1}px)`);
		const on = () => setNarrow(mq.matches);
		on();
		mq.addEventListener("change", on);
		return () => mq.removeEventListener("change", on);
	}, []);
	return narrow;
}

/** A column beside the viewport, or an overlay above it on a narrow window.
 *  The inner edge drags to resize. */
function SidePanel({
	side,
	open,
	overlay,
	defaultWidth,
	onClose,
	children,
}: {
	side: "left" | "right";
	open: boolean;
	overlay: boolean;
	defaultWidth: number;
	onClose: () => void;
	children: ReactNode;
}) {
	const [width, setWidth] = useState(() => {
		try {
			const saved = Number(localStorage.getItem(`freshcoat.panel.${side}`));
			return saved >= 180 && saved <= 480 ? saved : defaultWidth;
		} catch {
			return defaultWidth;
		}
	});
	useEffect(() => {
		try {
			localStorage.setItem(`freshcoat.panel.${side}`, String(width));
		} catch {}
	}, [side, width]);

	if (!open) return null;
	return (
		<>
			{overlay ? (
				<div
					aria-hidden="true"
					className="absolute inset-0 z-20 bg-fc-scrim"
					onPointerDown={onClose}
				/>
			) : null}
			<aside
				data-testid={`panel-${side}`}
				className={cn(
					"relative z-30 flex min-h-0 shrink-0 flex-col bg-fc-panel",
					side === "left"
						? "border-fc-border border-r"
						: "border-fc-border border-l",
					overlay &&
						cn(
							"absolute inset-y-0 max-w-[85vw] shadow-(--shadow-fc-sheet)",
							side === "left" ? "left-10 pointer-coarse:left-12" : "right-0",
						),
				)}
				style={{ width }}
			>
				{children}
				{/* biome-ignore lint/a11y/useSemanticElements: an <hr> cannot take pointer and key input */}
				<div
					role="separator"
					tabIndex={0}
					aria-orientation="vertical"
					aria-valuenow={width}
					aria-valuemin={180}
					aria-valuemax={480}
					aria-label={`Resize the ${side} panel`}
					onKeyDown={(e) => {
						const step =
							e.key === "ArrowLeft" ? -16 : e.key === "ArrowRight" ? 16 : 0;
						if (!step) return;
						e.preventDefault();
						setWidth((w) =>
							Math.min(
								480,
								Math.max(180, w + (side === "left" ? step : -step)),
							),
						);
					}}
					className={cn(
						"absolute inset-y-0 z-10 w-1.5 cursor-col-resize touch-none hover:bg-fc-accent/40",
						side === "left" ? "-right-1" : "-left-1",
					)}
					onPointerDown={(e) => {
						const startX = e.clientX;
						const start = width;
						const el = e.currentTarget;
						el.setPointerCapture(e.pointerId);
						const move = (ev: PointerEvent) => {
							const d = ev.clientX - startX;
							setWidth(
								Math.min(
									480,
									Math.max(180, start + (side === "left" ? d : -d)),
								),
							);
						};
						const up = () => {
							el.removeEventListener("pointermove", move);
							el.removeEventListener("pointerup", up);
						};
						el.addEventListener("pointermove", move);
						el.addEventListener("pointerup", up);
					}}
				/>
			</aside>
		</>
	);
}
