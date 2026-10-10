// Conditional visibility. An element carrying `visibleWhen` is dropped from the
// scene before layout when its condition does not hold, so an auto-layout frame
// closes the gap it leaves exactly as a hidden layer does in Figma.

import type {
	BooleanOperandElement,
	Element,
	FieldDefinition,
	VisibilityCondition,
} from "./types";

/** Whether a field counts as set. A boolean field is set when it is "true"; any
 *  other field when it has a non-blank value. */
export function fieldIsSet(
	value: unknown,
	def: FieldDefinition | undefined,
): boolean {
	if (def?.format === "boolean") return value === "true" || value === true;
	if (value == null) return false;
	if (typeof value === "string") return value.trim() !== "";
	return true;
}

function conditionHolds(
	cond: VisibilityCondition,
	values: Record<string, unknown>,
	fields: Record<string, FieldDefinition>,
): boolean {
	const value = values[cond.field];
	const match =
		cond.equals !== undefined
			? String(value ?? "") === cond.equals
			: fieldIsSet(value, fields[cond.field]);
	return cond.not ? !match : match;
}

/** Whether an element is shown for these values. Several conditions must all
 *  hold. `values` are the resolved ones, defaults included. */
export function isElementVisible(
	el: Pick<Element, "visibleWhen">,
	values: Record<string, unknown>,
	fields: Record<string, FieldDefinition>,
): boolean {
	const when = el.visibleWhen;
	if (!when) return true;
	const conds = Array.isArray(when) ? when : [when];
	return conds.every((c) => conditionHolds(c, values, fields));
}

/** The elements shown for these values, recursing into frames, masks and boolean operands. */
export function pruneHiddenElements(
	elements: Element[],
	values: Record<string, unknown>,
	fields: Record<string, FieldDefinition>,
): Element[] {
	const out: Element[] = [];
	for (const el of elements) {
		if (!isElementVisible(el, values, fields)) continue;
		if (el.type === "frame" || el.type === "mask") {
			// A mask's shape is not shown, so only what it masks is pruned.
			out.push({
				...el,
				properties: {
					...el.properties,
					children: pruneHiddenElements(el.properties.children, values, fields),
				},
			} as Element);
		} else if (el.type === "vector" && el.properties.boolean) {
			out.push({
				...el,
				properties: {
					...el.properties,
					boolean: {
						...el.properties.boolean,
						operands: pruneHiddenElements(
							el.properties.boolean.operands,
							values,
							fields,
						) as BooleanOperandElement[],
					},
				},
			});
		} else {
			out.push(el);
		}
	}
	return out;
}
