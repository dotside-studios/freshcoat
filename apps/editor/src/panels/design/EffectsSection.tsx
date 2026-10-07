import type { Element } from "@freshcoat-js/coatfile";
import { Checkbox } from "@freshcoat-js/ui/checkbox";
import { ColorInput } from "@freshcoat-js/ui/color";
import { NumberField } from "@freshcoat-js/ui/number-field";
import { PanelSection } from "@freshcoat-js/ui/panel";
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

type Shadow = Extract<NonNullable<Element["shadow"]>, { dx: number }>;

export const DEFAULT_SHADOW: Shadow = {
	color: "#00000040",
	dx: 0,
	dy: 4,
	blur: 12,
};

export function shadowsOf(el: Element): Shadow[] {
	const s = el.shadow;
	if (!s) return [];
	return Array.isArray(s) ? s : [s];
}

function shadowPatch(list: Shadow[]): Element["shadow"] {
	return list.length === 0 ? undefined : list.length === 1 ? list[0] : list;
}

function clean(s: Shadow): Shadow {
	const out = { ...s } as Record<string, unknown>;
	for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
	return out as Shadow;
}

export function EffectsSection({ ins }: { ins: Inspect }) {
	const els = ins.layers as Element[];
	const lists = els.map(shadowsOf);
	const common = commonValue(lists);
	const blur = commonValue(els.map((e) => e.blur ?? 0));

	const update = (field: string, fn: (list: Shadow[]) => Shadow[]) =>
		ins.setShared(field, (el) => ({
			shadow: shadowPatch(fn(shadowsOf(el as Element))),
		}));

	return (
		<PanelSection
			title="Effects"
			actions={
				<AddButton
					label="Add shadow"
					onPress={() =>
						update("shadow-add", (list) =>
							common === null ? [DEFAULT_SHADOW] : [...list, DEFAULT_SHADOW],
						)
					}
				/>
			}
		>
			<SharedNotice />
			{common === null && (
				<Notice>Mixed shadows. Adding one replaces them.</Notice>
			)}
			{(common ?? []).map((s, i) => (
				<ItemGroup
					// biome-ignore lint/suspicious/noArrayIndexKey: shadows have no identity
					key={i}
				>
					<div className="flex min-w-0 items-center gap-1.5">
						<ColorInput
							aria-label={`Shadow ${i + 1} color`}
							className="min-w-0 flex-1"
							value={s.color}
							swatches={ins.swatches}
							onChange={(c) =>
								update(`shadow:${i}:color`, (l) =>
									replaceAt(l, i, { ...(l[i] as Shadow), color: c }),
								)
							}
						/>
						<Checkbox
							isSelected={s.inset === true}
							onChange={(on) =>
								update(`shadow:${i}:inset`, (l) =>
									replaceAt(
										l,
										i,
										clean({
											...(l[i] as Shadow),
											inset: on ? true : undefined,
										}),
									),
								)
							}
						>
							Inner
						</Checkbox>
						<RemoveButton
							label={`Remove shadow ${i + 1}`}
							onPress={() => update("shadow-remove", (l) => removeAt(l, i))}
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
								aria-label={`Shadow ${i + 1} ${k === "dx" ? "x" : k === "dy" ? "y" : k}`}
								min={k === "blur" ? 0 : undefined}
								value={s[k] ?? 0}
								onChange={(v) =>
									update(`shadow:${i}:${k}`, (l) =>
										replaceAt(
											l,
											i,
											clean({
												...(l[i] as Shadow),
												[k]: k === "spread" && v === 0 ? undefined : v,
											}),
										),
									)
								}
							/>
						))}
					</Pair>
				</ItemGroup>
			))}
			<Row label="Blur">
				<NumberField
					aria-label="Layer blur"
					className="min-w-0 flex-1"
					min={0}
					value={blur}
					onChange={(v) =>
						ins.setShared("blur", () => ({ blur: v === 0 ? undefined : v }))
					}
				/>
			</Row>
		</PanelSection>
	);
}
