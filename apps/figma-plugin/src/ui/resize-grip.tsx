import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import { postToMain } from "~/ui/post";

// The panel is designed at 320 by 480. Narrower, a Dropdown and a Button no
// longer fit side by side; shorter than 360, a tab's footer and the tabs leave
// too little between them to scroll.
const MIN_WIDTH = 320;
const MIN_HEIGHT = 360;
// The grip's own footprint, so the window edge lands under the cursor rather
// than a few px inside it.
const GRIP = 12;

/**
 * Bottom-right corner grip that resizes the plugin window.
 *
 * Figma gives plugins no chrome of their own, so a resizable panel has to draw
 * and drive its own handle. The pointer is captured on the grip, so a fast drag
 * that leaves the iframe keeps resizing instead of stopping dead. Size is
 * applied live during the drag and persisted once on release — clientStorage
 * writes on every pointermove would be dozens per second.
 */
export function ResizeGrip(): JSX.Element {
	const sizeRef = useRef<{ width: number; height: number } | null>(null);

	const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLElement>): void => {
		e.currentTarget.setPointerCapture(e.pointerId);
	};

	const onPointerMove = (e: JSX.TargetedPointerEvent<HTMLElement>): void => {
		if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
		// clientX/Y are relative to the iframe viewport, and the grip sits at its
		// bottom-right — so the cursor position IS the new size.
		const width = Math.max(MIN_WIDTH, Math.floor(e.clientX + GRIP));
		const height = Math.max(MIN_HEIGHT, Math.floor(e.clientY + GRIP));
		sizeRef.current = { width, height };
		postToMain({ type: "resize-window", width, height });
	};

	const onPointerUp = (e: JSX.TargetedPointerEvent<HTMLElement>): void => {
		e.currentTarget.releasePointerCapture(e.pointerId);
		const size = sizeRef.current;
		if (!size) return;
		sizeRef.current = null;
		postToMain({
			type: "save-settings",
			settings: { windowWidth: size.width, windowHeight: size.height },
		});
	};

	return (
		<div
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			title="Drag to resize"
			style={{
				position: "fixed",
				right: 0,
				bottom: 0,
				width: `${GRIP}px`,
				height: `${GRIP}px`,
				cursor: "nwse-resize",
				// Two short strokes echoing Figma's own corner grip.
				background:
					"linear-gradient(-45deg, transparent 3px, var(--figma-color-border) 3px, var(--figma-color-border) 4px, transparent 4px, transparent 6px, var(--figma-color-border) 6px, var(--figma-color-border) 7px, transparent 7px)",
				touchAction: "none",
			}}
		/>
	);
}
