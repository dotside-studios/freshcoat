import type { FigmaContainerNode, FigmaNode } from "../types";
import { isContainerNode } from "../types";

// A boolean operation is no container, but its children are layers to pair
// like a frame's: hiding one changes the operands.
function childrenOf(n: FigmaNode): FigmaNode[] | undefined {
	if (isContainerNode(n)) return n.children;
	return n.type === "BOOLEAN_OPERATION" ? n.children : undefined;
}

// Colorway variants are authored as INSTANCEs of the card COMPONENT, named
// `<Card> / <Label>`. The label after the separator identifies the colorway,
// and the transpiler emits it as a variant: the instance's sides diffed
// against the base's. Instances inherit their size from the base, so a
// colorway cannot drift off the canvas.

const SEP = " / ";

export function colorwayLabel(
	instanceName: string,
	cardName: string,
): string | null {
	const prefix = cardName + SEP;
	if (!instanceName.startsWith(prefix)) return null;
	const label = instanceName.slice(prefix.length).trim();
	return label.length > 0 ? label : null;
}

// Whether a layer paints anything. The walk skips one that doesn't, so the
// same test decides which layers a side's elements come from.
function renders(n: FigmaNode): boolean {
	return n.visible !== false && n.opacity !== 0;
}

export type AlignedInstance = {
	/** The instance side, with every layer whose visibility differs from the
	 *  base's set back to the base's, so both walks visit the same layers and
	 *  produce the same element ids. */
	frame: FigmaContainerNode;
	/** Base node ids (with every descendant) the instance hides. */
	hiddenBaseNodes: Set<string>;
	/** Instance layers the base hides and the instance shows. */
	unhidden: FigmaNode[];
};

// Pairs a colorway instance's side with the base side it was made from, layer
// for layer. An instance keeps its main component's children in order, so a
// pair is the same index with the same name; anything else is left unpaired
// and walks as it is.
export function alignInstanceVisibility(
	base: FigmaContainerNode,
	instance: FigmaContainerNode,
): AlignedInstance {
	const hiddenBaseNodes = new Set<string>();
	const unhidden: FigmaNode[] = [];

	const markSubtree = (n: FigmaNode): void => {
		hiddenBaseNodes.add(n.id);
		for (const c of childrenOf(n) ?? []) markSubtree(c);
	};

	const alignChildren = (
		baseChildren: FigmaNode[],
		children: FigmaNode[],
	): FigmaNode[] =>
		children.map((child, i) => {
			const pair = baseChildren[i];
			return pair && pair.name === child.name ? align(pair, child) : child;
		});

	const align = (b: FigmaNode, n: FigmaNode): FigmaNode => {
		if (renders(b) && !renders(n)) {
			markSubtree(b);
			const shown = {
				...n,
				visible: true,
				opacity: n.opacity === 0 ? b.opacity : n.opacity,
			} as FigmaNode;
			return withAlignedChildren(b, shown);
		}
		if (!renders(b) && renders(n)) {
			unhidden.push(n);
			return { ...n, visible: false } as FigmaNode;
		}
		return withAlignedChildren(b, n);
	};

	const withAlignedChildren = (b: FigmaNode, n: FigmaNode): FigmaNode => {
		const baseChildren = childrenOf(b);
		const children = childrenOf(n);
		return baseChildren && children
			? ({ ...n, children: alignChildren(baseChildren, children) } as FigmaNode)
			: n;
	};

	return {
		frame: {
			...instance,
			children: alignChildren(base.children ?? [], instance.children ?? []),
		},
		hiddenBaseNodes,
		unhidden,
	};
}
