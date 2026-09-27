import type { Fill } from "@freshcoat-js/coatfile";
import { ColorInput } from "@freshcoat-js/ui/color";
import { IconButton } from "@freshcoat-js/ui/icon-button";
import { NumberField } from "@freshcoat-js/ui/number-field";
import { PanelSection } from "@freshcoat-js/ui/panel";
import { Select, SelectItem } from "@freshcoat-js/ui/select";
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
import {
	addStop,
	convertFill,
	DEFAULT_FILL_COLOR,
	type FillKind,
	fillKind,
	fillsOf,
	fillsPatch,
	type Gradient,
	removeAt,
	replaceAt,
	reverseStops,
	rotateQuarter,
	type Stop,
	withLinearAngle,
	withStops,
} from "./fills";
import { GradientSwatch } from "./GradientSwatch";
import { GradientStops } from "./StopBar";

const KINDS: [FillKind, string][] = [
	["solid", "Solid"],
	["linear", "Linear"],
	["radial", "Radial"],
	["angular", "Angular"],
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
	const box = ins.geometry.get(ins.keys[0] ?? "")?.rect;

	return (
		<PanelSection
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
							if (field === "kind" && typeof next !== "string") activate(i);
						}}
						onRemove={() =>
							update("fill-remove", (fills) => removeAt(fills, i))
						}
					/>
				</ItemGroup>
			))}
		</PanelSection>
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
				) : (
					<GradientSwatch
						g={fill}
						box={box}
						className="h-fc-control min-w-0 flex-1 rounded-[3px]"
					/>
				)}
				<RemoveButton label={`Remove fill ${index + 1}`} onPress={onRemove} />
			</div>
			{typeof fill !== "string" && (
				<div
					className="contents"
					onFocusCapture={onActivate}
					onPointerDownCapture={onActivate}
				>
					<GradientEditor
						g={fill}
						index={index}
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

function GradientEditor({
	g,
	index,
	swatches,
	onChange,
}: {
	g: Gradient;
	index: number;
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
					aria-label={`Reverse fill ${index + 1} stops`}
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
						aria-label={`Rotate fill ${index + 1} 90°`}
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
				onChange={(field, stops: Stop[]) =>
					onChange(field, withStops(g, stops))
				}
			/>
		</div>
	);
}
