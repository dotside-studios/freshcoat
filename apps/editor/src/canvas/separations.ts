import {
	type Element,
	type LayerSpot,
	resolveSlices,
	type Template,
} from "@freshcoat-js/coatfile";
import { createExternalStore } from "~/state/external-store";

// One choice for the session, like the bleed. Off until asked for.
const shown = createExternalStore(false);
const hidden = createExternalStore<ReadonlySet<string>>(new Set());

export function separationsShown(): boolean {
	return shown.get();
}

export function setSeparationsShown(on: boolean): void {
	shown.set(on);
}

/** View > Separations. */
export function toggleSeparations(): void {
	setSeparationsShown(!shown.get());
}

export function useSeparationsShown(): boolean {
	return shown.useStore();
}

/** Inks the legend has switched off in the overlay, by name. */
export function useHiddenInks(): ReadonlySet<string> {
	return hidden.useStore();
}

export function toggleInkHidden(name: string): void {
	hidden.set((prev) => {
		const next = new Set(prev);
		if (!next.delete(name)) next.add(name);
		return next;
	});
}

export function resetHiddenInks(): void {
	hidden.set(new Set());
}

/** A stable preview color for an ink name: the same name always gets the same
 *  hue, so a plate keeps its color across sides, templates and sessions. */
export function inkColor(name: string): string {
	let h = 2166136261;
	for (let i = 0; i < name.length; i++) {
		h ^= name.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return `oklch(0.68 0.19 ${(h >>> 0) % 360})`;
}

export type SeparationShape = {
	/** The layer's id. */
	id: string;
	ink: string;
	paint: keyof LayerSpot;
	/** The outline in trim coordinates. */
	path: string;
	fillRule: "nonzero" | "evenodd";
};

export type SeparationInk = {
	name: string;
	color: string;
	overprint: boolean;
};

export type Separations = {
	/** Inks in order of first use. */
	inks: SeparationInk[];
	shapes: SeparationShape[];
};

type Painted = Extract<Element, { type: "rect" | "vector" }>;

const isPainted = (el: Element): el is Painted =>
	el.type === "rect" || el.type === "vector";

export type CollectOptions = {
	frameName: string;
	values?: Record<string, unknown>;
	variantId?: string;
};

/**
 * The spot inks the shown layers of one side print, with the outline each
 * one paints. Layers hidden outright, by their conditions or by the variant
 * are left out, as an export leaves them out. A stroke ink counts only on a
 * layer that has a stroke.
 */
export function collectSeparations(
	template: Template,
	options: CollectOptions,
): Separations {
	// resolveSlices finds the outline of each top-level shape, so each spot
	// layer is given an empty slice for the lookup.
	const marked: Template = {
		...template,
		template_data: template.template_data.map((frame) =>
			frame.name !== options.frameName
				? frame
				: {
						...frame,
						elements: frame.elements.map((el) =>
							isPainted(el) && el.properties.spot
								? ({
										...el,
										properties: {
											...el.properties,
											slice: el.properties.slice ?? {},
										},
									} as Painted)
								: el,
						),
					},
		),
	};
	const byId = new Map<string, Element>(
		template.template_data
			.find((f) => f.name === options.frameName)
			?.elements.map((el) => [el.id, el]),
	);

	const inks = new Map<string, SeparationInk>();
	const shapes: SeparationShape[] = [];
	for (const outline of resolveSlices(marked, options)) {
		const el = byId.get(outline.id);
		const spot = el && isPainted(el) ? el.properties.spot : undefined;
		if (!el || !isPainted(el) || !spot) continue;
		for (const paint of ["fill", "stroke"] as const) {
			const ink = spot[paint];
			if (!ink || (paint === "stroke" && el.properties.stroke === undefined))
				continue;
			const known = inks.get(ink.spot);
			if (known) known.overprint ||= ink.overprint ?? false;
			else
				inks.set(ink.spot, {
					name: ink.spot,
					color: inkColor(ink.spot),
					overprint: ink.overprint ?? false,
				});
			shapes.push({
				id: el.id,
				ink: ink.spot,
				paint,
				path: outline.path,
				fillRule: outline.fillRule,
			});
		}
	}
	return { inks: [...inks.values()], shapes };
}
