import type { Element } from "@freshcoat-js/coatfile";
import {
	type BooleanOp,
	type BooleanOperand,
	type BooleanShape,
	combineShapes as combineOperands,
} from "@freshcoat-js/engine";
import type { CanvasKit } from "canvaskit-wasm";

export type { BooleanOp, BooleanShape };

export const BOOLEAN_OPS: BooleanOp[] = [
	"union",
	"subtract",
	"intersect",
	"exclude",
];

/** The layer types a boolean operation takes. */
export function isBooleanShape(el: Element): boolean {
	return el.type === "rect" || el.type === "vector";
}

function operandOf(el: Element): BooleanOperand | null {
	const placed = {
		...(el.pos ? { pos: el.pos } : {}),
		...(el.size ? { size: el.size } : {}),
		...(el.rotation !== undefined ? { rotation: el.rotation } : {}),
	};
	if (el.type === "rect")
		return {
			...placed,
			kind: "rect",
			cornerRadius: el.properties.cornerRadius,
		};
	if (el.type === "vector")
		return {
			...placed,
			kind: "path",
			d: el.properties.d,
			cornerRadius: el.properties.cornerRadius,
			fillRule: el.properties.fillRule,
		};
	return null;
}

/**
 * Combines shapes, bottom-most first, as Figma does: union and exclude fold
 * every shape together, intersect keeps what all of them cover, and subtract
 * takes the rest away from the bottom-most. Null when nothing is left.
 */
export function combineShapes(
	ck: CanvasKit,
	elements: Element[],
	op: BooleanOp,
): BooleanShape | null {
	const operands = elements.map(operandOf);
	if (operands.some((o) => !o)) return null;
	return combineOperands(ck, operands as BooleanOperand[], op);
}
