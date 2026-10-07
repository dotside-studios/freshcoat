import type { Element, LayoutChild, Template } from "@freshcoat-js/coatfile";
import { Checkbox } from "@freshcoat-js/ui/checkbox";
import { NumberField } from "@freshcoat-js/ui/number-field";
import { PanelSection } from "@freshcoat-js/ui/panel";
import { Select, SelectItem } from "@freshcoat-js/ui/select";
import { toast } from "@freshcoat-js/ui/toast";
import { memo, type ReactNode, useMemo } from "react";
import {
	applyRect,
	isAutoLayoutChild,
	type LayerGeometry,
	parentOrigin,
	type Rect,
} from "~/doc/geometry";
import { type OpResult, ok, updateElement } from "~/doc/ops";
import { getElement, isAncestor, parentKeyOf } from "~/doc/path";
import { useEditor } from "~/state/hooks";
import { working } from "~/state/store";
import RotateIcon from "~icons/mingcute/anticlockwise-line";
import { CommitField, Marked, Pair, Row } from "./controls";
import { isGridLayout } from "./FrameSection";
import {
	commonValue,
	formatGridLine,
	type Inspect,
	mergeKeyOf,
	parseGridLine,
} from "./field-helpers";

export const BLEND_MODES = [
	"normal",
	"multiply",
	"screen",
	"overlay",
	"darken",
	"lighten",
	"color-dodge",
	"color-burn",
	"linear-burn",
	"hard-light",
	"soft-light",
	"difference",
	"exclusion",
	"hue",
	"saturation",
	"color",
	"luminosity",
	"plus",
] as const;

const SIZING = ["fixed", "hug", "fill"] as const;

const POS = ["pos"];
const SIZE = ["size"];

type Axis = "x" | "y" | "width" | "height";

/** A layer's absolute box, read from the document where it says so and from
 *  the last render where layout decides, so typed values show before the
 *  repaint lands. */
export function liveRect(
	t: Template,
	key: string,
	geometry: LayerGeometry,
): Rect | undefined {
	const el = getElement(t, key) as Element | undefined;
	if (!el) return undefined;
	const g = geometry.get(key)?.rect;
	const auto = isAutoLayoutChild(t, key);
	const o = parentOrigin(t, key, geometry);
	const lc = el.layoutChild;
	const laidW = lc?.width === "hug" || lc?.width === "fill";
	const laidH = lc?.height === "hug" || lc?.height === "fill";
	const fromDoc = (v: number | undefined, laid: boolean) =>
		v !== undefined && !laid;
	return {
		x: !auto ? o.x + (el.pos?.x ?? 0) : (g?.x ?? o.x),
		y: !auto ? o.y + (el.pos?.y ?? 0) : (g?.y ?? o.y),
		width: fromDoc(el.size?.width, laidW || (auto && !el.size))
			? (el.size?.width as number)
			: (g?.width ?? el.size?.width ?? 0),
		height: fromDoc(el.size?.height, laidH || (auto && !el.size))
			? (el.size?.height as number)
			: (g?.height ?? el.size?.height ?? 0),
		rotation: el.rotation ?? 0,
	};
}

/** Sets one axis of every layer's absolute box. Auto-layout children only
 *  take a size, which pins that axis to `fixed`. */
export function setAxis(
	t: Template,
	keys: readonly string[],
	axis: Axis,
	value: number,
	geometry: LayerGeometry,
): OpResult {
	let next = t;
	for (const key of keys) {
		const rect = liveRect(next, key, geometry);
		if (!rect) continue;
		if (isAutoLayoutChild(next, key)) {
			if (axis === "x" || axis === "y") continue;
			const el = getElement(next, key) as Element;
			const size = {
				width: rect.width,
				height: rect.height,
				[axis]: Math.max(1, value),
			};
			const lcAxis = axis === "width" ? "width" : "height";
			const lc: LayoutChild | undefined =
				el.layoutChild?.[lcAxis] && el.layoutChild[lcAxis] !== "fixed"
					? { ...el.layoutChild, [lcAxis]: "fixed" }
					: el.layoutChild;
			next = replaceElement(next, key, { ...el, size, layoutChild: lc });
			continue;
		}
		const r = applyRect(next, key, { ...rect, [axis]: value }, geometry);
		if (!r.ok) return r;
		next = r.template;
	}
	return ok(next, [...keys]);
}

