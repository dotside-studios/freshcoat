import type { Template } from "@freshcoat-js/coatfile";
import { hasFills } from "@freshcoat-js/coatfile/fills";
import { useMemo, useRef } from "react";
import { useController } from "~/app/context";
import { isBooleanShape } from "~/doc/boolean";
import { ok, resetOverride } from "~/doc/ops";
import { getElement, isBackgroundPath, keyOf, parseKey } from "~/doc/path";
import { activeVariantId, overriddenKeys } from "~/doc/variant-edit";
import { useEditor } from "~/state/hooks";
import { working } from "~/state/store";
import { AdjustSection } from "./AdjustSection";
import { AlignSection } from "./AlignSection";
import { BarcodeSection } from "./BarcodeSection";
import { BooleanSection } from "./BooleanSection";
import { ConstraintsSection, takesConstraints } from "./ConstraintsSection";
import { type Overrides, OverridesContext } from "./controls";
import { EffectsSection } from "./EffectsSection";
import { FillSection } from "./FillSection";
import { FrameSection } from "./FrameSection";
import {
	documentSwatches,
	type Inspect,
	type Layer,
	mergeKeyOf,
	patchLayers,
} from "./field-helpers";
import { ImageSection } from "./ImageSection";
import {
	InspectorCollapsedProvider,
	useInspectorCollapsed,
} from "./InspectorSection";
import { LayerSection } from "./LayerSection";
import { MaskSection } from "./MaskSection";
import { QrSection } from "./QrSection";
import { SideSection } from "./SideSection";
import { StrokeSection } from "./StrokeSection";
import { TextSection } from "./TextSection";
import { VectorSection } from "./VectorSection";
import { VisibilitySection } from "./VisibilitySection";

const STROKED = new Set(["rect", "vector", "frame", "image"]);

/** Keeps the previous array while its entries are the same objects, so the
 *  sections see a stable list across unrelated document changes. */
function useStableList<T>(next: T[]): T[] {
	const prev = useRef(next);
	const same =
		prev.current.length === next.length &&
		prev.current.every((v, i) => v === next[i]);
	if (!same) prev.current = next;
	return prev.current;
}

export function DesignPanel() {
	const controller = useController();
	const template = useEditor(working);
	const selection = useEditor((s) => s.selection);
	const side = useEditor((s) => s.side);
	// A drag changes the document every frame. Only the geometry sections
	// follow it live; the rest hold the state the drag started from.
	const inTx = useEditor((s) => s.doc?.history.tx !== undefined);
	const frozen = useRef<Inspect | null>(null);

	const picked = template
		? selection.filter((k) => {
				const p = parseKey(k);
				return p && !isBackgroundPath(p) && getElement(template, p);
			})
		: [];
	const background = picked.length === 0;
	const keys = useStableList(
		background ? [keyOf({ side, background: true })] : picked,
	);
	const layers = useStableList(
		template
			? keys.map((k) => getElement(template, k)).filter((l): l is Layer => !!l)
			: [],
	);
	// Swatches follow the drawing, not metadata edits.
	const drawing = template?.template_data;
	const lastSwatches = useRef<string[]>([]);
	const swatches = useStableList(
		useMemo(() => {
			if (inTx || !drawing) return lastSwatches.current;
			lastSwatches.current = documentSwatches(drawing);
			return lastSwatches.current;
		}, [drawing, inTx]),
	);

	const live = useMemo<Inspect | null>(() => {
		if (!template || layers.length === 0) return null;
		const set: Inspect["set"] = (field, fn) =>
			controller.edit((t) => patchLayers(t, keys, fn, getElement), {
				mergeKey: mergeKeyOf(field, keys),
			});
		return {
			controller,
			template,
			side,
			keys,
			layers,
			swatches,
			set,
			setShared: (field, fn) =>
				controller.edit((t) => patchLayers(t, keys, fn, getElement), {
					mergeKey: mergeKeyOf(field, keys),
					scope: "base",
				}),
			setProps: (field, fn) =>
				set(field, (el, key) => {
					const props = fn(el, key);
					return props ? { properties: props } : null;
				}),
		};
	}, [controller, template, side, keys, layers, swatches]);
	// They also hold through edits that only move or resize the selection,
	// like a scrub.
	const held = frozen.current;
	const hold =
		held !== null &&
		held.keys === keys &&
		(inTx ||
			(live !== null &&
				held.side === live.side &&
				held.swatches === live.swatches &&
				onlyMoved(held.template, live.template, keys)));
	const ins = hold ? held : live;
	frozen.current = ins;

	const body = useMemo(() => (ins ? sections(ins) : null), [ins]);
	const overrides = useOverrides(template, keys);
	const collapsed = useInspectorCollapsed();

	if (!template) return null;
	if (!ins)
		return <p className="p-3 text-fc-muted text-fc-sm">Nothing selected</p>;
	return (
		<InspectorCollapsedProvider value={collapsed}>
			<OverridesContext.Provider value={overrides}>
				{body}
			</OverridesContext.Provider>
		</InspectorCollapsedProvider>
	);
}

