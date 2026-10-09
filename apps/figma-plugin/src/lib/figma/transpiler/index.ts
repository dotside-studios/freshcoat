import {
	DEFAULT_VARIANT_ID,
	type TemplateWarning,
	type VariantElementDelta,
	variantIdFor,
} from "@freshcoat-js/coatfile";
import type { PendingAsset } from "@freshcoat-js/coatfile/assets";
import {
	buildFieldMeta,
	createBindingResolver,
	type FieldMeta,
	fieldMetaToSchema,
} from "../binding";
import type { FigmaContainerNode } from "../types";
import {
	type CanvasSize,
	exactSizeCheck,
	fromDesignSize,
	type SizeIssue,
	SizeMismatchError,
	sizesAgree,
} from "./exact-size";
import { collectFontDescriptors } from "./fonts";
import { combineGuides, readSlotGuides, type SlotGuides } from "./guides";
import { backgroundFromFrame, buildSideElements } from "./side";
import type {
	ColorwayInput,
	FigmaVariantPick,
	NodeTrace,
	ReportedDecision,
	SizeMode,
	TranspileInput,
	TranspileOutput,
} from "./types";
import {
	backgroundsDiffer,
	collectAssetRefsDeep,
	diffElementProperties,
	diffElementShell,
	fillOf,
	flattenElementsById,
	hiddenElements,
	traceElementsByNode,
} from "./variant-deltas";
import { alignInstanceVisibility } from "./variants";
import { makeThrowawaySink } from "./walk";

export type {
	ColorwayInput,
	FetchNodeTreeFn,
	FigmaPick,
	FigmaVariantPick,
	FrameSlot,
	NodeTrace,
	ProductRegistryEntry,
	ReportedDecision,
	SizeMode,
	TemplateMetadata,
	TranspileInput,
	TranspileOutput,
	TranspileReport,
} from "./types";

