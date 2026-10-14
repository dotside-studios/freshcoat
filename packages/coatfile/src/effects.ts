import type { Effect, ElementShell } from "./types";

/** The effects an element carries, from `effects` or from the legacy `shadow`,
 *  `blur` and `backdropBlur` fields it stands in for. */
export function effectsOf(
	el: Pick<ElementShell, "effects" | "shadow" | "blur" | "backdropBlur">,
): Effect[] {
	if (el.effects) return el.effects;
	const out: Effect[] = [];
	const shadows = el.shadow === undefined ? [] : [el.shadow].flat();
	for (const s of shadows) out.push({ type: "shadow", ...s });
	if (typeof el.blur === "number") out.push({ type: "blur", radius: el.blur });
	if (typeof el.backdropBlur === "number")
		out.push({ type: "backdropBlur", radius: el.backdropBlur });
	return out;
}
