import type { RectProperties } from "@freshcoat-js/coatfile";
import { ColorInput } from "@freshcoat-js/ui/color";
import { TextField } from "@freshcoat-js/ui/field";
import { NumberField } from "@freshcoat-js/ui/number-field";
import { PanelSection } from "@freshcoat-js/ui/panel";
import { Select, SelectItem } from "@freshcoat-js/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@freshcoat-js/ui/toggle";
import { useEffect, useState } from "react";
import {
	AddButton,
	Notice,
	Pair,
	RemoveButton,
	Row,
	sectionActions,
} from "./controls";
import { commonValue, type Inspect, parseDash, propsOf } from "./field-helpers";

export type Stroke = NonNullable<RectProperties["stroke"]>;

export const DEFAULT_STROKE: Stroke = { color: "#000000", width: 1 };

const TRIMS = [
	{ key: "trimStart", label: "Trim start", fallback: 0 },
	{ key: "trimEnd", label: "Trim end", fallback: 1 },
	{ key: "trimOffset", label: "Trim offset", fallback: 0 },
] as const;

const strokeOf = (el: Inspect["layers"][number]) =>
	propsOf(el).stroke as Stroke | undefined;

/** Drops keys set to undefined, so a cleared option leaves no trace. */
function clean(s: Stroke): Stroke {
	const out = { ...s } as Record<string, unknown>;
	for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
	return out as Stroke;
}

export function StrokeSection({ ins }: { ins: Inspect }) {
	const strokes = ins.layers.map(strokeOf);
	const all = strokes.every(Boolean);
	const none = strokes.every((s) => !s);

	const set = (field: string, patch: Partial<Stroke>) =>
		ins.setProps(field, (el) => {
			const s = strokeOf(el);
			return s ? { stroke: clean({ ...s, ...patch }) } : null;
		});

	const actions = all ? (
		<RemoveButton
			label="Remove stroke"
			onPress={() =>
				ins.setProps("stroke-remove", () => ({ stroke: undefined }))
			}
		/>
	) : (
		<AddButton
			label="Add stroke"
			onPress={() =>
				ins.setProps("stroke-add", (el) =>
					strokeOf(el) ? null : { stroke: DEFAULT_STROKE },
				)
			}
		/>
	);

	const pick = <K extends keyof Stroke>(k: K) =>
		commonValue(strokes.map((s) => s?.[k]));
	// Unset reads as the renderer's default, so it is not Mixed against it.
	const align = commonValue(strokes.map((s) => s?.align ?? "center"));
	const cap = commonValue(strokes.map((s) => s?.cap ?? "butt"));
	const join = commonValue(strokes.map((s) => s?.join ?? "miter"));

	return (
		<PanelSection title="Stroke" actions={sectionActions(["stroke"], actions)}>
			{!all && !none && <Notice>Some layers have no stroke</Notice>}
			{all && (
				<>
					<div className="flex min-w-0 items-center gap-1.5">
						<ColorInput
							aria-label="Stroke color"
							className="min-w-0 flex-1"
							value={(pick("color") as string | null) ?? ""}
							swatches={ins.swatches}
							onChange={(c) => set("stroke-color", { color: c })}
						/>
						<NumberField
							label="W"
							aria-label="Stroke width"
							className="w-[68px] shrink-0"
							min={0}
							value={pick("width") as number | null}
							onChange={(v) => set("stroke-width", { width: v })}
						/>
					</div>
					<Row label="Position">
						<ToggleGroup
							aria-label="Stroke position"
							className="flex-1"
							selectedKeys={align ? [align] : []}
							onSelectionChange={(keys) => {
								const v = [...keys][0] as Stroke["align"];
								set("stroke-align", {
									align: v === "center" ? undefined : v,
								});
							}}
						>
							<ToggleGroupItem id="inside">Inside</ToggleGroupItem>
							<ToggleGroupItem id="center">Center</ToggleGroupItem>
							<ToggleGroupItem id="outside">Outside</ToggleGroupItem>
						</ToggleGroup>
					</Row>
					<DashField
						value={commonValue(strokes.map((s) => s?.dash ?? []))}
						onCommit={(dash) => set("stroke-dash", { dash })}
					/>
					<Row label="Trim">
						{TRIMS.map(({ key, label, fallback }) => {
							const v = commonValue(strokes.map((s) => s?.[key] ?? fallback));
							return (
								<NumberField
									key={key}
									aria-label={label}
									className="min-w-0 flex-1"
									unit="%"
									precision={0}
									min={key === "trimOffset" ? undefined : 0}
									max={key === "trimOffset" ? undefined : 100}
									value={typeof v === "number" ? Math.round(v * 100) : null}
									placeholder={typeof v === "string" ? v : "Mixed"}
									onChange={(pct) => {
										const f = pct / 100;
										set(`stroke-${key}`, {
											[key]: f === fallback ? undefined : f,
										});
									}}
								/>
							);
						})}
					</Row>
					<Pair>
						<Select
							aria-label="Stroke cap"
							value={cap}
							placeholder="Mixed"
							onChange={(v) =>
								set("stroke-cap", {
									cap: v === "butt" ? undefined : (v as Stroke["cap"]),
								})
							}
						>
							<SelectItem id="butt" textValue="Butt cap">
								Butt cap
							</SelectItem>
							<SelectItem id="round" textValue="Round cap">
								Round cap
							</SelectItem>
							<SelectItem id="square" textValue="Square cap">
								Square cap
							</SelectItem>
						</Select>
						<Select
							aria-label="Stroke join"
							value={join}
							placeholder="Mixed"
							onChange={(v) =>
								set("stroke-join", {
									join: v === "miter" ? undefined : (v as Stroke["join"]),
								})
							}
						>
							<SelectItem id="miter" textValue="Miter join">
								Miter join
							</SelectItem>
							<SelectItem id="round" textValue="Round join">
								Round join
							</SelectItem>
							<SelectItem id="bevel" textValue="Bevel join">
								Bevel join
							</SelectItem>
						</Select>
					</Pair>
				</>
			)}
		</PanelSection>
	);
}

function DashField({
	value,
	onCommit,
}: {
	value: number[] | null;
	onCommit: (dash: number[] | undefined) => void;
}) {
	const shown = value === null ? "" : value.join(" ");
	const [draft, setDraft] = useState(shown);
	const [invalid, setInvalid] = useState(false);
	useEffect(() => {
		setDraft(shown);
		setInvalid(false);
	}, [shown]);
	const commit = () => {
		if (draft === shown) return;
		const dash = parseDash(draft);
		if (dash === null) {
			setInvalid(true);
			return;
		}
		setInvalid(false);
		onCommit(dash);
	};
	return (
		<Row label="Dash">
			<TextField
				aria-label="Stroke dash"
				className="flex-1"
				placeholder={value === null ? "Mixed" : "Solid, or e.g. 4 2"}
				value={draft}
				isInvalid={invalid}
				onChange={(v) => {
					setDraft(v);
					setInvalid(false);
				}}
				onBlur={commit}
				onKeyDown={(e) => {
					if (e.key === "Enter") commit();
					if (e.key === "Escape") setDraft(shown);
				}}
			/>
		</Row>
	);
}
