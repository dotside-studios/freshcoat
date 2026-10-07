import { NumberField } from "@freshcoat-js/ui/number-field";
import { PanelSection } from "@freshcoat-js/ui/panel";
import { ToggleButton } from "@freshcoat-js/ui/toggle";
import RadiusIcon from "~icons/mingcute/border-radius-line";
import SplitIcon from "~icons/mingcute/fullscreen-line";
import { Pair, sectionActions } from "./controls";
import { commonValue, type Inspect, propsOf } from "./field-helpers";

type Radius = number | [number, number, number, number];

const CORNERS = ["TL", "TR", "BR", "BL"] as const;

const radiusOf = (el: Inspect["layers"][number]) =>
	(propsOf(el).cornerRadius as Radius | undefined) ?? 0;

/** One radius for the whole shape, or null when the corners differ. */
function uniform(r: Radius): number | null {
	if (typeof r === "number") return r;
	return r.every((v) => v === r[0]) ? r[0] : null;
}

export function CornersSection({ ins }: { ins: Inspect }) {
	const rectOnly = ins.layers.every((l) => l.type === "rect");
	const splittable = ins.layers.every(
		(l) => l.type === "rect" || l.type === "frame",
	);
	const radii = ins.layers.map(radiusOf);
	const split = splittable && radii.some((r) => Array.isArray(r));
	const single = commonValue(radii.map(uniform));
	const smoothing = commonValue(
		ins.layers.map((l) =>
			Math.round(
				((propsOf(l).cornerSmoothing as number | undefined) ?? 0) * 100,
			),
		),
	);

	const setAll = (field: string, fn: (r: Radius) => Radius) =>
		ins.setProps(field, (el) => {
			const next = fn(radiusOf(el));
			return { cornerRadius: next === 0 ? undefined : next };
		});

	const toggleSplit = (on: boolean) =>
		setAll("corners-split", (r) => {
			if (on) {
				const v = typeof r === "number" ? r : r[0];
				return [v, v, v, v];
			}
			return typeof r === "number" ? r : r[0];
		});

	return (
		<PanelSection
			title="Corners"
			actions={sectionActions(["cornerRadius", "cornerSmoothing"])}
		>
			<div className="flex min-w-0 items-center gap-1.5">
				<NumberField
					label={<RadiusIcon />}
					aria-label="Corner radius"
					className="min-w-0 flex-1"
					min={0}
					value={single}
					onChange={(v) => setAll("radius", () => v)}
				/>
				{rectOnly && (
					<NumberField
						label="S"
						aria-label="Corner smoothing"
						className="min-w-0 flex-1"
						unit="%"
						min={0}
						max={100}
						precision={0}
						value={smoothing}
						onChange={(v) =>
							ins.setProps("smoothing", () => ({
								cornerSmoothing: v === 0 ? undefined : v / 100,
							}))
						}
					/>
				)}
				{splittable && (
					<ToggleButton
						aria-label="Independent corners"
						tooltip="Independent corners"
						isSelected={split}
						onChange={toggleSplit}
					>
						<SplitIcon />
					</ToggleButton>
				)}
			</div>
			{split && (
				<Pair cols={4}>
					{CORNERS.map((name, i) => (
						<NumberField
							key={name}
							label={name}
							aria-label={`${name} radius`}
							min={0}
							value={commonValue(
								radii.map((r) => (typeof r === "number" ? r : r[i])),
							)}
							onChange={(v) =>
								setAll(`radius-${i}`, (r) => {
									const list: [number, number, number, number] =
										typeof r === "number" ? [r, r, r, r] : [...r];
									list[i] = v;
									return list;
								})
							}
						/>
					))}
				</Pair>
			)}
		</PanelSection>
	);
}