function replaceElement(t: Template, key: string, el: Element): Template {
	const r = updateElement(t, key, () => el);
	return r.ok ? r.template : t;
}

/** A disabled control says why on hover; the wrapper takes the pointer the
 *  disabled input ignores. */
function DisabledHint({
	when,
	tip,
	children,
}: {
	when: boolean;
	tip: string;
	children: ReactNode;
}) {
	if (!when) return children;
	return (
		<span title={tip} className="min-w-0">
			{children}
		</span>
	);
}

export const LayerSection = memo(function LayerSection({
	ins,
}: {
	ins: Inspect;
}) {
	const t = ins.template;
	const keys = ins.keys;
	const els = ins.layers as Element[];
	const autoAll = keys.every((k) => isAutoLayoutChild(t, k));
	const opacity = commonValue(
		els.map((e) => Math.round((e.opacity ?? 1) * 100)),
	);
	const blend = commonValue(els.map((e) => e.blendMode ?? "normal"));
	const parentLayouts = keys.map((k) => {
		const p = parentKeyOf(k);
		const pe = p ? getElement(t, p) : undefined;
		return pe?.type === "frame" ? pe.properties.layout : undefined;
	});
	const inLayout = parentLayouts.every((l) => l !== undefined);
	const inGrid = inLayout && parentLayouts.every(isGridLayout);

	return (
		<PanelSection title="Layer">
			<Pair>
				<GeometryFields ins={ins} autoAll={autoAll} />
				<Marked keys={["opacity"]}>
					<NumberField
						label="O"
						aria-label="Opacity"
						unit="%"
						min={0}
						max={100}
						precision={0}
						value={opacity}
						onChange={(v) =>
							ins.set("opacity", () => ({
								opacity: v >= 100 ? undefined : v / 100,
							}))
						}
					/>
				</Marked>
			</Pair>
			<Row label="Blend">
				<Select
					aria-label="Blend mode"
					className="flex-1"
					value={blend}
					placeholder="Mixed"
					onChange={(v) =>
						ins.setShared("blend", () => ({
							blendMode:
								v === "normal"
									? undefined
									: (v as (typeof BLEND_MODES)[number]),
						}))
					}
				>
					{BLEND_MODES.map((m) => (
						<SelectItem key={m} id={m}>
							{m}
						</SelectItem>
					))}
				</Select>
			</Row>
			{inLayout && <ResizingRows ins={ins} grid={inGrid} />}
		</PanelSection>
	);
});

/** Position, size and rotation follow the document live, even while the rest
 *  of the inspector holds still during a drag. */
function GeometryFields({ ins, autoAll }: { ins: Inspect; autoAll: boolean }) {
	const { keys, controller } = ins;
	// Subscribed as a string of the numbers shown, so a render result that
	// leaves them unchanged does not re-render the fields.
	const shown = useEditor((s) => {
		const t = working(s) ?? ins.template;
		return JSON.stringify(keys.map((k) => liveRect(t, k, s.geometry)));
	});
	const rects = useMemo(
		() => JSON.parse(shown) as ReturnType<typeof liveRect>[],
		[shown],
	);
	const geometry = () => controller.state.geometry;
	const axis = (a: Axis | "rotation") =>
		commonValue(rects.map((r) => (r ? round(r[a]) : 0)));

	// A layer inside another selected one moves with it, not on its own.
	const boxes = keys.filter((k) => !keys.some((o) => isAncestor(o, k)));
	const write = (a: Axis) => (v: number) =>
		controller.edit((doc) => setAxis(doc, boxes, a, v, geometry()), {
			mergeKey: mergeKeyOf(a, keys),
		});

	return (
		<>
			<Marked keys={POS}>
				<DisabledHint when={autoAll} tip="Positioned by auto layout">
					<NumberField
						label="X"
						value={axis("x")}
						onChange={write("x")}
						isDisabled={autoAll}
					/>
				</DisabledHint>
			</Marked>
			<Marked keys={POS}>
				<DisabledHint when={autoAll} tip="Positioned by auto layout">
					<NumberField
						label="Y"
						value={axis("y")}
						onChange={write("y")}
						isDisabled={autoAll}
					/>
				</DisabledHint>
			</Marked>
			<Marked keys={SIZE}>
				<NumberField
					label="W"
					value={axis("width")}
					min={1}
					onChange={write("width")}
				/>
			</Marked>
			<Marked keys={SIZE}>
				<NumberField
					label="H"
					value={axis("height")}
					min={1}
					onChange={write("height")}
				/>
			</Marked>
			<Marked keys={["rotation"]}>
				<NumberField
					label={<RotateIcon />}
					aria-label="Rotation"
					unit="°"
					value={axis("rotation")}
					min={-360}
					max={360}
					onChange={(v) =>
						ins.set("rotation", (el) => ({
							rotation: v === 0 && el.rotation === undefined ? undefined : v,
						}))
					}
				/>
			</Marked>
		</>
	);
}

