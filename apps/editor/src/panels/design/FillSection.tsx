import type { Fill } from "@freshcoat-js/coatfile";
import {
	addStop,
	convertFill,
	type FillKind,
	fillKind,
	fillsOf,
	fillsPatch,
	type Gradient,
	type GradientStop,
	isGradient,
	type PatternFill,
	type PatternName,
	patternParams,
	reverseStops,
	rotateQuarter,
	withLinearAngle,
	withStops,
} from "@freshcoat-js/coatfile/fills";
import { ColorInput } from "@freshcoat-js/ui/color";
import { IconButton } from "@freshcoat-js/ui/icon-button";
import { NumberField } from "@freshcoat-js/ui/number-field";
import { Select, SelectItem } from "@freshcoat-js/ui/select";
import { useMemo } from "react";
import { useEditor } from "~/state/hooks";
import ClockwiseIcon from "~icons/mingcute/clockwise-line";
import ReverseIcon from "~icons/mingcute/transfer-horizontal-line";
import {
	AddButton,
	ItemGroup,
	Pair,
	RemoveButton,
	sectionActions,
} from "./controls";
import { commonValue, type Inspect, type Layer } from "./field-helpers";
import { DEFAULT_FILL_COLOR, removeAt, replaceAt } from "./fills";
import { GradientSwatch } from "./GradientSwatch";
import { InspectorSection } from "./InspectorSection";
import { PatternSwatch } from "./PatternSwatch";
import { GradientStops } from "./StopBar";

export const KINDS: [FillKind, string][] = [
	["solid", "Solid"],
	["linear", "Linear"],
	["radial", "Radial"],
	["angular", "Angular"],
	["pattern", "Pattern"],
];

const PATTERNS: [PatternName, string][] = [
	["noise", "Noise"],
	["paper", "Paper"],
	["hatching", "Hatching"],
	["dots", "Dots"],
];

export function FillSection({
	ins,
	title = "Fill",
}: {
	ins: Inspect;
	title?: string;
}) {
	const lists = ins.layers.map(fillsOf);
	const common = commonValue(lists);
	const single = ins.layers.every((l) => l.type === "text");

	const update = (field: string, fn: (fills: Fill[], el: Layer) => Fill[]) =>
		ins.setProps(field, (el) => fillsPatch(el, fn(fillsOf(el), el)));

	const add = () =>
		update("fill-add", (fills) =>
			common === null
				? [DEFAULT_FILL_COLOR]
				: single
					? [DEFAULT_FILL_COLOR]
					: [...fills, DEFAULT_FILL_COLOR],
		);

	const order = common ? common.map((_, i) => i).reverse() : [];
	// The canvas handles follow the gradient last opened here.
	const only = ins.keys.length === 1 ? ins.keys[0] : undefined;
	const activate = (index: number) => {
		if (only !== undefined)
			ins.controller.dispatch({
				type: "setActiveFill",
				fill: { key: only, index },
			});
	};
	const box = useBox(ins.keys[0] ?? "");

	return (
		<InspectorSection
			title={title}
			actions={sectionActions(
				["fill", "color"],
				<AddButton
					label="Add fill"
					onPress={add}
					isDisabled={single && common !== null && common.length > 0}
				/>,
			)}
		>
			{common === null && (
				<div className="flex min-w-0 items-center gap-1.5">
					<ColorInput
						aria-label="Fill color"
						className="min-w-0 flex-1"
						value=""
						swatches={ins.swatches}
						onChange={(c) => update("fill-mixed", () => [c])}
					/>
					<span className="shrink-0 text-fc-faint text-fc-sm">Mixed</span>
				</div>
			)}
			{order.map((i) => (
				<ItemGroup key={i}>
					<FillRow
						fill={(common as Fill[])[i]}
						index={i}
						swatches={ins.swatches}
						box={box}
						onActivate={() => activate(i)}
						onChange={(field, next) => {
							update(`fill:${i}:${field}`, (fills) =>
								replaceAt(fills, i, next),
							);
							if (field === "kind" && isGradient(next)) activate(i);
						}}
						onRemove={() =>
							update("fill-remove", (fills) => removeAt(fills, i))
						}
					/>
				</ItemGroup>
			))}
		</InspectorSection>
	);
}

