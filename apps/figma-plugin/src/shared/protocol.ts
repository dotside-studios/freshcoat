import type {
	BindProperty,
	BindTarget,
	FieldFormat,
	FieldMeta,
} from "~/lib/figma/binding";
import type { ProductRegistryEntry } from "~/lib/figma/transpiler";
import type { FigmaContainerNode } from "~/lib/figma/types";

/** What the export is scoped to.
 *  - "davi": a catalog product. Fixed print size, fixed frame slots, importable
 *    by the order site (which matches `template.product` to a product record).
 *  - "custom": no product. The picked frame IS the template — its measured size
 *    is the canvas and `template.product` is the placeholder "custom" sku. For
 *    art rendered through coatfile outside the Davi order pipeline. */
export type TemplateMode = "davi" | "custom";

/** One product slot the author assigned a frame to. */
export type SlotRead = {
	slot: string; // "front" | "back"
	nodeId: string;
	nodeName: string;
	width: number;
	height: number;
	tree: FigmaContainerNode;
};

/** A raster the main thread pre-exported for a node id. */
export type RasterRead = {
	nodeId: string;
	bytes: Uint8Array; // PNG bytes
};

/** main → ui: everything transpile needs, gathered offline. */
export type ReadDocumentMessage = {
	type: "read-document";
	product: ProductRegistryEntry;
	mode: TemplateMode;
	slots: SlotRead[];
	colorways: ColorwayRead[];
	rasters: RasterRead[];
};

/** main → ui: a read ended without producing a document. The UI blocks on
 *  read-document to clear its spinner, so every path out of a read — a bad
 *  node, a thrown export — has to say so or the panel spins forever. */
export type ReadFailedMessage = {
	type: "read-failed";
	message: string;
};

/** main → ui: how far a read has got. Rasterizing is the slow step and there is
 *  no way to know from outside whether it is working or wedged. */
export type ReadProgressMessage = {
	type: "read-progress";
	text: string;
};

export type CardSideView = {
	side: string;
	nodeId: string | null;
	nodeName: string | null;
};
export type CardView = {
	id: string;
	name: string;
	sides: CardSideView[];
	missingRequired: string[];
	colorways: Array<{ instanceId: string; label: string }>;
	unmatchedInstances: number;
	canHaveColorways: boolean; // true when the card is a COMPONENT
};

/** A top-level frame offered as a custom-mode canvas. Unlike a CardView it has
 *  no side slots — the node itself is the template's single frame — so it
 *  carries its own measured size instead. */
export type NodeCandidate = {
	id: string;
	name: string;
	width: number;
	height: number;
	canHaveColorways: boolean; // true when the node is a COMPONENT
	colorways: Array<{ instanceId: string; label: string }>;
	unmatchedInstances: number;
};

/** main → ui: sent on startup, on selectionchange, and on currentpagechange. */
export type CardsMessage = {
	type: "cards";
	cards: CardView[];
	/** Every top-level frame on the page, for custom mode — where any frame can
	 *  be a template, not just ones with product-named side children. */
	nodes: NodeCandidate[];
	pageName: string;
	/** The detected card currently highlighted on the canvas (the selection's
	 *  top-level card ancestor), or null. Drives the UI's "Use selected" button
	 *  and the initial auto-selection. */
	selectedCardId: string | null;
	/** Same, for custom mode: the selection's top-level ancestor when it is one
	 *  of `nodes`. Broader than selectedCardId — any frame qualifies. */
	selectedNodeId: string | null;
};

/** ui → main: ask main to read the assigned card sides. The UI sends the whole
 *  product entry rather than a sku: in custom mode it is synthesized per-export
 *  (makeCustomProduct) and never exists in main's registry. */
export type RequestReadMessage = {
	type: "request-read";
	product: ProductRegistryEntry;
	mode: TemplateMode;
	cardId: string;
	sideAssignment: Record<string, string>; // side → child node id (author-confirmed)
};

export type ColorwayRead = {
	/** The INSTANCE node this colorway was read from. Carried through to the
	 *  export so a variant can be traced back to the layer that produced it,
	 *  the way a frame is traced through `source.picks`. */
	instanceId: string;
	label: string;
	perSide: Record<string, FigmaContainerNode>;
};

/** One field a selected node references, with its current metadata. */
export type SelectionFieldDetail = {
	id: string;
	format: FieldFormat;
	meta: FieldMeta;
};

/** main → ui: the binding state of the single selected node (Layer tab). */
export type SelectionDetail = {
	nodeId: string;
	name: string;
	nodeType: string;
	/** Properties this node can be bound on (from the capability table). */
	capabilities: BindTarget[];
	/** Current property → value template (stored pluginData, else live inference). */
	bind: Partial<Record<BindProperty, string>>;
	/** Fields the current binding references, with metadata. */
	fields: SelectionFieldDetail[];
};

export type SelectionDetailMessage = {
	type: "selection-detail";
	detail: SelectionDetail | null;
};

/** ui → main: materialize all markers in the assigned card sides into pluginData. */
export type HarvestMessage = {
	type: "harvest";
	product: ProductRegistryEntry;
	cardId: string;
	sideAssignment: Record<string, string>;
};

/** ui → main: write the selected node's binding + field metadata. */
export type SetBindingMessage = {
	type: "set-binding";
	nodeId: string;
	bind: Partial<Record<BindProperty, string>>;
	fields: FieldMeta[];
	/** Field id renames to rewrite into the layer-name marker. */
	renames?: Array<{ from: string; to: string }>;
	/** Field ids no longer referenced by this node (removed from slot metadata). */
	removedIds?: string[];
	/** Set the layer name outright (used to write a `qr:` marker, since QR
	 * detection is layer-name driven). Overrides any rename rewrite. */
	setName?: string;
};

