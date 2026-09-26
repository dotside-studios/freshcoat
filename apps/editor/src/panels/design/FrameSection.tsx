import type { FrameElement, Layout } from "@freshcoat/coatfile";
import { Checkbox } from "@freshcoat/ui/checkbox";
import { NumberField } from "@freshcoat/ui/number-field";
import { PanelSection } from "@freshcoat/ui/panel";
import { Select, SelectItem } from "@freshcoat/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@freshcoat/ui/toggle";
import ArrowDownIcon from "~icons/mingcute/arrow-down-line";
import ArrowRightIcon from "~icons/mingcute/arrow-right-line";
import { AddButton, Notice, Pair, RemoveButton, Row } from "./controls";
import { commonValue, type Inspect } from "./field-helpers";

export const DEFAULT_LAYOUT: Layout = { direction: "row", gap: 8 };

const PRIMARY = [
	["start", "Start"],
	["center", "Center"],
	["end", "End"],
	["space-between", "Space between"],
	["space-around", "Space around"],
	["space-evenly", "Space evenly"],
] as const;

const CROSS = [
	["start", "Start"],
	["center", "Center"],
	["end", "End"],
	["stretch", "Stretch"],
] as const;

const SIDES = [
	["top", "T"],
	["right", "R"],
	["bottom", "B"],
	["left", "L"],
] as const;

function clean<T extends object>(o: T): T {
	const out = { ...o } as Record<string, unknown>;
	for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
	return out as T;
}

export function FrameSection({ ins }: { ins: Inspect }) {
	const frames = ins.layers as FrameElement[];
	const layouts = frames.map((f) => f.properties.layout);
	const all = layouts.every(Boolean);
	const none = layouts.every((l) => !l);
	const clip = commonValue(
		frames.map((f) => f.properties.clipsContent === true),
	);
	const pick = <T,>(fn: (l: Layout) => T) =>
		commonValue(layouts.filter((l): l is Layout => !!l).map(fn));

	const setLayout = (field: string, patch: Partial<Layout>) =>
		ins.setProps(field, (el) => {
			const l = (el as FrameElement).properties.layout;
			return l ? { layout: clean({ ...l, ...patch }) } : null;
		});
	const setPadding = (side: (typeof SIDES)[number][0], v: number) =>
		ins.setProps(`padding-${side}`, (el) => {
			const l = (el as FrameElement).properties.layout;
			if (!l) return null;
			const padding = clean({ ...l.padding, [side]: v === 0 ? undefined : v });
			return {
				layout: clean({
					...l,
					padding: Object.keys(padding).length ? padding : undefined,
				}),
			};
		});

	const wrap = pick((l) => l.wrap === true);

	return (
		<>
			<PanelSection title="Frame">
				<Checkbox
					isSelected={clip === true}
					isIndeterminate={clip === null}
					onChange={(on) =>
						ins.setProps("clip", () => ({
							clipsContent: on ? true : undefined,
						}))
					}
				>
					Clip content
				</Checkbox>
			</PanelSection>
			<PanelSection
				title="Auto layout"
				actions={
					all ? (
						<RemoveButton
							label="Remove auto layout"
							onPress={() =>
								ins.setProps("layout-remove", () => ({ layout: undefined }))
							}
						/>
					) : (
						<AddButton
							label="Add auto layout"
							onPress={() =>
								ins.setProps("layout-add", (el) =>
									(el as FrameElement).properties.layout
										? null
										: { layout: DEFAULT_LAYOUT },
								)
							}
						/>
					)
				}
			>
				{!all && !none && <Notice>Some frames have no auto layout</Notice>}
				{all && (
					<>
						<Row label="Direction">
							<ToggleGroup
								aria-label="Direction"
								selectedKeys={keys(pick((l) => l.direction))}
								onSelectionChange={(k) =>
									setLayout("direction", {
										direction: [...k][0] as Layout["direction"],
									})
								}
							>
								<ToggleGroupItem id="row" aria-label="Row" tooltip="Row">
									<ArrowRightIcon />
								</ToggleGroupItem>
								<ToggleGroupItem
									id="column"
									aria-label="Column"
									tooltip="Column"
								>
									<ArrowDownIcon />
								</ToggleGroupItem>
							</ToggleGroup>
							<NumberField
								label="Gap"
								aria-label="Gap"
								className="min-w-0 flex-1"
								min={0}
								value={pick((l) => l.gap ?? 0)}
								onChange={(v) =>
									setLayout("gap", { gap: v === 0 ? undefined : v })
								}
							/>
						</Row>
						<Row label="Padding">
							<Pair cols={4} className="flex-1">
								{SIDES.map(([side, label]) => (
									<NumberField
										key={side}
										label={label}
										aria-label={`Padding ${side}`}
										min={0}
										value={pick((l) => l.padding?.[side] ?? 0)}
										onChange={(v) => setPadding(side, v)}
									/>
								))}
							</Pair>
						</Row>
						<Row label="Main">
							<Select
								aria-label="Primary align"
								className="min-w-0 flex-1"
								placeholder="Mixed"
								value={pick((l) => l.primaryAlign ?? "start")}
								onChange={(v) =>
									setLayout("primary", {
										primaryAlign:
											v === "start" ? undefined : (v as Layout["primaryAlign"]),
									})
								}
							>
								{PRIMARY.map(([id, name]) => (
									<SelectItem key={id} id={id}>
										{name}
									</SelectItem>
								))}
							</Select>
						</Row>
						<Row label="Cross">
							<Select
								aria-label="Cross align"
								className="min-w-0 flex-1"
								placeholder="Mixed"
								value={pick((l) => l.crossAlign ?? "start")}
								onChange={(v) =>
									setLayout("cross", {
										crossAlign:
											v === "start" ? undefined : (v as Layout["crossAlign"]),
									})
								}
							>
								{CROSS.map(([id, name]) => (
									<SelectItem key={id} id={id}>
										{name}
									</SelectItem>
								))}
							</Select>
						</Row>
						<Row label="">
							<Checkbox
								isSelected={wrap === true}
								isIndeterminate={wrap === null}
								onChange={(on) =>
									setLayout("wrap", { wrap: on ? true : undefined })
								}
							>
								Wrap
							</Checkbox>
							{wrap === true && (
								<NumberField
									label="Gap"
									aria-label="Cross gap"
									className="ml-auto w-[96px]"
									min={0}
									value={pick((l) => l.crossGap ?? 0)}
									onChange={(v) =>
										setLayout("cross-gap", {
											crossGap: v === 0 ? undefined : v,
										})
									}
								/>
							)}
						</Row>
					</>
				)}
			</PanelSection>
		</>
	);
}

function keys(v: string | null | undefined): string[] {
	return typeof v === "string" ? [v] : [];
}
