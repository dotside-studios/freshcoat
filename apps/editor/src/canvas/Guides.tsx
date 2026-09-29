import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { useController } from "~/app/context";
import type { EditorController } from "~/app/controller";
import { type GuideAxis, sideGuides } from "~/doc/guides";
import { useEditor } from "~/state/hooks";
import { present } from "~/state/store";
import { RULER_SIZE } from "./rulers";

const HIT = 7;

export const GUIDE_LABEL: Record<GuideAxis, string> = {
	x: "Vertical guide",
	y: "Horizontal guide",
};

/** The active side's ruler guides, over the canvas. */
export function Guides() {
	const controller = useController();
	const view = useEditor((s) => s.view);
	const tool = useEditor((s) => s.tool);
	const size = useEditor((s) => {
		const t = present(s);
		return t ? `${t.width}x${t.height}` : "";
	});
	const guides = useEditor((s) => {
		const t = present(s);
		const name = t?.template_data[s.side]?.name;
		return s.doc && name !== undefined
			? sideGuides(s.doc.history.guides, name)
			: null;
	});
	if (!guides || (guides.x.length === 0 && guides.y.length === 0)) return null;
	const [width, height] = size.split("x").map(Number) as [number, number];
	const interactive = tool === "move";

	return (
		<div className="pointer-events-none absolute inset-0" data-testid="guides">
			{(["x", "y"] as const).map((axis) =>
				guides[axis].map((value, index) => (
					<Guide
						// biome-ignore lint/suspicious/noArrayIndexKey: a guide is its index on its axis
						key={`${axis}${index}`}
						axis={axis}
						index={index}
						value={value}
						at={
							axis === "x"
								? view.x + value * view.zoom
								: view.y + value * view.zoom
						}
						max={axis === "x" ? width : height}
						interactive={interactive}
						controller={controller}
					/>
				)),
			)}
		</div>
	);
}

function Guide({
	axis,
	index,
	value,
	at,
	max,
	interactive,
	controller,
}: {
	axis: GuideAxis;
	index: number;
	value: number;
	at: number;
	max: number;
	interactive: boolean;
	controller: EditorController;
}) {
	const vertical = axis === "x";
	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		const step = e.shiftKey ? 10 : 1;
		const delta = {
			ArrowLeft: -step,
			ArrowUp: -step,
			ArrowRight: step,
			ArrowDown: step,
		}[e.key];
		if (delta !== undefined) {
			e.preventDefault();
			controller.moveGuide(axis, index, value + delta, {
				mergeKey: `guide:${axis}:${index}`,
			});
			return;
		}
		if (e.key === "Delete" || e.key === "Backspace") {
			e.preventDefault();
			controller.removeGuide(axis, index);
			focusRuler(e.currentTarget, axis);
			return;
		}
		if (e.key === "Escape") {
			e.preventDefault();
			e.currentTarget.blur();
		}
	};
	const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (e.button !== 0) return;
		e.stopPropagation();
		e.preventDefault();
		e.currentTarget.focus({ preventScroll: true });
		const viewport = viewportOf(e.currentTarget);
		if (viewport) dragGuide(controller, viewport, axis, index);
	};

	return (
		<div
			role="slider"
			tabIndex={0}
			aria-label={GUIDE_LABEL[axis]}
			aria-orientation={vertical ? "horizontal" : "vertical"}
			aria-valuenow={value}
			aria-valuemin={Math.min(0, value)}
			aria-valuemax={Math.max(max, value)}
			aria-valuetext={`${value} px`}
			data-testid={`guide-${axis}-${index}`}
			data-value={value}
			className={`group absolute flex justify-center outline-none ${
				interactive ? "pointer-events-auto" : ""
			} ${vertical ? "top-0 bottom-0 cursor-ew-resize" : "right-0 left-0 cursor-ns-resize flex-col"}`}
			style={
				vertical
					? { left: Math.round(at) - (HIT - 1) / 2, width: HIT }
					: { top: Math.round(at) - (HIT - 1) / 2, height: HIT }
			}
			onPointerDown={onPointerDown}
			onKeyDown={onKeyDown}
		>
			<div
				className={`bg-fc-guide group-focus-visible:bg-fc-accent ${vertical ? "h-full w-px" : "h-px w-full"}`}
			/>
			<span
				className="pointer-events-none absolute hidden whitespace-nowrap rounded-sm bg-fc-raised px-1 text-fc-text text-fc-xs tabular-nums group-hover:block group-focus-visible:block"
				style={
					vertical
						? { top: RULER_SIZE + 4, left: HIT }
						: { left: RULER_SIZE + 4, top: HIT }
				}
			>
				{value}
			</span>
		</div>
	);
}

export function viewportOf(el: Element): HTMLElement | null {
	return el.closest<HTMLElement>('[data-testid="viewport"]');
}

function focusRuler(from: Element, axis: GuideAxis) {
	viewportOf(from)
		?.querySelector<HTMLElement>(`[data-ruler-adds="${axis}"]`)
		?.focus();
}

/** Focuses a guide once it has rendered. */
export function focusGuide(viewport: Element, axis: GuideAxis, index: number) {
	requestAnimationFrame(() =>
		viewport
			.querySelector<HTMLElement>(`[data-testid="guide-${axis}-${index}"]`)
			?.focus(),
	);
}

/**
 * Drags a guide with the pointer as one undo step: a new one (`index` null)
 * from a ruler, or an existing one. Let go over its ruler to remove it; Esc
 * cancels.
 */
export function dragGuide(
	controller: EditorController,
	viewport: HTMLElement,
	axis: GuideAxis,
	index: number | null,
): void {
	const box = viewport.getBoundingClientRect();
	const local = (e: PointerEvent) =>
		axis === "x" ? e.clientX - box.left : e.clientY - box.top;
	const valueAt = (e: PointerEvent) => {
		const v = controller.state.view;
		return Math.round((local(e) - (axis === "x" ? v.x : v.y)) / v.zoom);
	};
	const overRuler = (e: PointerEvent) =>
		controller.state.rulers && local(e) < RULER_SIZE;
	const created = index === null;
	let current = index;

	controller.beginTx();
	const move = (e: PointerEvent) => {
		const value = valueAt(e);
		if (current === null) {
			if (overRuler(e)) return;
			current = controller.addGuide(axis, value, { preview: true });
		} else controller.moveGuide(axis, current, value, { preview: true });
	};
	const stop = () => {
		window.removeEventListener("pointermove", move);
		window.removeEventListener("pointerup", up);
		window.removeEventListener("pointercancel", cancel);
		window.removeEventListener("keydown", onEscape, true);
	};
	const up = (e: PointerEvent) => {
		stop();
		if (current === null) return controller.cancelTx();
		if (overRuler(e)) {
			if (created) return controller.cancelTx();
			controller.removeGuide(axis, current, { preview: true });
			return controller.endTx();
		}
		controller.endTx();
		if (created) focusGuide(viewport, axis, current);
	};
	const cancel = () => {
		stop();
		controller.cancelTx();
	};
	const onEscape = (e: globalThis.KeyboardEvent) => {
		if (e.key !== "Escape") return;
		e.preventDefault();
		e.stopImmediatePropagation();
		cancel();
	};
	window.addEventListener("pointermove", move);
	window.addEventListener("pointerup", up);
	window.addEventListener("pointercancel", cancel);
	window.addEventListener("keydown", onEscape, true);
}
