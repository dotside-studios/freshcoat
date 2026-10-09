import type { TextElement } from "@freshcoat-js/coatfile";
import { cn } from "@freshcoat-js/ui/lib/cn";
import type { CanvasKit } from "canvaskit-wasm";
import {
	type CSSProperties,
	type KeyboardEvent,
	type PointerEvent,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { useController } from "~/app/context";
import { ancestorRects, worldCorners } from "~/doc/geometry";
import { getElement } from "~/doc/path";
import { useFieldCompletion } from "~/panels/design/field-completion";
import { getCanvasKit, loadedCanvasKit } from "~/render/canvaskit";
import { useEditor } from "~/state/hooks";
import { TextSurface } from "./text-surface";

const faces = new Map<string, string>();

/** A CSS family for the template's own font bytes, so the editor shows the
 *  face the canvas paints. Falls back to the family's name where the browser
 *  has no FontFace. */
function editingFamily(
	family: string,
	fonts: Map<string, Uint8Array[]> | undefined,
): string {
	const known = faces.get(family);
	if (known) return known;
	const bytes = fonts?.get(family)?.[0];
	if (
		!bytes ||
		typeof FontFace === "undefined" ||
		typeof document === "undefined"
	)
		return family;
	const name = `fc-text-${family.replace(/[^A-Za-z0-9]+/g, "-")}`;
	const face = new FontFace(name, bytes.slice().buffer);
	document.fonts.add(face);
	void face.load().catch(() => faces.delete(family));
	faces.set(family, name);
	return name;
}

function fitHeight(el: HTMLTextAreaElement) {
	el.style.height = "0px";
	el.style.height = `${el.scrollHeight}px`;
}

function useCanvasKit(): CanvasKit | undefined {
	const [ck, setCk] = useState(loadedCanvasKit);
	useEffect(() => {
		if (ck) return;
		let live = true;
		getCanvasKit()
			.then((instance) => {
				if (live) setCk(() => instance);
			})
			.catch(() => {});
		return () => {
			live = false;
		};
	}, [ck]);
	return ck;
}

function select(el: HTMLTextAreaElement, anchor: number, focus: number) {
	if (focus < anchor) el.setSelectionRange(focus, anchor, "backward");
	else el.setSelectionRange(anchor, focus, "forward");
}

function ends(el: HTMLTextAreaElement): { anchor: number; focus: number } {
	return el.selectionDirection === "backward"
		? { anchor: el.selectionEnd, focus: el.selectionStart }
		: { anchor: el.selectionStart, focus: el.selectionEnd };
}

const MAC =
	typeof navigator !== "undefined" &&
	/Mac|iP(hone|ad)/.test(navigator.platform);

const JUSTIFY: Record<string, CSSProperties["justifyContent"]> = {
	top: "flex-start",
	middle: "center",
	bottom: "flex-end",
};

const CASE: Record<string, CSSProperties["textTransform"]> = {
	upper: "uppercase",
	lower: "lowercase",
	title: "capitalize",
};

/** The layer being edited on the canvas, holding the raw template text with
 *  its `{{tokens}}`. A textarea over the layer's box takes the typing; once
 *  CanvasKit is loaded it hides, and a canvas shows the text as the render
 *  shapes and wraps it, with the caret, selection and fields. The render
 *  leaves the layer out meanwhile. Blur, Escape or Mod+Enter end the edit. */
export function TextEditor() {
	const key = useEditor((s) => s.textEdit);
	return key ? <EditingText layer={key} /> : null;
}

function EditingText({ layer }: { layer: string }) {
	const controller = useController();
	const view = useEditor((s) => s.view);
	const geometry = useEditor((s) => s.geometry);
	const area = useRef<HTMLTextAreaElement>(null);
	const wrap = useRef<HTMLDivElement>(null);
	const canvas = useRef<HTMLCanvasElement>(null);
	const surface = useRef<TextSurface | null>(null);
	const goal = useRef<{ at: number; x: number } | null>(null);
	const drag = useRef<{ from: [number, number]; by: "char" | "word" } | null>(
		null,
	);
	const [painted, setPainted] = useState(false);
	const ck = useCanvasKit();
	const placed = geometry.has(layer);
	const template = useEditor((s) => s.doc?.history.present ?? null);
	const completion = useFieldCompletion(wrap, template, (next, caret) => {
		const el = area.current;
		if (!el) return;
		el.value = next;
		el.setSelectionRange(caret, caret);
		fitHeight(el);
		controller.setEditedText(next);
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: refocus when the edited layer changes or a new one is first laid out
	useLayoutEffect(() => {
		const el = area.current;
		if (!el) return;
		fitHeight(el);
		el.focus();
		el.select();
	}, [layer, placed]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: a new surface for each layer, once its canvas is mounted
	useLayoutEffect(() => {
		const c = canvas.current;
		const a = area.current;
		if (!ck || !c || !a) return;
		const s = new TextSurface(ck, c, a, () => setPainted(true));
		surface.current = s;
		return () => {
			surface.current = null;
			s.dispose();
			setPainted(false);
		};
	}, [ck, layer, placed]);

	const t = controller.template;
	const el = t ? getElement(t, layer) : undefined;
	const box = geometry.get(layer);
	if (!el || !("type" in el) || el.type !== "text" || !box) return null;
	const props = (el as TextElement).properties;
	const font = props.font;

	const corners = worldCorners(box.rect, ancestorRects(layer, geometry)).map(
		(p) => ({ x: view.x + p.x * view.zoom, y: view.y + p.y * view.zoom }),
	);
	const [nw, ne, , sw] = corners as [
		{ x: number; y: number },
		{ x: number; y: number },
		{ x: number; y: number },
		{ x: number; y: number },
	];
	const width = Math.hypot(ne.x - nw.x, ne.y - nw.y);
	const height = Math.hypot(sw.x - nw.x, sw.y - nw.y);
	const angle = (Math.atan2(ne.y - nw.y, ne.x - nw.x) * 180) / Math.PI;
	if (surface.current)
		surface.current.input = {
			props,
			fonts: controller.fonts,
			box: { width: box.rect.width, height: box.rect.height },
			zoom: view.zoom,
		};

	const laidOut = () => {
		const s = surface.current;
		return painted && s?.sync() ? s.text : null;
	};
	const move = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		const text = laidOut();
		const el = area.current;
		if (!text || !el || e.altKey || e.ctrlKey) return false;
		const { anchor, focus } = ends(el);
		let to: number | null = null;
		if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.metaKey) {
			const x =
				goal.current?.at === focus ? goal.current.x : text.caret(focus).x;
			to = text.vertical(focus, e.key === "ArrowUp" ? -1 : 1, x);
			goal.current = { at: to, x };
		} else if (
			e.key === "Home" ||
			e.key === "End" ||
			(MAC && e.metaKey && (e.key === "ArrowLeft" || e.key === "ArrowRight"))
		) {
			const back = e.key === "Home" || e.key === "ArrowLeft";
			if (e.metaKey && !MAC) return false;
			to = text.lineEdge(focus, back ? "start" : "end");
		}
		if (to === null) return false;
		if (e.shiftKey) select(el, anchor, to);
		else el.setSelectionRange(to, to);
		return true;
	};

	const pick = (e: PointerEvent<HTMLCanvasElement>) => {
		const text = laidOut();
		if (!text) return null;
		const at = text.indexAt(
			e.nativeEvent.offsetX / view.zoom,
			e.nativeEvent.offsetY / view.zoom,
		);
		return { text, at };
	};
	const onCanvasDown = (e: PointerEvent<HTMLCanvasElement>) => {
		e.stopPropagation();
		e.preventDefault();
		const el = area.current;
		const hit = pick(e);
		if (!el || !hit || e.button !== 0) return;
		el.focus();
		const { text, at } = hit;
		goal.current = null;
		if (e.detail >= 3) {
			const [a, b] = text.paragraph(at);
			select(el, a, b);
			drag.current = null;
			return;
		}
		if (e.detail === 2) {
			const [a, b] = text.word(at);
			select(el, a, b);
			drag.current = { from: [a, b], by: "word" };
		} else if (e.shiftKey) {
			const { anchor } = ends(el);
			select(el, anchor, at);
			drag.current = { from: [anchor, anchor], by: "char" };
		} else {
			el.setSelectionRange(at, at);
			drag.current = { from: [at, at], by: "char" };
		}
		e.currentTarget.setPointerCapture(e.pointerId);
	};
	const onCanvasMove = (e: PointerEvent<HTMLCanvasElement>) => {
		const d = drag.current;
		const el = area.current;
		const hit = d && pick(e);
		if (!d || !el || !hit) return;
		const [a, b] = d.by === "word" ? hit.text.word(hit.at) : [hit.at, hit.at];
		if (a < d.from[0]) select(el, d.from[1], a);
		else select(el, d.from[0], Math.max(b, d.from[1]));
	};
	const onCanvasUp = () => {
		drag.current = null;
	};

	const end = () => {
		if (controller.state.textEdit === layer) controller.endTextEdit();
	};
	const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		// The textarea keeps its own undo while the edit is one history step.
		e.stopPropagation();
		if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
			e.preventDefault();
			area.current?.blur();
			return;
		}
		if (e.key !== "ArrowUp" && e.key !== "ArrowDown") goal.current = null;
		if (move(e)) e.preventDefault();
	};
	const align = props.align ?? (props.direction ? "start" : "left");

	return (
		<div
			ref={wrap}
			className="absolute flex flex-col"
			style={{
				left: nw.x,
				top: nw.y,
				width,
				minHeight: height,
				transform: angle ? `rotate(${angle}deg)` : undefined,
				transformOrigin: "0 0",
				justifyContent: JUSTIFY[props.verticalAlign ?? "top"],
			}}
		>
			<canvas
				ref={canvas}
				aria-hidden
				className={cn(
					"block cursor-text outline outline-1 outline-fc-accent",
					!painted && "hidden",
				)}
				onPointerDown={onCanvasDown}
				onPointerMove={onCanvasMove}
				onPointerUp={onCanvasUp}
				onPointerCancel={onCanvasUp}
				onMouseDown={(e) => e.preventDefault()}
				onDoubleClick={(e) => e.stopPropagation()}
			/>
			<textarea
				ref={area}
				aria-label="Edit text on canvas"
				defaultValue={props.value ?? ""}
				dir={props.direction ?? "ltr"}
				spellCheck={false}
				rows={1}
				className={cn(
					"block w-full resize-none overflow-hidden border-0 bg-transparent p-0",
					painted
						? "pointer-events-none absolute inset-0 h-full text-transparent caret-transparent selection:bg-transparent"
						: "outline outline-1 outline-fc-accent",
				)}
				style={{
					fontFamily: `"${editingFamily(font.family, controller.fonts)}", "${font.family}", sans-serif`,
					fontSize: font.size * view.zoom,
					fontWeight: font.weight ?? 400,
					fontStyle: font.style ?? "normal",
					letterSpacing: font.letterSpacing
						? font.letterSpacing * view.zoom
						: undefined,
					lineHeight:
						typeof font.lineHeight === "number" ? font.lineHeight : "normal",
					color: props.color ?? "black",
					textAlign: align,
					textAlignLast:
						props.align === "justify" ? props.alignLast : undefined,
					textTransform: CASE[props.case ?? ""],
					textDecoration: font.decoration,
				}}
				onInput={(e) => {
					fitHeight(e.currentTarget);
					controller.setEditedText(e.currentTarget.value);
				}}
				onBlur={end}
				onKeyDown={onKeyDown}
				onPointerDown={(e) => e.stopPropagation()}
				onDoubleClick={(e) => e.stopPropagation()}
			/>
			{completion}
		</div>
	);
}