function ResizingRows({ ins, grid }: { ins: Inspect; grid: boolean }) {
	const els = ins.layers as Element[];
	const lc = (e: Element) => e.layoutChild ?? {};
	const width = commonValue(els.map((e) => lc(e).width ?? "fixed"));
	const height = commonValue(els.map((e) => lc(e).height ?? "fixed"));
	const absolute = commonValue(els.map((e) => lc(e).absolute === true));
	const grow = commonValue(els.map((e) => lc(e).grow === 1));
	const column = commonValue(els.map((e) => formatGridLine(lc(e).column)));
	const row = commonValue(els.map((e) => formatGridLine(lc(e).row)));

	const setLc = (field: string, patch: Partial<LayoutChild>) =>
		ins.setShared(field, (el) => {
			const next = { ...(el as Element).layoutChild, ...patch } as Record<
				string,
				unknown
			>;
			for (const k of Object.keys(next))
				if (next[k] === undefined) delete next[k];
			return {
				layoutChild: Object.keys(next).length
					? (next as LayoutChild)
					: undefined,
			};
		});

	const place = (axis: "column" | "row") => (text: string) => {
		const line = parseGridLine(text);
		if (line === null) {
			toast("Use a track number like 2, or a span like 1-3", {
				tone: "danger",
			});
			return false;
		}
		setLc(`lc-${axis}`, { [axis]: line });
		return true;
	};

	return (
		<>
			{grid && (
				<Row label="Cell">
					<Pair className="flex-1">
						<CommitField
							aria-label="Grid column"
							placeholder="Column"
							value={column}
							onCommit={place("column")}
						/>
						<CommitField
							aria-label="Grid row"
							placeholder="Row"
							value={row}
							onCommit={place("row")}
						/>
					</Pair>
				</Row>
			)}
			<Row label="Resizing">
				<Select
					aria-label="Width sizing"
					className="flex-1"
					value={width}
					placeholder="Mixed"
					onChange={(v) =>
						setLc("lc-width", {
							width: v === "fixed" ? undefined : (v as "hug" | "fill"),
						})
					}
				>
					{SIZING.map((s) => (
						<SelectItem key={s} id={s} textValue={s}>
							W {s}
						</SelectItem>
					))}
				</Select>
				<Select
					aria-label="Height sizing"
					className="flex-1"
					value={height}
					placeholder="Mixed"
					onChange={(v) =>
						setLc("lc-height", {
							height: v === "fixed" ? undefined : (v as "hug" | "fill"),
						})
					}
				>
					{SIZING.map((s) => (
						<SelectItem key={s} id={s} textValue={s}>
							H {s}
						</SelectItem>
					))}
				</Select>
			</Row>
			<Row label="">
				<Checkbox
					isSelected={absolute === true}
					isIndeterminate={absolute === null}
					onChange={(v) =>
						setLc("lc-absolute", { absolute: v ? true : undefined })
					}
				>
					Absolute
				</Checkbox>
				{!grid && (
					<Checkbox
						isSelected={grow === true}
						isIndeterminate={grow === null}
						onChange={(v) => setLc("lc-grow", { grow: v ? 1 : undefined })}
						className="ml-2"
					>
						Grow
					</Checkbox>
				)}
			</Row>
		</>
	);
}

function round(n: number): number {
	return Math.round(n * 100) / 100;
}
