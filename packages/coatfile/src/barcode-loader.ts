import type { BarcodeEncoder } from "./barcode-encoder";

// bwip-js weighs ~87 KB gzipped and most templates have no barcode, so its
// chunk is only fetched when something needs it.
let loading: Promise<BarcodeEncoder> | null = null;

/** `bwipBarcodeEncoder`, loaded on first use. A failed load is retried by the
 *  next call. */
export function loadBarcodeEncoder(): Promise<BarcodeEncoder> {
	loading ??= import("./barcode").then(
		({ bwipBarcodeEncoder }) => bwipBarcodeEncoder,
		(err: unknown) => {
			loading = null;
			throw err;
		},
	);
	return loading;
}
