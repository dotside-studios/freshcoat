import type { Insets, Sides, TemplateWarning } from "@freshcoat-js/coatfile";
import { hasInsets } from "@freshcoat-js/coatfile/bleed";
import type { FigmaContainerNode, FigmaNode } from "../types";
import { roundHalfPx } from "./coordinates";

export type GuideKind = "bleed" | "safe-area";

const GUIDE_NAME = /^\s*guide:\s*(bleed|safe-area)\s*$/i;

export function guideKind(name: string): GuideKind | undefined {
	const m = GUIDE_NAME.exec(name);
	return m ? (m[1].toLowerCase() as GuideKind) : undefined;
}

export function withoutGuides(children: FigmaNode[]): FigmaNode[] {
	return children.filter((c) => guideKind(c.name) === undefined);
}

export type SlotGuides = { bleed?: Sides; safeArea?: Sides };

function sidesEqual(a: Sides, b: Sides): boolean {
	return (
		a.top === b.top &&
		a.right === b.right &&
		a.bottom === b.bottom &&
		a.left === b.left
	);
}

export function readSlotGuides(
	frame: FigmaContainerNode,
	slot: string,
	scale: number,
	warnings: TemplateWarning[],
): SlotGuides {
	const trim = frame.absoluteBoundingBox;
	const out: SlotGuides = {};
	for (const child of frame.children ?? []) {
		const kind = guideKind(child.name);
		if (!kind) continue;
		const key = kind === "bleed" ? "bleed" : "safeArea";
		if (out[key]) {
			warnings.push({
				severity: "warn",
				code: "guide_duplicate",
				message: `Slot "${slot}" has more than one "guide:${kind}" layer. The first one is used.`,
				nodeId: child.id,
				slot,
			});
			continue;
		}
		const box = child.absoluteBoundingBox;
		const d = (n: number) => Math.max(0, roundHalfPx(n * scale));
		const sides: Sides =
			kind === "bleed"
				? {
						top: d(trim.y - box.y),
						right: d(box.x + box.width - (trim.x + trim.width)),
						bottom: d(box.y + box.height - (trim.y + trim.height)),
						left: d(trim.x - box.x),
					}
				: {
						top: d(box.y - trim.y),
						right: d(trim.x + trim.width - (box.x + box.width)),
						bottom: d(trim.y + trim.height - (box.y + box.height)),
						left: d(box.x - trim.x),
					};
		if (!hasInsets(sides)) {
			warnings.push({
				severity: "warn",
				code: "guide_empty",
				message:
					kind === "bleed"
						? `"guide:bleed" on slot "${slot}" does not reach past the frame, so the template has no bleed from it. Make it larger than the frame by the bleed on each side.`
						: `"guide:safe-area" on slot "${slot}" does not sit inside the frame, so the template has no safe area from it. Inset it from the frame by the margin on each side.`,
				nodeId: child.id,
				slot,
			});
			continue;
		}
		out[key] = sides;
	}
	return out;
}

export function toInsets(s: Sides): Insets {
	return s.top === s.right && s.top === s.bottom && s.top === s.left
		? s.top
		: { ...s };
}

// Slots that disagree take the larger inset on each side: extra bleed is
// always printable, and a larger safe area is the cautious guide.
export function combineGuides(
	slots: Array<{ slot: string; guides: SlotGuides }>,
	canvas: { width: number; height: number },
	warnings: TemplateWarning[],
): { bleed?: Insets; safeArea?: Insets } {
	const combine = (
		key: keyof SlotGuides,
		kind: GuideKind,
	): Sides | undefined => {
		const found = slots.filter((s) => s.guides[key] !== undefined);
		if (found.length === 0) return undefined;
		const all = found.map((s) => s.guides[key] as Sides);
		const merged: Sides = {
			top: Math.max(...all.map((s) => s.top)),
			right: Math.max(...all.map((s) => s.right)),
			bottom: Math.max(...all.map((s) => s.bottom)),
			left: Math.max(...all.map((s) => s.left)),
		};
		const differs =
			found.length < slots.length || all.some((s) => !sidesEqual(s, merged));
		if (differs && slots.length > 1) {
			warnings.push({
				severity: "warn",
				code: "guide_mismatch",
				message: `The "guide:${kind}" layers differ between slots (${slots.map((s) => s.slot).join(", ")}). The template uses the largest on each side.`,
			});
		}
		return merged;
	};

	const bleed = combine("bleed", "bleed");
	let safeArea = combine("safeArea", "safe-area");
	if (
		safeArea &&
		(safeArea.left + safeArea.right >= canvas.width ||
			safeArea.top + safeArea.bottom >= canvas.height)
	) {
		warnings.push({
			severity: "warn",
			code: "guide_safe_area_exceeds_trim",
			message: `"guide:safe-area" leaves no room inside the ${canvas.width}×${canvas.height} canvas, so the template has no safe area.`,
		});
		safeArea = undefined;
	}
	return {
		...(bleed ? { bleed: toInsets(bleed) } : {}),
		...(safeArea ? { safeArea: toInsets(safeArea) } : {}),
	};
}
