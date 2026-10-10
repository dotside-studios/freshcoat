import {
	applyBooleans,
	type BooleanOperandElement,
	cachePathOp,
	childElements,
	type Element,
	type PathOp,
	sameJson,
	type Template,
	type VectorElement,
} from "@freshcoat-js/coatfile";
import {
	type BooleanOp,
	type BooleanOperand,
	type BooleanShape,
	combineShapes as combineOperands,
} from "@freshcoat-js/engine";
import type { CanvasKit } from "canvaskit-wasm";
import { round2 } from "./factories";
import { rotatePoint } from "./geometry";
import { type BooleanVector, isBooleanVector } from "./path";

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

const resolved = new WeakMap<Element, Element>();

/** `el` with the result of its boolean rebuilt from its operands by `pathOp`,
 *  as compile draws it. Under a variant the cached path is the base's. */
export function resolveBoolean(el: Element, pathOp: PathOp): Element {
	if (!isBooleanVector(el)) return el;
	let out = resolved.get(el);
	if (!out) {
		out = applyBooleans([el], pathOp)[0] as Element;
		resolved.set(el, out);
	}
	return out;
}

const boxedOps = new WeakMap<CanvasKit, PathOp>();

/** `combineShapes` on operands, results kept by operation and geometry. Its
 *  paths are relative to the result's box, which it reports in the operands'
 *  space. */
function boxedOp(ck: CanvasKit): PathOp {
	let op = boxedOps.get(ck);
	if (!op) {
		op = cachePathOp((kind, operands) => combineOperands(ck, operands, kind));
		boxedOps.set(ck, op);
	}
	return op;
}

// Elements of a template already settled, or part of one: a subtree seen once
// is not walked again, since elements are never changed in place.
const seen = new WeakSet<object>();

function markSeen(list: readonly Element[]): void {
	for (const el of list) {
		if (seen.has(el)) continue;
		seen.add(el);
		markSeen(childElements(el));
	}
}

function shiftOperand(
	el: BooleanOperandElement,
	dx: number,
	dy: number,
): BooleanOperandElement {
	return {
		...el,
		pos: { x: round2((el.pos?.x ?? 0) - dx), y: round2((el.pos?.y ?? 0) - dy) },
	};
}

// A vector with an operation takes the box of its result, with the operands
// shifted so they stay where they were on the canvas. A turned vector turns
// about its centre, so its position follows the centre's move.
function refreshed(
	el: BooleanVector,
	operands: BooleanOperandElement[],
	ck: CanvasKit,
): VectorElement {
	const operation = el.properties.boolean;
	const { fillRule: _fillRule, ...rest } = el.properties;
	const shape = operands.length
		? boxedOp(ck)(
				operation.op,
				operands.map((o) => operandOf(o) as BooleanOperand),
			)
		: null;
	if (!shape) {
		return {
			...el,
			properties: { ...rest, d: "", boolean: { ...operation, operands } },
		};
	}
	const { x, y, width, height } = shape.box;
	const size = el.size ?? { width: 0, height: 0 };
	const centre = rotatePoint(
		{ x: x + width / 2, y: y + height / 2 },
		el.rotation ?? 0,
		{ x: size.width / 2, y: size.height / 2 },
	);
	const pos = {
		x: round2((el.pos?.x ?? 0) + centre.x - width / 2),
		y: round2((el.pos?.y ?? 0) + centre.y - height / 2),
	};
	return {
		...el,
		pos,
		size: { width, height },
		properties: {
			...rest,
			d: shape.d,
			...(shape.fillRule ? { fillRule: shape.fillRule } : {}),
			boolean: {
				...operation,
				operands:
					x === 0 && y === 0
						? operands
						: operands.map((o) => shiftOperand(o, x, y)),
			},
		},
	};
}

function settleList<T extends Element>(list: T[], ck: CanvasKit): T[] {
	const out = list.map((el) => settleElement(el, ck) as T);
	return out.every((el, i) => el === list[i]) ? list : out;
}

function settleElement(el: Element, ck: CanvasKit): Element {
	if (seen.has(el)) return el;
	if (el.type === "frame") {
		const children = settleList(el.properties.children, ck);
		return children === el.properties.children
			? el
			: { ...el, properties: { ...el.properties, children } };
	}
	if (el.type === "mask") {
		const mask = settleElement(el.properties.mask, ck);
		const children = settleList(el.properties.children, ck);
		return mask === el.properties.mask && children === el.properties.children
			? el
			: { ...el, properties: { ...el.properties, mask, children } };
	}
	if (!isBooleanVector(el)) return el;
	const operands = settleList(el.properties.boolean.operands, ck);
	const next = refreshed(el, operands, ck);
	const unchanged =
		operands === el.properties.boolean.operands &&
		next.properties.d === el.properties.d &&
		next.properties.fillRule === el.properties.fillRule &&
		sameJson(next.pos, el.pos) &&
		sameJson(next.size, el.size);
	return unchanged ? el : next;
}

/**
 * `after` with the result each boolean vector caches (`d`, `fillRule`, its
 * box) rebuilt from its operands, for every vector that is not part of
 * `before`. A change to an operand makes its vector, and every boolean it is
 * an operand of, new, so those are the ones rebuilt. Everything else is
 * returned as it was.
 */
export function settleBooleans(
	before: Template,
	after: Template,
	ck: CanvasKit,
): Template {
	if (after === before || after.template_data === before.template_data)
		return after;
	for (const frame of before.template_data) markSeen(frame.elements);
	let template_data = after.template_data;
	after.template_data.forEach((frame, i) => {
		const elements = settleList(frame.elements, ck);
		if (elements === frame.elements) return;
		if (template_data === after.template_data)
			template_data = after.template_data.slice();
		template_data[i] = { ...frame, elements };
	});
	const next =
		template_data === after.template_data ? after : { ...after, template_data };
	for (const frame of next.template_data) markSeen(frame.elements);
	return next;
}
