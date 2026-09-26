import type { FrameSlot, ProductRegistryEntry } from "~/lib/figma/transpiler";

// Hardcoded catalog shipped with the plugin. This is the FALLBACK: it seeds the
// registry so the plugin works immediately (and fully offline), and it's what
// the plugin falls back to if the live catalog can't be fetched (network
// blocked, non-2xx, malformed). The live catalog, once loaded, overlays these
// by sku — remote wins, but a sku present only here still resolves.
const PRODUCTS: Record<string, ProductRegistryEntry> = {
	card_cr80: {
		sku: "card_cr80",
		displayName: "CR80 Card",
		width: 1013,
		height: 638,
		frames: [
			{ name: "front", label: "Front", required: true },
			{ name: "back", label: "Back", required: true },
		],
	},
};

// Where the order site publishes its catalog (admin → Products → Export
// products, written to `catalog/products.json` on the site's S3 public base).
// The plugin fetches this at startup; the manifest's `networkAccess` must allow
// this host.
export const PRODUCTS_REGISTRY_URL =
	"https://davishopusercontent.dotsidecdn.net/catalog/products.json";

// The live registry: starts as the shipped fallback, replaced/extended once the
// remote catalog loads. The two plugin contexts (main sandbox, UI iframe) each
// bundle this module separately and keep their own copy — only the UI can make
// network requests, so it fetches and forwards the parsed entries to main (see
// the `products-loaded` message), and both apply them here.
let registry: Record<string, ProductRegistryEntry> = { ...PRODUCTS };

/** The sku a custom export carries. Deliberately not a catalog sku: it never
 *  resolves in the registry, and the order site's import rejects a template
 *  whose `product` doesn't match a product record — a custom bundle is meant to
 *  be fed to coatfile directly, not through the Davi order pipeline. */
export const CUSTOM_PRODUCT_SKU = "custom";

/** A one-off product standing in for "no product": the picked frame is the
 *  whole template and its measured size is the canvas. Shaped as a registry
 *  entry so the transpiler's per-slot machinery (picks, colorway diffing,
 *  field harvesting) runs unchanged — the single slot is the frame itself.
 *  width/height are only a seed here; the transpiler's "from-design" sizeMode
 *  takes the real dims off the design. */
export function makeCustomProduct(
	frameName: string,
	width: number,
	height: number,
): ProductRegistryEntry {
	return {
		sku: CUSTOM_PRODUCT_SKU,
		displayName: "Custom",
		width,
		height,
		frames: [{ name: frameName, label: frameName, required: true }],
	};
}

export function getProductSpec(sku: string): ProductRegistryEntry | null {
	return registry[sku] ?? null;
}

export function listProductSpecs(): ProductRegistryEntry[] {
	return Object.values(registry);
}

/** Overlay loaded entries on the shipped fallback. Rebuilt from PRODUCTS each
 *  call so a reload reflects SKUs removed from the remote catalog while still
 *  keeping any fallback-only sku. */
export function applyRemoteProducts(entries: ProductRegistryEntry[]): void {
	const next: Record<string, ProductRegistryEntry> = { ...PRODUCTS };
	for (const entry of entries) next[entry.sku] = entry;
	registry = next;
}

function parseFrames(raw: unknown): FrameSlot[] {
	if (!Array.isArray(raw)) return [];
	const frames: FrameSlot[] = [];
	for (const item of raw) {
		const f = item as Record<string, unknown>;
		if (typeof f.name === "string" && typeof f.label === "string") {
			frames.push({ name: f.name, label: f.label, required: true });
		}
	}
	return frames;
}

/** Map the exported catalog JSON to the plugin's product shape. The order site
 *  exports the full product record (author-space canvas as `authorWidth`/
 *  `authorHeight`, plus commerce fields); the plugin only needs geometry and
 *  frame slots. Parses defensively — a malformed product is skipped rather than
 *  failing the whole load. */
export function parseProductsExport(payload: unknown): ProductRegistryEntry[] {
	const products = (payload as { products?: unknown } | null)?.products;
	if (!Array.isArray(products)) return [];

	const out: ProductRegistryEntry[] = [];
	for (const raw of products) {
		const p = raw as Record<string, unknown>;
		const width = Number(p.authorWidth);
		const height = Number(p.authorHeight);
		const frames = parseFrames(p.frames);
		if (
			typeof p.sku !== "string" ||
			typeof p.displayName !== "string" ||
			!Number.isFinite(width) ||
			!Number.isFinite(height) ||
			frames.length === 0
		) {
			continue;
		}
		out.push({ sku: p.sku, displayName: p.displayName, width, height, frames });
	}
	return out;
}

// Minimal fetch surface, so this module doesn't depend on the DOM `fetch` type
// (it's bundled into the main sandbox too, which has no fetch — only the UI
// injects a real implementation).
type FetchLike = (
	input: string,
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/** Fetch the published catalog and overlay it on the fallback. Returns the
 *  parsed entries on success, or null on any failure (network error, non-2xx,
 *  empty/malformed payload) — in which case the shipped fallback stays in
 *  effect. Never throws: a catalog that can't load must not break the plugin. */
export async function loadProductRegistry(
	fetchImpl: FetchLike,
): Promise<ProductRegistryEntry[] | null> {
	try {
		const res = await fetchImpl(PRODUCTS_REGISTRY_URL);
		if (!res.ok) return null;
		const entries = parseProductsExport(await res.json());
		if (entries.length === 0) return null;
		applyRemoteProducts(entries);
		return entries;
	} catch {
		return null;
	}
}
