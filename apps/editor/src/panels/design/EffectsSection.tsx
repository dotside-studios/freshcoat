import { type Effect, type Element, effectsOf } from "@freshcoat-js/coatfile";
import { Checkbox } from "@freshcoat-js/ui/checkbox";
import { ColorInput } from "@freshcoat-js/ui/color";
import { NumberField } from "@freshcoat-js/ui/number-field";
import { ToggleButton } from "@freshcoat-js/ui/toggle";
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
type BlurType = "blur" | "backdropBlur";

export const DEFAULT_SHADOW: Shadow = {
	type: "shadow",
	color: "#00000040",
	dx: 0,
	dy: 4,
	blur: 12,
};

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
	const has = (type: BlurType) => list.some((e) => e.type === type);

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
				</>
			}
		>
			<SharedNotice />
			{common === null && (
				<Notice>Mixed effects. Adding one replaces them.</Notice>
			)}
			{list.map((e, i) => {
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
