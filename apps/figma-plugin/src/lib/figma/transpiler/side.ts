import { assetUri } from "@freshcoat-js/coatfile/assets";
import type { BindingResolver } from "../binding";
import type { FigmaContainerNode } from "../types";
import { dedupeFlattenMarkers } from "./coalesce";
import { figmaPaintToFill } from "./colors";
import {
	dropUnfilledSlots,
	finalizeMasks,
	uniquifyElementIdsDeep,
} from "./finalize";
import { rasterScaleFor } from "./raster-scale";
import {
	isEmptyRaster,
	type RenderImageFn,
	type RenderResult,
	rasterElementId,
	rasterizeMarkers,
} from "./rasterize";
import { createWalker, type ElementSink, fillSlot, walkSide } from "./walk";

export function backgroundFromFrame(
	frame: FigmaContainerNode,
	slotName: string,
	authorWidth: number,
	authorHeight: number,
) {
	const fills = (frame.fills ?? []).filter((f) => f.visible !== false);
	const id = frame.name || slotName;
	if (fills.length === 0) {
		return {
			id,
			type: "rect" as const,
			pos: { x: 0, y: 0 },
			size: { width: authorWidth, height: authorHeight },
			properties: { fill: "#ffffff" },
		};
	}
	const result = figmaPaintToFill(fills[0], {
		width: authorWidth,
		height: authorHeight,
	});
	if (result.kind === "solid") {
		return {
			id,
			type: "rect" as const,
			pos: { x: 0, y: 0 },
			size: { width: authorWidth, height: authorHeight },
			properties: { fill: result.hex },
		};
	}
	return {
		id,
		type: "rect" as const,
		pos: { x: 0, y: 0 },
		size: { width: authorWidth, height: authorHeight },
		properties: { fill: result.value },
	};
}

// Produces one slot side's background + native elements: walks frame.children
// (flattening groups, classifying native vs. flatten-to-raster vs. skip),
// rasterizes coalesced flatten/static-image markers, and uniquifies element
// ids GLOBALLY across the whole side (top-level and nested frame children —
// see uniquifyElementIdsDeep). Called once per base slot (with the real
// sink) and once per colorway instance side (with a throwaway sink) — an
// instance mirrors the base's child names/order, so the SAME walk produces
// the SAME id sequence, which is what lets the variant diff align
// elements by id.
export async function buildSideElements(
	frame: FigmaContainerNode,
	slotName: string,
	opts: {
		scale: number;
		fileKey: string;
		authorWidth: number;
		authorHeight: number;
		renderImage: RenderImageFn;
		sink: ElementSink;
		resolveBinding?: BindingResolver;
	},
): Promise<{
	background: ReturnType<typeof backgroundFromFrame>;
	elements: unknown[];
}> {
	const { scale, fileKey, authorWidth, authorHeight, renderImage, sink } = opts;
	const background = backgroundFromFrame(
		frame,
		slotName,
		authorWidth,
		authorHeight,
	);
	const w = createWalker(frame, slotName, scale, sink, opts.resolveBinding);
	const elements = walkSide(w);

	// The density every raster on this side is exported at. Sized in AUTHOR space
	// so a design drawn smaller than the canvas doesn't quietly hand the card a
	// low-resolution bitmap; the main thread pre-exports at the same scale.
	const renderScale = rasterScaleFor(scale);

	const markers = dedupeFlattenMarkers(w.flattenMarkers);
	if (markers.length > 0) {
		const rasterized = await rasterizeMarkers({
			fileKey,
			markers,
			scale: renderScale,
			renderImage,
		});
		// rasterizeMarkers answers one entry per marker, in order, so each bitmap
		// goes back into the slot its node reserved. A null entry leaves the slot
		// unfilled, and it is pruned below.
		markers.forEach((m, i) => {
			const el = rasterized.elements[i];
			if (el) m.entry.el = fillSlot(m.slot, el);
		});
		for (const a of rasterized.assets) sink.assets.push(a);
		for (const id of rasterized.skipped) {
			sink.warnings.push({
				severity: "warn",
				code: "raster_unavailable",
				message: `A flattened region (${id}) had no exported raster and was skipped.`,
				nodeId: id,
			});
		}
		for (const id of rasterized.empty) {
			sink.warnings.push({
				severity: "warn",
				code: "raster_empty",
				message: `A flattened region (${id}) exported with nothing in it and was skipped.`,
				nodeId: id,
			});
		}
	}

	for (const m of w.staticImageMarkers) {
		let res: RenderResult;
		try {
			res = await renderImage({
				fileKey,
				nodeIds: [m.nodeId],
				scale: renderScale,
				format: "png",
			});
		} catch {
			// No pre-exported raster for this static image — skip + warn rather
			// than crashing the whole export.
			sink.warnings.push({
				severity: "warn",
				code: "raster_unavailable",
				message: `A static image (${m.nodeId}) had no exported raster and was skipped.`,
				nodeId: m.nodeId,
			});
			continue;
		}
		if (isEmptyRaster(res)) {
			sink.warnings.push({
				severity: "warn",
				code: "raster_empty",
				message: `A static image (${m.nodeId}) exported with nothing in it and was skipped.`,
				nodeId: m.nodeId,
			});
			continue;
		}
		m.entry.el = fillSlot(m.slot, {
			id: rasterElementId("image", m.nodeId),
			type: "image",
			pos: m.pos,
			size: m.size,
			...(m.rotation !== 0 ? { rotation: m.rotation } : {}),
			properties: { src: assetUri(res.sha256), fit: "fill" },
		});
		sink.assets.push({
			sha256: res.sha256,
			blob: res.blob,
			contentType: "image/png",
		});
	}

	const finalElements = uniquifyElementIdsDeep(
		dropUnfilledSlots(finalizeMasks(elements)),
	);
	// Ids are settled and every placeholder is gone, so an element still held by
	// a trace entry is one that made it into the file under the name it now has.
	for (const entry of sink.trace) {
		if (entry.el && typeof entry.el.id === "string")
			entry.elementId = entry.el.id;
		entry.el = undefined;
	}

	return { background, elements: finalElements };
}
