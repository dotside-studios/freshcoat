import { classify } from "~/lib/figma/transpiler/classify";
import { isWholeMustacheToken } from "~/lib/figma/transpiler/fields";
import type { FigmaContainerNode, FigmaNode } from "~/lib/figma/types";
import { isContainerNode } from "~/lib/figma/types";

export function collectRasterTargets(frame: FigmaContainerNode): string[] {
	const ids: string[] = [];
	const walk = (n: FigmaNode) => {
		const c = classify(n);
		if (c.kind === "skip") return;
		if (c.kind === "flatten") {
			ids.push(n.id);
			return;
		}
		if (c.kind === "native-image") {
			// Static image fills are rasterized; dynamic {{token}} images are not.
			if (!isWholeMustacheToken(n.name).ok) ids.push(n.id);
			return;
		}
		if (
			(c.kind === "container" || c.kind === "native-frame") &&
			isContainerNode(n)
		) {
			for (const child of n.children) walk(child);
		}
	};
	for (const child of frame.children ?? []) walk(child);
	return ids;
}
