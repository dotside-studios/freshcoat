import { afterEach, describe, expect, it } from "vitest";
import {
	applyRemoteProducts,
	getProductSpec,
	listProductSpecs,
	loadProductRegistry,
	parseProductsExport,
} from "~/main/product";

// Reset the registry to the shipped fallback after any test that mutates it,
// so tests don't leak state through the module-level registry.
afterEach(() => {
	applyRemoteProducts([]);
});

describe("getProductSpec", () => {
	it("returns card_cr80 with exact print dimensions", () => {
		const p = getProductSpec("card_cr80");
		expect(p).not.toBeNull();
		expect(p?.width).toBe(1012);
		expect(p?.height).toBe(638);
		expect(p?.frames.map((f) => f.name)).toEqual(["front", "back"]);
	});
	it("returns null for an unknown sku", () => {
		expect(getProductSpec("nope")).toBeNull();
	});
});

describe("parseProductsExport", () => {
	it("maps the exported record to the plugin shape (authorWidth/Height → width/height)", () => {
		const entries = parseProductsExport({
			version: 1,
			products: [
				{
					sku: "card_square",
					displayName: "Square Card",
					weight_grams: 8,
					authorWidth: 800,
					authorHeight: 800,
					price_cents: 25000,
					frames: [{ name: "front", label: "Front", required: true }],
				},
			],
		});
		expect(entries).toEqual([
			{
				sku: "card_square",
				displayName: "Square Card",
				width: 800,
				height: 800,
				frames: [{ name: "front", label: "Front", required: true }],
			},
		]);
	});

	it("skips malformed products and tolerates non-object payloads", () => {
		expect(parseProductsExport(null)).toEqual([]);
		expect(parseProductsExport({ products: "nope" })).toEqual([]);
		const entries = parseProductsExport({
			products: [
				{
					sku: "ok",
					displayName: "Ok",
					authorWidth: 10,
					authorHeight: 20,
					frames: [{ name: "front", label: "Front" }],
				},
				{
					sku: "no_frames",
					displayName: "No frames",
					authorWidth: 10,
					authorHeight: 20,
					frames: [],
				},
				{
					displayName: "No sku",
					authorWidth: 10,
					authorHeight: 20,
					frames: [{ name: "front", label: "Front" }],
				},
				{
					sku: "bad_dims",
					displayName: "Bad dims",
					authorWidth: "x",
					authorHeight: 20,
					frames: [{ name: "front", label: "Front" }],
				},
			],
		});
		expect(entries.map((e) => e.sku)).toEqual(["ok"]);
	});
});

describe("applyRemoteProducts", () => {
	it("overlays remote entries while keeping fallback-only SKUs", () => {
		applyRemoteProducts([
			{
				sku: "card_square",
				displayName: "Square Card",
				width: 800,
				height: 800,
				frames: [{ name: "front", label: "Front", required: true }],
			},
		]);
		// Remote-added sku resolves…
		expect(getProductSpec("card_square")?.width).toBe(800);
		// …and the shipped fallback sku still resolves.
		expect(getProductSpec("card_cr80")?.width).toBe(1012);
		expect(
			listProductSpecs()
				.map((p) => p.sku)
				.sort(),
		).toEqual(["card_cr80", "card_square"]);
	});

	it("lets a remote entry override a fallback sku", () => {
		applyRemoteProducts([
			{
				sku: "card_cr80",
				displayName: "CR80 (remote)",
				width: 1012,
				height: 700,
				frames: [{ name: "front", label: "Front", required: true }],
			},
		]);
		expect(getProductSpec("card_cr80")?.displayName).toBe("CR80 (remote)");
		expect(getProductSpec("card_cr80")?.height).toBe(700);
	});
});

describe("loadProductRegistry", () => {
	function jsonResponse(body: unknown, ok = true) {
		return { ok, json: async () => body };
	}

	it("applies the fetched catalog and returns the parsed entries", async () => {
		const entries = await loadProductRegistry(async () =>
			jsonResponse({
				products: [
					{
						sku: "card_square",
						displayName: "Square Card",
						authorWidth: 800,
						authorHeight: 800,
						frames: [{ name: "front", label: "Front", required: true }],
					},
				],
			}),
		);
		expect(entries?.map((e) => e.sku)).toEqual(["card_square"]);
		expect(getProductSpec("card_square")?.width).toBe(800);
	});

	it("returns null and keeps the fallback on a non-2xx response", async () => {
		const entries = await loadProductRegistry(async () =>
			jsonResponse({}, false),
		);
		expect(entries).toBeNull();
		expect(listProductSpecs().map((p) => p.sku)).toEqual(["card_cr80"]);
	});

	it("returns null and keeps the fallback when fetch throws", async () => {
		const entries = await loadProductRegistry(async () => {
			throw new Error("network down");
		});
		expect(entries).toBeNull();
		expect(getProductSpec("card_cr80")).not.toBeNull();
	});

	it("returns null when the payload has no usable products", async () => {
		const entries = await loadProductRegistry(async () =>
			jsonResponse({ products: [] }),
		);
		expect(entries).toBeNull();
	});
});
