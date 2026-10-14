import { type Effect, type Element, effectsOf } from "@freshcoat-js/coatfile";
import { Checkbox } from "@freshcoat-js/ui/checkbox";
import { ColorInput } from "@freshcoat-js/ui/color";
import { NumberField } from "@freshcoat-js/ui/number-field";
import { Select, SelectItem } from "@freshcoat-js/ui/select";
import { ToggleButton } from "@freshcoat-js/ui/toggle";
import { documentDpi } from "~/app/units";
import { useEditor } from "~/state/hooks";
import EyeIcon from "~icons/mingcute/eye-2-line";
import EyeOffIcon from "~icons/mingcute/eye-close-line";
import {
	AddButton,
	ItemGroup,
	Notice,
	Pair,
	RemoveButton,
	Row,
	SharedNotice,
} from "./controls";
import { commonValue, type Inspect } from "./field-helpers";
import { removeAt, replaceAt } from "./fills";
import { InspectorSection } from "./InspectorSection";

type Shadow = Extract<Effect, { type: "shadow" }>;
type Grain = Extract<Effect, { type: "grain" }>;
type Halftone = Extract<Effect, { type: "halftone" }>;
type BlurType = "blur" | "backdropBlur";
type SingleType = BlurType | "grain" | "halftone";

export const DEFAULT_SHADOW: Shadow = {
	type: "shadow",
	color: "#00000040",
	dx: 0,
	dy: 4,
	blur: 12,
};

export const DEFAULT_GRAIN: Grain = { type: "grain", amount: 0.25 };

export const DEFAULT_HALFTONE: Halftone = { type: "halftone", cellSize: 6 };

const GRAIN_BLENDS: [NonNullable<Grain["blendMode"]>, string][] = [
	["overlay", "Overlay"],
	["soft-light", "Soft light"],
	["multiply", "Multiply"],
	["screen", "Screen"],
	["normal", "Normal"],
];

const HALFTONE_SHAPES: [NonNullable<Halftone["shape"]>, string][] = [
	["round", "Round"],
	["line", "Line"],
	["square", "Square"],
];

/** Lines per inch of a screen whose cells are `cellSize` template px, printed
 *  with one template px per dot at `dpi`. */
export function halftoneLpi(cellSize: number, dpi: number): number {
	return dpi / cellSize;
}

const BLUR_UI = {
	blur: { row: "Blur", label: "Layer blur", add: "Add layer blur" },
	backdropBlur: {
		row: "Background",
		label: "Background blur",
		add: "Add background blur",
	},
} as const;

function clean<T extends Effect>(e: T): T {
	const out = { ...e } as Record<string, unknown>;
	for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
	return out as T;
}

function VisibleToggle({
	label,
	hidden,
	onChange,
}: {
	label: string;
	hidden: boolean;
	onChange: (hidden: boolean) => void;
}) {
	return (
		<ToggleButton
			aria-label={label}
			isSelected={!hidden}
			onChange={(on) => onChange(!on)}
			className="size-5 pointer-coarse:size-8"
		>
			{hidden ? <EyeOffIcon /> : <EyeIcon />}
		</ToggleButton>
	);
}

