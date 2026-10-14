import { cn } from "@freshcoat-js/ui/lib/cn";
import { lazy, Suspense, useEffect, useState } from "react";
import { VariantBar } from "~/canvas/VariantBar";
import { Viewport } from "~/canvas/Viewport";
import { LeftPanel } from "~/panels/LeftPanel";
import { RightPanel } from "~/panels/RightPanel";
import { useEditor } from "~/state/hooks";
import { AppMenuBar } from "./AppMenuBar";
import type { CommandContext } from "./commands";
import { useController } from "./context";
import { SidePanel } from "./SidePanel";
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
						testId="panel-left"
						open={panels.left}
						overlay={narrow}
						leftOverlayClassName="left-10 pointer-coarse:left-12"
						resizable
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
						testId="panel-right"
						open={panels.right}
						overlay={narrow}
						resizable
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
			</div>
			<StatusBar />
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