/** ui → main: unbind the selected node. */
export type ClearBindingMessage = {
	type: "clear-binding";
	nodeId: string;
	removedIds: string[];
};

/** ui → main: select + zoom to a node on the canvas. */
export type FocusNodeMessage = { type: "focus-node"; nodeId: string };

/** ui → main: resize a slot frame to the canvas the export needs. Offered as a
 *  one-click fix on a size error, since the correct dimensions are exactly what
 *  the error already knows. */
export type ResizeNodeMessage = {
	type: "resize-node";
	nodeId: string;
	width: number;
	height: number;
};

/** One field in the template-wide overview (Fields tab). */
export type FieldOverviewItem = {
	id: string;
	meta: FieldMeta;
	/** Card node name this field's metadata lives on. */
	slot: string;
	/** Nodes whose binding references this field (for jump-to-canvas). */
	nodeIds: string[];
	/** Their layer names, in the same order, for the Fields tab's rows. */
	layerNames?: string[];
};

/** main → ui: every field stored across the page's cards. */
export type FieldsOverviewMessage = {
	type: "fields-overview";
	fields: FieldOverviewItem[];
};

/** ui → main: ask for a fresh fields overview. */
export type RequestFieldsMessage = { type: "request-fields" };

/** ui → main: export small PNG previews of these frames. Requested lazily for
 *  the frames actually on screen, not for the whole page — an export is a real
 *  cost and postCards runs on every selection change. */
export type RequestThumbnailsMessage = {
	type: "request-thumbnails";
	nodeIds: string[];
};

/** main → ui: preview bytes, keyed by node id. Sent in response to a request,
 *  and unprompted for a node main has just changed (see handleResize) so a
 *  stale preview corrects itself. */
export type ThumbnailsMessage = {
	type: "thumbnails";
	items: Array<{ nodeId: string; bytes: Uint8Array }>;
};

/** Panel state that outlives a session, in figma.clientStorage. Deliberately
 *  only choices the author would resent re-making: window size, where they
 *  were, and how they export. Never per-template content (a name or
 *  description belongs to one design, not to the plugin). */
export type PluginSettings = {
	windowWidth: number;
	windowHeight: number;
	tab: string;
	daviMode: boolean;
	productSku: string;
	/** Where "Open in Freshcoat" sends a template. See `lib/handoff.ts`. */
	freshcoatUrl: string;
	/** Open the result's diagnostics section after each export. */
	showDiagnostics: boolean;
};

/** The Freshcoat address a build ships with, from the `FRESHCOAT_URL`
 *  environment variable at build time (see build-figma-plugin.*.js). */
declare const FRESHCOAT_URL: string | undefined;

export const DEFAULT_SETTINGS: PluginSettings = {
	// The compact window the panel is designed for, the size of Figma's own
	// side panels. The resize grip makes it larger, and that size is kept.
	windowWidth: 320,
	windowHeight: 480,
	// First run opens on Layer — marking up layers is the start of the workflow,
	// and its empty state is what teaches the marker grammar. Afterwards the
	// author reopens wherever they left off.
	tab: "layer",
	daviMode: false,
	productSku: "",
	freshcoatUrl: typeof FRESHCOAT_URL === "string" ? FRESHCOAT_URL : "",
	showDiagnostics: false,
};

/** main → ui: the stored settings. Sent unprompted on startup and in reply to
 *  request-settings. */
export type SettingsMessage = {
	type: "settings";
	settings: PluginSettings;
};

/** ui → main: send me the settings. The UI asks on mount rather than relying
 *  solely on the startup push — it renders nothing until settings land, so a
 *  message that arrives before the iframe is listening would leave a blank
 *  panel rather than a stale one. */
export type RequestSettingsMessage = { type: "request-settings" };

/** ui → main: merge and persist these keys. */
export type SaveSettingsMessage = {
	type: "save-settings";
	settings: Partial<PluginSettings>;
};

/** ui → main: live window resize from the corner grip. Fires continuously
 *  during a drag; the size is persisted separately on release. */
export type ResizeWindowMessage = {
	type: "resize-window";
	width: number;
	height: number;
};

/** ui → main: the live product catalog the UI fetched from the order site.
 *  Only the UI iframe can make network requests, so it forwards the parsed
 *  entries here for the main sandbox to overlay on its shipped fallback. */
export type ProductsLoadedMessage = {
	type: "products-loaded";
	products: ProductRegistryEntry[];
};

/** ui → main: open this URL in the browser. The UI is a sandboxed iframe
 *  and cannot navigate anywhere itself; only `figma.openExternal` can. */
export type OpenExternalMessage = { type: "open-external"; url: string };

export type MainToUi =
	| ReadDocumentMessage
	| ReadFailedMessage
	| ReadProgressMessage
	| CardsMessage
	| SelectionDetailMessage
	| FieldsOverviewMessage
	| ThumbnailsMessage
	| SettingsMessage;
export type UiToMain =
	| RequestReadMessage
	| HarvestMessage
	| SetBindingMessage
	| ClearBindingMessage
	| FocusNodeMessage
	| ResizeNodeMessage
	| RequestFieldsMessage
	| RequestThumbnailsMessage
	| RequestSettingsMessage
	| SaveSettingsMessage
	| ResizeWindowMessage
	| ProductsLoadedMessage
	| OpenExternalMessage;
