import type { Constraint, Constraints } from "@freshcoat-js/coatfile";
import type {
	FigmaConstraints,
	FigmaConstraintType,
	FigmaContainerNode,
} from "../types";

const CONSTRAINT: Record<FigmaConstraintType, Constraint> = {
	MIN: "start",
	MAX: "end",
	CENTER: "center",
	STRETCH: "stretch",
	SCALE: "scale",
};

/** The coatfile constraint for one Figma constraint axis. */
export function mapConstraint(c: FigmaConstraintType): Constraint {
	return CONSTRAINT[c];
}

/** An element's `constraints` for a node's Figma constraints, or undefined when
 *  there is nothing to write. `start` is coatfile's default on either axis, so
 *  an axis pinned to the left or top is left out, and a node pinned to both is
 *  written with none. */
export function elementConstraints(
	source: FigmaConstraints | undefined,
): Constraints | undefined {
	if (!source) return undefined;
	const horizontal = mapConstraint(source.horizontal);
	const vertical = mapConstraint(source.vertical);
	const out: Constraints = {
		...(horizontal !== "start" ? { horizontal } : {}),
		...(vertical !== "start" ? { vertical } : {}),
	};
	return Object.keys(out).length > 0 ? out : undefined;
}

/** The constraints a group's contents follow as one unit: its own where the
 *  scene carries them, else the ones every child agrees on. The Plugin API
 *  gives a group none, and Figma's editor sets a group's constraints by setting
 *  all of its children's, so children that agree are the group's setting. */
export function groupConstraints(
	group: FigmaContainerNode,
): FigmaConstraints | undefined {
	if (group.constraints) return group.constraints;
	const children = group.children.filter((c) => c.visible !== false);
	const first = children[0]?.constraints;
	if (!first) return undefined;
	const agree = children.every(
		(c) =>
			c.constraints?.horizontal === first.horizontal &&
			c.constraints?.vertical === first.vertical,
	);
	return agree ? first : undefined;
}
