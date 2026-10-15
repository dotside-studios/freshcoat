import type { Element, VisibilityCondition } from "@freshcoat-js/coatfile";
import { Button } from "@freshcoat-js/ui/button";
import { TextField } from "@freshcoat-js/ui/field";
import { Select, SelectItem } from "@freshcoat-js/ui/select";
import { useContext, useMemo } from "react";
import { SHOW_WHEN, VARIANT_UI } from "~/app/copy";
import { listFields } from "~/doc/values";
import {
	AddButton,
	ItemGroup,
	Notice,
	OverridesContext,
	RemoveButton,
} from "./controls";
import { commonValue, type Inspect } from "./field-helpers";
import { removeAt, replaceAt } from "./fills";
import { InspectorSection } from "./InspectorSection";

export type ConditionOp = "set" | "unset" | "equals" | "differs";

const OPS: [ConditionOp, string][] = [
	["set", SHOW_WHEN.ops.set],
	["unset", SHOW_WHEN.ops.unset],
	["equals", SHOW_WHEN.ops.equals],
	["differs", SHOW_WHEN.ops.differs],
];

export function conditionsOf(el: Element): VisibilityCondition[] {
	const w = el.visibleWhen;
	return w ? (Array.isArray(w) ? w : [w]) : [];
}

export function opOf(c: VisibilityCondition): ConditionOp {
	if (c.equals !== undefined) return c.not ? "differs" : "equals";
	return c.not ? "unset" : "set";
}

export function withOp(
	c: VisibilityCondition,
	op: ConditionOp,
): VisibilityCondition {
	const out: VisibilityCondition = { field: c.field };
	if (op === "equals" || op === "differs") out.equals = c.equals ?? "";
	if (op === "unset" || op === "differs") out.not = true;
	return out;
}

export function describeCondition(c: VisibilityCondition): string {
	const op = opOf(c);
	const test = SHOW_WHEN.ops[op];
	return op === "equals" || op === "differs"
		? `${c.field} ${test} ${c.equals}`
		: `${c.field} ${test}`;
}

function whenPatch(list: VisibilityCondition[]): Element["visibleWhen"] {
	return list.length === 0 ? undefined : list.length === 1 ? list[0] : list;
}

/** The line for a layer hidden in the active variant, or in Default with no
 *  variant, with the way back. The action to hide is in the layer menu. */
function HiddenInVariant({ ins }: { ins: Inspect }) {
	const overrides = useContext(OverridesContext);
	const layers = ins.controller.variantVisibility(ins.keys);
	if (layers.length === 0 || !layers.every((l) => l.hidden)) return null;
	const label = overrides?.label ?? VARIANT_UI.default;
	return (
		<div className="flex items-center justify-between gap-2">
			<span className="text-fc-muted text-fc-sm">
				{VARIANT_UI.hiddenIn(label)}
			</span>
			<Button
				size="sm"
				data-testid="show-in-variant"
				onPress={() => ins.controller.setHiddenInVariant(ins.keys, false)}
			>
				{SHOW_WHEN.show}
			</Button>
		</div>
	);
}

export function VisibilitySection({ ins }: { ins: Inspect }) {
	const fields = useMemo(() => listFields(ins.template), [ins.template]);
	const lists = (ins.layers as Element[]).map(conditionsOf);
	const common = commonValue(lists);

	const update = (
		field: string,
		fn: (list: VisibilityCondition[]) => VisibilityCondition[],
	) =>
		ins.setShared(field, (el) => ({
			visibleWhen: whenPatch(fn(conditionsOf(el as Element))),
		}));

	const first = fields[0]?.id;
	const add = () =>
		first &&
		update("when-add", (l) =>
			common === null ? [{ field: first }] : [...l, { field: first }],
		);
	const empty = common?.length === 0;
	const overrides = useContext(OverridesContext);
	return (
		<InspectorSection
			title={SHOW_WHEN.title}
			actions={
				empty ? undefined : (
					<AddButton label={SHOW_WHEN.add} isDisabled={!first} onPress={add} />
				)
			}
		>
			<HiddenInVariant ins={ins} />
			{empty && (
				<div className="flex items-center justify-between gap-2">
					<span className="text-fc-muted text-fc-sm">{SHOW_WHEN.always}</span>
					<Button size="sm" isDisabled={!first} onPress={add}>
						{SHOW_WHEN.add}
					</Button>
				</div>
			)}
			{fields.length === 0 && <Notice>{SHOW_WHEN.needField}</Notice>}
			{common === null && <Notice>{SHOW_WHEN.mixed}</Notice>}
			{overrides && !empty && <Notice>{VARIANT_UI.sharedConditions}</Notice>}
			{(common ?? []).map((c, i) => {
				const op = opOf(c);
				const set = (field: string, next: VisibilityCondition) =>
					update(`when:${i}:${field}`, (l) => replaceAt(l, i, next));
				return (
					<ItemGroup
						// biome-ignore lint/suspicious/noArrayIndexKey: conditions have no identity
						key={i}
					>
						<div className="flex min-w-0 items-center gap-1.5">
							<Select
								aria-label={`Condition ${i + 1} field`}
								className="min-w-0 flex-1"
								value={c.field}
								onChange={(v) => set("field", { ...c, field: String(v) })}
							>
								{[
									...fields.map((f) => f.id),
									...(fields.some((f) => f.id === c.field) ? [] : [c.field]),
								].map((id) => (
									<SelectItem key={id} id={id}>
										{id}
									</SelectItem>
								))}
							</Select>
							<RemoveButton
								label={`Remove condition ${i + 1}`}
								onPress={() => update("when-remove", (l) => removeAt(l, i))}
							/>
						</div>
						<div className="flex min-w-0 items-center gap-1.5">
							<Select
								aria-label={`Condition ${i + 1} test`}
								className={
									op === "set" || op === "unset"
										? "flex-1"
										: "w-[112px] shrink-0"
								}
								value={op}
								onChange={(v) => set("op", withOp(c, v as ConditionOp))}
							>
								{OPS.map(([id, name]) => (
									<SelectItem key={id} id={id}>
										{name}
									</SelectItem>
								))}
							</Select>
							{(op === "equals" || op === "differs") && (
								<TextField
									aria-label={`Condition ${i + 1} value`}
									className="min-w-0 flex-1"
									placeholder="Value"
									value={c.equals ?? ""}
									onChange={(v) => set("value", { ...c, equals: v })}
								/>
							)}
						</div>
					</ItemGroup>
				);
			})}
		</InspectorSection>
	);
}