export async function transpile(
	input: TranspileInput,
): Promise<TranspileOutput> {
	const start = Date.now();
	const warnings: TemplateWarning[] = [];
	const counts = { native: 0, flattened: 0, skipped: 0 };
	const allAssets: PendingAsset[] = [];
	// Every decision the walk made, across all slots, in visit order.
	const trace: NodeTrace[] = [];
	const resolveBinding = createBindingResolver();
	// All field metadata is registered here from node bindings (text/image/qr/
	// color), keyed by field id; first-wins across slots (front before back).
	const overlayMeta = new Map<string, FieldMeta>();
	const visibilityFields = new Set<string>();
	// Author-edited field metadata read from the slot frame's pluginData;
	// highest precedence at assembly. First-wins across slots (front before back).
	const storedMeta = new Map<string, FieldMeta>();

	const templateData: Array<{
		name: string;
		background: unknown;
		elements: unknown[];
	}> = [];
	const baseSideFrames: Record<string, FigmaContainerNode> = {};
	const baseElementsBySlot: Record<string, unknown[]> = {};
	const slotScale: Record<string, number> = {};
	const slotFileKey: Record<string, string> = {};
	// The canvas every slot shares. Under "exact" the product defines it and the
	// gate below rejects any frame that doesn't measure it; under "from-design"
	// the first slot's own measurement defines it and later slots must match.
	// Either way all sides end up on one canvas and one orientation.
	const sizeMode: SizeMode = input.sizeMode ?? "exact";
	let authorWidth = input.product.width;
	let authorHeight = input.product.height;

	// Pass 1 — fetch every slot's tree and settle the canvas.
	//
	// Sizing is resolved for ALL slots before any expensive work runs, and every
	// off-canvas frame is collected rather than thrown on sight: an author with
	// two wrong frames should see both, not fix one and re-run to discover the
	// other. The fetched trees are cached for pass 2 so a slot is never read
	// twice (fetchNodeTree is a map lookup in the plugin, but a REST call in
	// principle).
	const trees = new Map<string, FigmaContainerNode>();
	const sizeIssues: SizeIssue[] = [];
	let canvas: CanvasSize | null = null;
	for (const slot of input.product.frames) {
		const pick = input.picks[slot.name];
		if (!pick) {
			warnings.push({
				severity: "error",
				code: "missing_pick",
				message: `slot '${slot.name}' has no Figma pick`,
				slot: slot.name,
			});
			continue;
		}
		const fetched = await input.fetchNodeTree(pick.fileKey, pick.nodeId);
		trees.set(slot.name, fetched);
		const fw = fetched.absoluteBoundingBox.width;
		const fh = fetched.absoluteBoundingBox.height;
		const issue = (expectedWidth: number, expectedHeight: number): void => {
			sizeIssues.push({
				slot: slot.name,
				nodeId: pick.nodeId,
				nodeName: pick.nodeName,
				width: Math.round(fw),
				height: Math.round(fh),
				expectedWidth,
				expectedHeight,
			});
		};

		let size: CanvasSize;
		if (sizeMode === "from-design") {
			size = fromDesignSize(fw, fh);
		} else {
			const checked = exactSizeCheck(fw, fh, input.product);
			if (!checked.ok) {
				issue(checked.suggestedWidth, checked.suggestedHeight);
				continue;
			}
			size = checked;
		}
		// The first slot that resolves sets the canvas; the rest must match it.
		// This subsumes orientation — a portrait side against a landscape canvas
		// reads as "638×1013, resize to 1013×638", which is what the author does
		// about it anyway.
		if (canvas === null) canvas = size;
		else if (!sizesAgree(size, canvas)) issue(canvas.width, canvas.height);
	}
	if (sizeIssues.length > 0) {
		throw new SizeMismatchError(
			sizeMode === "from-design" ? "size_mismatch" : "exact_size",
			sizeIssues,
		);
	}
	if (canvas !== null) {
		authorWidth = canvas.width;
		authorHeight = canvas.height;
	}

	// Pass 2 — produce each slot's elements on the settled canvas.
	const slotGuides: Array<{ slot: string; guides: SlotGuides }> = [];
	for (const slot of input.product.frames) {
		const pick = input.picks[slot.name];
		const frame = trees.get(slot.name);
		if (!pick || !frame) continue; // missing_pick already warned in pass 1
		// Author-edited field metadata lives on the assigned slot root.
		if (frame.fieldMeta) {
			for (const [id, m] of Object.entries(frame.fieldMeta)) {
				if (!storedMeta.has(id)) storedMeta.set(id, m as FieldMeta);
			}
		}
		const scale = authorWidth / frame.absoluteBoundingBox.width;
		baseSideFrames[slot.name] = frame;
		slotScale[slot.name] = scale;
		slotFileKey[slot.name] = pick.fileKey;
		slotGuides.push({
			slot: slot.name,
			guides: readSlotGuides(frame, slot.name, scale, warnings),
		});

		const { background, elements } = await buildSideElements(frame, slot.name, {
			scale,
			fileKey: pick.fileKey,
			authorWidth,
			authorHeight,
			renderImage: input.renderImage,
			resolveBinding,
			sink: {
				counts,
				warnings,
				overlayMeta,
				visibilityFields,
				assets: allAssets,
				trace,
			},
		});
		baseElementsBySlot[slot.name] = elements;

		templateData.push({ name: slot.name, background, elements });
	}
	const { bleed, safeArea } = combineGuides(
		slotGuides,
		{ width: authorWidth, height: authorHeight },
		warnings,
	);

	const variants: unknown[] = [];
	const variantPicks: Record<string, FigmaVariantPick> = {};

	// What every colorway diffs a side against, worked out once per side.
	const baseSlots = new Map<
		string,
		{
			background: ReturnType<typeof backgroundFromFrame>;
			elements: unknown[];
			byId: Map<string, Record<string, unknown>>;
			elementsByNode: Map<string, string[]>;
		}
	>();
	const baseSlotOf = (name: string) => {
		let base = baseSlots.get(name);
		if (!base) {
			const elements = baseElementsBySlot[name] ?? [];
			base = {
				background: backgroundFromFrame(
					baseSideFrames[name],
					name,
					authorWidth,
					authorHeight,
				),
				elements,
				byId: flattenElementsById(elements),
				elementsByNode: traceElementsByNode(trace, name),
			};
			baseSlots.set(name, base);
		}
		return base;
	};

	const primarySlotName = input.product.frames[0]?.name;
	const defaultSwatch = primarySlotName
		? fillOf(baseSlotOf(primarySlotName).background)
		: undefined;

	// Diffs a colorway instance's sides against the base BY ELEMENT ID (see
	// buildSideElements — an instance mirrors the base's child names/order, so
	// the same walk yields the same id sequence). Each side's element
	// production uses a throwaway sink so variant computation never touches
	// the real counts/warnings/field registration/pendingAssets.
	const buildVariantOverrides = async (
		colorway: ColorwayInput,
	): Promise<{
		overrides: Array<{
			name: string;
			background?: unknown;
			elements?: VariantElementDelta[];
		}>;
		swatch?: string;
		assets: PendingAsset[];
	}> => {
		const perSide = colorway.perSide;
		const overrides: Array<{
			name: string;
			background?: unknown;
			elements?: VariantElementDelta[];
		}> = [];
		let swatch = defaultSwatch;
		// A variant side still uses a throwaway sink for counts/warnings/field
		// registration (those belong to the base only), but its RASTERS are
		// real: when a variant repaints a flattened/static image (a recolored
		// icon strip, etc.) buildSideElements produces a fresh PNG with a new
		// sha256 and the diff emits `src: "asset:<newsha>"`. Those bytes must
		// ride along in the bundle or the override resolves to nothing at import
		// (unresolved_asset). Capture every raster produced here, then keep only
		// the ones an emitted override actually references.
		const producedAssets: PendingAsset[] = [];

		for (const slot of input.product.frames) {
			const frame = perSide[slot.name];
			if (!frame) continue;
			const scale =
				slotScale[slot.name] ?? authorWidth / frame.absoluteBoundingBox.width;
			const fileKey = slotFileKey[slot.name] ?? "";
			const baseFrame = baseSideFrames[slot.name];

			// Walk the instance with the base's visibility, so a layer it hides
			// still takes its place in the id sequence, and read what it hid.
			const aligned = baseFrame
				? alignInstanceVisibility(baseFrame, frame)
				: { frame, hiddenBaseNodes: new Set<string>(), unhidden: [] };
			for (const n of aligned.unhidden) {
				warnings.push({
					severity: "warn",
					code: "variant_unhide_unsupported",
					message: `Layer "${n.name}" is hidden on the card and shown in colorway "${colorway.label}". A colorway can hide a layer but not show one, so it stays hidden.`,
					nodeId: n.id,
					slot: slot.name,
				});
			}

			const sideSink = makeThrowawaySink();
			const { background: vBg, elements: vEls } = await buildSideElements(
				aligned.frame,
				slot.name,
				{
					scale,
					fileKey,
					authorWidth,
					authorHeight,
					renderImage: input.renderImage,
					sink: sideSink,
					resolveBinding,
				},
			);
			for (const a of sideSink.assets) producedAssets.push(a);

			if (slot.name === primarySlotName) swatch = fillOf(vBg) ?? swatch;

			const base = baseSlotOf(slot.name);
			const bgDiffers = backgroundsDiffer(vBg, base.background);

			const hidden = hiddenElements(
				base.elements,
				base.elementsByNode,
				aligned.hiddenBaseNodes,
			);
			const baseById = base.byId;
			const varById = flattenElementsById(vEls);
			// A hidden layer's own element can be missing from the instance's walk
			// (its raster was never exported), which is not a structural change.
			const baseIds = new Set(
				[...baseById.keys()].filter((id) => !hidden.within.has(id)),
			);
			const varIds = new Set(
				[...varById.keys()].filter((id) => !hidden.within.has(id)),
			);
			const sameStructure =
				baseIds.size === varIds.size &&
				[...baseIds].every((id) => varIds.has(id));
			if (!sameStructure) {
				warnings.push({
					severity: "warn",
					code: "variant_structure_mismatch",
					message: `colorway side "${slot.name}" has a different element structure than the base (elements added or removed) — only the elements present on both sides were diffed.`,
					slot: slot.name,
				});
			}

			const elementDeltas: VariantElementDelta[] = [];
			for (const [id, baseEl] of baseById) {
				if (hidden.top.has(id)) {
					elementDeltas.push({ id, properties: {}, hidden: true });
					continue;
				}
				if (hidden.within.has(id)) continue;
				const varEl = varById.get(id);
				if (!varEl) continue;
				const properties = diffElementProperties(baseEl, varEl);
				const shell = diffElementShell(baseEl, varEl);
				if (
					Object.keys(properties).length > 0 ||
					Object.keys(shell).length > 0
				) {
					elementDeltas.push({ id, properties, ...shell });
				}
			}

			if (bgDiffers || elementDeltas.length > 0) {
				overrides.push({
					name: slot.name,
					...(bgDiffers ? { background: vBg } : {}),
					...(elementDeltas.length > 0 ? { elements: elementDeltas } : {}),
				});
			}
		}

		// Only assets an emitted override actually points at need embedding.
		// Rasters whose bytes matched the base (same sha256, no delta emitted)
		// are already carried by the base and would just be de-duped anyway.
		const referenced = new Set<string>();
		for (const ov of overrides) collectAssetRefsDeep(ov, referenced);
		const assets = producedAssets.filter((a) => referenced.has(a.sha256));

		return { overrides, swatch, assets };
	};

	const colorways = input.variants ?? [];
	if (colorways.length > 0) {
		// The base card itself, so a picker has something to switch back to. It is
		// not a colorway instance, so it gets no variantPicks entry.
		variants.push({
			id: DEFAULT_VARIANT_ID,
			label: "Default",
			...(defaultSwatch ? { swatch: defaultSwatch } : {}),
			overrides: [],
		});
		const takenIds = new Set<string>();
		for (const cw of colorways) {
			const { overrides, swatch, assets } = await buildVariantOverrides(cw);
			// Embed the recolored rasters this variant introduced; assembleBundle
			// de-dupes by sha256, so any that coincide with base rasters collapse.
			for (const a of assets) allAssets.push(a);
			const id = variantIdFor(cw.label, takenIds);
			takenIds.add(id);
			variants.push({
				id,
				label: cw.label,
				...(swatch ? { swatch } : {}),
				overrides,
			});
			variantPicks[id] = { instanceId: cw.instanceId, label: cw.label };
		}
	}

	// Only the layers that did NOT come through as authored ride along in the
	// template: a native element is its own evidence, but a bitmap where a vector
	// was drawn needs to say why, long after the export.
	const decisions: ReportedDecision[] = trace
		.filter((t) => t.decision === "flatten" || t.decision === "skip")
		.map(({ slot: _slot, ...rest }) => rest);

	const fonts = collectFontDescriptors(templateData);

	// A field only an `if:` layer names is a toggle. One a layer also renders
	// keeps that layer's format, and its `if:` layers hide while it is blank.
	for (const id of visibilityFields) {
		if (!overlayMeta.has(id))
			overlayMeta.set(id, buildFieldMeta({ id, format: "boolean" }));
	}

	// Field schema is built from the registered binding metadata, in first-
	// registration (walk) order. Author-edited stored metadata wins over inferred.
	const properties: Record<string, unknown> = {};
	const required: string[] = [];
	for (const [id, inferred] of overlayMeta) {
		const stored = storedMeta.get(id);
		// The widget follows the element the field drives (a barcode's value is
		// entered as one), which stored metadata written before it may lack.
		const meta =
			stored && !stored.widget && inferred.widget && stored.format === "text"
				? { ...stored, widget: inferred.widget }
				: (stored ?? inferred);
		properties[id] = fieldMetaToSchema(meta);
		if (meta.required) required.push(id);
	}
	const fields = { type: "object" as const, properties, required };

	const template = {
		format_version: input.metadata.formatVersion,
		version: input.metadata.version,
		id: input.metadata.id,
		name: input.metadata.name,
		...(input.metadata.description !== undefined
			? { description: input.metadata.description }
			: {}),
		...(input.metadata.mood !== undefined ? { mood: input.metadata.mood } : {}),
		...(input.metadata.author !== undefined
			? { author: input.metadata.author }
			: {}),
		product: input.product.sku,
		width: authorWidth,
		height: authorHeight,
		...(bleed !== undefined ? { bleed } : {}),
		...(safeArea !== undefined ? { safeArea } : {}),
		fields,
		...(fonts.length > 0 ? { fonts } : {}),
		template_data: templateData,
		...(variants.length > 0 ? { variants } : {}),
	};

	return {
		template,
		pendingAssets: allAssets,
		fieldsInferred: Array.from(overlayMeta.entries()).map(([id, m]) => ({
			id,
			field: fieldMetaToSchema(m),
		})),
		warnings,
		variantPicks,
		report: {
			counts,
			durationMs: Date.now() - start,
			...(decisions.length > 0 ? { decisions } : {}),
		},
		trace,
	};
}
