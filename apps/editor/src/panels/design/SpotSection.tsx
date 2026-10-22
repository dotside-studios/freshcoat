import type { LayerSpot, SpotColor } from "@freshcoat-js/coatfile";
import { parseColor } from "@freshcoat-js/engine/internal";
import { Checkbox } from "@freshcoat-js/ui/checkbox";
import { IconButton } from "@freshcoat-js/ui/icon-button";
import { Menu, MenuItem } from "@freshcoat-js/ui/menu";
import { NumberField } from "@freshcoat-js/ui/number-field";
import { Popover } from "@freshcoat-js/ui/popover";
import { MenuTrigger } from "react-aria-components";
import AddIcon from "~icons/mingcute/add-line";
import { CommitField, ItemGroup, Notice, RemoveButton, Row } from "./controls";
import {
	commonValue,
	type Inspect,
	type Layer,
	propsOf,
} from "./field-helpers";
import { InspectorSection } from "./InspectorSection";

type Paint = keyof LayerSpot;

const LABEL: Record<Paint, string> = { fill: "Fill", stroke: "Stroke" };

/** Whether the section applies: every layer is a painted rect or vector. */
export function takesSpot(ins: Pick<Inspect, "layers">): boolean {
	return ins.layers.every((l) => l.type === "rect" || l.type === "vector");
}

const spotOf = (el: Layer): LayerSpot | undefined =>
	propsOf(el).spot as LayerSpot | undefined;

/** Marks a layer's fill or stroke as a named spot ink, for white ink, foil
 *  or varnish. A vector PDF prints it as a Separation; the canvas and images
 *  show its alternate colour. */
export function SpotSection({ ins }: { ins: Inspect }) {
	const spots = ins.layers.map(spotOf);
	const setInk = (paint: Paint, ink: SpotColor | undefined) =>
		ins.setProps(`spot-${paint}`, (el) => {
			const { [paint]: _, ...rest } = spotOf(el) ?? {};
			const next: LayerSpot = ink ? { ...rest, [paint]: ink } : rest;
			return { spot: Object.keys(next).length > 0 ? next : undefined };
		});
	const editInk = (paint: Paint, change: Partial<SpotColor>) =>
		ins.setProps(`spot-${paint}`, (el) => {
			const current = spotOf(el);
			const ink = current?.[paint];
			if (!current || !ink) return null;
			const next = { ...ink, ...change } as SpotColor;
			for (const key of Object.keys(change) as (keyof SpotColor)[])
				if (change[key] === undefined) delete next[key];
			return { spot: { ...current, [paint]: next } };
		});

	const state = (["fill", "stroke"] as const).map((paint) => {
		const inks = spots.map((s) => s?.[paint]);
		return {
			paint,
			inks,
			on: commonValue(inks.map((ink) => ink !== undefined)),
			all: inks.every((ink) => ink !== undefined),
		};
	});
	const addable = state.filter((p) => !p.all).map((p) => p.paint);

	return (
		<InspectorSection
			title="Spot color"
			actions={
				addable.length > 0 ? (
					<MenuTrigger>
						<IconButton
							aria-label="Add spot ink"
							tooltip="Add spot ink"
							className="size-5 pointer-coarse:size-8"
						>
							<AddIcon />
						</IconButton>
						<Popover placement="bottom end">
							<Menu
								aria-label="Add spot ink"
								disabledKeys={state.filter((p) => p.all).map((p) => p.paint)}
								onAction={(k) =>
									setInk(k as Paint, { spot: "White", overprint: true })
								}
							>
								<MenuItem id="fill">Fill</MenuItem>
								<MenuItem id="stroke">Stroke</MenuItem>
							</Menu>
						</Popover>
					</MenuTrigger>
				) : null
			}
		>
			{state.map(({ paint, inks, on, all }) => {
				const some = <T,>(read: (ink: SpotColor) => T) =>
					commonValue(
						inks.map((ink) => (ink ? read(ink) : undefined)),
					) as T | null;
				const name = some((ink) => ink.spot);
				const tint = some((ink) => ink.tint ?? 1);
				const alt = some((ink) => ink.alt ?? "");
				const overprint = some((ink) => ink.overprint ?? false);
				if (on === false) return null;
				if (!all)
					return (
						<Notice key={paint}>{`Some layers use a ${paint} spot`}</Notice>
					);
				return (
					<ItemGroup key={paint}>
						<div className="flex min-h-fc-control items-center justify-between">
							<span className="text-fc-base">{LABEL[paint]}</span>
							<RemoveButton
								label={`Remove ${paint} spot`}
								onPress={() => setInk(paint, undefined)}
							/>
						</div>
						<Row label="Name">
							<CommitField
								aria-label={`${LABEL[paint]} spot name`}
								value={name}
								onCommit={(text) => {
									const spot = text.trim();
									if (!spot || spot === "All" || spot === "None") return false;
									editInk(paint, { spot });
									return true;
								}}
							/>
						</Row>
						<Row label="Tint">
							<NumberField
								aria-label={`${LABEL[paint]} spot tint`}
								className="min-w-0 flex-1"
								min={0}
								max={100}
								step={1}
								precision={0}
								value={typeof tint === "number" ? tint * 100 : null}
								placeholder={tint === null ? "Mixed" : undefined}
								onChange={(v) =>
									editInk(paint, { tint: v === 100 ? undefined : v / 100 })
								}
							/>
						</Row>
						<Row label="Alternate">
							<CommitField
								aria-label={`${LABEL[paint]} spot alternate`}
								value={alt}
								placeholder="Layer color"
								onCommit={(text) => {
									const color = text.trim();
									if (!color) {
										editInk(paint, { alt: undefined });
										return true;
									}
									const parsed = parseColor(color);
									if (!parsed || parsed === "none") return false;
									editInk(paint, { alt: color });
									return true;
								}}
							/>
						</Row>
						<Row label="Overprint">
							<Checkbox
								aria-label="Overprint"
								isSelected={overprint === true}
								isIndeterminate={overprint === null}
								onChange={(next) =>
									editInk(paint, { overprint: next || undefined })
								}
							>
								On
							</Checkbox>
						</Row>
					</ItemGroup>
				);
			})}
		</InspectorSection>
	);
}
