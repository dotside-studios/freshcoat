import type { Element, VisibilityCondition } from "@freshcoat-js/coatfile";
import { Button } from "@freshcoat-js/ui/button";
import { TextField } from "@freshcoat-js/ui/field";
import { Select, SelectItem } from "@freshcoat-js/ui/select";
import { useContext, useMemo } from "react";
import { VARIANT_UI } from "~/app/copy";
import { listFields } from "~/doc/values";
import { useEditor } from "~/state/hooks";
import EyeIcon from "~icons/mingcute/eye-2-line";
import EyeOffIcon from "~icons/mingcute/eye-close-line";
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
	["set", "is set"],
	["unset", "is not set"],
	["equals", "equals"],
	["differs", "does not equal"],
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

function whenPatch(list: VisibilityCondition[]): Element["visibleWhen"] {
	return list.length === 0 ? undefined : list.length === 1 ? list[0] : list;
}

/** Hide in <variant> / Show in <variant>, while a variant is active. It is
 *  saved with the variant, unlike the eye in the layers tree. The
 *  conditions below are the same in every variant. */
function HideInVariant({ ins }: { ins: Inspect }) {
	const overrides = useContext(OverridesContext);
	const variantId = useEditor((s) => s.variantId);
	const layers = variantId ? ins.controller.variantVisibility(ins.keys) : [];
	if (!overrides || layers.length === 0) return null;
	const hidden = layers.every((l) => l.hidden);
	return (
		<div className="flex flex-col gap-1.5 border-fc-border border-b pb-2">
			<Button
				size="sm"
				data-testid="hide-in-variant"
				className="self-start"
				onPress={() => ins.controller.setHiddenInVariant(ins.keys, !hidden)}
			>
				{hidden ? <EyeIcon /> : <EyeOffIcon />}
				{hidden
					? VARIANT_UI.showIn(overrides.label)
					: VARIANT_UI.hideIn(overrides.label)}
			</Button>
			<Notice>{VARIANT_UI.sharedConditions}</Notice>
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
	return (
		<InspectorSection
			title="Visibility"
			actions={
				<AddButton
					label="Add condition"
					isDisabled={!first}
					onPress={() =>
						first &&
						update("when-add", (l) =>
							common === null ? [{ field: first }] : [...l, { field: first }],
						)
					}
				/>
			}
		>
			<HideInVariant ins={ins} />
			{fields.length === 0 && (
				<Notice>Add a field in Content to show this layer conditionally</Notice>
			)}
			{common === null && (
				<Notice>Mixed conditions. Adding one replaces them.</Notice>
			)}
			{common?.length === 0 && fields.length > 0 && (
				<Notice>Always visible</Notice>
			)}
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