export function useBox(key: string) {
	const width = useEditor((s) => s.geometry.get(key)?.rect.width);
	const height = useEditor((s) => s.geometry.get(key)?.rect.height);
	return useMemo(
		() =>
			width === undefined || height === undefined
				? undefined
				: { width, height },
		[width, height],
	);
}

export function FillRow({
	fill,
	index,
	swatches,
	box,
	onActivate,
	onChange,
	onRemove,
}: {
	fill: Fill;
	index: number;
	swatches: string[];
	/** The layer's size, for the swatch's proportions. */
	box?: { width: number; height: number };
	/** Called when the row's gradient editor is focused or pressed. */
	onActivate?: () => void;
	onChange: (field: string, next: Fill) => void;
	onRemove: () => void;
}) {
	const kind = fillKind(fill);
	return (
		<>
			<div className="flex min-w-0 items-center gap-1.5">
				<Select
					aria-label={`Fill ${index + 1} kind`}
					className="w-[76px] shrink-0"
					value={kind}
					onChange={(v) => onChange("kind", convertFill(fill, v as FillKind))}
				>
					{KINDS.map(([id, name]) => (
						<SelectItem key={id} id={id}>
							{name}
						</SelectItem>
					))}
				</Select>
				{typeof fill === "string" ? (
					<ColorInput
						aria-label={`Fill ${index + 1} color`}
						className="min-w-0 flex-1"
						value={fill}
						swatches={swatches}
						onChange={(c) => onChange("color", c)}
					/>
				) : fill.kind === "pattern" ? (
					<PatternSwatch
						p={fill}
						className="h-fc-control min-w-0 flex-1 rounded-[3px]"
					/>
				) : (
					<GradientSwatch
						g={fill}
						box={box}
						className="h-fc-control min-w-0 flex-1 rounded-[3px]"
					/>
				)}
				<RemoveButton label={`Remove fill ${index + 1}`} onPress={onRemove} />
			</div>
			{typeof fill !== "string" && fill.kind === "pattern" && (
				<PatternEditor
					p={fill}
					index={index}
					swatches={swatches}
					onChange={onChange}
				/>
			)}
			{isGradient(fill) && (
				<div
					className="contents"
					onFocusCapture={onActivate}
					onPointerDownCapture={onActivate}
				>
					<GradientEditor
						g={fill}
						name={`fill ${index + 1}`}
						swatches={swatches}
						onChange={(field, g) => onChange(field, g)}
					/>
				</div>
			)}
		</>
	);
}

const pct = (n: number | undefined, fallback: number) =>
	Math.round((n ?? fallback) * 1000) / 10;

function PatternEditor({
	p,
	index,
	swatches,
	onChange,
}: {
	p: PatternFill;
	index: number;
	swatches: string[];
	onChange: (field: string, p: PatternFill) => void;
}) {
	const { scale, angle, density, seed, colors } = patternParams(p);
	const n = index + 1;
	return (
		<div className="flex flex-col gap-1.5">
			<Select
				aria-label={`Fill ${n} pattern`}
				value={p.pattern}
				onChange={(v) =>
					onChange("pattern", {
						kind: "pattern",
						pattern: v as PatternName,
						...(p.colors ? { colors: p.colors } : {}),
					})
				}
			>
				{PATTERNS.map(([id, name]) => (
					<SelectItem key={id} id={id}>
						{name}
					</SelectItem>
				))}
			</Select>
			<Pair>
				<NumberField
					label="S"
					aria-label="Pattern scale"
					min={0.1}
					step={0.5}
					precision={1}
					value={scale}
					onChange={(v) => onChange("scale", { ...p, scale: v })}
				/>
				<NumberField
					label="∠"
					aria-label="Pattern angle"
					unit="°"
					value={angle}
					onChange={(v) => onChange("angle", { ...p, angle: v })}
				/>
			</Pair>
			<Pair>
				<NumberField
					label="D"
					aria-label="Pattern density"
					unit="%"
					min={0}
					max={100}
					value={Math.round(density * 100)}
					onChange={(v) => onChange("density", { ...p, density: v / 100 })}
				/>
				<NumberField
					label="#"
					aria-label="Pattern seed"
					min={0}
					precision={0}
					isDisabled={p.pattern === "hatching" || p.pattern === "dots"}
					value={seed}
					onChange={(v) => onChange("seed", { ...p, seed: Math.round(v) })}
				/>
			</Pair>
			{(["Background", "Ink"] as const).map((name, i) => (
				<ColorInput
					key={name}
					aria-label={`Fill ${n} pattern ${name.toLowerCase()}`}
					value={colors[i] as string}
					swatches={swatches}
					onChange={(c) =>
						onChange(`color${i}`, {
							...p,
							colors: (i === 0 ? [c, colors[1]] : [colors[0], c]) as [
								string,
								string,
							],
						})
					}
				/>
			))}
		</div>
	);
}

