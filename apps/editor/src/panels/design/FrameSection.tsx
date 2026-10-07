import type {
	FrameElement,
	FrameFlexLayout,
	FrameGridLayout,
	GridTrack,
	Layout,
} from "@freshcoat-js/coatfile";
import { Checkbox } from "@freshcoat-js/ui/checkbox";
import { NumberField } from "@freshcoat-js/ui/number-field";
import { PanelSection } from "@freshcoat-js/ui/panel";
import { Select, SelectItem } from "@freshcoat-js/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@freshcoat-js/ui/toggle";
import { memo } from "react";
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

type Kind = "flex" | "grid";

export function isGridLayout(l: Layout | undefined): l is FrameGridLayout {
	return !!l && "type" in l && l.type === "grid";
}

function clean<T extends object>(o: T): T {
	const out = { ...o } as Record<string, unknown>;
	for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
	return out as T;
}

/** The layout of the other kind, keeping the padding and spacing. */
export function switchLayout(l: Layout, kind: Kind): Layout {
	if (kind === "grid") {
		if (isGridLayout(l)) return l;
		return clean({
			type: "grid",
			columns: ["1fr", "1fr"],
			gap: l.gap,
			padding: l.padding,
		} satisfies FrameGridLayout);
	}
	if (!isGridLayout(l)) return l;
	const gap = typeof l.gap === "number" ? l.gap : l.gap?.[1];
	return clean({ ...DEFAULT_LAYOUT, gap: gap ?? 8, padding: l.padding });
}

export const FrameSection = memo(function FrameSection({
	ins,
}: {
	ins: Inspect;
}) {
	const frames = ins.layers as FrameElement[];
	const layouts = frames.map((f) => f.properties.layout);
	const all = layouts.every(Boolean);
	const none = layouts.every((l) => !l);
	const present = layouts.filter((l): l is Layout => !!l);
	const kind = commonValue(
		present.map((l): Kind => (isGridLayout(l) ? "grid" : "flex")),
	);
	const clip = commonValue(
		frames.map((f) => f.properties.clipsContent === true),
	);
	const pick = <T,>(fn: (l: Layout) => T) => commonValue(present.map(fn));

	const setLayout = (field: string, patch: (l: Layout) => Layout | null) =>
		ins.setProps(field, (el) => {
			const l = (el as FrameElement).properties.layout;
			const next = l ? patch(l) : null;
			return next ? { layout: clean(next) } : null;
		});
	const setPadding = (side: (typeof SIDES)[number][0], v: number) =>
		setLayout(`padding-${side}`, (l) => {
			const padding = clean({ ...l.padding, [side]: v === 0 ? undefined : v });
			return {
				...l,
				padding: Object.keys(padding).length ? padding : undefined,
			};
		});

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
						<Row label="Type">
							<ToggleGroup
								aria-label="Layout type"
								selectedKeys={kind ? [kind] : []}
								onSelectionChange={(k) => {
									const next = [...k][0] as Kind | undefined;
									if (next)
										setLayout("layout-type", (l) => switchLayout(l, next));
								}}
							>
								<ToggleGroupItem id="flex">Flex</ToggleGroupItem>
								<ToggleGroupItem id="grid">Grid</ToggleGroupItem>
							</ToggleGroup>
						</Row>
						{kind === null && (
							<Notice>The frames use different layout types</Notice>
						)}
						{kind === "flex" && (
							<FlexRows
								pick={(fn) => pick((l) => fn(l as FrameFlexLayout))}
								set={(field, patch) =>
									setLayout(field, (l) =>
										isGridLayout(l) ? null : { ...l, ...patch },
									)
								}
							/>
						)}
						{kind === "grid" && (
							<GridRows
								pick={(fn) => pick((l) => fn(l as FrameGridLayout))}
								set={(field, patch) =>
									setLayout(field, (l) =>
										isGridLayout(l) ? { ...l, ...patch(l) } : null,
									)
								}
							/>
						)}
						{kind !== null && (
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
						)}
					</>
				)}
			</PanelSection>
		</>
	);
});

