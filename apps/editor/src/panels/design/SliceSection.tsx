import type { Element, SliceModifier } from "@freshcoat-js/coatfile";
import { Checkbox } from "@freshcoat-js/ui/checkbox";
import { NumberField } from "@freshcoat-js/ui/number-field";
import { Select, SelectItem } from "@freshcoat-js/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@freshcoat-js/ui/toggle";
import { isSliceable } from "~/doc/slice";
import { CommitField, Row } from "./controls";
import { commonValue, type Inspect, propsOf } from "./field-helpers";
import { InspectorSection } from "./InspectorSection";

const EDGES: [NonNullable<SliceModifier["edge"]>, string][] = [
	["none", "None"],
	["through", "Through cut"],
	["kiss", "Kiss cut"],
	["score", "Score"],
	["perforate", "Perforate"],
];

/** Whether the section applies: every layer is a top-level rect or vector. */
export function takesSlice(ins: Pick<Inspect, "template" | "keys">): boolean {
	return ins.keys.every((k) => isSliceable(ins.template, k));
}

const sliceOf = (el: Element): SliceModifier | undefined =>
	propsOf(el).slice as SliceModifier | undefined;

export function SliceSection({ ins }: { ins: Inspect }) {
	const slices = (ins.layers as Element[]).map(sliceOf);
	const on = commonValue(slices.map((s) => s !== undefined));
	const all = slices.every((s) => s !== undefined);
	const setSlice = (change: (s: SliceModifier) => SliceModifier) =>
		ins.setProps("slice", (el) => {
			const current = sliceOf(el as Element);
			return current ? { slice: change(current) } : null;
		});
	const edit = <K extends keyof SliceModifier>(
		key: K,
		value: SliceModifier[K],
	) =>
		setSlice((s) => {
			const next: SliceModifier = { ...s, [key]: value };
			if (value === undefined) delete next[key];
			return next;
		});

	const some = <T,>(read: (s: SliceModifier) => T) =>
		commonValue(slices.map((s) => (s ? read(s) : undefined))) as T | null;
	const name = some((s) => s.name ?? "");
	const output = some((s) => s.output ?? "piece");
	const edge = some((s) => s.edge ?? "none");
	const bleed = some((s) => s.bleed ?? 0);

	return (
		<InspectorSection title="Slice">
			<Row label="">
				<Checkbox
					isSelected={on === true}
					isIndeterminate={on === null}
					onChange={(next) =>
						ins.setProps("slice-on", (el) => {
							const has = sliceOf(el as Element) !== undefined;
							return has === next ? null : { slice: next ? {} : undefined };
						})
					}
				>
					Use as slice
				</Checkbox>
			</Row>
			{all && (
				<>
					<Row label="Name">
						<CommitField
							aria-label="Slice name"
							value={name}
							placeholder={
								ins.layers.length === 1 ? ins.layers[0]?.id : undefined
							}
							onCommit={(text) => {
								edit("name", text.trim() || undefined);
								return true;
							}}
						/>
					</Row>
					<Row label="Output">
						<ToggleGroup
							aria-label="Slice output"
							className="flex-1"
							selectedKeys={output ? [output] : []}
							onSelectionChange={(k) => {
								const v = [...k][0];
								if (v) edit("output", v === "piece" ? undefined : "none");
							}}
						>
							<ToggleGroupItem id="piece">Piece</ToggleGroupItem>
							<ToggleGroupItem id="none">None</ToggleGroupItem>
						</ToggleGroup>
					</Row>
					<Row label="Edge">
						<Select
							aria-label="Slice edge"
							className="min-w-0 flex-1"
							value={edge}
							placeholder="Mixed"
							onChange={(next) =>
								edit("edge", next === "none" ? undefined : (next as never))
							}
						>
							{EDGES.map(([id, label]) => (
								<SelectItem key={id} id={id} textValue={label}>
									{label}
								</SelectItem>
							))}
						</Select>
					</Row>
					<Row label="Bleed">
						<NumberField
							aria-label="Slice bleed"
							className="min-w-0 flex-1"
							min={0}
							value={typeof bleed === "number" ? bleed : null}
							placeholder={bleed === null ? "Mixed" : undefined}
							onChange={(v) => edit("bleed", v === 0 ? undefined : v)}
						/>
					</Row>
				</>
			)}
		</InspectorSection>
	);
}
