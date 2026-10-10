// Live boolean operations. A vector with `boolean` keeps its operands, and `d`
// is only the last result. Where a path op is available, the result is
// rebuilt from the operands that are shown, after visibility, variants and
// relayout have changed them.

import {
	type BooleanOp,
	type BooleanOperand,
	type BooleanShape,
	combineShapes,
	type Renderer,
} from "@freshcoat-js/engine";
import type { BooleanOperandElement, Element } from "./types";

type CanvasKit = Renderer["ck"];

/** Combines operands, bottom-most first, into path data in the operands' own
 *  space. Null when nothing is left. */
export type PathOp = (
	op: BooleanOp,
	operands: BooleanOperand[],
) => BooleanShape | null;

const CACHE_MAX = 512;
const NO_SHAPE = Symbol("no shape");

/** `pathOp` that remembers its results by operation and operand geometry. */
export function cachePathOp(pathOp: PathOp, max = CACHE_MAX): PathOp {
	const results = new Map<string, BooleanShape | typeof NO_SHAPE>();
	return (op, operands) => {
		const key = JSON.stringify([op, operands]);
		let hit = results.get(key);
		if (hit === undefined) {
			hit = pathOp(op, operands) ?? NO_SHAPE;
			if (results.size >= max)
				results.delete(results.keys().next().value as string);
			results.set(key, hit);
		}
		return hit === NO_SHAPE ? null : hit;
	};
}

const byCanvasKit = new WeakMap<CanvasKit, PathOp>();

/** The `pathOp` for a CanvasKit. One is kept per CanvasKit, so results are
 *  shared by every render that uses it. */
export function canvasKitPathOp(ck: CanvasKit): PathOp {
	let pathOp = byCanvasKit.get(ck);
	if (!pathOp) {
		pathOp = cachePathOp((op, operands) =>
			combineShapes(ck, operands, op, { x: 0, y: 0 }),
		);
		byCanvasKit.set(ck, pathOp);
	}
	return pathOp;
}

function operandOf(el: BooleanOperandElement): BooleanOperand {
	const placed = {
		...(el.pos ? { pos: el.pos } : {}),
		...(el.size ? { size: el.size } : {}),
		...(el.rotation !== undefined ? { rotation: el.rotation } : {}),
	};
	if (el.type === "rect")
		return {
			...placed,
			kind: "rect",
			...(el.properties.cornerRadius !== undefined
				? { cornerRadius: el.properties.cornerRadius }
				: {}),
		};
	return {
		...placed,
		kind: "path",
		d: el.properties.d,
		...(el.properties.cornerRadius !== undefined
			? { cornerRadius: el.properties.cornerRadius }
			: {}),
		...(el.properties.fillRule !== undefined
			? { fillRule: el.properties.fillRule }
			: {}),
	};
}

// A vector with `boolean` after its path is rebuilt: its operands' own
// operations first, so a nested result is what its parent combines. An
// operand that ends up empty drops out.
function rebuilt(
	el: Extract<Element, { type: "vector" }>,
	pathOp: PathOp,
): Extract<Element, { type: "vector" }> {
	const operation = el.properties.boolean;
	if (!operation) return el;
	const operands: BooleanOperand[] = [];
	for (const operand of operation.operands) {
		const resolved =
			operand.type === "vector" ? rebuilt(operand, pathOp) : operand;
		if (resolved.type === "vector" && resolved.properties.d === "") continue;
		operands.push(operandOf(resolved));
	}
	const { fillRule: _fillRule, ...rest } = el.properties;
	const shape = operands.length ? pathOp(operation.op, operands) : null;
	return {
		...el,
		properties: {
			...rest,
			d: shape?.d ?? "",
			...(shape?.fillRule ? { fillRule: shape.fillRule } : {}),
		},
	};
}

/** `elements` with every vector's boolean operation recomputed by `pathOp`.
 *  A vector whose operation leaves nothing keeps its box and draws nothing. */
export function applyBooleans(elements: Element[], pathOp: PathOp): Element[] {
	return elements.map((el) => {
		if (el.type === "vector") return rebuilt(el, pathOp);
		if (el.type === "frame")
			return {
				...el,
				properties: {
					...el.properties,
					children: applyBooleans(el.properties.children, pathOp),
				},
			};
		if (el.type === "mask")
			return {
				...el,
				properties: {
					...el.properties,
					mask: applyBooleans([el.properties.mask], pathOp)[0] as Element,
					children: applyBooleans(el.properties.children, pathOp),
				},
			};
		return el;
	});
}