function FlexRows({
	pick,
	set,
}: {
	pick: <T>(fn: (l: FrameFlexLayout) => T) => T | null;
	set: (field: string, patch: Partial<FrameFlexLayout>) => void;
}) {
	const wrap = pick((l) => l.wrap === true);
	return (
		<>
			<Row label="Direction">
				<ToggleGroup
					aria-label="Direction"
					selectedKeys={keys(pick((l) => l.direction))}
					onSelectionChange={(k) =>
						set("direction", {
							direction: [...k][0] as FrameFlexLayout["direction"],
						})
					}
				>
					<ToggleGroupItem id="row" aria-label="Row" tooltip="Row">
						<ArrowRightIcon />
					</ToggleGroupItem>
					<ToggleGroupItem id="column" aria-label="Column" tooltip="Column">
						<ArrowDownIcon />
					</ToggleGroupItem>
				</ToggleGroup>
				<NumberField
					label="Gap"
					aria-label="Gap"
					className="min-w-0 flex-1"
					min={0}
					value={pick((l) => l.gap ?? 0)}
					onChange={(v) => set("gap", { gap: v === 0 ? undefined : v })}
				/>
			</Row>
			<Row label="Main">
				<Select
					aria-label="Primary align"
					className="min-w-0 flex-1"
					placeholder="Mixed"
					value={pick((l) => l.primaryAlign ?? "start")}
					onChange={(v) =>
						set("primary", {
							primaryAlign:
								v === "start"
									? undefined
									: (v as FrameFlexLayout["primaryAlign"]),
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
						set("cross", {
							crossAlign:
								v === "start"
									? undefined
									: (v as FrameFlexLayout["crossAlign"]),
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
					onChange={(on) => set("wrap", { wrap: on ? true : undefined })}
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
							set("cross-gap", { crossGap: v === 0 ? undefined : v })
						}
					/>
				)}
			</Row>
		</>
	);
}

type TrackKind = "fill" | "fixed" | "hug";
type Axis = "columns" | "rows";

const TRACK_KINDS: [TrackKind, string][] = [
	["fill", "Fill"],
	["fixed", "Fixed"],
	["hug", "Hug"],
];

const AXIS_NAME: Record<Axis, string> = { columns: "Column", rows: "Row" };

export function trackKind(t: GridTrack): TrackKind {
	if (typeof t === "number") return "fixed";
	return t === "auto" ? "hug" : "fill";
}

/** A fill track's share or a fixed track's length; a hug track has none. */
export function trackAmount(t: GridTrack): number | null {
	if (typeof t === "number") return t;
	return t === "auto" ? null : Number.parseFloat(t);
}

export function makeTrack(kind: TrackKind, amount?: number): GridTrack {
	if (kind === "hug") return "auto";
	if (kind === "fixed") return amount ?? 100;
	return `${amount ?? 1}fr`;
}

/** The first `count` tracks, new ones filling for columns and hugging for
 *  rows. */
export function resizeTracks(
	tracks: readonly GridTrack[],
	count: number,
	axis: Axis,
): GridTrack[] {
	const fresh: GridTrack = axis === "columns" ? "1fr" : "auto";
	return Array.from({ length: count }, (_, i) => tracks[i] ?? fresh);
}

function GridRows({
	pick,
	set,
}: {
	pick: <T>(fn: (l: FrameGridLayout) => T) => T | null;
	set: (
		field: string,
		patch: (l: FrameGridLayout) => Partial<FrameGridLayout>,
	) => void;
}) {
	const setGap = (axis: 0 | 1, v: number) =>
		set(axis === 0 ? "gap-row" : "gap-column", (l) => {
			const next = gridGaps(l);
			next[axis] = v;
			return { gap: packGap(next) };
		});
	const setCount = (axis: Axis, n: number) =>
		set(`${axis}-count`, (l) => {
			const count = Math.max(axis === "columns" ? 1 : 0, Math.round(n));
			const tracks = resizeTracks(l[axis] ?? [], count, axis);
			return { [axis]: tracks.length > 0 ? tracks : undefined };
		});
	const setTrack = (axis: Axis, i: number, track: GridTrack) =>
		set(`${axis}-${i}`, (l) => {
			const tracks = [...(l[axis] ?? [])];
			if (i >= tracks.length) return {};
			tracks[i] = track;
			return { [axis]: tracks };
		});

	return (
		<>
			{(["columns", "rows"] as const).map((axis) => (
				<TrackList
					key={axis}
					axis={axis}
					count={pick((l) => l[axis]?.length ?? 0)}
					tracks={pick((l) => l[axis] ?? [])}
					onCount={(n) => setCount(axis, n)}
					onTrack={(i, t) => setTrack(axis, i, t)}
				/>
			))}
			<Row label="Gap">
				<Pair className="flex-1">
					<NumberField
						label="R"
						aria-label="Row gap"
						min={0}
						value={pick((l) => gridGaps(l)[0])}
						onChange={(v) => setGap(0, v)}
					/>
					<NumberField
						label="C"
						aria-label="Column gap"
						min={0}
						value={pick((l) => gridGaps(l)[1])}
						onChange={(v) => setGap(1, v)}
					/>
				</Pair>
			</Row>
		</>
	);
}

function TrackList({
	axis,
	count,
	tracks,
	onCount,
	onTrack,
}: {
	axis: Axis;
	count: number | null;
	tracks: GridTrack[] | null;
	onCount: (n: number) => void;
	onTrack: (i: number, t: GridTrack) => void;
}) {
	const name = AXIS_NAME[axis];
	return (
		<>
			<Row label={axis === "columns" ? "Columns" : "Rows"}>
				<NumberField
					aria-label={`${name} count`}
					className="min-w-0 flex-1"
					min={axis === "columns" ? 1 : 0}
					max={24}
					precision={0}
					value={count}
					onChange={onCount}
				/>
			</Row>
			{axis === "rows" && count === 0 && (
				<Notice>Added as children need them</Notice>
			)}
			{tracks?.map((t, i) => {
				const kind = trackKind(t);
				const amount = trackAmount(t);
				const label = `${name} ${i + 1}`;
				return (
					<Row
						// biome-ignore lint/suspicious/noArrayIndexKey: tracks are positional
						key={i}
						label={<span className="pl-2">{i + 1}</span>}
					>
						<ToggleGroup
							aria-label={`${label} size`}
							selectedKeys={[kind]}
							onSelectionChange={(k) => {
								const next = [...k][0] as TrackKind | undefined;
								if (next && next !== kind) onTrack(i, makeTrack(next));
							}}
						>
							{TRACK_KINDS.map(([id, text]) => (
								<ToggleGroupItem key={id} id={id}>
									{text}
								</ToggleGroupItem>
							))}
						</ToggleGroup>
						{amount !== null && (
							<NumberField
								aria-label={
									kind === "fill" ? `${label} share` : `${label} size`
								}
								className="w-[64px]"
								unit={kind === "fill" ? "fr" : undefined}
								min={kind === "fill" ? 0.1 : 0}
								precision={kind === "fill" ? 2 : 1}
								value={amount}
								onChange={(v) => onTrack(i, makeTrack(kind, v))}
							/>
						)}
					</Row>
				);
			})}
			{count !== null && tracks === null && (
				<Notice>The frames' {axis} differ</Notice>
			)}
		</>
	);
}

/** A grid's [row, column] gaps. */
export function gridGaps(l: FrameGridLayout): [number, number] {
	if (typeof l.gap === "number") return [l.gap, l.gap];
	return l.gap ? [l.gap[0], l.gap[1]] : [0, 0];
}

/** The shortest way to write [row, column] gaps: none, one number, or both. */
export function packGap([row, column]: [
	number,
	number,
]): FrameGridLayout["gap"] {
	if (row === column) return row === 0 ? undefined : row;
	return [row, column];
}

function keys(v: string | null | undefined): string[] {
	return typeof v === "string" ? [v] : [];
}
