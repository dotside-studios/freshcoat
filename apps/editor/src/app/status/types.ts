import type { ComponentType } from "react";
import type { EditorState } from "~/state/store";
import type { Section } from "~/state/workspace";

/** One entry in the status bar, contributed by the folder whose state it reads. */
export type StatusItem = {
	id: string;
	/** shown in the bar's context menu, to hide and show the item */
	name: string;
	sections: readonly Section[] | "all";
	align: "start" | "end";
	/** higher sits closer to its edge, and is the last to go when narrow */
	priority: number;
	/** cheap store check; the item is not mounted while false */
	when?: (s: EditorState) => boolean;
	component: ComponentType;
};
