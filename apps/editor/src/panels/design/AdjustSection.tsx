import type { Element, ElementAdjust } from "@freshcoat-js/coatfile";
import { Checkbox } from "@freshcoat-js/ui/checkbox";
import { NumberField } from "@freshcoat-js/ui/number-field";
import {
	AddButton,
	Notice,
	Pair,
	RemoveButton,
	Row,
	SharedNotice,
} from "./controls";
import { commonValue, type Inspect } from "./field-helpers";
import { InspectorSection } from "./InspectorSection";

type Factor = "saturation" | "contrast" | "brightness";

const FACTORS: [Factor, string][] = [
	["saturation", "Saturation"],
	["contrast", "Contrast"],
	["brightness", "Brightness"],
];

export const DEFAULT_ADJUST: ElementAdjust = {};

/** The adjustment without the keys a control cleared. */
export function tidyAdjust(a: ElementAdjust): ElementAdjust {
	const out: ElementAdjust = { ...a };
	for (const k of Object.keys(out) as (keyof ElementAdjust)[])
		if (out[k] === undefined || out[k] === false) delete out[k];
	return out;
}

export function AdjustSection({ ins }: { ins: Inspect }) {
	const els = ins.layers as Element[];
	const adjusts = els.map((e) => e.adjust);
	const all = adjusts.every(Boolean);
	const none = adjusts.every((a) => !a);
	const pick = <T,>(fn: (a: ElementAdjust) => T) =>
		commonValue(adjusts.map((a) => fn(a ?? {})));

	const update = (field: string, patch: Partial<ElementAdjust>) =>
		ins.setShared(field, (el) => {
			const a = (el as Element).adjust;
			return a ? { adjust: tidyAdjust({ ...a, ...patch }) } : null;
		});
	const percent = (v: number | undefined) => Math.round((v ?? 1) * 100);
	const hue = pick((a) => a.preserveHue === true);

	return (
		<InspectorSection
			title="Adjust"
			actions={
				all ? (
					<RemoveButton
						label="Remove adjustments"
						onPress={() =>
							ins.setShared("adjust-remove", () => ({ adjust: undefined }))
						}
					/>
				) : (
					<AddButton
						label="Add adjustments"
						onPress={() =>
							ins.setShared("adjust-add", (el) =>
								(el as Element).adjust ? null : { adjust: DEFAULT_ADJUST },
							)
						}
					/>
				)
			}
		>
			{!all && !none && <Notice>Some layers have no adjustments</Notice>}
			{all && (
				<>
					<SharedNotice />
					<Row label="Tone">
						<Pair cols={3} className="flex-1">
							{FACTORS.map(([key, label]) => (
								<NumberField
									key={key}
									label={label[0]}
									aria-label={label}
									unit="%"
									min={0}
									max={400}
									precision={0}
									value={pick((a) => percent(a[key]))}
									onChange={(v) =>
										update(key, { [key]: v === 100 ? undefined : v / 100 })
									}
								/>
							))}
						</Pair>
					</Row>
					<Row label="Gamma">
						<NumberField
							aria-label="Gamma"
							className="min-w-0 flex-1"
							min={0.1}
							max={5}
							step={0.05}
							precision={2}
							value={pick((a) => a.gamma ?? 1)}
							onChange={(v) =>
								update("gamma", { gamma: v === 1 ? undefined : v })
							}
						/>
					</Row>
					<Row label="Sharpen">
						<NumberField
							aria-label="Sharpen"
							className="min-w-0 flex-1"
							min={0}
							max={5}
							step={0.1}
							precision={2}
							value={pick((a) => a.sharpen ?? 0)}
							onChange={(v) =>
								update("sharpen", { sharpen: v === 0 ? undefined : v })
							}
						/>
					</Row>
					<Row label="">
						<Checkbox
							isSelected={hue === true}
							isIndeterminate={hue === null}
							onChange={(on) =>
								update("preserve-hue", { preserveHue: on || undefined })
							}
						>
							Preserve hue
						</Checkbox>
					</Row>
				</>
			)}
		</InspectorSection>
	);
}