const MOVES = new Set(["pos", "size", "rotation"]);

/** Whether `b` differs from `a` only in where the layers at `keys` sit. */
function onlyMoved(a: Template, b: Template, keys: readonly string[]): boolean {
	const from = keys.map((k) => getElement(a, k));
	const to = keys.map((k) => getElement(b, k));
	const same = (x: unknown, y: unknown): boolean => {
		if (x === y) return true;
		if (typeof x !== "object" || typeof y !== "object" || !x || !y)
			return false;
		if (Array.isArray(x) !== Array.isArray(y)) return false;
		const i = from.indexOf(x as Layer);
		const layer = i !== -1 && to[i] === y;
		const xs = x as Record<string, unknown>;
		const ys = y as Record<string, unknown>;
		const names = new Set([...Object.keys(xs), ...Object.keys(ys)]);
		for (const n of names) {
			if (layer && MOVES.has(n)) continue;
			if (layer ? xs[n] !== ys[n] : !same(xs[n], ys[n])) return false;
		}
		return true;
	};
	return same(a, b);
}

/** What the active variant changes on the selected layers, for the markers
 *  and their resets. */
function useOverrides(
	template: Template | null,
	keys: readonly string[],
): Overrides | null {
	const controller = useController();
	const variantId = useEditor((s) => s.variantId);
	return useMemo(() => {
		if (!template) return null;
		const id = activeVariantId(template, variantId);
		const variant = template.variants?.find((v) => v.id === id);
		if (!variant) return null;
		const targets = keys.flatMap((key) => {
			const p = parseKey(key);
			const side = p ? template.template_data[p.side]?.name : undefined;
			if (!p || side === undefined) return [];
			const elementId = isBackgroundPath(p)
				? undefined
				: getElement(template, key)?.id;
			if (!isBackgroundPath(p) && elementId === undefined) return [];
			const changed = new Set(
				overriddenKeys(template, variant.id, side, elementId),
			);
			return [{ side, elementId, changed }];
		});
		return {
			label: variant.label,
			changed: (names) =>
				targets.some((t) =>
					t.elementId === undefined
						? t.changed.size > 0
						: names.some((k) => t.changed.has(k)),
				),
			reset: (names) => {
				controller.edit(
					(base) => {
						let next = base;
						for (const t of targets) {
							const r = resetOverride(
								next,
								variant.id,
								t.side,
								t.elementId,
								t.elementId === undefined ? ["background"] : [...names],
							);
							if (!r.ok) return r;
							next = r.template;
						}
						return ok(next, []);
					},
					{ scope: "base" },
				);
			},
		};
	}, [controller, template, variantId, keys]);
}

function sections(ins: Inspect) {
	const { layers } = ins;
	const background = ins.keys[0]?.endsWith("/bg") ?? false;
	if (background) {
		const bg = layers[0] as Layer;
		return (
			<div data-testid="design-inspector" data-mode="side">
				<SideSection ins={ins} />
				{bg.type === "rect" ? (
					<FillSection ins={ins} title="Background" />
				) : (
					<ImageSection ins={ins} background />
				)}
				<AdjustSection ins={ins} />
			</div>
		);
	}

	const types = new Set(layers.map((l) => l.type));
	const every = (ok: (type: string) => boolean) => [...types].every(ok);

	return (
		<div data-testid="design-inspector" data-mode="layers">
			<AlignSection ins={ins} />
			{layers.length > 1 && layers.every(isBooleanShape) && (
				<BooleanSection ins={ins} />
			)}
			<LayerSection ins={ins} />
			{every((t) => t === "text") && <TextSection ins={ins} />}
			{every((t) => t === "image") && <ImageSection ins={ins} />}
			{every((t) => t === "qr_code") && <QrSection ins={ins} />}
			{every((t) => t === "barcode") && <BarcodeSection ins={ins} />}
			{every((t) => t === "vector") && <VectorSection ins={ins} />}
			{every((t) => t === "frame") && <FrameSection ins={ins} />}
			{every((t) => t === "mask") && <MaskSection ins={ins} />}
			{layers.every(hasFills) && <FillSection ins={ins} />}
			{every((t) => STROKED.has(t)) && <StrokeSection ins={ins} />}
			<EffectsSection ins={ins} />
			{takesConstraints(ins) && <ConstraintsSection ins={ins} />}
			<AdjustSection ins={ins} />
			<VisibilitySection ins={ins} />
		</div>
	);
}
