import type { TextElement } from "@freshcoat-js/coatfile";
import {
	type CSSProperties,
	type KeyboardEvent,
	useLayoutEffect,
	useRef,
} from "react";
import { useController } from "~/app/context";
import { ancestorRects, worldCorners } from "~/doc/geometry";
import { getElement } from "~/doc/path";
import { useEditor } from "~/state/hooks";

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

/** The layer being edited on the canvas: a textarea over its box, in its
 *  font, holding the raw template text with its `{{tokens}}`. The render
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

	// biome-ignore lint/correctness/useExhaustiveDependencies: refocus when the edited layer changes
	useLayoutEffect(() => {
		const el = area.current;
		if (!el) return;
		fitHeight(el);
		el.focus();
		el.select();
	}, [layer]);

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

	const end = () => {
		if (controller.state.textEdit === layer) controller.endTextEdit();
	};
	const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		// The textarea keeps its own undo while the edit is one history step.
		e.stopPropagation();
		if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
			e.preventDefault();
			area.current?.blur();
		}
	};
	const align = props.align ?? (props.direction ? "start" : "left");

	return (
		<div
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
			<textarea
				ref={area}
				aria-label="Edit text on canvas"
				defaultValue={props.value ?? ""}
				dir={props.direction ?? "ltr"}
				spellCheck={false}
				rows={1}
				className="block w-full resize-none overflow-hidden border-0 bg-transparent p-0 outline outline-1 outline-fc-accent"
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
		</div>
	);
}
