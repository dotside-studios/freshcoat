import type { TemplateWarning } from "@freshcoat-js/coatfile";
import type { PendingAsset } from "@freshcoat-js/coatfile/assets";
import type { FigmaContainerNode } from "../types";
import type { Classification, FlattenReason } from "./classify";
import type { RenderImageFn } from "./rasterize";

export type FrameSlot = { name: string; label: string; required: true };
export type ProductRegistryEntry = {
	sku: string;
	displayName: string;
	/** Exact print size in pixels (CR80 at ~300 DPI = 1013×638). Under
	 *  sizeMode "exact" frames must measure exactly this (either orientation)
	 *  and template dims are emitted as these ints; under "from-design" it is
	 *  only a seed — the design's own measurement wins. */
	width: number;
	height: number;
	frames: FrameSlot[];
};

/** How the template's canvas is decided.
 *  - "exact": the product declares the print size and every slot frame must
 *    measure it. Card fulfillment prints at the template's native pixels, so
 *    the emitted dims have to be the product's.
 *  - "from-design": no product is pinning a size, so the first slot's own
 *    measurement becomes the canvas and the remaining slots must agree with
 *    it. Backs the plugin's custom export (certificates, posters, anything
 *    rendered through coatfile outside the Davi order pipeline). */
export type SizeMode = "exact" | "from-design";

/** The figma node one frame was read from. */
export type FigmaPick = {
	fileKey: string;
	nodeId: string;
	nodeName: string;
	width: number;
	height: number;
};

export type TemplateMetadata = {
	id: string;
	name: string;
	version: string;
	formatVersion: string;
	description?: string;
	mood?: string;
	author?: { name: string; url?: string };
};

/** What the walk decided about one Figma node, and what it produced. The counts
 *  say how many layers flattened; this says WHICH ones and WHY — the question an
 *  author (or anyone reading a template back) actually has when a shape arrives
 *  as a bitmap. */
export type NodeTrace = {
	slot: string;
	nodeId: string;
	name: string;
	nodeType: string;
	decision: Classification["kind"];
	reason?: FlattenReason;
	/** The element this node produced. Absent when it produced none: a skipped
	 *  layer, a pass-through group, or a raster whose bytes never arrived. Read
	 *  AFTER ids are uniquified, so it matches the emitted template. */
	elementId?: string;
};

/** One line of the same, kept in the template itself for the nodes that did not
 *  come through as authored. Small enough to ride along on every export. */
export type ReportedDecision = Omit<NodeTrace, "slot">;

/** How much of the design survived as native elements vs. had to be flattened
 *  to a raster. The headline number an author judges an import by. */
export type TranspileReport = {
	counts: { native: number; flattened: number; skipped: number };
	durationMs: number;
	/** Every layer that was flattened or skipped, with the reason. Omitted when
	 *  the whole design came through natively. */
	decisions?: ReportedDecision[];
};

export type FetchNodeTreeFn = (
	fileKey: string,
	nodeId: string,
) => Promise<FigmaContainerNode>;

export type ColorwayInput = {
	instanceId: string; // the INSTANCE node the colorway was read from
	label: string;
	perSide: Record<string, FigmaContainerNode>; // side name → instance's side child (fills read)
};

/** Which figma instance produced one emitted variant, keyed by the variant's
 *  id. The counterpart of FigmaPick for colorways. */
export type FigmaVariantPick = {
	instanceId: string;
	label: string;
};

export type TranspileInput = {
	product: ProductRegistryEntry;
	sizeMode?: SizeMode; // default "exact"
	picks: Record<string, FigmaPick>; // base side children (template_data)
	variants?: ColorwayInput[]; // colorway instances (optional; omitted/[] = no colorways)
	metadata: TemplateMetadata;
	fetchNodeTree: FetchNodeTreeFn;
	renderImage: RenderImageFn;
};

export type TranspileOutput = {
	template: unknown;
	pendingAssets: PendingAsset[];
	fieldsInferred: Array<{ id: string; field: Record<string, unknown> }>;
	warnings: TemplateWarning[];
	/** Keyed by emitted variant id. Empty when the card has no colorways; the
	 *  synthesized "default" variant has no instance behind it and is absent. */
	variantPicks: Record<string, FigmaVariantPick>;
	report: TranspileReport;
	/** What the walk decided about every node it reached. The template carries
	 *  only the notable rows (see TranspileReport.decisions); this is the whole
	 *  record, for a diagnostics export to pair with the scene graph it read. */
	trace: NodeTrace[];
};
