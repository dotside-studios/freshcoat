import { type Effect, type Element, effectsOf } from "@freshcoat-js/coatfile";
import { Checkbox } from "@freshcoat-js/ui/checkbox";
import { ColorInput } from "@freshcoat-js/ui/color";
import { NumberField } from "@freshcoat-js/ui/number-field";
import { Select, SelectItem } from "@freshcoat-js/ui/select";
import { ToggleButton } from "@freshcoat-js/ui/toggle";
import type { ReactNode } from "react";
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
	SettingsPopover,
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
				const field = (k: string) => `effect:${i}:${k}`;
				const row = (
					name: string,
					summary: string | null,
					removeLabel: string,
					body: ReactNode,
				) => (
					<ItemGroup
						// biome-ignore lint/suspicious/noArrayIndexKey: effects have no identity
						key={i}
					>
						<div className="flex min-h-fc-control min-w-0 items-center gap-1">
							<span className="min-w-0 flex-1 truncate text-fc-base">
								{name}
							</span>
							{summary ? (
								<span className="shrink-0 text-fc-faint text-fc-sm">
									{summary}
								</span>
							) : null}
							<VisibleToggle
								label={`${name} visible`}
								hidden={e.hidden === true}
								onChange={(h) =>
									patchAt(field("hidden"), i, { hidden: h ? true : undefined })
								}
							/>
							<SettingsPopover label={`${name} settings`} title={name}>
								{body}
							</SettingsPopover>
							<RemoveButton label={removeLabel} onPress={remove} />
						</div>
					</ItemGroup>
				);
				if (e.type === "grain")
					return row(
						"Grain",
						`${Math.round(e.amount * 100)}%`,
						"Remove grain",
						<>
							<NumberField
								label="A"
								aria-label="Grain amount"
								unit="%"
								min={0}
								max={100}
								value={Math.round(e.amount * 100)}
								onChange={(v) =>
									patchAt(field("amount"), i, { amount: v / 100 })
								}
							/>
							<Pair>
								<NumberField
									label="S"
									aria-label="Grain size"
									min={0.1}
									step={0.5}
									value={e.size ?? 1}
									onChange={(v) =>
										patchAt(field("size"), i, {
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
										patchAt(field("seed"), i, {
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
										patchAt(field("blendMode"), i, {
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
							</Row>
							<Checkbox
								isSelected={e.monochrome !== false}
								onChange={(on) =>
									patchAt(field("monochrome"), i, {
										monochrome: on ? undefined : false,
									})
								}
							>
								Mono
							</Checkbox>
						</>,
					);
				if (e.type === "halftone") {
					const cmyk = e.mode === "cmyk";
					return row(
						"Halftone",
						cmyk ? "CMYK look" : null,
						"Remove halftone",
						<>
							<Row label="Mode">
								<Select
									aria-label="Halftone mode"
									className="min-w-0 flex-1"
									value={e.mode ?? "mono"}
									onChange={(v) =>
										patchAt(field("mode"), i, {
											mode: v === "cmyk" ? "cmyk" : undefined,
										})
									}
								>
									<SelectItem id="mono">Mono</SelectItem>
									<SelectItem id="cmyk">CMYK look</SelectItem>
								</Select>
							</Row>
							<Row label="Shape">
								<Select
									aria-label="Halftone dot shape"
									className="min-w-0 flex-1"
									value={e.shape ?? "round"}
									onChange={(v) =>
										patchAt(field("shape"), i, {
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
							</Row>
							<Checkbox
								isSelected={e.invert === true}
								onChange={(on) =>
									patchAt(field("invert"), i, { invert: on ? true : undefined })
								}
							>
								Invert
							</Checkbox>
							<Pair>
								<NumberField
									label="C"
									aria-label="Halftone cell size"
									min={0.5}
									step={0.5}
									value={e.cellSize}
									onChange={(v) =>
										patchAt(field("cellSize"), i, { cellSize: v })
									}
								/>
								<NumberField
									label="A"
									aria-label="Halftone angle"
									unit="°"
									value={e.angle ?? (cmyk ? 0 : 45)}
									onChange={(v) =>
										patchAt(field("angle"), i, {
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
							{!cmyk && (
								<ColorInput
									aria-label="Halftone ink color"
									className="min-w-0 flex-1"
									value={e.color ?? "#000000"}
									swatches={ins.swatches}
									onChange={(c) =>
										patchAt(field("color"), i, {
											color: c === "#000000" ? undefined : c,
										})
									}
								/>
							)}
							<div className="flex min-w-0 items-center gap-1.5">
								<Checkbox
									isSelected={e.background !== undefined}
									onChange={(on) =>
										patchAt(field("background"), i, {
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
											patchAt(field("background"), i, { background: c })
										}
									/>
								)}
							</div>
						</>,
					);
				}
				if (e.type !== "shadow") {
					const ui = BLUR_UI[e.type];
					return row(
						ui.label,
						`${e.radius}`,
						`Remove ${ui.label.toLowerCase()}`,
						<NumberField
							label="R"
							aria-label={ui.label}
							min={0}
							value={e.radius}
							onChange={(v) => patchAt(field("radius"), i, { radius: v })}
						/>,
					);
				}
				const n = ++shadowNo;
				return row(
					`Shadow ${n}`,
					`${e.inset === true ? "Inner " : ""}${e.dx ?? 0}, ${e.dy ?? 0}, ${e.blur ?? 0}`,
					`Remove shadow ${n}`,
					<>
						<ColorInput
							aria-label={`Shadow ${n} color`}
							className="min-w-0 flex-1"
							value={e.color}
							swatches={ins.swatches}
							onChange={(c) => patchAt(field("color"), i, { color: c })}
						/>
						<Checkbox
							isSelected={e.inset === true}
							onChange={(on) =>
								patchAt(field("inset"), i, { inset: on ? true : undefined })
							}
						>
							Inner
						</Checkbox>
						<Pair>
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
										patchAt(field(k), i, {
											[k]: k === "spread" && v === 0 ? undefined : v,
										})
									}
								/>
							))}
						</Pair>
					</>,
				);
			})}
		</InspectorSection>
	);
}