export function GradientEditor({
	g,
	name,
	swatches,
	onChange,
}: {
	g: Gradient;
	/** Names the paint in control labels, such as "fill 1". */
	name: string;
	swatches: string[];
	onChange: (field: string, g: Gradient) => void;
}) {
	const center =
		g.kind === "radial" || g.kind === "angular"
			? (g.center ?? [0.5, 0.5])
			: null;
	return (
		<div className="flex flex-col gap-1.5">
			{g.kind === "linear" && (
				<Pair>
					<NumberField
						label="∠"
						aria-label="Gradient angle"
						unit="°"
						value={g.angle}
						onChange={(v) => onChange("angle", withLinearAngle(g, v))}
					/>
				</Pair>
			)}
			{center && (
				<Pair cols={3}>
					<NumberField
						label="X"
						aria-label="Center X"
						unit="%"
						precision={1}
						value={pct(center[0], 0.5)}
						onChange={(v) =>
							onChange("cx", { ...g, center: [v / 100, center[1]] } as Gradient)
						}
					/>
					<NumberField
						label="Y"
						aria-label="Center Y"
						unit="%"
						precision={1}
						value={pct(center[1], 0.5)}
						onChange={(v) =>
							onChange("cy", { ...g, center: [center[0], v / 100] } as Gradient)
						}
					/>
					{g.kind === "radial" ? (
						<NumberField
							label="R"
							aria-label="Radius"
							unit="%"
							min={0}
							precision={1}
							value={pct(g.radius, 0.5)}
							onChange={(v) => onChange("radius", { ...g, radius: v / 100 })}
						/>
					) : (
						<NumberField
							label="∠"
							aria-label="Rotation"
							unit="°"
							value={g.kind === "angular" ? (g.rotation ?? 0) : 0}
							onChange={(v) =>
								onChange("rotation", {
									...g,
									rotation: v === 0 ? undefined : v,
								} as Gradient)
							}
						/>
					)}
				</Pair>
			)}
			{g.kind === "radial" && (
				<Pair>
					<NumberField
						label="RY"
						aria-label="Second radius"
						unit="%"
						min={0}
						precision={1}
						value={pct(g.radiusY ?? g.radius, 0.5)}
						onChange={(v) => onChange("radiusY", { ...g, radiusY: v / 100 })}
					/>
					<NumberField
						label="∠"
						aria-label="Rotation"
						unit="°"
						value={g.rotation ?? 0}
						onChange={(v) =>
							onChange("rotation", {
								...g,
								rotation: v === 0 ? undefined : v,
							})
						}
					/>
				</Pair>
			)}
			<div className="flex h-5 items-center gap-0.5 pointer-coarse:h-8">
				<span className="flex-1 text-fc-muted text-fc-sm">Stops</span>
				<IconButton
					aria-label={`Reverse ${name} stops`}
					tooltip="Reverse stops"
					className="size-5 pointer-coarse:size-8"
					onPress={() =>
						onChange("reverse", withStops(g, reverseStops(g.stops)))
					}
				>
					<ReverseIcon />
				</IconButton>
				{g.kind === "linear" && (
					<IconButton
						aria-label={`Rotate ${name} 90°`}
						tooltip="Rotate 90°"
						className="size-5 pointer-coarse:size-8"
						onPress={() => onChange("rotate90", rotateQuarter(g))}
					>
						<ClockwiseIcon />
					</IconButton>
				)}
				<AddButton
					label="Add stop"
					onPress={() => onChange("stop-add", withStops(g, addStop(g.stops)))}
				/>
			</div>
			<GradientStops
				stops={g.stops}
				swatches={swatches}
				onChange={(field, stops: GradientStop[]) =>
					onChange(field, withStops(g, stops))
				}
			/>
		</div>
	);
}