export function EffectsSection({ ins }: { ins: Inspect }) {
	const els = ins.layers as Element[];
	const common = commonValue(els.map(effectsOf));
	const list = common ?? [];
	const has = (type: SingleType) => list.some((e) => e.type === type);
	const dpi = useEditor(documentDpi);

	// Any edit writes `effects` and drops the legacy fields it replaces.
	const update = (field: string, fn: (list: Effect[]) => Effect[]) =>
		ins.setShared(field, (el) => {
			const next = fn(effectsOf(el as Element));
			return {
				effects: next.length === 0 ? undefined : next,
				shadow: undefined,
				blur: undefined,
				backdropBlur: undefined,
			};
		});
	const add = (field: string, effect: Effect) =>
		update(field, (l) => (common === null ? [effect] : [...l, effect]));
	const patchAt = (field: string, i: number, patch: Partial<Effect>) =>
		update(field, (l) =>
			replaceAt(l, i, clean({ ...(l[i] as Effect), ...patch } as Effect)),
		);

	let shadowNo = 0;
	return (
		<InspectorSection
			title="Effects"
			actions={
				<>
					<AddButton
						label="Add shadow"
						onPress={() => add("effect-add", DEFAULT_SHADOW)}
					/>
					{(["blur", "backdropBlur"] as const).map(
						(type) =>
							!has(type) && (
								<AddButton
									key={type}
									label={BLUR_UI[type].add}
									onPress={() =>
										add("effect-add", { type, radius: type === "blur" ? 4 : 8 })
									}
								/>
							),
					)}
					{!has("grain") && (
						<AddButton
							label="Add grain"
							onPress={() => add("effect-add", DEFAULT_GRAIN)}
						/>
					)}
					{!has("halftone") && (
						<AddButton
							label="Add halftone"
							onPress={() => add("effect-add", DEFAULT_HALFTONE)}
						/>
					)}
				</>
			}
		>
			<SharedNotice />
			{common === null && (
				<Notice>Mixed effects. Adding one replaces them.</Notice>
			)}
			{list.map((e, i) => {
				const remove = () => update("effect-remove", (l) => removeAt(l, i));
				const visible = (label: string) => (
					<VisibleToggle
						label={`${label} visible`}
						hidden={e.hidden === true}
						onChange={(h) =>
							patchAt(`effect:${i}:hidden`, i, {
								hidden: h ? true : undefined,
							})
						}
					/>
				);
				if (e.type === "grain")
					return (
						<ItemGroup
							// biome-ignore lint/suspicious/noArrayIndexKey: effects have no identity
							key={i}
						>
							<Row label="Grain">
								<NumberField
									aria-label="Grain amount"
									className="min-w-0 flex-1"
									unit="%"
									min={0}
									max={100}
									value={Math.round(e.amount * 100)}
									onChange={(v) =>
										patchAt(`effect:${i}:amount`, i, { amount: v / 100 })
									}
								/>
								{visible("Grain")}
								<RemoveButton label="Remove grain" onPress={remove} />
							</Row>
							<Pair>
								<NumberField
									label="S"
									aria-label="Grain size"
									min={0.1}
									step={0.5}
									value={e.size ?? 1}
									onChange={(v) =>
										patchAt(`effect:${i}:size`, i, {
											size: v === 1 ? undefined : v,
										})
									}
								/>
								<NumberField
									label="#"
									aria-label="Grain seed"
									min={0}
									max={65535}
									precision={0}
									value={e.seed ?? 0}
									onChange={(v) =>
										patchAt(`effect:${i}:seed`, i, {
											seed: v === 0 ? undefined : Math.round(v),
										})
									}
								/>
							</Pair>
							<Row label="Blend">
								<Select
									aria-label="Grain blend mode"
									className="min-w-0 flex-1"
									value={e.blendMode ?? "overlay"}
									onChange={(v) =>
										patchAt(`effect:${i}:blendMode`, i, {
											blendMode:
												v === "overlay" ? undefined : (v as Grain["blendMode"]),
										})
									}
								>
									{GRAIN_BLENDS.map(([id, label]) => (
										<SelectItem key={id} id={id}>
											{label}
										</SelectItem>
									))}
								</Select>
								<Checkbox
									isSelected={e.monochrome !== false}
									onChange={(on) =>
										patchAt(`effect:${i}:monochrome`, i, {
											monochrome: on ? undefined : false,
										})
									}
								>
									Mono
								</Checkbox>
							</Row>
						</ItemGroup>
					);
				if (e.type === "halftone") {
					const cmyk = e.mode === "cmyk";
					return (
						<ItemGroup
							// biome-ignore lint/suspicious/noArrayIndexKey: effects have no identity
							key={i}
						>
							<Row label="Halftone">
								<Select
									aria-label="Halftone mode"
									className="min-w-0 flex-1"
									value={e.mode ?? "mono"}
									onChange={(v) =>
										patchAt(`effect:${i}:mode`, i, {
											mode: v === "cmyk" ? "cmyk" : undefined,
										})
									}
								>
									<SelectItem id="mono">Mono</SelectItem>
									<SelectItem id="cmyk">CMYK look</SelectItem>
								</Select>
								{visible("Halftone")}
								<RemoveButton label="Remove halftone" onPress={remove} />
							</Row>
							<Row label="Shape">
								<Select
									aria-label="Halftone dot shape"
									className="min-w-0 flex-1"
									value={e.shape ?? "round"}
									onChange={(v) =>
										patchAt(`effect:${i}:shape`, i, {
											shape:
												v === "round" ? undefined : (v as Halftone["shape"]),
										})
									}
								>
									{HALFTONE_SHAPES.map(([id, label]) => (
										<SelectItem key={id} id={id}>
											{label}
										</SelectItem>
									))}
								</Select>
								<Checkbox
									isSelected={e.invert === true}
									onChange={(on) =>
										patchAt(`effect:${i}:invert`, i, {
											invert: on ? true : undefined,
										})
									}
								>
									Invert
								</Checkbox>
							</Row>
							<Pair>
								<NumberField
									label="C"
									aria-label="Halftone cell size"
									min={0.5}
									step={0.5}
									value={e.cellSize}
									onChange={(v) =>
										patchAt(`effect:${i}:cellSize`, i, { cellSize: v })
									}
								/>
								<NumberField
									label="A"
									aria-label="Halftone angle"
									unit="°"
									value={e.angle ?? (cmyk ? 0 : 45)}
									onChange={(v) =>
										patchAt(`effect:${i}:angle`, i, {
											angle: v === (cmyk ? 0 : 45) ? undefined : v,
										})
									}
								/>
							</Pair>
							<Notice>
								{e.cellSize > 0
									? `${Math.round(halftoneLpi(e.cellSize, dpi))} lpi at ${dpi} dpi`
									: null}
								{cmyk ? ". A visual effect, not color separations." : null}
							</Notice>
							<div className="flex min-w-0 items-center gap-1.5">
								{!cmyk && (
									<ColorInput
										aria-label="Halftone ink color"
										className="min-w-0 flex-1"
										value={e.color ?? "#000000"}
										swatches={ins.swatches}
										onChange={(c) =>
											patchAt(`effect:${i}:color`, i, {
												color: c === "#000000" ? undefined : c,
											})
										}
									/>
								)}
								<Checkbox
									isSelected={e.background !== undefined}
									onChange={(on) =>
										patchAt(`effect:${i}:background`, i, {
											background: on ? "#ffffff" : undefined,
										})
									}
								>
									Paper
								</Checkbox>
								{e.background !== undefined && (
									<ColorInput
										aria-label="Halftone paper color"
										className="min-w-0 flex-1"
										value={e.background}
										swatches={ins.swatches}
										onChange={(c) =>
											patchAt(`effect:${i}:background`, i, { background: c })
										}
									/>
								)}
							</div>
						</ItemGroup>
					);
				}
				if (e.type !== "shadow") {
					const ui = BLUR_UI[e.type];
					return (
						<ItemGroup
							// biome-ignore lint/suspicious/noArrayIndexKey: effects have no identity
							key={i}
						>
							<Row label={ui.row}>
								<NumberField
									aria-label={ui.label}
									className="min-w-0 flex-1"
									min={0}
									value={e.radius}
									onChange={(v) =>
										patchAt(`effect:${i}:radius`, i, { radius: v })
									}
								/>
								<VisibleToggle
									label={`${ui.label} visible`}
									hidden={e.hidden === true}
									onChange={(h) =>
										patchAt(`effect:${i}:hidden`, i, {
											hidden: h ? true : undefined,
										})
									}
								/>
								<RemoveButton
									label={`Remove ${ui.label.toLowerCase()}`}
									onPress={() => update("effect-remove", (l) => removeAt(l, i))}
								/>
							</Row>
						</ItemGroup>
					);
				}
				const n = ++shadowNo;
				return (
					<ItemGroup
						// biome-ignore lint/suspicious/noArrayIndexKey: effects have no identity
						key={i}
					>
						<div className="flex min-w-0 items-center gap-1.5">
							<ColorInput
								aria-label={`Shadow ${n} color`}
								className="min-w-0 flex-1"
								value={e.color}
								swatches={ins.swatches}
								onChange={(c) => patchAt(`effect:${i}:color`, i, { color: c })}
							/>
							<Checkbox
								isSelected={e.inset === true}
								onChange={(on) =>
									patchAt(`effect:${i}:inset`, i, {
										inset: on ? true : undefined,
									})
								}
							>
								Inner
							</Checkbox>
							<VisibleToggle
								label={`Shadow ${n} visible`}
								hidden={e.hidden === true}
								onChange={(h) =>
									patchAt(`effect:${i}:hidden`, i, {
										hidden: h ? true : undefined,
									})
								}
							/>
							<RemoveButton
								label={`Remove shadow ${n}`}
								onPress={() => update("effect-remove", (l) => removeAt(l, i))}
							/>
						</div>
						<Pair cols={4}>
							{(
								[
									["dx", "X"],
									["dy", "Y"],
									["blur", "B"],
									["spread", "S"],
								] as const
							).map(([k, label]) => (
								<NumberField
									key={k}
									label={label}
									aria-label={`Shadow ${n} ${k === "dx" ? "x" : k === "dy" ? "y" : k}`}
									min={k === "blur" ? 0 : undefined}
									value={e[k] ?? 0}
									onChange={(v) =>
										patchAt(`effect:${i}:${k}`, i, {
											[k]: k === "spread" && v === 0 ? undefined : v,
										})
									}
								/>
							))}
						</Pair>
					</ItemGroup>
				);
			})}
		</InspectorSection>
	);
}
