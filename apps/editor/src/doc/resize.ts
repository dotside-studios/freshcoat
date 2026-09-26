import { resizeTemplate as layOut, type Template } from "@freshcoat/coatfile";
import { type OpResult, ok, resizeTemplate } from "./ops";

/**
 * Changes the template's size and re-places every layer by its constraints,
 * by the rule compile uses for `resize`. Backgrounds with a size follow, and
 * every variant is carried: its moved layers and replaced backgrounds are
 * resized with it. The size is checked as the plain resize checks it.
 */
export function resizeWithConstraints(
	t: Template,
	width: number,
	height: number,
): OpResult {
	const checked = resizeTemplate(t, width, height);
	if (!checked.ok) return checked;
	return ok(layOut(t, width, height), []);
}
