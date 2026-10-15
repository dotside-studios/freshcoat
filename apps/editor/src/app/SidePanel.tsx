import { cn } from "@freshcoat-js/ui/lib/cn";
import { type ReactNode, useEffect, useState } from "react";

const MIN_WIDTH = 180;
const MAX_WIDTH = 480;

/** A column beside the content, or an overlay above it on a narrow window.
 *  With `resizable`, the inner edge drags to resize and the width is kept. */
export function SidePanel({
	side,
	testId,
	open,
	overlay,
	defaultWidth,
	resizable = false,
	escapeCloses = false,
	leftOverlayClassName = "left-0",
	onClose,
	children,
}: {
	side: "left" | "right";
	testId: string;
	open: boolean;
	overlay: boolean;
	defaultWidth: number;
	resizable?: boolean;
	/** Escape closes an overlay before anything under it takes the key. */
	escapeCloses?: boolean;
	/** Where the left overlay sits, to clear a strip beside it. */
	leftOverlayClassName?: string;
	onClose: () => void;
	children: ReactNode;
}) {
	const [width, setWidth] = useState(() => {
		if (!resizable) return defaultWidth;
		try {
			const saved = Number(localStorage.getItem(`freshcoat.panel.${side}`));
			return saved >= MIN_WIDTH && saved <= MAX_WIDTH ? saved : defaultWidth;
		} catch {
			return defaultWidth;
		}
	});
	useEffect(() => {
		if (!resizable) return;
		try {
			localStorage.setItem(`freshcoat.panel.${side}`, String(width));
		} catch {}
	}, [resizable, side, width]);

	useEffect(() => {
		if (!escapeCloses || !open || !overlay) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			const el = e.target as HTMLElement | null;
			if (
				el?.closest?.(
					"input,textarea,select,[role=dialog],[role=menu],[role=listbox]",
				)
			)
				return;
			e.preventDefault();
			e.stopPropagation();
			onClose();
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [escapeCloses, open, overlay, onClose]);

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
				data-testid={testId}
				className={cn(
					"relative z-30 flex min-h-0 shrink-0 flex-col bg-fc-panel",
					side === "left"
						? "border-fc-border border-r"
						: "border-fc-border border-l",
					overlay &&
						cn(
							"absolute inset-y-0 max-w-[85vw] shadow-(--shadow-fc-sheet)",
							side === "left" ? leftOverlayClassName : "right-0",
						),
				)}
				style={{ width }}
			>
				{children}
				{resizable ? (
					<ResizeHandle side={side} width={width} onWidth={setWidth} />
				) : null}
			</aside>
		</>
	);
}

function ResizeHandle({
	side,
	width,
	onWidth,
}: {
	side: "left" | "right";
	width: number;
	onWidth: (width: number) => void;
}) {
	const clamp = (w: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w));
	return (
		// biome-ignore lint/a11y/useSemanticElements: an <hr> cannot take pointer and key input
		<div
			role="separator"
			tabIndex={0}
			aria-orientation="vertical"
			aria-valuenow={width}
			aria-valuemin={MIN_WIDTH}
			aria-valuemax={MAX_WIDTH}
			aria-label={`Resize the ${side} panel`}
			onKeyDown={(e) => {
				const step =
					e.key === "ArrowLeft" ? -16 : e.key === "ArrowRight" ? 16 : 0;
				if (!step) return;
				e.preventDefault();
				onWidth(clamp(width + (side === "left" ? step : -step)));
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
					onWidth(clamp(start + (side === "left" ? d : -d)));
				};
				const up = () => {
					el.removeEventListener("pointermove", move);
					el.removeEventListener("pointerup", up);
				};
				el.addEventListener("pointermove", move);
				el.addEventListener("pointerup", up);
			}}
		/>
	);
}
